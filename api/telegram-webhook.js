const {
  tg, ik, t,
  TG_WEBHOOK_SECRET,
  upsertUser, getUser, setUser,
  getChildren, getLocation,
  locKeyboard, prefsKeyboard
} = require("../utils");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== TG_WEBHOOK_SECRET) return res.status(403).send("Forbidden");

    const update = req.body;

    if (update.message) await onMessage(update.message);
    if (update.callback_query) await onCallback(update.callback_query);

    res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    res.status(200).send("ok"); // Telegram retry storm bo'lmasin
  }
};

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const tgUserId = msg.from.id;

  if (msg.text === "/start") {
    await upsertUser(tgUserId);
    const u = await getUser(tgUserId);

    await tg("sendMessage", {
      chat_id: chatId,
      text: t(u.language, "startIntro") + "\n\n" + t(u.language, "chooseLang"),
      ...ik([
        [{ text: "O‘zbekcha", callback_data: "lang:uz" }]
      ])
    });

    await setUser(tgUserId, { step: "LANG" });
  }
}

async function onCallback(cb) {
  const tgUserId = cb.from.id;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  // loaderni o'chirish
  await tg("answerCallbackQuery", { callback_query_id: cb.id });

  await upsertUser(tgUserId);
  const u = await getUser(tgUserId);

  const data = cb.data || "";

  // LANG
  if (data.startsWith("lang:")) {
    const lang = data.split(":")[1];
    await setUser(tgUserId, { language: lang, step: "REGION" });

    const regions = await getChildren(null, "region");
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: t(lang, "chooseRegion"),
      ...locKeyboard(regions, "region", 0, 10)
    });
    return;
  }

  // REGION select + pagination
  if (data.startsWith("region:")) {
    const [, code, pageStr] = data.split(":");
    if (code === "__PAGE__") {
      const regions = await getChildren(null, "region");
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: t(u.language, "chooseRegion"),
        ...locKeyboard(regions, "region", parseInt(pageStr, 10), 10)
      });
      return;
    }

    await setUser(tgUserId, { temp_parent: code, step: "DISTRICT" });
    const districts = await getChildren(code, "district");

    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: t(u.language, "chooseDistrict"),
      ...locKeyboard(districts, "district", 0, 10)
    });
    return;
  }

  // DISTRICT select + pagination
  if (data.startsWith("district:")) {
    const [, code, pageStr] = data.split(":");
    if (code === "__PAGE__") {
      const districts = await getChildren(u.temp_parent, "district");
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: t(u.language, "chooseDistrict"),
        ...locKeyboard(districts, "district", parseInt(pageStr, 10), 10)
      });
      return;
    }

    await setUser(tgUserId, { temp_parent: code, step: "CITY" });
    const cities = await getChildren(code, "city");

    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: t(u.language, "chooseCity"),
      ...locKeyboard(cities, "city", 0, 10)
    });
    return;
  }

  // CITY select + pagination
  if (data.startsWith("city:")) {
    const [, code, pageStr] = data.split(":");
    if (code === "__PAGE__") {
      const cities = await getChildren(u.temp_parent, "city");
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: t(u.language, "chooseCity"),
        ...locKeyboard(cities, "city", parseInt(pageStr, 10), 10)
      });
      return;
    }

    const loc = await getLocation(code);
    if (!loc?.lat || !loc?.lng) {
      await tg("sendMessage", { chat_id: chatId, text: "Bu lokatsiyada koordinata yo‘q. locations jadvaliga lat/lng qo‘shing." });
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
      text: t(updated.language, "prefsTitle"),
      ...prefsKeyboard(updated)
    });

    await tg("sendMessage", { chat_id: chatId, text: t(updated.language, "done") });
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
      text: t(updated.language, "prefsTitle") + "\n" + t(updated.language, "prefsSaved"),
      ...prefsKeyboard(updated)
    });
    return;
  }
}
