import { supabaseAdmin } from "../_lib/supabase.js";
import { rebuildUserSchedules } from "../_lib/schedule.js";

export default async function handler(req, res) {
  if ((req.query.key || "") !== process.env.CRON_SECRET) return res.status(401).send("No");

  const sb = supabaseAdmin();
  const { data: users, error } = await sb
    .from("users")
    .select("telegram_id, city_key")
    .not("city_key", "is", null);

  if (error) throw error;

  let ok = 0, fail = 0;
  for (const u of users) {
    try { await rebuildUserSchedules(u.telegram_id); ok++; }
    catch { fail++; }
  }

  res.status(200).json({ ok, fail, users: users.length });
}
