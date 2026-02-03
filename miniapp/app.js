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
  return new Date(d).toLocaleDateString("uz-UZ", { day:"2-digit", month:"short" });
}

function pill(name, time) {
  return `<div class="pill"><b>${name}</b><span>${time}</span></div>`;
}

function toggleRow(key, title, desc, value) {
  const on = value ? "on" : "";
  return `
    <div class="toggle" onclick="togglePref('${key}', ${!value})">
      <div class="label">
        <strong>${title}</strong>
        <small>${desc}</small>
      </div>
      <div class="switch ${on}"></div>
    </div>
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
    $("place").textContent = "Botda lokatsiya tanlanmagan. Botga qayting.";
    return;
  }

  $("place").textContent = data.locationName;
  $("todayDate").textContent = formatDate(Date.now());
  $("tomorrowDate").textContent = formatDate(Date.now() + 86400000);

  $("today").innerHTML = Object.entries(data.today).map(([k,v]) => pill(k,v)).join("");
  $("tomorrow").innerHTML = Object.entries(data.tomorrow).map(([k,v]) => pill(k,v)).join("");

  const p = data.prefs;
  $("toggles").innerHTML = [
    toggleRow("notify_prayers", "Namoz vaqti eslatmasi", "Har namoz kirganda xabar", p.notify_prayers),
    toggleRow("notify_ramadan", "Ramazon eslatmasi", "Saharlik/Iftor + duo", p.notify_ramadan),
    toggleRow("notify_daily_morning", "Ertalab jadval", "Bomdoddan oldin bugungi vaqtlar", p.notify_daily_morning),
    toggleRow("notify_daily_evening", "Kechki jadval", "Kechqurun ertangi vaqtlar", p.notify_daily_evening),
  ].join("");

  $("statusChip").textContent = "Sinxron ✅";
}

boot().catch(err => {
  console.error(err);
  $("statusChip").textContent = "Xatolik ⚠️";
  $("place").textContent = "Ulanishda xatolik. Keyinroq urinib ko‘ring.";
});
