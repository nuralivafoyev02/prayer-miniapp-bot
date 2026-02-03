const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const BOT_TOKEN = mustEnv("BOT_TOKEN");
const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const TG_WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET || "";
const MINIAPP_URL = process.env.MINIAPP_URL || "";

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
    [{ text: `☀️ Ertalab jadval: ${u.notify_daily_morning ? "ON" : "OFF"}`, callback_data: "pref:notify_daily_morning" }],
    [{ text: `🌆 Kechki jadval: ${u.notify_daily_evening ? "ON" : "OFF"}`, callback_data: "pref:notify_daily_evening" }]
  ];

  if (MINIAPP_URL) rows.push([{ text: "📲 Mini App", web_app: { url: MINIAPP_URL } }]);

  return { reply_markup: { inline_keyboard: rows } };
}

async function upsertUser(tgUserId) {
  const { data, error } = await sb.from("users").select("tg_user_id").eq("tg_user_id", tgUserId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { error: insErr } = await sb.from("users").insert({ tg_user_id: tgUserId });
    if (insErr) throw insErr;
  }
}

async function getUser(tgUserId) {
  const { data, error } = await sb.from("users").select("*").eq("tg_user_id", tgUserId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setUser(tgUserId, patch) {
  const { error } = await sb
    .from("users")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tg_user_id", tgUserId);
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

function userFriendlyError(e) {
  const msg = String(e?.message || e || "");
  if (msg.includes("PGRST205") && msg.includes("locations")) {
    return "⚠️ Lokatsiya bazasi hali yuklanmagan (locations).\nHozircha 📍 lokatsiyangizni yuboring.";
  }
  if (msg.includes("PGRST205") && msg.includes("users")) {
    return "⚠️ Baza sozlanmagan (users jadvali yo‘q). Admin Supabase SQL’ni run qilishi kerak.";
  }
  if (msg.includes("Telegram") && msg.includes("Unauthorized")) {
    return "⚠️ Bot token xato yoki env yo‘q. Vercel Environment Variables tekshiring.";
  }
  return "⚠️ Texnik xatolik. Iltimos keyinroq urinib ko‘ring.";
}

/**
 * Telegram Mini App initData validate (HMAC SHA256)
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

async function isRamadanToday() {
  const d = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("ramadan_periods")
    .select("*")
    .lte("starts_on", d)
    .gte("ends_on", d)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}
const APP_TZ = process.env.APP_TZ || process.env.TZ || "Asia/Tashkent";

function fmtTime(date, tz = APP_TZ) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

// Toshkent bo'yicha "bugun" sanasini aniq olish (server UTC bo'lsa ham)
function tzDate(tz = APP_TZ, addDays = 0) {
  const now = new Date(Date.now() + addDays * 86400000);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const get = (t) => parts.find(p => p.type === t)?.value;
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));

  // UTC muhitida ham y/m/d to'g'ri bo'lishi uchun UTC noon
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}


module.exports = {
  sb, tg, ik,
  BOT_TOKEN, TG_WEBHOOK_SECRET, MINIAPP_URL,
  upsertUser, getUser, setUser,
  getChildren, getLocation,
  locKeyboard, prefsKeyboard,
  userFriendlyError,
  parseMiniappUser,
  isRamadanToday,
  APP_TZ,
  fmtTime,
  tzDate,
};
