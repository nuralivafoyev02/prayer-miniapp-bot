const tg = window.Telegram?.WebApp;
tg?.ready?.();

const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}
function setBadge(text) {
  const el = $("badge");
  if (el) el.textContent = text;
}

async function api(path, body) {
  const initData = tg?.initData || "";
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData, ...body })
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt);
  return JSON.parse(txt);
}

function pill(name, time) {
  return `<div class="pill"><b>${name}</b><span>${time}</span></div>`;
}

function toggleRow(key, title, desc, icon, value) {
  const stateClass = value ? "on" : "";
  const stateText = value ? "ON" : "OFF";
  return `
    <button class="toggle-row" type="button" onclick="togglePref('${key}', ${!value})">
      <div class="toggle-left">
        <div class="ico">${icon}</div>
        <div>
          <div class="toggle-title">${title}</div>
          <div class="toggle-desc">${desc}</div>
        </div>
      </div>

      <div class="toggle-right">
        <span class="state ${stateClass}">${stateText}</span>
        <span class="switch ${stateClass}">
          <span class="knob"></span>
        </span>
      </div>
    </button>
  `;
}

window.togglePref = async (key, value) => {
  try {
    setText("status", "⏳ Saqlanmoqda…");
    await api("/api/miniapp-prefs", { key, value });
    tg?.HapticFeedback?.impactOccurred?.("light");
    await boot();
  } catch (e) {
    console.error(e);
    setText("status", "⚠️ Saqlashda xatolik bo‘ldi.");
  }
};

async function boot() {
  try {
    // Telegram initData yo‘q bo‘lsa — darrov tushunarli xabar
    if (!tg?.initData) {
      setBadge("⚠️ Telegram kerak");
      setText("status", "Mini App faqat Telegram ichida ochilganda ishlaydi. Botdagi 📲 Mini App tugmasidan kiring.");
      return;
    }

    setBadge("⏳ Yuklanmoqda…");
    setText("status", "Yuklanmoqda…");

    const data = await api("/api/miniapp-me", {});

    if (data.needsSetup) {
      setBadge("📍 Lokatsiya kerak");
      setText("status", "Botda lokatsiya sozlanmagan. Botga qayting va 📍 lokatsiya yuboring.");
      return;
    }

    setBadge(data.ramadan ? "🌙 Ramazon: ON" : "🕌 Ramazon: OFF");
    setText("status", "Hammasi tayyor. Eslatmalarni pastdan sozlang.");

    $("today").innerHTML = Object.entries(data.today).map(([k, v]) => pill(k, v)).join("");
    $("tomorrow").innerHTML = Object.entries(data.tomorrow).map(([k, v]) => pill(k, v)).join("");

    const p = data.prefs;
    $("toggles").innerHTML = [
      toggleRow("notify_prayers", "Namoz eslatmasi", "Namoz vaqti kirganda bildirishnoma keladi", "🕌", p.notify_prayers),
      toggleRow("notify_ramadan", "Ramazon eslatmasi", "Saharlik/iftor va duolar bilan eslatadi", "🌙", p.notify_ramadan),
      toggleRow("notify_daily_morning", "Ertalab jadval", "Bomdoddan oldin bugungi vaqtlar yuboriladi", "☀️", p.notify_daily_morning),
      toggleRow("notify_daily_evening", "Kechki jadval", "Kechqurun ertangi vaqtlar yuboriladi", "🌆", p.notify_daily_evening)
    ].join("");
  } catch (e) {
    console.error(e);
    // API xatosini ham user ko‘rsin (Telegram ichida)
    setBadge("⚠️ Xatolik");
    setText("status", "Xatolik: " + String(e.message || e).slice(0, 140));
  }
}

boot();
