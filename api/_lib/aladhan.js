export async function fetchTimingsByCity(dayISO, city, country, method = 3) {
  const url =
    `https://api.aladhan.com/v1/timingsByCity/${encodeURIComponent(dayISO)}` +
    `?city=${encodeURIComponent(city)}` +
    `&country=${encodeURIComponent(country)}` +
    `&method=${encodeURIComponent(String(method))}` +
    `&iso8601=true`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`AlAdhan error ${res.status}`);

  const json = await res.json();
  const t = json?.data?.timings || {};
  const hijriMonth = json?.data?.date?.hijri?.month?.number ?? null;

  const clean = (v) => (typeof v === "string" ? v.trim().slice(0, 5) : null);

  return {
    timings: {
      Fajr: clean(t.Fajr),
      Sunrise: clean(t.Sunrise),
      Dhuhr: clean(t.Dhuhr),
      Asr: clean(t.Asr),
      Maghrib: clean(t.Maghrib),
      Isha: clean(t.Isha),
      Imsak: clean(t.Imsak)
    },
    hijriMonth,
    raw: json?.data ?? {}
  };
}
