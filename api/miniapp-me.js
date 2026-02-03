const adhan = require("adhan");
const { sb, parseMiniappUser } = require("../utils");

function prayerTimes(lat, lng, date) {
  const coords = new adhan.Coordinates(lat, lng);
  const params = adhan.CalculationMethod.MuslimWorldLeague();
  params.madhab = adhan.Madhab.Shafi;
  const pt = new adhan.PrayerTimes(coords, date, params);
  return {
    Bomdod: hhmm(pt.fajr),
    Peshin: hhmm(pt.dhuhr),
    Asr: hhmm(pt.asr),
    Shom: hhmm(pt.maghrib),
    Xufton: hhmm(pt.isha)
  };
}
function hhmm(d) { return new Date(d).toTimeString().slice(0, 5); }

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");
    const { initData } = req.body || {};
    if (!initData) return res.status(400).send("No initData");

    const { tg_user_id } = parseMiniappUser(initData);

    const { data: u, error } = await sb.from("users").select("*").eq("tg_user_id", tg_user_id).maybeSingle();
    if (error) throw error;
    if (!u?.lat || !u?.lng) return res.status(200).json({ ok: true, needsSetup: true });

    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);

    const { data: loc } = await sb.from("locations").select("*").eq("code", u.location_code).maybeSingle();

    res.status(200).json({
      ok: true,
      locationName: loc?.name_uz || "—",
      today: prayerTimes(u.lat, u.lng, today),
      tomorrow: prayerTimes(u.lat, u.lng, tomorrow),
      prefs: {
        notify_prayers: u.notify_prayers,
        notify_ramadan: u.notify_ramadan,
        notify_daily_morning: u.notify_daily_morning,
        notify_daily_evening: u.notify_daily_evening
      }
    });
  } catch (e) {
    console.error(e);
    res.status(401).send("Unauthorized");
  }
};
