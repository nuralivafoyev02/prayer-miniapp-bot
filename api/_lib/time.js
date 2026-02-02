const UZT_OFFSET_MIN = 5 * 60;

export function isoDayUZT(date = new Date()) {
  // returns YYYY-MM-DD in UZT
  const uz = new Date(date.getTime() + UZT_OFFSET_MIN * 60 * 1000);
  return uz.toISOString().slice(0, 10);
}

export function addDaysISO(dayISO, add) {
  const [y, m, d] = dayISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + add);
  return dt.toISOString().slice(0, 10);
}

export function uztToUtcISO(dayISO, hhmm, offsetMinutes = 0) {
  // local UZT datetime -> UTC ISO string (timestamptz)
  const [y, m, d] = dayISO.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);

  const totalMin = hh * 60 + mm - offsetMinutes;      // apply user offset
  const utcMin = totalMin - UZT_OFFSET_MIN;           // convert UZT -> UTC

  const utcH = Math.floor(utcMin / 60);
  const utcM = ((utcMin % 60) + 60) % 60;

  const base = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  base.setUTCHours(utcH, utcM, 0, 0);
  return base.toISOString();
}

export function minusMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  let t = h * 60 + m - mins;
  while (t < 0) t += 1440;
  t = t % 1440;
  const hh = String(Math.floor(t / 60)).padStart(2, "0");
  const mm = String(t % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function nowIso() {
  return new Date().toISOString();
}
