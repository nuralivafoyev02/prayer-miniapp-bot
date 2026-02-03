const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const BOT_TOKEN = mustEnv("BOT_TOKEN");
const TG_WEBHOOK_SECRET = mustEnv("TG_WEBHOOK_SECRET");
const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function tg(method, payload) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

function ik(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function t(lang, key) {
  const dict = {
    uz: {
      startIntro:
        "Assalomu alaykum! Men namoz va Ramazon vaqtlarini eslatib turaman.\n\n✅ Til tanlash\n✅ Viloyat → tuman → shahar\n✅ Namoz vaqtida eslatma\n✅ Ramazonda saharlik/iftor + duo\n✅ Har kuni bugungi va ertangi jadval",
      chooseLang: "Tilni tanlang:",
      chooseRegion: "Viloyatni tanlang:",
      chooseDistrict: "Tumanni tanlang:",
      chooseCity: "Shaharni tanlang:",
      prefsTitle: "Eslatmalarni sozlang:",
      prefsSaved: "✅ Saqlandi",
      openMiniapp: "📲 Mini App ochish",
      done: "✅ Tayyor! Endi mini app orqali ham ko‘rasiz."
    }
  };
  return (dict[lang] && dict[lang][key]) || dict.uz[key] || key;
}

async function upsertUser(tgUserId) {
  const { data } = await sb.from("users").select("tg_user_id").eq("tg_user_id", tgUserId).maybeSingle();
  if (!data) await sb.from("users").insert({ tg_user_id: tgUserId });
}

async function getUser(tgUserId) {
  const { data, error } = await sb.from("users").select("*").eq("tg_user_id", tgUserId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setUser(tgUserId, patch) {
  const { error } = await sb.from("users").update({ ...patch, updated_at: new Date().toISOString() }).eq("tg_user_id", tgUserId);
  if (error) throw error;
}

async function getChildren(parentCode, level) {
  let q = sb.from("locations").select("*").eq("level", level);
  if (parentCode === null) q = q.is("parent_code", null);
  else q = q.eq("parent_code", parentCode);
  const { data, error } = await q.order("name_uz", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getLocation(code) {
  const { data, error } = await sb.from("locations").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Mini app initData validation (HMAC-SHA256) — Telegram talabi.
 * Telegram mini apps initData ni serverda validate qilish shart. :contentReference[oaicite:2]{index=2}
 */
function validateInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("No hash in initData");

  params.delete("hash");
  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computed !== hash) throw new Error("Invalid initData signature");
  return Object.fromEntries(pairs);
}

function parseMiniappUser(initData) {
  const data = validateInitData(initData);
  const user = JSON.parse(data.user || "{}");
  if (!user.id) throw new Error("No user in initData");
  return { tg_user_id: user.id };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function locKeyboard(items, prefix, page, pageSize) {
  const pages = chunk(items, pageSize);
  const p = Math.max(0, Math.min(page, pages.length - 1));
  const rows = (pages[p] || []).map(x => [{ text: x.name_uz, callback_data: `${prefix}:${x.code}:0` }]);

  const nav = [];
  if (p > 0) nav.push({ text: "⬅️", callback_data: `${prefix}:__PAGE__:${p - 1}` });
  if (p < pages.length - 1) nav.push({ text: "➡️", callback_data: `${prefix}:__PAGE__:${p + 1}` });
  if (nav.length) rows.push(nav);

  return ik(rows);
}

function prefsKeyboard(u) {
  const rows = [
    [{ text: `🕌 Namoz: ${u.notify_prayers ? "ON" : "OFF"}`, callback_data: "pref:notify_prayers" }],
    [{ text: `🌙 Ramazon: ${u.notify_ramadan ? "ON" : "OFF"}`, callback_data: "pref:notify_ramadan" }],
    [{ text: `☀️ Har kuni ertalab: ${u.notify_daily_morning ? "ON" : "OFF"}`, callback_data: "pref:notify_daily_morning" }],
    [{ text: `🌆 Har kuni kechqurun: ${u.notify_daily_evening ? "ON" : "OFF"}`, callback_data: "pref:notify_daily_evening" }],
    [{ text: "📲 Mini App", web_app: { url: `${mustEnv("MINIAPP_URL")}` } }]
  ];
  return { reply_markup: { inline_keyboard: rows } };
}

async function isRamadanToday() {
  const today = new Date(); // TZ=Asia/Tashkent bo'lsa to'g'ri
  const d = today.toISOString().slice(0, 10);
  const { data, error } = await sb.from("ramadan_periods")
    .select("*")
    .lte("starts_on", d)
    .gte("ends_on", d)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

module.exports = {
  sb, tg, ik, t,
  BOT_TOKEN, TG_WEBHOOK_SECRET,
  upsertUser, getUser, setUser,
  getChildren, getLocation,
  parseMiniappUser,
  locKeyboard, prefsKeyboard,
  isRamadanToday
};
