const { sb, parseMiniappUser } = require("../utils");

const ALLOWED = new Set([
  "notify_prayers",
  "notify_ramadan",
  "notify_daily_morning",
  "notify_daily_evening"
]);

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const { initData, key, value } = req.body || {};
    if (!initData) return res.status(400).json({ ok: false, error: "NO_INIT_DATA" });
    if (!ALLOWED.has(key)) return res.status(400).json({ ok: false, error: "BAD_KEY" });

    let tg_user_id;
    try {
      ({ tg_user_id } = parseMiniappUser(initData));
    } catch (e) {
      return res.status(401).json({ ok: false, error: "INVALID_INIT_DATA", details: String(e.message || e) });
    }

    const patch = {};
    patch[key] = !!value;

    const { error } = await sb.from("users").update(patch).eq("tg_user_id", tg_user_id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("miniapp-prefs error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", details: String(e.message || e) });
  }
};
