const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const el = (id) => document.getElementById(id);

const state = {
  initData: tg?.initData || "",
  data: null
};

function setTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

function render() {
  const d = state.data;
  if (!d) return;

  el("cityText").textContent = d.city_text || "";

  // Today list
  const list = [
    ["Bomdod", d.today?.fajr],
    ["Peshin", d.today?.dhuhr],
    ["Asr", d.today?.asr],
    ["Shom", d.today?.maghrib],
    ["Xufton", d.today?.isha],
  ];
  const todayHtml = list.map(([k,v]) =>
    `<div class="item"><b>${k}</b><span>${v || "-"}</span></div>`
  ).join("");
  el("todayList").innerHTML = todayHtml;

  // Ramadan box
  if (d.is_ramadan) {
    el("ramadanBox").innerHTML = `
      <div class="item"><b>Og‘iz yopish (Imsak)</b><span>${d.today?.imsak || "-"}</span></div>
      <div class="item"><b>Og‘iz ochish (Iftor)</b><span>${d.today?.maghrib || "-"}</span></div>
    `;
    el("duaText").textContent = d.iftar_dua || "";
  } else {
    el("ramadanBox").innerHTML = `<div class="muted">Hozir Ramazon emas (Hijriy oy: ${d.hijri_month || "-"})</div>`;
    el("duaText").textContent = d.iftar_dua || "";
  }

  // Settings
  el("s_prayers").checked = !!d.settings?.notify_prayers;
  el("s_ramadan").checked = !!d.settings?.notify_ramadan;
  el("s_morning").checked = !!d.settings?.notify_morning_summary;
  el("s_evening").checked = !!d.settings?.notify_evening_summary;
  el("s_offset").value = String(d.settings?.offset_minutes ?? 0);

  // Next prayer & countdown (simple)
  el("nextPrayer").textContent = d.next_label || "...";
  el("countdown").textContent = d.next_in || "...";

  // Week
  el("weekList").innerHTML = (d.week || []).map(day => `
    <div class="day">
      <div class="dayTitle">${day.day}</div>
      <div class="muted">Bomdod ${day.fajr} • Peshin ${day.dhuhr} • Asr ${day.asr} • Shom ${day.maghrib} • Xufton ${day.isha}</div>
    </div>
  `).join("");
}

async function loadData() {
  const res = await fetch("/api/webapp/data", {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({ initData: state.initData })
  });
  const json = await res.json();
  state.data = json;
  render();
}

async function saveSettings() {
  el("saveHint").textContent = "Saqlanmoqda...";
  const body = {
    initData: state.initData,
    settings: {
      notify_prayers: el("s_prayers").checked,
      notify_ramadan: el("s_ramadan").checked,
      notify_morning_summary: el("s_morning").checked,
      notify_evening_summary: el("s_evening").checked,
      offset_minutes: Number(el("s_offset").value || 0)
    }
  };

  const res = await fetch("/api/webapp/settings", {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(body)
  });

  const json = await res.json();
  el("saveHint").textContent = json.ok ? "✅ Saqlandi" : ("❌ Xatolik: " + (json.error || ""));
}

el("refreshBtn").addEventListener("click", loadData);
el("saveSettings").addEventListener("click", saveSettings);
el("copyDua").addEventListener("click", async () => {
  await navigator.clipboard.writeText(el("duaText").textContent || "");
});

setTabs();
loadData();
