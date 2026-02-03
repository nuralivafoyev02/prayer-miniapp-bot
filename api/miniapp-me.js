const adhan = require("adhan");
const utils = require("../utils");
const { sb, parseMiniappUser, isRamadanToday, APP_TZ, fmtTime, tzDate } = utils;

function prayerTimes(lat, lng, date, tz) {
  const coords = new adhan.Coordinates(lat, lng);
  const params = adhan.CalculationMethod.MuslimWorldLeague();
  params.madhab = adhan.Madhab.Shafi;

  const pt = new adhan.PrayerTimes(coords, date, params);

  return {
    Bomdod: fmtTime(pt.fajr, tz),
    Peshin: fmtTime(pt.dhuhr, tz),
    Asr: fmtTime(pt.asr, tz),
    Shom: fmtTime(pt.maghrib, tz),
    Xufton: fmtTime(pt.isha, tz)
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const { initData } = req.body || {};
    if (!initData) return res.status(400).json({ ok: false, error: "NO_INIT_DATA" });

    // 1) utils export tekshiruv
    if (typeof tzDate !== "function" || typeof fmtTime !== "function") {
      return res.status(500).json({
        ok: false,
        error: "UTILS_EXPORT_MISSING",
        details: "utils.js dan tzDate yoki fmtTime export qilinmagan (yoki nomi mos emas)"
      });
    }

    // isRamadanToday export bo'lmasa ham (deploy mismatch), miniapp yiqilib ketmasin
    if (typeof isRamadanToday !== "function") {
      console.warn("utils.js dan isRamadanToday export qilinmagan — ramadan=false bo'ladi");
    }

    // 2) initData parse
    let tg_user_id;
    try {
      ({ tg_user_id } = parseMiniappUser(initData));
    } catch (e) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_INIT_DATA",
        details: String(e.message || e)
      });
    }

    const { data: u, error } = await sb.from("users").select("*").eq("tg_user_id", tg_user_id).maybeSingle();
    if (error) throw error;

    if (!u?.lat || !u?.lng) return res.status(200).json({ ok: true, needsSetup: true });

    const tz = APP_TZ || "Asia/Tashkent";
    const today = tzDate(tz, 0);
    const tomorrow = tzDate(tz, 1);

    // ✅ isRamadanToday yo'q bo'lsa ham miniapp yiqilmasin
    const ramadan = typeof isRamadanToday === "function" ? await isRamadanToday(tz) : false;

    return res.status(200).json({
      ok: true,
      tz,
      ramadan,
      today: prayerTimes(u.lat, u.lng, today, tz),
      tomorrow: prayerTimes(u.lat, u.lng, tomorrow, tz),
      prefs: {
        notify_prayers: u.notify_prayers,
        notify_ramadan: u.notify_ramadan,
        notify_daily_morning: u.notify_daily_morning,
        notify_daily_evening: u.notify_daily_evening
      }
    });
  } catch (e) {
    console.error("miniapp-me error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", details: String(e.message || e) });
  }
};
