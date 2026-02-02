import { supabaseAdmin } from "../_lib/supabase.js";
import { isoDayUZT, addDaysISO } from "../_lib/time.js";
import { ensureCacheForCityDay } from "../_lib/schedule.js";

export default async function handler(req, res) {
  if ((req.query.key || "") !== process.env.CRON_SECRET) return res.status(401).send("No");

  const sb = supabaseAdmin();
  const today = isoDayUZT();
  const tomorrow = addDaysISO(today, 1);

  const { data: users, error } = await sb.from("users").select("city_key").not("city_key", "is", null);
  if (error) throw error;

  const cityKeys = [...new Set(users.map(u => u.city_key).filter(Boolean))];

  let ok = 0, fail = 0;
  for (const ck of cityKeys) {
    try { await ensureCacheForCityDay(sb, ck, today); ok++; } catch { fail++; }
    try { await ensureCacheForCityDay(sb, ck, tomorrow); ok++; } catch { fail++; }
  }

  res.status(200).json({ ok, fail, cityKeys: cityKeys.length, days: [today, tomorrow] });
}
