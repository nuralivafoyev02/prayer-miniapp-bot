const {
  sb, tg, ik,
  TG_WEBHOOK_SECRET,
  isCreator,
  setCommandsForChat,
  upsertUser, getUser, setUser,
  getChildren, getLocation,
  locKeyboard, prefsKeyboard,
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
    return res.status(200).send("ok");
  }
};

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const tgUserId = msg.from.id;

  try {
    await upsertUser(tgUserId);

    // GPS yuborildi
    if (msg.location) {
      const { latitude, longitude } = msg.location;

      await setUser(tgUserId, {
        lat: latitude,
        lng: longitude,
        location_code: null,
        step: "PREFS"
      });

      // reply keyboardni olib tashlaymiz (chiroyli UX)
      await tg("sendMessage", {
        chat_id: chatId,
        text: "✅ Lokatsiya saqlandi.",
        reply_markup: { remove_keyboard: true }
      });

      const u = await getUser(tgUserId);

      await tg("sendMessage", {
        chat_id: chatId,
        text: "Endi eslatmalarni sozlang:",
        ...prefsKeyboard(u)
      });
      return;
    }

    const text = (msg.text || "").trim();

    // 🔒 Creator-only: userlar ro'yxati
    // Boshqa userlar uchun javob ham bermaymiz (ko'rinmas bo'lsin)
    if (text.startsWith("/users")) {
      if (!isCreator(tgUserId)) return;
      const parts = text.split(/\s+/);
      const page = Math.max(0, Number(parts[1] || 0) || 0);
      await sendUsersPage(chatId, page, { mode: "send" });
      return;
    }

    if (text === "/reset") {
      await setUser(tgUserId, {
        step: "LANG",
        language: null,
        temp_parent: null,
        location_code: null
      });

      // creator bo'lsa /users komandasi shu chatda ko'rinsin
      await setCommandsForChat(chatId, isCreator(tgUserId));
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
        language: null,
        temp_parent: null,
        location_code: null
      });

      // creator bo'lsa /users komandasi faqat shu chatda chiqadi
      await setCommandsForChat(chatId, isCreator(tgUserId));

      await tg("sendMessage", {
        chat_id: chatId,
        text:
          "Assalomu alaykum! Men namoz va Ramazon vaqtlarini ko‘rsatib, eslatib turaman.\n\n" +
          "1) Til tanlaysiz\n" +
          "2) Lokatsiyani tanlaysiz (manzil yoki GPS)\n" +
          "3) Eslatmalarni yoqasiz\n\n" +
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

    // toast
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "⏳ Yuklanyapti…" });

    const data = cb.data || "";

    // 🔒 Creator-only pagination: userlar ro'yxati
    if (data.startsWith("adminusers:")) {
      if (!isCreator(tgUserId)) return;
      const page = Math.max(0, Number(data.split(":")[1] || 0) || 0);
      await sendUsersPage(chatId, page, { mode: "edit", messageId });
      return;
    }

    // ✅ 1) Til tanlashdan keyin: lokatsiya usulini so'raymiz
    if (data.startsWith("lang:")) {
      const lang = data.split(":")[1];

      await setUser(tgUserId, {
        language: lang,
        step: "LOC_METHOD",
        temp_parent: null,
        location_code: null
      });

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text:
          "✅ Til tanlandi.\n\n" +
          "Endi lokatsiyani tanlang:\n" +
          "1) 🏙 Manzilni tanlash (viloyat → tuman → shahar)\n" +
          "2) 📍 Lokatsiya yuborish (GPS)\n\n" +
          "Qaysi usul qulay?",
        ...ik([
          [{ text: "🏙 Manzilni tanlash", callback_data: "locmode:list" }],
          [{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]
        ])
      });
      return;
    }

    // ✅ 2) Lokatsiya usuli tanlandi
    if (data === "locmode:gps") {
      await setUser(tgUserId, { step: "ASK_GPS" });

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "📍 Iltimos, lokatsiyangizni yuboring (namoz vaqtlarini hisoblash uchun)."
      });

      await askForLocation(chatId);
      return;
    }

    if (data === "locmode:list") {
      await setUser(tgUserId, { step: "REGION", temp_parent: null });

      await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Yuklanyapti…" });

      const regions = await safeGetRegions();
      if (!regions.length) {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text:
            "⚠️ Manzil ro‘yxati hali yuklanmagan.\n" +
            "Hozircha 📍 lokatsiyangizni yuboring.",
          ...ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]])
        });
        return;
      }

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "Viloyatni tanlang:",
        ...locKeyboard(regions, "region", 0, 10)
      });
      return;
    }

    // REGION select + pagination
    if (data.startsWith("region:")) {
      const [, code, pageStr] = data.split(":");

      await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Yuklanyapti…" });

      const regions = await safeGetRegions();
      if (!regions.length) {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Manzil bazasi yo‘q. 📍 lokatsiya yuboring.",
          ...ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]])
        });
        return;
      }

      if (code === "__PAGE__") {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "Viloyatni tanlang:",
          ...locKeyboard(regions, "region", parseInt(pageStr, 10), 10)
        });
        return;
      }

      await setUser(tgUserId, { temp_parent: code, step: "DISTRICT" });
      const districts = await getChildren(code, "district").catch(() => []);

      if (!districts.length) {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Bu viloyat uchun tumanlar topilmadi. 📍 lokatsiya yuboring.",
          ...ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]])
        });
        return;
      }

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "Tumanni tanlang:",
        ...locKeyboard(districts, "district", 0, 10)
      });
      return;
    }

    // DISTRICT select + pagination
    if (data.startsWith("district:")) {
      const [, code, pageStr] = data.split(":");

      await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Yuklanyapti…" });

      if (code === "__PAGE__") {
        const districts = await getChildren(u.temp_parent, "district").catch(() => []);
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "Tumanni tanlang:",
          ...locKeyboard(districts, "district", parseInt(pageStr, 10), 10)
        });
        return;
      }

      await setUser(tgUserId, { temp_parent: code, step: "CITY" });
      const cities = await getChildren(code, "city").catch(() => []);

      if (!cities.length) {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Shaharlar topilmadi. 📍 lokatsiya yuboring.",
          ...ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]])
        });
        return;
      }

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "Shaharni tanlang:",
        ...locKeyboard(cities, "city", 0, 10)
      });
      return;
    }

    // CITY select + pagination
    if (data.startsWith("city:")) {
      const [, code, pageStr] = data.split(":");

      await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: "⏳ Yuklanyapti…" });

      if (code === "__PAGE__") {
        const cities = await getChildren(u.temp_parent, "city").catch(() => []);
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "Shaharni tanlang:",
          ...locKeyboard(cities, "city", parseInt(pageStr, 10), 10)
        });
        return;
      }

      const loc = await getLocation(code);
      if (!loc?.lat || !loc?.lng) {
        await tg("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "⚠️ Bu lokatsiyada koordinata yo‘q. 📍 lokatsiya yuboring.",
          ...ik([[{ text: "📍 Lokatsiya yuborish", callback_data: "locmode:gps" }]])
        });
        return;
      }

      await setUser(tgUserId, {
        location_code: code,
        lat: loc.lat,
        lng: loc.lng,
        step: "PREFS"
      });

      const updated = await getUser(tgUserId);

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "✅ Lokatsiya tanlandi. Endi eslatmalarni sozlang:",
        ...prefsKeyboard(updated)
      });
      return;
    }

    // PREF toggles
    if (data.startsWith("pref:")) {
      const key = data.split(":")[1];
      const patch = {};
      patch[key] = !u[key];

      await setUser(tgUserId, patch);
      const updated = await getUser(tgUserId);

      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "✅ Saqlandi. Eslatmalar:",
        ...prefsKeyboard(updated)
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

/** =====================
 *  Creator-only /users
 * ===================== */
const USERS_PAGE_SIZE = 20;

async function sendUsersPage(chatId, page, opts = { mode: "send" }) {
  const { rows, total } = await fetchUsersPage(page);
  const text = renderUsersText(rows, page, total);

  const hasPrev = page > 0;
  const totalPages = typeof total === "number" ? Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)) : null;
  const hasNext = totalPages ? page < totalPages - 1 : rows.length === USERS_PAGE_SIZE;

  const navRow = [];
  if (hasPrev) navRow.push({ text: "⬅️", callback_data: `adminusers:${page - 1}` });
  navRow.push({ text: "🔄", callback_data: `adminusers:${page}` });
  if (hasNext) navRow.push({ text: "➡️", callback_data: `adminusers:${page + 1}` });

  const reply_markup = { inline_keyboard: [navRow] };

  if (opts.mode === "edit" && opts.messageId) {
    try {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: opts.messageId,
        text,
        reply_markup
      });
    } catch (e) {
      const msg = String(e?.message || e || "").toLowerCase();
      if (msg.includes("can't be edited") || msg.includes("message to edit not found")) {
        await tg("sendMessage", { chat_id: chatId, text, reply_markup });
        return;
      }
      throw e;
    }
    return;
  }


  await tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup
  });
}

async function fetchUsersPage(page) {
  const from = page * USERS_PAGE_SIZE;
  const to = from + USERS_PAGE_SIZE - 1;

  const { data, error, count } = await sb
    .from("users")
    .select(
      "tg_user_id,language,location_code,lat,lng,notify_prayers,notify_ramadan,notify_daily_morning,notify_daily_evening,created_at,updated_at",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { rows: data || [], total: typeof count === "number" ? count : null };
}

function renderUsersText(rows, page, total) {
  const head = [
    "👤 Userlar ro'yxati",
    total != null
      ? `Sahifa: ${page + 1}/${Math.max(1, Math.ceil(total / USERS_PAGE_SIZE))} | Jami: ${total}`
      : `Sahifa: ${page + 1}`,
    ""
  ].join("\n");

  if (!rows.length) return head + "Hali user yo'q.";

  const lines = rows.map((u, i) => {
    const idx = page * USERS_PAGE_SIZE + i + 1;
    const prefs = prefIcons(u);
    const loc = locLabel(u);
    const lang = u.language ? `🌐${u.language}` : "";
    return `${idx}) ${u.tg_user_id}  ${lang} ${loc}  ${prefs}`.trim();
  });

  return head + lines.join("\n");
}

function prefIcons(u) {
  let s = "";
  if (u.notify_prayers) s += "🕌";
  if (u.notify_ramadan) s += "🌙";
  if (u.notify_daily_morning) s += "☀️";
  if (u.notify_daily_evening) s += "🌆";
  return s || "—";
}

function locLabel(u) {
  if (u.lat != null && u.lng != null) return "📍GPS";
  if (u.location_code) return `🏙${u.location_code}`;
  return "";
}
