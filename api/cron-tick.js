const { sb, tg } = require("../utils");

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const { data: due, error } = await sb.rpc("claim_due_notifications", { p_limit: 200 });
    if (error) throw error;

    for (const n of due || []) {
      try {
        const text = render(n.kind, n.payload);
        await tg("sendMessage", { chat_id: n.tg_user_id, text });
        await sb.from("notifications").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", n.id);
      } catch (e) {
        await sb.from("notifications").update({ status: "failed", error: String(e) }).eq("id", n.id);
      }
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    return res.status(500).send("error");
  }
};

function render(kind, p) {
  if (kind.startsWith("prayer_")) return `🕌 ${p.name} vaqti kirdi`;
  if (kind === "suhoor") return `⏳ Og'iz yopish vaqti: ${p.time}`;
  if (kind === "iftar") return `🌙 Og'iz ochish vaqti: ${p.time}\n\n🤲 ${p.dua}`;
  return "Eslatma";
}
