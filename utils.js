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

// Creator/admin access (comma-separated TG user IDs)
// Example: CREATOR_TG_IDS=123456789,987654321
const CREATOR_TG_IDS = new Set(
  String(process.env.CREATOR_TG_IDS || process.env.CREATOR_TG_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
);

function isCreator(tgUserId) {
  const id = Number(tgUserId);
  if (!Number.isFinite(id)) return false;
  return CREATOR_TG_IDS.has(id);
}

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

  if (!json.ok) {
    const desc = String(json.description || "");
    const low = desc.toLowerCase();

    // ✅ Telegram “o‘zgarmadi” desa, xato deb hisoblamaymiz
    if (low.includes("message is not modified")) return null;

    throw new Error(`Telegram ${method} failed: ${desc}`);
  }

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
  const rows = (pages[p] || []).map((x) => [{ text: x.name_uz, callback_data: `${prefix}:${x.code}:0` }]);

  const nav = [];
  if (p > 0) nav.push({ text: "⬅️", callback_data: `${prefix}:__PAGE__:${p - 1}` });
  if (p < pages.length - 1) nav.push({ text: "➡️", callback_data: `${prefix}:__PAGE__:${p + 1}` });
  if (nav.length) rows.push(nav);

  return ik(rows);
}

// (legacy) eski inline sozlamalar uchun (hozir Mini App asosiy)
// boshqa joylar buzilmasin deb qoldirdik
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

// ✅ Per-user commands: creator uchun /users ko'rinadi, boshqalar uchun yo'q
// Eslatma: chat_member scope ishlatamiz — guruhda ham “ko‘rinmas” bo‘lib qoladi.
async function setCommandsForChat(chatId, creator = false, userId = null) {
  const baseCommands = [
    { command: "start", description: "Boshlash" },
    { command: "location", description: "Lokatsiya yuborish" },
    { command: "reset", description: "Qayta sozlash" }
  ];
  const commands = creator ? baseCommands.concat([{ command: "users", description: "Userlar ro'yxati" }]) : baseCommands;

  const scope = userId
    ? { type: "chat_member", chat_id: chatId, user_id: Number(userId) }
    : { type: "chat", chat_id: chatId };

  try {
    await tg("setMyCommands", { commands, scope });
  } catch {
    // ignore
  }
}

/**
 * ✅ users.language NOT NULL bo'lsa ham yiqilmaydi:
 * - yangi user uchun language default "uz"
 * - agar sizda users jadvalida language ustuni bo'lmasa, fallback insert qiladi
 */
async function upsertUser(tgUserId) {
  const { data, error } = await sb.from("users").select("tg_user_id").eq("tg_user_id", tgUserId).maybeSingle();
  if (error) throw error;

  if (!data) {
    // primary attempt: with language
    const { error: insErr } = await sb.from("users").insert({ tg_user_id: tgUserId, language: "uz" });

    if (insErr) {
      const msg = String(insErr.message || insErr || "");
      const low = msg.toLowerCase();

      // If "language" column doesn't exist in user's schema, fallback
      if (insErr.code === "42703" || (low.includes("column") && low.includes("language"))) {
        const { error: insErr2 } = await sb.from("users").insert({ tg_user_id: tgUserId });
        if (insErr2) throw insErr2;
      } else {
        throw insErr;
      }
    }
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

  if (msg.includes("Invalid time zone") || msg.includes("time zone specified")) {
    return "⚠️ Timezone xato kelmoqda. Admin Vercel env'ga APP_TZ=Asia/Tashkent qo‘ysin.";
  }
  if (msg.includes("PGRST205") && msg.includes("locations")) {
    return "⚠️ Lokatsiya bazasi hali yuklanmagan (locations).\nHozircha 📍 lokatsiyangizni yuboring.";
  }
  if (msg.includes("PGRST205") && msg.includes("users")) {
    return "⚠️ Baza sozlanmagan (users jadvali yo‘q). Admin Supabase SQL’ni run qilishi kerak.";
  }
  if (msg.includes("Telegram") && msg.includes("Unauthorized")) {
    return "⚠️ Bot token xato yoki env yo‘q. Vercel Environment Variables tekshiring.";
  }
  if (msg.includes("null value") && msg.includes("language")) {
    return "⚠️ Baza (users.language) NOT NULL, lekin language null ketyapti. Kod yangilandi — qayta deploy qiling.";
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

/** ====== TIMEZONE / DATE HELPERS ====== */
const DEFAULT_TZ = "Asia/Tashkent";

function normalizeTz(input) {
  let tz = String(input || "").trim();

  // ":UTC" / "::UTC" -> "UTC"
  tz = tz.replace(/^:+/, "");
  tz = tz.replace(/\s+/g, "");

  if (!tz) return DEFAULT_TZ;

  // ko‘p uchraydigan nomlar
  if (tz === "UTC" || tz === "GMT") tz = "Etc/UTC";

  // "UTC+5" kabi yozuvlar Intl’ga to‘g‘ri kelmaydi -> fallback
  if (/^UTC[+-]\d{1,2}$/.test(tz)) return DEFAULT_TZ;

  // tekshiruv: Intl qabul qiladimi?
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const APP_TZ = normalizeTz(process.env.APP_TZ || DEFAULT_TZ);

// Date object that represents "that day in tz" safely (midday UTC avoids day-shift issues)
function tzDate(tz, addDays = 0) {
  const z = normalizeTz(tz);
  const now = new Date(Date.now() + addDays * 86400000);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: z,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));

  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function fmtTime(dateObj, tz) {
  const z = normalizeTz(tz);
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: z,
    hour: "2-digit",
    minute: "2-digit"
  }).format(dateObj);
}

function tzYMD(tz, addDays = 0) {
  return tzDate(tz, addDays).toISOString().slice(0, 10);
}

function islamicMonth(tz, dateObj = new Date()) {
  const z = normalizeTz(tz);
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic", {
      timeZone: z,
      month: "numeric"
    }).formatToParts(dateObj);
    const m = parts.find((p) => p.type === "month")?.value;
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * ✅ Ramazon bugunmi?
 * 1) RAMADAN_START / RAMADAN_END env bo'lsa — shuni ishlatadi
 * 2) bo'lmasa — islamic calendar month=9 fallback
 */
async function isRamadanToday(tz = APP_TZ) {
  const z = normalizeTz(tz);
  const ymd = tzYMD(z, 0);

  const start = String(process.env.RAMADAN_START || "").slice(0, 10);
  const end = String(process.env.RAMADAN_END || "").slice(0, 10);
  if (start && end) return ymd >= start && ymd <= end;

  // Optional table (if you add later): ramadan_periods(starts_on, ends_on)
  try {
    const { data, error } = await sb
      .from("ramadan_periods")
      .select("id")
      .lte("starts_on", ymd)
      .gte("ends_on", ymd)
      .limit(1);

    if (!error) return (data || []).length > 0;
  } catch {
    // ignore
  }

  const m = islamicMonth(z, tzDate(z, 0));
  return m === 9;
}

module.exports = {
  sb, tg, ik,
  BOT_TOKEN, TG_WEBHOOK_SECRET, MINIAPP_URL,
  isCreator,
  setCommandsForChat,
  upsertUser, getUser, setUser,
  getChildren, getLocation,
  locKeyboard, prefsKeyboard,
  userFriendlyError,
  validateInitData, parseMiniappUser,
  DEFAULT_TZ, APP_TZ, normalizeTz,
  tzDate, fmtTime, tzYMD,
  isRamadanToday
};
