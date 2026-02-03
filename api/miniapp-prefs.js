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
    if (!initData) return res.status(400).send("No initData");
    if (!ALLOWED.has(key)) return res.status(400).send("Bad key");

    const { tg_user_id } = parseMiniappUser(initData);

    const patch = {};
    patch[key] = !!value;

    const { error } = await sb.from("users").update(patch).eq("tg_user_id", tg_user_id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(401).send("Unauthorized");
  }
};
