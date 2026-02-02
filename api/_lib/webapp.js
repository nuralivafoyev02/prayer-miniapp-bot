import crypto from "crypto";

export function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") return { ok: false, error: "No initData" };
  const params = new URLSearchParams(initData);

  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "No hash" };

  params.delete("hash");

  // data-check-string
  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret key = HMAC_SHA256("WebAppData", bot_token)  OR (bot_token with key "WebAppData")
  // Most used stable approach:
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();

  const calculated = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (calculated !== hash) return { ok: false, error: "Bad signature" };

  const userRaw = params.get("user");
  let user = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch {}
  return { ok: true, user };
}
