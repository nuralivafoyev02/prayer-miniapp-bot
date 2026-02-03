const tg = window.Telegram?.WebApp;
tg?.ready?.();

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: tg?.initData || "", ...body })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("uz-UZ", { day: "2-digit", month: "short" });
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
  await api("/api/miniapp-prefs", { key, value });
  tg?.HapticFeedback?.impactOccurred?.("light");
  await boot(); // refresh
};

async function boot() {
  $("place").textContent = "Yuklanmoqda…";
  const data = await api("/api/miniapp-me", {});

  if (data.needsSetup) {
    $("status").textContent = "Botda lokatsiya sozlanmagan. Botga qayting va 📍 lokatsiya yuboring.";
    const badge = document.getElementById("badge");
    badge.textContent = "📍 Lokatsiya kerak";
    return;
  }


  $("place").textContent = data.locationName;
  $("todayDate").textContent = formatDate(Date.now());
  $("tomorrowDate").textContent = formatDate(Date.now() + 86400000);

  $("today").innerHTML = Object.entries(data.today).map(([k, v]) => pill(k, v)).join("");
  $("tomorrow").innerHTML = Object.entries(data.tomorrow).map(([k, v]) => pill(k, v)).join("");

  const p = data.prefs;
  $("toggles").innerHTML = [
    toggleRow("notify_prayers", "Namoz eslatmasi", "Namoz vaqti kirganda bildirishnoma keladi", "🕌", p.notify_prayers),
    toggleRow("notify_ramadan", "Ramazon eslatmasi", "Saharlik/iftor va duolar bilan eslatadi", "🌙", p.notify_ramadan),
    toggleRow("notify_daily_morning", "Ertalab jadval", "Bomdoddan oldin bugungi vaqtlar yuboriladi", "☀️", p.notify_daily_morning),
    toggleRow("notify_daily_evening", "Kechki jadval", "Kechqurun ertangi vaqtlar yuboriladi", "🌆", p.notify_daily_evening)
  ].join("");


  $("statusChip").textContent = "Sinxron ✅";
}

boot().catch(err => {
  console.error(err);
  $("statusChip").textContent = "Xatolik ⚠️";
  $("place").textContent = "Ulanishda xatolik. Keyinroq urinib ko‘ring.";
});
