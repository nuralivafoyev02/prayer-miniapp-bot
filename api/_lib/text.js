export function tr(lang = "uz") {
  const UZ = {
    intro:
      "Assalomu alaykum! Men namoz va Ramazon vaqtlarini eslatib turaman.\n\n" +
      "✅ Namoz vaqtida eslatma\n" +
      "✅ Ramazonda saharlik/iftor + duo\n" +
      "✅ Har kuni bomdoddan oldin jadval\n" +
      "✅ Kechqurun ertangi jadval\n\n" +
      "Tilni tanlang:",
    chooseRegion: "Viloyatni tanlang:",
    chooseCity: "Shaharni tanlang:",
    chooseNotify: "Eslatmalarni sozlang:",
    done: "Tayyor ✅ Mini App orqali ham ko‘rishingiz mumkin."
  };

  const RU = {
    intro:
      "Ассалому алейкум! Я напомню время намаза и Рамазана.\n\n" +
      "✅ Уведомления во время намаза\n" +
      "✅ В Рамазан: сухур/ифтар + дуа\n" +
      "✅ Ежедневно (до фаджра) расписание\n" +
      "✅ Вечером расписание на завтра\n\n" +
      "Выберите язык:",
    chooseRegion: "Выберите регион:",
    chooseCity: "Выберите город:",
    chooseNotify: "Настройте уведомления:",
    done: "Готово ✅ Можно смотреть и через Mini App."
  };

  const EN = {
    intro:
      "Assalamu alaikum! I’ll remind prayer times and Ramadan timings.\n\n" +
      "✅ Exact-time reminders\n✅ Ramadan: suhoor/iftar + dua\n✅ Daily schedule (before Fajr)\n✅ Evening schedule for tomorrow\n\n" +
      "Choose language:",
    chooseRegion: "Choose region:",
    chooseCity: "Choose city:",
    chooseNotify: "Configure notifications:",
    done: "Done ✅ You can also use the Mini App."
  };

  return lang === "ru" ? RU : lang === "en" ? EN : UZ;
}
