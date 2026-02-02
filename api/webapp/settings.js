import { supabaseAdmin } from "../_lib/supabase.js";
import { verifyInitData } from "../_lib/webapp.js";
import { rebuildUserSchedules } from "../_lib/schedule.js";

export default async function handler(req, res) {
  const body = req.body || {};
  const initData = body.initData || "";
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const v = verifyInitData(initData, token);
  if (!v.ok) return res.status(401).json({ ok: false, error: v.error });

  const telegramId = v.user?.id;
  if (!telegramId) return res.status(401).json({ ok: false, error: "No user" });

  const s = body.settings || {};
  const patch = {
    notify_prayers: !!s.notify_prayers,
    notify_ramadan: !!s.notify_ramadan,
    notify_morning_summary: !!s.notify_morning_summary,
    notify_evening_summary: !!s.notify_evening_summary,
    offset_minutes: Math.max(0, Math.min(60, Number(s.offset_minutes || 0)))
  };

  const sb = supabaseAdmin();
  const { error } = await sb.from("users").update(patch).eq("telegram_id", telegramId);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // schedulesni darhol yangilab qo'yamiz
  try { await rebuildUserSchedules(telegramId); } catch {}

  res.status(200).json({ ok: true });
}
