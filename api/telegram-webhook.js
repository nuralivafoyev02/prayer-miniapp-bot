const {
  sb, tg, ik,
  TG_WEBHOOK_SECRET,
  MINIAPP_URL,
  isCreator, setCommandsForChat,
  upsertUser, getUser, setUser,
  getChildren, getLocation,
  locKeyboard,
  userFriendlyError
} = require("../utils");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (TG_WEBHOOK_SECRET && secret !== TG_WEBHOOK_SECRET) return res.status(403).send("Forbidden");

    const raw = req.body;
    const update = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (update.message) await onMessage(update.message);
    if (update.callback_query) await onCallback(update.callback_query);

    return res.status(200).send("ok");
  } catch (e) {
    console.error("Webhook error:", e);
    // Telegram webhook: always 200 to avoid retries storm
    return res.status(200).send("ok");
  }
};

const USERS_PAGE_SIZE = 10;

function miniAppOnlyKeyboard() {
  if (!MINIAPP_URL) return null;
  return {
    reply_markup: {
      inline_keyboard: [[{ text: "📲 Mini App", web_app: { url: MINIAPP_URL } }]]
    }
  };
}

async function sendSetupDone(chatId, opts = {}) {
  const { via = "unknown" } = opts;

  const statusText =
    "✅ Manzil saqlandi.\n" +
    "Xabarnomalarni Mini App’dan sozlashingiz mumkin.\n\n" +
    "📌 Keyinroq botning o‘zida ham taqvim va namoz vaqtlarini ko‘rish funksiyasini qo‘shamiz.";

  const mini = miniAppOnlyKeyboard();

  // GPS bilan kelganda request_location klaviaturasini olib tashlaymiz
  if (via === "gps") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: statusText,
      reply_markup: { remove_keyboard: true }
    }).catch(() => {});

    if (mini) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "📲 Sozlamalar uchun Mini App’ni oching:",
        ...mini
      }).catch(() => {});
    }
    return;
  }

  // List orqali tanlanganda bitta xabarda status + Mini App tugmasi
  await tg("sendMessage", {
    chat_id: chatId,
    text: statusText,
    ...(mini ? mini : {})
  });
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const tgUserId = msg.from.id;

  try {
    await upsertUser(tgUserId);

    // 🔒 /start bosilganda shu user uchun komandalar yangilanadi:
    // - creator bo'lsa /users ko'rinadi
    // - oddiy user uchun /users umuman ko'rinmaydi
    if ((msg.text || "").trim().startsWith("/start")) {
      await setCommandsForChat(chatId, isCreator(tgUserId), tgUserId);
    }

    // GPS yuborildi
    if (msg.location) {
      const { latitude, longitude } = msg.location;

      await setUser(tgUserId, {
        lat: latitude,
        lng: longitude,
        location_code: null,
        step: "READY"
      });

      await sendSetupDone(chatId, { via: "gps" });
      return;
    }

    const text = (msg.text || "").trim();

    // 🔒 Creator-only: userlar ro'yxati
    // Boshqa userlar uchun javob ham bermaymiz (ko'rinmas bo'lsin)
    if (text === "/users") {
      if (!isCreator(tgUserId)) return;
      await sendUsersPage({ chatId, page: 0, mode: "send" });
      return;
    }

    if (text === "/reset") {
      await setUser(tgUserId, {
        step: "LANG",
        temp_parent: null,
        location_code: null
      });
      await sendLang(chatId);
      return;
    }

    if (text === "/location") {
      await askForLocation(chatId);
      return;
    }

    if (text.startsWith("/start")) {
      await setUser(tgUserId, {
        step: "LANG",
        temp_parent: null,
        location_code: null
      });

      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "Assalomu alaykum! Men namoz va Ramazon vaqtlarini ko‘rsatib, eslatib turaman.\n\n" +
          "1) Til tanlaysiz\n" +
          "2) Lokatsiyani tanlaysiz (viloyat → tuman) yoki 📍 GPS yuborasiz\n" +
          "3) Xabarnomalarni Mini App’da sozlaysiz\n\n" +
          "Tilni tanlang:",
        ...ik([[{ text: "O‘zbekcha", callback_data: "lang:uz" }]])
      });
      return;
    }

    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "Buyruqlar:\n" +
        "/start — boshlash\n" +
        "/location — lokatsiya yuborish\n" +
        "/reset — qayta sozlash"
    });
  } catch (e) {
    console.error(e);
    await tg("sendMessage", { chat_id: chatId, text: userFriendlyError(e) });
  }
}

async function onCallback(cb) {
  const tgUserId = cb.from.id;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  try {
    await upsertUser(tgUserId);
    const u = await getUser(tgUserId);

    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "⏳ Yuklanyapti…" });

    const data = cb.data || "";

    // ======= ADMIN USERS PAGINATION (creator only) =======
    if (data.startsWith("au:")) {
      if (!isCreator(tgUserId)) {
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Ruxsat yo'q" });
        return;
      }
      const [, action, pageStr] = data.split(":");
      const page = Math.max(0, parseInt(pageStr || "0", 10) || 0);
      if (action === "p" || action === "r") {
        await sendUsersPage({ chatId, page, mode: "edit", messageId });
      }
      return;
    }

    // ======= LANGUAGE =======
    if (data.startsWith("lang:")) {
      const lang = data.split(":")[1];

      await setUser(tgUserId, {
        language: lang,
        step: "LOC_METHOD",
        temp_parent: null,
        location_code: null
      });

      await safeEditText({
        chatId,
        messageId,
        text:
          "✅ Til tanlandi.\n\n" +
          "Endi lokatsiyani tanlang:\n" +
          "1) 🏙 Manzilni tanlash (viloyat → tuman)\n" +
          "2) 📍 Lokatsiya yuborish (GPS)\n\n" +
          "Qaysi usul qulay?",
        replyMarkup: ik([
          [{ text: "🏙 Manzilni tanlash", callback_data: "locmode:list" }],
          [{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]
        ]).reply_markup
      });
      return;
    }

    // ======= LOCATION MODE =======
    if (data === "locmode:gps") {
      await setUser(tgUserId, { step: "ASK_GPS" });

      await safeEditText({
        chatId,
        messageId,
        text: "📍 Iltimos, lokatsiyangizni yuboring (namoz vaqtlarini hisoblash uchun)."
      });

      await askForLocation(chatId);
      return;
    }

    if (data === "locmode:list") {
      await setUser(tgUserId, { step: "REGION", temp_parent: null });

      await safeEditText({ chatId, messageId, text: "⏳ Yuklanyapti…" });

      const regions = await safeGetRegions();
      if (!regions.length) {
        await safeEditText({
          chatId,
          messageId,
          text:
            "⚠️ Manzil ro‘yxati hali yuklanmagan.\n" +
            "Hozircha 📍 lokatsiyangizni yuboring.",
          replyMarkup: ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]]).reply_markup
        });
        return;
      }

      await safeEditText({
        chatId,
        messageId,
        text: "Viloyatni tanlang:",
        replyMarkup: locKeyboard(regions, "region", 0, 10).reply_markup
      });
      return;
    }

    // ======= REGION (viloyat) =======
    if (data.startsWith("region:")) {
      const [, code, pageStr] = data.split(":");

      await safeEditText({ chatId, messageId, text: "⏳ Yuklanyapti…" });

      const regions = await safeGetRegions();
      if (!regions.length) {
        await safeEditText({
          chatId,
          messageId,
          text: "⚠️ Manzil bazasi yo‘q. 📍 lokatsiya yuboring.",
          replyMarkup: ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]]).reply_markup
        });
        return;
      }

      if (code === "__PAGE__") {
        await safeEditText({
          chatId,
          messageId,
          text: "Viloyatni tanlang:",
          replyMarkup: locKeyboard(regions, "region", parseInt(pageStr, 10), 10).reply_markup
        });
        return;
      }

      await setUser(tgUserId, { temp_parent: code, step: "DISTRICT" });
      const districts = await getChildren(code, "district").catch(() => []);

      if (!districts.length) {
        await safeEditText({
          chatId,
          messageId,
          text: "⚠️ Bu viloyat uchun tumanlar topilmadi. 📍 lokatsiya yuboring.",
          replyMarkup: ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]]).reply_markup
        });
        return;
      }

      await safeEditText({
        chatId,
        messageId,
        text: "Tumanni tanlang:",
        replyMarkup: locKeyboard(districts, "district", 0, 10).reply_markup
      });
      return;
    }

    // ======= DISTRICT (tuman) — FINAL (CITY removed) =======
    if (data.startsWith("district:")) {
      const [, code, pageStr] = data.split(":");

      await safeEditText({ chatId, messageId, text: "⏳ Yuklanyapti…" });

      if (code === "__PAGE__") {
        const districts = await getChildren(u.temp_parent, "district").catch(() => []);
        await safeEditText({
          chatId,
          messageId,
          text: "Tumanni tanlang:",
          replyMarkup: locKeyboard(districts, "district", parseInt(pageStr, 10), 10).reply_markup
        });
        return;
      }

      // ✅ Now district selection finishes setup
      const loc = await getLocation(code);
      if (!loc?.lat || !loc?.lng) {
        await safeEditText({
          chatId,
          messageId,
          text:
            "⚠️ Bu tumanda koordinata topilmadi.\n" +
            "Iltimos, 📍 GPS lokatsiyangizni yuboring.",
          replyMarkup: ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]]).reply_markup
        });
        return;
      }

      await setUser(tgUserId, {
        location_code: code,
        lat: loc.lat,
        lng: loc.lng,
        step: "READY"
      });

      await safeEditText({
        chatId,
        messageId,
        text:
          "✅ Manzil saqlandi.\n" +
          "Xabarnomalarni Mini App’dan sozlashingiz mumkin.\n\n" +
          "📌 Keyinroq botning o‘zida ham taqvim va namoz vaqtlarini ko‘rish funksiyasini qo‘shamiz.",
        replyMarkup: (miniAppOnlyKeyboard() || {}).reply_markup
      });
      return;
    }

    // ======= Backward compatibility: old city buttons =======
    if (data.startsWith("city:")) {
      await safeEditText({
        chatId,
        messageId,
        text:
          "ℹ️ Shahar tanlash olib tashlandi.\n" +
          "Iltimos, tumanni tanlang yoki 📍 GPS lokatsiya yuboring.",
        replyMarkup: ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]]).reply_markup
      });
      return;
    }

    // ======= Old pref toggles: redirect to mini app =======
    if (data.startsWith("pref:")) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Sozlamalar Mini App’da 🙂" });
      await safeEditText({
        chatId,
        messageId,
        text:
          "ℹ️ Xabarnomalarni sozlash Mini App’ga ko‘chirildi.\n" +
          "Mini App’ni ochib sozlashingiz mumkin.",
        replyMarkup: (miniAppOnlyKeyboard() || {}).reply_markup
      });
      return;
    }
  } catch (e) {
    console.error(e);
    await tg("sendMessage", { chat_id: chatId, text: userFriendlyError(e) });
  }
}

async function sendLang(chatId) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: "Tilni tanlang:",
    ...ik([[{ text: "O‘zbekcha", callback_data: "lang:uz" }]])
  });
}

async function askForLocation(chatId) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: "📍 Iltimos, lokatsiyangizni yuboring (namoz vaqtlarini hisoblash uchun).",
    reply_markup: {
      keyboard: [[{ text: "📍 Lokatsiyani yuborish", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

async function safeGetRegions() {
  return await getChildren(null, "region").catch(() => []);
}

async function safeEditText({ chatId, messageId, text, replyMarkup }) {
  try {
    const payload = { chat_id: chatId, message_id: messageId, text };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await tg("editMessageText", payload);
  } catch (e) {
    await tg("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    }).catch(() => {});
  }
}

async function sendUsersPage({ chatId, page, mode, messageId }) {
  const from = page * USERS_PAGE_SIZE;
  const to = from + USERS_PAGE_SIZE - 1;

  const { data, count, error } = await sb
    .from("users")
    .select(
      "tg_user_id,language,location_code,lat,lng,notify_prayers,notify_ramadan,notify_daily_morning,notify_daily_evening",
      { count: "exact" }
    )
    .order("tg_user_id", { ascending: true })
    .range(from, to);

  if (error) throw error;

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const p = Math.max(0, Math.min(page, totalPages - 1));

  const rows = data || [];
  const lines = rows.map((uu, i) => {
    const idx = from + i + 1;
    const lang = uu.language || "uz";
    const loc = uu.location_code ? "🏙 MANZIL" : (uu.lat && uu.lng ? "📍 GPS" : "—");
    const icons =
      (uu.notify_prayers ? "🕌" : "") +
      (uu.notify_ramadan ? "🌙" : "") +
      (uu.notify_daily_morning ? "☀️" : "") +
      (uu.notify_daily_evening ? "🌆" : "");
    return `${idx}) ${uu.tg_user_id} 🌐 ${lang} ${loc} ${icons || "—"}`.trim();
  });

  const text =
    "👤 Userlar ro'yxati\n" +
    `Sahifa: ${p + 1}/${totalPages} | Jami: ${total}\n\n` +
    (lines.length ? lines.join("\n") : "— Hozircha user yo'q —");

  const nav = [];
  if (p > 0) nav.push({ text: "⬅️", callback_data: `au:p:${p - 1}` });
  nav.push({ text: "🔄", callback_data: `au:r:${p}` });
  if (p < totalPages - 1) nav.push({ text: "➡️", callback_data: `au:p:${p + 1}` });

  const reply_markup = { inline_keyboard: [nav] };

  if (mode === "edit" && messageId) {
    await safeEditText({ chatId, messageId, text, replyMarkup: reply_markup });
  } else {
    await tg("sendMessage", { chat_id: chatId, text, reply_markup });
  }
}
