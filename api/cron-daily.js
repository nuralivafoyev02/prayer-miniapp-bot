const adhan = require("adhan");
const { sb, tg, isRamadanToday, APP_TZ, fmtTime, tzDate } = require("../utils");

function hhmm(d) { return new Date(d).toTimeString().slice(0, 5); }

function prayerTimes(lat, lng, date) {
  const coords = new adhan.Coordinates(lat, lng);
  const params = adhan.CalculationMethod.MuslimWorldLeague();
  params.madhab = adhan.Madhab.Shafi;
  const pt = new adhan.PrayerTimes(coords, date, params);
  return {
    fajr: pt.fajr, dhuhr: pt.dhuhr, asr: pt.asr, maghrib: pt.maghrib, isha: pt.isha
  };
}
function mapTimes(t, tz) {
  return {
    Bomdod: fmtTime(t.fajr, tz),
    Peshin: fmtTime(t.dhuhr, tz),
    Asr: fmtTime(t.asr, tz),
    Shom: fmtTime(t.maghrib, tz),
    Xufton: fmtTime(t.isha, tz)
  };
}


module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const { data: users, error } = await sb
      .from("users")
      .select("*")
      .not("lat", "is", null)
      .not("lng", "is", null);

    if (error) throw error;
    

    const ramadan = await isRamadanToday();

    const now = new Date();
    const today = now;
    const tomorrow = new Date(now.getTime() + 86400000);

    for (const u of users || []) {
      const t1 = prayerTimes(u.lat, u.lng, today);
      const t2 = prayerTimes(u.lat, u.lng, tomorrow);

      // Ertalab/kechqurun xabar yuborish (to'g'ridan-to'g'ri)
      if (u.notify_daily_morning) {
        await tg("sendMessage", {
          chat_id: u.tg_user_id,
          text: `☀️ Bugungi namoz vaqtlari:\n${lines(mapTimes(t1))}${ramadan && u.notify_ramadan ? "\n\n🌙 Ramazon eslatmalari ON" : ""}`
        }).catch(() => {});
      }

      if (u.notify_daily_evening) {
        await tg("sendMessage", {
          chat_id: u.tg_user_id,
          text: `🌆 Ertangi namoz vaqtlari:\n${lines(mapTimes(t2))}${ramadan && u.notify_ramadan ? "\n\n🌙 Ramazon eslatmalari ON" : ""}`
        }).catch(() => {});
      }

      // Real-time uchun queue tayyorlab qo'yamiz (cron-tick bilan jo'natish mumkin)
      const inserts = [];
      if (u.notify_prayers) {
        inserts.push(n(u.tg_user_id, t1.fajr, "prayer_fajr", { name: "Bomdod" }));
        inserts.push(n(u.tg_user_id, t1.dhuhr, "prayer_dhuhr", { name: "Peshin" }));
        inserts.push(n(u.tg_user_id, t1.asr, "prayer_asr", { name: "Asr" }));
        inserts.push(n(u.tg_user_id, t1.maghrib, "prayer_maghrib", { name: "Shom" }));
        inserts.push(n(u.tg_user_id, t1.isha, "prayer_isha", { name: "Xufton" }));
      }
      if (ramadan && u.notify_ramadan) {
        inserts.push(n(u.tg_user_id, t1.fajr, "suhoor", { time: hhmm(t1.fajr) }));
        inserts.push(n(u.tg_user_id, t1.maghrib, "iftar", {
          time: hhmm(t1.maghrib),
          dua: "Allohumma inni laka sumtu wa bika aamantu wa ‘alayka tawakkaltu wa ‘ala rizqika aftartu."
        }));
      }

      if (inserts.length) {
        await sb.from("notifications").insert(inserts).catch(() => {});
      }
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    return res.status(500).send("error");
  }
};

function n(tg_user_id, date, kind, payload) {
  return { tg_user_id, scheduled_at: new Date(date).toISOString(), kind, payload };
}
function lines(obj) {
  return Object.entries(obj).map(([k, v]) => `• ${k}: ${v}`).join("\n");
}
