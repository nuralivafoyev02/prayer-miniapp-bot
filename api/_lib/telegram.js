const API = (token) => `https://api.telegram.org/bot${token}`;

async function tgCall(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const res = await fetch(`${API(token)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const desc = json?.description || `HTTP ${res.status}`;
    throw new Error(`${method} failed: ${desc}`);
  }
  return json.result;
}

export async function sendMessage(chat_id, text, extra = {}) {
  return tgCall("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
}

export async function editMessageText(chat_id, message_id, text, extra = {}) {
  return tgCall("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...extra });
}

export async function answerCallbackQuery(callback_query_id, text) {
  return tgCall("answerCallbackQuery", { callback_query_id, text, show_alert: false });
}
