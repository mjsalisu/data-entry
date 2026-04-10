/* =============================================
   BCWS Target Tracker Dashboard — JavaScript
   ============================================= */

// ── Partner data from the spreadsheet ──
const PARTNERS = {
  northern: [
    { state: "Benue",   partner: "Mindset Series",       regular: 0,     pwd: 0,    idp: 2000, femaleTarget: 80, target: 2000, placement: 45, reach: 60 },
    { state: "Kaduna",  partner: "YandyTech Community",   regular: 0,     pwd: 1500, idp: 0,    femaleTarget: 80, target: 1500, placement: 45, reach: 60 },
    { state: "Kano",    partner: "Dev Hub",               regular: 2000,  pwd: 1500, idp: 0,    femaleTarget: 80, target: 3500, placement: 45, reach: 60 },
    { state: "Kano",    partner: "Spider Tech",           regular: 2000,  pwd: 1500, idp: 0,    femaleTarget: 80, target: 3500, placement: 45, reach: 60 },
    { state: "Katsina", partner: "FAHYE",                 regular: 0,     pwd: 0,    idp: 1000, femaleTarget: 80, target: 1000, placement: 45, reach: 60 },
  ],
  southern: [
    { state: "Akwa Ibom", partner: "The Root Hub",                    regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Edo",       partner: "BlueChip Consults",               regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Enugu",     partner: "Nnenna Anozie Foundation",        regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Enugu",     partner: "RedFoundation",                   regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Ogun",      partner: "Do it Services",                  regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Ondo",      partner: "SafeStone",                       regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Ondo",      partner: "TentaGrow Integrated Farms Ltd",  regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Oyo",       partner: "Opportunity Hub",                 regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
    { state: "Oyo",       partner: "TentaGrow Integrated Farms Ltd",  regular: 5000, pwd: 0, idp: 0, femaleTarget: 80, target: 5000, placement: 45, reach: 60 },
  ],
  // States with no partner yet
  pending: ["Abia", "Cross River", "Delta", "Nassarawa"]
};

// ── Months for Year-to-Date (Feb 2026 → Feb 2027) ──
const YTD_MONTHS = [
  "Feb 26","Mar 26","Apr 26","May 26","Jun 26","Jul 26",
  "Aug 26","Sep 26","Oct 26","Nov 26","Dec 26","Jan 27","Feb 27"
];

// ── LocalStorage keys ──
const LS_KEY = "bcws_tracker_data";

// ── Helpers ──
const fmt = n => n.toLocaleString("en-NG");
const $ = id => document.getElementById(id);
const now = new Date();

// ── Load / Save persisted data ──
function loadData() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveData(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// Get or initialize month data
function getMonthData(monthKey) {
  const data = loadData();
  if (!data[monthKey]) {
    data[monthKey] = { partners: {} };
    // Initialize all partners
    [...PARTNERS.northern, ...PARTNERS.southern].forEach(p => {
      const key = `${p.state}|${p.partner}`;
      data[monthKey].partners[key] = { training: 0, unique: 0 };
    });
    saveData(data);
  }
  return data[monthKey];
}

function updatePartnerData(monthKey, partnerKey, field, value) {
  const data = loadData();
  if (!data[monthKey]) data[monthKey] = { partners: {} };
  if (!data[monthKey].partners[partnerKey]) data[monthKey].partners[partnerKey] = { training: 0, unique: 0 };
  data[monthKey].partners[partnerKey][field] = parseInt(value) || 0;
  saveData(data);
}

// ── Populate month selector ──
function initMonthSelector() {
  const sel = $("monthSelect");
  YTD_MONTHS.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    // Default to current-ish month
    const monthIdx = now.getMonth(); // 0-based
    const year = now.getFullYear();
    if ((year === 2026 && i === monthIdx - 1) || (year === 2027 && i === monthIdx + 11)) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  });
  // If none selected, select first
  if (!sel.value) sel.value = YTD_MONTHS[0];
  sel.addEventListener("change", () => renderAll());
}

// ── Render Region Table ──
function renderRegionTable(region, bodyId, totalId) {
  const monthKey = $("monthSelect").value;
  const monthData = getMonthData(monthKey);
  const tbody = $(bodyId);
  tbody.innerHTML = "";
  let regionTotal = 0, regionTraining = 0, regionUnique = 0;

  PARTNERS[region].forEach(p => {
    const key = `${p.state}|${p.partner}`;
    const pd = monthData.partners[key] || { training: 0, unique: 0 };
    const dup = Math.max(0, pd.training - pd.unique);
    regionTotal += p.target;
    regionTraining += pd.training;
    regionUnique += pd.unique;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="state-cell">${p.state}</td>
      <td class="partner-cell" title="${p.partner}">${p.partner}</td>
      <td class="num-cell">${fmt(p.regular)}</td>
      <td class="num-cell">${fmt(p.pwd)}</td>
      <td class="num-cell">${fmt(p.idp)}</td>
      <td class="num-cell" style="font-weight:700;color:#818cf8">${fmt(p.target)}</td>
      <td class="input-cell"><input type="number" min="0" value="${pd.training}" data-key="${key}" data-field="training" data-month="${monthKey}"></td>
      <td class="input-cell"><input type="number" min="0" value="${pd.unique}" data-key="${key}" data-field="unique" data-month="${monthKey}"></td>
      <td class="num-cell dup-cell">${fmt(dup)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Pending states
  if (region === "southern") {
    PARTNERS.pending.forEach(state => {
      const tr = document.createElement("tr");
      tr.style.opacity = ".45";
      tr.innerHTML = `<td class="state-cell">${state}</td><td class="partner-cell" style="color:var(--text-dim)">— Pending —</td>
        <td class="num-cell">-</td><td class="num-cell">-</td><td class="num-cell">-</td>
        <td class="num-cell">-</td><td class="num-cell">-</td><td class="num-cell">-</td><td class="num-cell">-</td>`;
      tbody.appendChild(tr);
    });
  }

  $(totalId).textContent = `Target: ${fmt(regionTotal)}`;
  return { total: regionTotal, training: regionTraining, unique: regionUnique };
}

// ── Render KPIs ──
function renderKPIs(northStats, southStats) {
  const totalTarget = northStats.total + southStats.total;
  const totalTraining = northStats.training + southStats.training;
  const totalUnique = northStats.unique + southStats.unique;
  const totalDup = Math.max(0, totalTraining - totalUnique);
  const dupPct = totalTraining > 0 ? ((totalDup / totalTraining) * 100).toFixed(1) : 0;

  $("kpiTarget").textContent = fmt(totalTarget);
  $("kpiTraining").textContent = fmt(totalTraining);
  $("kpiUnique").textContent = fmt(totalUnique);
  $("kpiDuplicates").textContent = fmt(totalDup);
  $("kpiDupBadge").textContent = dupPct + "%";

  const trainingPct = totalTarget > 0 ? Math.min(100, (totalTraining / totalTarget) * 100) : 0;
  const uniquePct = totalTarget > 0 ? Math.min(100, (totalUnique / totalTarget) * 100) : 0;
  $("kpiTrainingBar").style.width = trainingPct + "%";
  $("kpiUniqueBar").style.width = uniquePct + "%";

  // Donut chart
  const circumference = 2 * Math.PI * 80; // ~502.65
  const northPct = totalTarget > 0 ? northStats.total / totalTarget : 0;
  const southPct = totalTarget > 0 ? southStats.total / totalTarget : 0;
  $("donutNorth").setAttribute("stroke-dasharray", `${northPct * circumference} ${circumference}`);
  $("donutSouth").setAttribute("stroke-dasharray", `${southPct * circumference} ${circumference}`);
  $("donutSouth").setAttribute("stroke-dashoffset", `${125.66 - northPct * circumference}`);
  $("donutTotal").textContent = fmt(totalTarget);
}

// ── Render YTD Table ──
function renderYTD() {
  const data = loadData();
  const tbody = $("ytdBody");
  tbody.innerHTML = "";
  const allPartners = [...PARTNERS.northern, ...PARTNERS.southern];
  let ytdTarget = 0, ytdTraining = 0, ytdUnique = 0;

  // Group by region
  [{ label: "Northern Region", list: PARTNERS.northern, cls: "northern" },
   { label: "Southern Region", list: PARTNERS.southern, cls: "southern" }].forEach(region => {
    // Region header row
    const rtr = document.createElement("tr");
    rtr.className = "region-row";
    let rhtml = `<td class="sticky-col">${region.label}</td>`;
    let regionYTDTotals = new Array(YTD_MONTHS.length).fill(0);
    let regionGrandTotal = 0;

    // Calculate region totals first
    region.list.forEach(p => {
      const key = `${p.state}|${p.partner}`;
      YTD_MONTHS.forEach((m, mi) => {
        const md = data[m]?.partners?.[key];
        regionYTDTotals[mi] += md?.unique || 0;
      });
    });
    regionGrandTotal = regionYTDTotals.reduce((a, b) => a + b, 0);
    regionYTDTotals.forEach(v => { rhtml += `<td style="font-weight:700">${v > 0 ? fmt(v) : '-'}</td>`; });
    rhtml += `<td class="total-col">${fmt(regionGrandTotal)}</td>`;
    rtr.innerHTML = rhtml;
    tbody.appendChild(rtr);

    // Partner rows
    region.list.forEach(p => {
      const key = `${p.state}|${p.partner}`;
      const tr = document.createElement("tr");
      let html = `<td class="sticky-col"><span style="color:var(--accent2)">${p.state}</span> — ${p.partner}</td>`;
      let rowTotal = 0;

      YTD_MONTHS.forEach((m, mi) => {
        const md = data[m]?.partners?.[key];
        const v = md?.unique || 0;
        rowTotal += v;
        ytdTarget += p.target; // per month
        ytdTraining += md?.training || 0;
        ytdUnique += v;
        const currentMonth = $("monthSelect").value;
        const cls = m === currentMonth ? ' class="month-active"' : '';
        html += `<td${cls}>${v > 0 ? fmt(v) : '<span style="color:var(--text-dim)">-</span>'}</td>`;
      });
      html += `<td class="total-col">${rowTotal > 0 ? fmt(rowTotal) : '-'}</td>`;
      tr.innerHTML = html;
      tbody.appendChild(tr);
    });
  });

  $("ytdTotalTarget").textContent = fmt(ytdTarget);
  $("ytdTotalTraining").textContent = fmt(ytdTraining);
  $("ytdTotalUnique").textContent = fmt(ytdUnique);
}

// ── Render Bar Chart ──
function renderBarChart() {
  const data = loadData();
  const chart = $("barChart");
  chart.innerHTML = "";
  const allPartners = [...PARTNERS.northern, ...PARTNERS.southern];
  const monthlyTarget = allPartners.reduce((s, p) => s + p.target, 0);

  YTD_MONTHS.forEach(m => {
    const md = data[m]?.partners || {};
    let training = 0, unique = 0;
    allPartners.forEach(p => {
      const key = `${p.state}|${p.partner}`;
      training += md[key]?.training || 0;
      unique += md[key]?.unique || 0;
    });

    const maxVal = Math.max(monthlyTarget, training, unique, 1);
    const tH = (monthlyTarget / maxVal) * 160;
    const trH = (training / maxVal) * 160;
    const uH = (unique / maxVal) * 160;

    const group = document.createElement("div");
    group.className = "bar-group";
    group.innerHTML = `
      <div class="bar-group-bars">
        <div class="bar bar-target" style="height:${tH}px" data-tooltip="Target: ${fmt(monthlyTarget)}"></div>
        <div class="bar bar-training" style="height:${trH}px" data-tooltip="Training: ${fmt(training)}"></div>
        <div class="bar bar-unique" style="height:${uH}px" data-tooltip="Unique: ${fmt(unique)}"></div>
      </div>
      <span class="bar-label">${m}</span>
    `;
    chart.appendChild(group);
  });
}

// ── Master render ──
function renderAll() {
  const north = renderRegionTable("northern", "northBody", "northTotal");
  const south = renderRegionTable("southern", "southBody", "southTotal");
  renderKPIs(north, south);
  renderYTD();
  renderBarChart();
}

// ── Event delegation for inputs ──
document.addEventListener("input", e => {
  if (e.target.matches(".tracker-table input[type=number]")) {
    const { key, field, month } = e.target.dataset;
    updatePartnerData(month, key, field, e.target.value);
    renderAll();
  }
});

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  initMonthSelector();
  renderAll();
});
