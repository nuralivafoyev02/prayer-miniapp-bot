import { supabaseAdmin } from "../_lib/supabase.js";
import { sendMessage } from "../_lib/telegram.js";
import { nowIso } from "../_lib/time.js";

function labelUZ(kind) {
  return {
    FAJR: "Bomdod vaqti",
    DHUHR: "Peshin vaqti",
    ASR: "Asr vaqti",
    MAGHRIB: "Shom vaqti",
    ISHA: "Xufton vaqti",
    IMSAK: "Og‘iz yopish vaqti",
    IFTAR: "Og‘iz ochish vaqti",
    MORNING_SUMMARY: "Bugungi namoz vaqtlari",
    EVENING_SUMMARY: "Ertangi jadval"
  }[kind] || kind;
}

function timesTextUZ(cache) {
  return (
    `Bomdod: <b>${cache.fajr}</b>\n` +
    `Peshin: <b>${cache.dhuhr}</b>\n` +
    `Asr: <b>${cache.asr}</b>\n` +
    `Shom: <b>${cache.maghrib}</b>\n` +
    `Xufton: <b>${cache.isha}</b>\n` +
    (cache.imsak ? `Saharlik tugashi (Imsak): <b>${cache.imsak}</b>\n` : "")
  );
}

export default async function handler(req, res) {
  if ((req.query.key || "") !== process.env.CRON_SECRET) return res.status(401).send("No");

  const sb = supabaseAdmin();
  const now = new Date();

  // Grace window: last 10 minutes to now (if function delayed, still sends)
  const from = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 15 * 1000).toISOString();

  const { data: due, error } = await sb
    .from("scheduled_notifications")
    .select("*")
    .eq("status", "pending")
    .gte("fire_at", from)
    .lte("fire_at", to)
    .order("fire_at", { ascending: true })
    .limit(200);

  if (error) throw error;

  let sent = 0, failed = 0;

  for (const n of due || []) {
    try {
      const telegramId = n.telegram_id;
      const kind = n.kind;
      const payload = n.payload || {};
      const day = payload.day;

      // user + cache
      const { data: user } = await sb
        .from("users")
        .select("language, city_key")
        .eq("telegram_id", telegramId)
        .single();

      const lang = user?.language || "uz";
      const cityKey = user?.city_key;

      let text = "";

      if (kind === "MORNING_SUMMARY" || kind === "EVENING_SUMMARY") {
        const targetDay = kind === "EVENING_SUMMARY" ? payload.day : payload.day;
        const { data: cache } = await sb
          .from("daily_times_cache")
          .select("*")
          .eq("city_key", cityKey)
          .eq("day", targetDay)
          .single();

        if (lang === "uz") {
          text = `<b>${labelUZ(kind)}</b>\n\n${timesTextUZ(cache)}`;
        } else {
          // minimal fallback
          text = `<b>${kind}</b>\n\nFajr ${cache.fajr}\nDhuhr ${cache.dhuhr}\nAsr ${cache.asr}\nMaghrib ${cache.maghrib}\nIsha ${cache.isha}`;
        }
      } else if (kind === "IFTAR") {
        if (lang === "uz") {
          const { data: dua } = await sb.from("duas").select("*").eq("kind", "iftar").eq("language", "uz").single();
          text =
            `🌙 <b>${labelUZ(kind)}</b> — <b>${payload.local_time}</b>\n\n` +
            `🤲 <b>${dua?.title || "Iftor duosi"}</b>\n${dua?.body || ""}`;
        } else {
          text = `IFTAR — ${payload.local_time}`;
        }
      } else if (kind === "IMSAK") {
        text = lang === "uz"
          ? `🌙 <b>${labelUZ(kind)}</b> — <b>${payload.local_time}</b>`
          : `IMSAK — ${payload.local_time}`;
      } else {
        // prayer single
        text = lang === "uz"
          ? `🕌 <b>${labelUZ(kind)}</b> — <b>${payload.local_time}</b>`
          : `${kind} — ${payload.local_time}`;
      }

      await sendMessage(telegramId, text);

      await sb.from("scheduled_notifications")
        .update({ status: "sent", sent_at: nowIso(), last_error: null })
        .eq("id", n.id);

      await sb.from("sent_log").insert({ telegram_id: telegramId, kind, fire_at: n.fire_at });

      sent++;
      await new Promise(r => setTimeout(r, 60)); // tiny delay (rate-limit safety)
    } catch (e) {
      failed++;
      await sb.from("scheduled_notifications")
        .update({ last_error: String(e).slice(0, 400), updated_at: nowIso() })
        .eq("id", n.id);
    }
  }

  res.status(200).json({ due: due?.length || 0, sent, failed, window: { from, to } });
}
