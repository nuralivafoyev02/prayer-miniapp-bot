import { supabaseAdmin } from "../_lib/supabase.js";
import { verifyInitData } from "../_lib/webapp.js";
import { isoDayUZT, addDaysISO } from "../_lib/time.js";
import { ensureCacheForCityDay } from "../_lib/schedule.js";

function nextPrayerInfo(today) {
  const now = new Date();
  const nowUZ = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const hh = String(nowUZ.getUTCHours()).padStart(2,"0");
  const mm = String(nowUZ.getUTCMinutes()).padStart(2,"0");
  const cur = `${hh}:${mm}`;

  const list = [
    ["Bomdod", today.fajr],
    ["Peshin", today.dhuhr],
    ["Asr", today.asr],
    ["Shom", today.maghrib],
    ["Xufton", today.isha]
  ].filter(x => x[1]);

  for (const [label, t] of list) {
    if (t >= cur) return { label: `${label} — ${t}`, in: `Hozirgi vaqt: ${cur}` };
  }
  return { label: `Ertangi Bomdod — ${today.fajr}`, in: `Hozirgi vaqt: ${cur}` };
}

export default async function handler(req, res) {
  const body = req.body || {};
  const initData = body.initData || "";
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const v = verifyInitData(initData, token);
  if (!v.ok) return res.status(401).json({ error: v.error });

  const telegramId = v.user?.id;
  if (!telegramId) return res.status(401).json({ error: "No user" });

  const sb = supabaseAdmin();

  // ensure user exists
  await sb.from("users").upsert({ telegram_id: telegramId }, { onConflict: "telegram_id" });

  const { data: user } = await sb.from("users").select("*").eq("telegram_id", telegramId).single();
  const cityKey = user?.city_key;

  const todayISO = isoDayUZT();
  const tomorrowISO = addDaysISO(todayISO, 1);

  let today = null, hijriMonth = null, isRamadan = false, iftarDua = "";

  if (cityKey) {
    const c1 = await ensureCacheForCityDay(sb, cityKey, todayISO);
    today = c1;
    hijriMonth = c1.hijri_month;
    isRamadan = Number(hijriMonth) === 9;
  }

  const { data: dua } = await sb.from("duas").select("*").eq("kind","iftar").eq("language", user.language || "uz").maybeSingle();
  iftarDua = dua?.body || "";

  // Week (next 7 days)
  const week = [];
  if (cityKey) {
    for (let i=0;i<7;i++) {
      const dISO = addDaysISO(todayISO, i);
      const c = await ensureCacheForCityDay(sb, cityKey, dISO);
      week.push({ day: dISO, fajr: c.fajr, dhuhr: c.dhuhr, asr: c.asr, maghrib: c.maghrib, isha: c.isha });
    }
  }

  // city text
  let cityText = "";
  if (cityKey) {
    const { data: c } = await sb.from("cities").select("region_uz,city_uz").eq("city_key", cityKey).maybeSingle();
    cityText = c ? `${c.region_uz} • ${c.city_uz}` : "";
  }

  const next = today ? nextPrayerInfo(today) : { label: "Shahar tanlanmagan", in: "" };

  res.status(200).json({
    city_text: cityText,
    settings: {
      notify_prayers: !!user.notify_prayers,
      notify_ramadan: !!user.notify_ramadan,
      notify_morning_summary: !!user.notify_morning_summary,
      notify_evening_summary: !!user.notify_evening_summary,
      offset_minutes: user.offset_minutes ?? 0
    },
    today: today ? {
      fajr: today.fajr, dhuhr: today.dhuhr, asr: today.asr, maghrib: today.maghrib, isha: today.isha, imsak: today.imsak
    } : null,
    hijri_month: hijriMonth,
    is_ramadan: isRamadan,
    iftar_dua: iftarDua,
    week,
    next_label: next.label,
    next_in: next.in,
    tomorrow: tomorrowISO
  });
}
