import { supabaseAdmin } from "./supabase.js";
import { fetchTimingsByCity } from "./aladhan.js";
import { isoDayUZT, addDaysISO, uztToUtcISO, minusMinutes } from "./time.js";

const METHOD = Number(process.env.ALADHAN_METHOD || "3");

export async function ensureCacheForCityDay(sb, cityKey, dayISO) {
  const { data: cached } = await sb
    .from("daily_times_cache")
    .select("*")
    .eq("city_key", cityKey)
    .eq("day", dayISO)
    .maybeSingle();

  if (cached) return cached;

  const { data: city, error: cityErr } = await sb
    .from("cities")
    .select("*")
    .eq("city_key", cityKey)
    .single();
  if (cityErr || !city) throw new Error("City not found for cache");

  const { timings, hijriMonth, raw } = await fetchTimingsByCity(
    dayISO,
    city.aladhan_city,
    city.aladhan_country,
    METHOD
  );

  const row = {
    city_key: cityKey,
    day: dayISO,
    fajr: timings.Fajr,
    sunrise: timings.Sunrise,
    dhuhr: timings.Dhuhr,
    asr: timings.Asr,
    maghrib: timings.Maghrib,
    isha: timings.Isha,
    imsak: timings.Imsak,
    hijri_month: hijriMonth,
    raw
  };

  const { data: inserted, error } = await sb.from("daily_times_cache").insert(row).select("*").single();
  if (error) throw error;
  return inserted;
}

function buildUpserts(user, cacheRow, dayISO) {
  const items = [];
  const offset = user.offset_minutes || 0;

  const push = (kind, hhmm, payloadExtra = {}) => {
    if (!hhmm) return;
    items.push({
      telegram_id: user.telegram_id,
      kind,
      fire_at: uztToUtcISO(dayISO, hhmm, offset),
      payload: {
        day: dayISO,
        local_time: hhmm,
        city_key: user.city_key,
        ...payloadExtra
      },
      status: "pending"
    });
  };

  if (user.notify_prayers) {
    push("FAJR", cacheRow.fajr);
    push("DHUHR", cacheRow.dhuhr);
    push("ASR", cacheRow.asr);
    push("MAGHRIB", cacheRow.maghrib);
    push("ISHA", cacheRow.isha);
  }

  const isRamadan = Number(cacheRow.hijri_month) === 9;

  if (user.notify_ramadan && isRamadan) {
    // Og'iz yopish = Imsak (bo'lsa)
    if (cacheRow.imsak) push("IMSAK", cacheRow.imsak, { ramadan: true });
    // Og'iz ochish = Maghrib
    push("IFTAR", cacheRow.maghrib, { ramadan: true });
  }

  if (user.notify_morning_summary) {
    // default: fajr - 30 min
    const t = minusMinutes(cacheRow.fajr, 30);
    push("MORNING_SUMMARY", t, { summary_for: "today" });
  }

  if (user.notify_evening_summary) {
    // default: 21:00 local, summary for tomorrow generated elsewhere
    // bu yerda faqat shu kun uchun "EVENING_SUMMARY" qo'yamiz (payloadda tomorrow flag)
    push("EVENING_SUMMARY", "21:00", { summary_for: "tomorrow" });
  }

  return items;
}

export async function rebuildUserSchedules(telegramId) {
  const sb = supabaseAdmin();

  const { data: user } = await sb
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!user?.city_key) return;

  const today = isoDayUZT();
  const tomorrow = addDaysISO(today, 1);

  const cacheToday = await ensureCacheForCityDay(sb, user.city_key, today);
  const cacheTomorrow = await ensureCacheForCityDay(sb, user.city_key, tomorrow);

  const upserts = [
    ...buildUpserts(user, cacheToday, today),
    ...buildUpserts(user, cacheTomorrow, tomorrow)
  ];

  if (!upserts.length) return;

  // upsert by unique (telegram_id, kind, fire_at) — duplikatsiz
  const { error } = await sb
    .from("scheduled_notifications")
    .upsert(upserts, { onConflict: "telegram_id,kind,fire_at" });
  if (error) throw error;
}
