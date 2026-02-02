import { supabaseAdmin } from "../_lib/supabase.js";
import { sendMessage, editMessageText, answerCallbackQuery } from "../_lib/telegram.js";
import { tr } from "../_lib/text.js";
import { rebuildUserSchedules } from "../_lib/schedule.js";

const REGIONS = {
  toshkent: { title: "Toshkent", cities: [
    { key: "toshkent_toshkent", title: "Toshkent sh." },
    { key: "toshkent_viloyat", title: "Nurafshon" }
  ]},
  samarqand: { title: "Samarqand", cities: [{ key: "samarqand_samarqand", title: "Samarqand" }]},
  buxoro: { title: "Buxoro", cities: [{ key: "buxoro_buxoro", title: "Buxoro" }]},
  andijon: { title: "Andijon", cities: [{ key: "andijon_andijon", title: "Andijon" }]},
  namangan: { title: "Namangan", cities: [{ key: "namangan_namangan", title: "Namangan" }]},
  fargona: { title: "Farg‘ona", cities: [{ key: "fargona_fargona", title: "Farg‘ona" }]},
  qashqadaryo: { title: "Qashqadaryo", cities: [{ key: "qashqadaryo_qarshi", title: "Qarshi" }]},
  surxondaryo: { title: "Surxondaryo", cities: [{ key: "surxondaryo_termiz", title: "Termiz" }]},
  xorazm: { title: "Xorazm", cities: [{ key: "xorazm_urganch", title: "Urganch" }]},
  qoraqalpoq: { title: "Qoraqalpog‘iston", cities: [{ key: "qoraqalpoq_nukus", title: "Nukus" }]}
};

function kb(rows) {
  return { inline_keyboard: rows };
}

function langKeyboard() {
  return kb([[
    { text: "🇺🇿 O‘zbek", callback_data: "lang:uz" },
    { text: "🇷🇺 Русский", callback_data: "lang:ru" },
    { text: "🇬🇧 English", callback_data: "lang:en" }
  ]]);
}

function regionsKeyboard() {
  const rows = Object.entries(REGIONS).map(([k, v]) => ([{ text: v.title, callback_data: `region:${k}` }]));
  return kb(rows);
}

function citiesKeyboard(regionKey) {
  const region = REGIONS[regionKey];
  const rows = region.cities.map(c => ([{ text: c.title, callback_data: `city:${c.key}` }]));
  rows.push([{ text: "⬅️ Orqaga", callback_data: "back:regions" }]);
  return kb(rows);
}

function notifyKeyboard(state) {
  const check = (v) => (v ? "✅" : "❌");
  return kb([
    [{ text: `${check(state.notify_prayers)} Namoz eslatma`, callback_data: "toggle:prayers" }],
    [{ text: `${check(state.notify_ramadan)} Ramazon (saharlik/iftor)`, callback_data: "toggle:ramadan" }],
    [{ text: `${check(state.notify_morning_summary)} Bomdoddan oldin jadval`, callback_data: "toggle:morning" }],
    [{ text: `${check(state.notify_evening_summary)} Kechqurun ertangi jadval`, callback_data: "toggle:evening" }],
    [{ text: "✅ Yakunlash", callback_data: "finish" }]
  ]);
}

function miniAppKeyboard() {
  return {
    inline_keyboard: [[
      { text: "📱 Mini App", web_app: { url: `${process.env.PUBLIC_BASE_URL}/mini/` } }
    ]]
  };
}

export default async function handler(req, res) {
  // Telegram secret header check :contentReference[oaicite:6]{index=6}
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  const sb = supabaseAdmin();
  const update = req.body || {};

  // 1) Message
  if (update.message?.text) {
    const chatId = update.message.chat.id;
    const fromId = update.message.from.id;

    await sb.from("users").upsert({ telegram_id: fromId }, { onConflict: "telegram_id" });

    if (update.message.text === "/start") {
      // default language unknown -> show intro in uz
      await sendMessage(chatId, tr("uz").intro, { reply_markup: langKeyboard() });
      return res.status(200).send("ok");
    }
  }

  // 2) Callback queries
  if (update.callback_query) {
    const cq = update.callback_query;
    const data = cq.data || "";
    const fromId = cq.from.id;
    const chatId = cq.message?.chat?.id;
    const msgId = cq.message?.message_id;

    const { data: user } = await sb.from("users").select("*").eq("telegram_id", fromId).maybeSingle();
    const lang = user?.language || "uz";
    const T = tr(lang);

    // Language select
    if (data.startsWith("lang:")) {
      const l = data.split(":")[1];
      await sb.from("users").update({ language: l, onboarding_step: "region" }).eq("telegram_id", fromId);
      await editMessageText(chatId, msgId, tr(l).chooseRegion, { reply_markup: regionsKeyboard() });
      await answerCallbackQuery(cq.id, "OK");
      return res.status(200).send("ok");
    }

    if (data === "back:regions") {
      await editMessageText(chatId, msgId, T.chooseRegion, { reply_markup: regionsKeyboard() });
      await answerCallbackQuery(cq.id, "OK");
      return res.status(200).send("ok");
    }

    // Region → cities
    if (data.startsWith("region:")) {
      const rk = data.split(":")[1];
      await editMessageText(chatId, msgId, T.chooseCity, { reply_markup: citiesKeyboard(rk) });
      await answerCallbackQuery(cq.id, "OK");
      return res.status(200).send("ok");
    }

    // City select → notify
    if (data.startsWith("city:")) {
      const cityKey = data.split(":")[1];
      await sb.from("users").update({
        city_key: cityKey,
        onboarding_step: "notify",
        notify_prayers: true,
        notify_ramadan: true,
        notify_morning_summary: true,
        notify_evening_summary: true
      }).eq("telegram_id", fromId);

      const { data: u2 } = await sb.from("users").select("*").eq("telegram_id", fromId).single();
      await editMessageText(chatId, msgId, T.chooseNotify, { reply_markup: notifyKeyboard(u2) });
      await answerCallbackQuery(cq.id, "OK");
      return res.status(200).send("ok");
    }

    // Toggle notify flags
    if (data.startsWith("toggle:")) {
      const key = data.split(":")[1];
      const map = {
        prayers: "notify_prayers",
        ramadan: "notify_ramadan",
        morning: "notify_morning_summary",
        evening: "notify_evening_summary"
      };
      const col = map[key];
      const current = !!user?.[col];
      await sb.from("users").update({ [col]: !current }).eq("telegram_id", fromId);

      const { data: u2 } = await sb.from("users").select("*").eq("telegram_id", fromId).single();
      await editMessageText(chatId, msgId, T.chooseNotify, { reply_markup: notifyKeyboard(u2) });
      await answerCallbackQuery(cq.id, !current ? "Yoqildi" : "O‘chirildi");
      return res.status(200).send("ok");
    }

    if (data === "finish") {
      await sb.from("users").update({ onboarding_step: "done" }).eq("telegram_id", fromId);

      // Build schedule now (today+tomorrow)
      await rebuildUserSchedules(fromId);

      await editMessageText(chatId, msgId, T.done, { reply_markup: miniAppKeyboard() });
      await answerCallbackQuery(cq.id, "Tayyor!");
      return res.status(200).send("ok");
    }
  }

  return res.status(200).send("ok");
}
