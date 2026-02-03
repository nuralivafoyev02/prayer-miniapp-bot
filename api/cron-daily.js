const adhan = require("adhan");
const { sb, isRamadanToday } = require("../utils");

function prayerTimes(lat, lng, date) {
  const coords = new adhan.Coordinates(lat, lng);
  const params = adhan.CalculationMethod.MuslimWorldLeague();
  params.madhab = adhan.Madhab.Shafi;

  const pt = new adhan.PrayerTimes(coords, date, params);
  return {
    fajr: pt.fajr,
    dhuhr: pt.dhuhr,
    asr: pt.asr,
    maghrib: pt.maghrib,
    isha: pt.isha
  };
}

function iso(d) { return new Date(d).toISOString(); }
function minusMinutes(d, m) { return new Date(d.getTime() - m * 60000); }

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const { data: users, error } = await sb.from("users")
      .select("*")
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (error) throw error;

    const ramadan = await isRamadanToday();
    const today = new Date();               // TZ=Asia/Tashkent bo‘lsa bugun UZT bo‘ladi
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);

    for (const u of users || []) {
      const timesT = prayerTimes(u.lat, u.lng, today);
      const timesN = prayerTimes(u.lat, u.lng, tomorrow);

      const inserts = [];

      // Namoz notificationlar
      if (u.notify_prayers) {
        inserts.push(n(u.tg_user_id, timesT.fajr, "prayer_fajr", { name: "Bomdod" }));
        inserts.push(n(u.tg_user_id, timesT.dhuhr, "prayer_dhuhr", { name: "Peshin" }));
        inserts.push(n(u.tg_user_id, timesT.asr, "prayer_asr", { name: "Asr" }));
        inserts.push(n(u.tg_user_id, timesT.maghrib, "prayer_maghrib", { name: "Shom" }));
        inserts.push(n(u.tg_user_id, timesT.isha, "prayer_isha", { name: "Xufton" }));
      }

      // Ramazon (saharlik/iftor)
      if (ramadan && u.notify_ramadan) {
        inserts.push(n(u.tg_user_id, timesT.fajr, "suhoor", { time: hhmm(timesT.fajr) }));
        inserts.push(n(u.tg_user_id, timesT.maghrib, "iftar", {
          time: hhmm(timesT.maghrib),
          dua: "Allohumma inni laka sumtu wa bika aamantu wa ‘alayka tawakkaltu wa ‘ala rizqika aftartu."
        }));
      }

      // Har kuni ertalab: bugungi jadval (fajr - 30min)
      if (u.notify_daily_morning) {
        inserts.push(n(u.tg_user_id, minusMinutes(timesT.fajr, 30), "daily_morning", {
          today: mapTimes(timesT),
          ramadan
        }));
      }

      // Kechqurun: ertangi jadval (20:00 UZT)
      if (u.notify_daily_evening) {
        const evening = new Date(today);
        evening.setHours(20, 0, 0, 0);
        inserts.push(n(u.tg_user_id, evening, "daily_evening", {
          tomorrow: mapTimes(timesN),
          ramadan
        }));
      }

      if (inserts.length) {
        // duplicate bo‘lsa unique index ushlab qoladi — error bo‘lsa ignore qilamiz
        const { error: insErr } = await sb.from("notifications").insert(inserts);
        if (insErr) {
          // unique conflict bo‘lishi normal (cron qayta run bo‘lsa)
          if (!String(insErr.message || "").includes("duplicate")) console.error(insErr);
        }
      }
    }

    res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    res.status(500).send("error");
  }
};

function n(tg_user_id, date, kind, payload) {
  return { tg_user_id, scheduled_at: iso(date), kind, payload };
}
function hhmm(d) { return new Date(d).toTimeString().slice(0, 5); }
function mapTimes(t) {
  return {
    Bomdod: hhmm(t.fajr),
    Peshin: hhmm(t.dhuhr),
    Asr: hhmm(t.asr),
    Shom: hhmm(t.maghrib),
    Xufton: hhmm(t.isha)
  };
}
