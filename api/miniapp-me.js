const adhan = require("adhan");
const { sb, parseMiniappUser, isRamadanToday, APP_TZ, fmtTime, tzDate } = require("../utils");

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

    // 🔎 1) utils export tekshiruv (sizdagi real muammoni darrov chiqaradi)
    if (typeof tzDate !== "function" || typeof fmtTime !== "function") {
      return res.status(500).json({
        ok: false,
        error: "UTILS_EXPORT_MISSING",
        details: "utils.js dan tzDate yoki fmtTime export qilinmagan (yoki nomi mos emas)"
      });
    }

    // 🔐 2) initData parse faqat shunda 401 bo'lsin
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

    const ramadan = await isRamadanToday();

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
    // ❗ Endi "Unauthorized" emas — real server error qaytadi
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", details: String(e.message || e) });
  }
};
