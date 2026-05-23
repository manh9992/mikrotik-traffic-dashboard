// ── Helpers ──────────────────────────────────────────
function kbToHuman(kb) {
  if (kb === 0) return '0 MB';
  if (kb < 1024) return kb.toFixed(0) + ' KB';
  if (kb < 1024 * 1024) return (kb / 1024).toFixed(1) + ' MB';
  return (kb / (1024 * 1024)).toFixed(2) + ' GB';
}
function kbToGbNum(kb) { return kb / (1024 * 1024); }

const MONTH_VI = ['Th.1','Th.2','Th.3','Th.4','Th.5','Th.6',
                  'Th.7','Th.8','Th.9','Th.10','Th.11','Th.12'];

const $ = id => document.getElementById(id);

// ── Chart defaults ─────────────────────────────────────
Chart.defaults.color = '#64748b';
Chart.defaults.font.family = 'Inter';

const CHART_COLORS = {
  fptDl: { bg: 'rgba(249,115,22,0.75)',  border: '#f97316' },
  fptUl: { bg: 'rgba(249,115,22,0.25)',  border: 'rgba(249,115,22,0.6)' },
  vttDl: { bg: 'rgba(239,68,68,0.75)', border: '#ef4444' },
  vttUl: { bg: 'rgba(239,68,68,0.25)', border: 'rgba(239,68,68,0.6)' },
};

function buildDatasets(keys, data) {
  return [
    { label: 'FPT ↓', data: keys.map(k => +kbToGbNum(data[k].fptDl).toFixed(3)),
      backgroundColor: CHART_COLORS.fptDl.bg, borderColor: CHART_COLORS.fptDl.border,
      borderWidth: 1, borderRadius: 4, borderSkipped: false },
    { label: 'Viettel ↓', data: keys.map(k => +kbToGbNum(data[k].vttDl).toFixed(3)),
      backgroundColor: CHART_COLORS.vttDl.bg, borderColor: CHART_COLORS.vttDl.border,
      borderWidth: 1, borderRadius: 4, borderSkipped: false },
    { label: 'FPT ↑', data: keys.map(k => +kbToGbNum(data[k].fptUl).toFixed(3)),
      backgroundColor: CHART_COLORS.fptUl.bg, borderColor: CHART_COLORS.fptUl.border,
      borderWidth: 1, borderRadius: 4, borderSkipped: false },
    { label: 'Viettel ↑', data: keys.map(k => +kbToGbNum(data[k].vttUl).toFixed(3)),
      backgroundColor: CHART_COLORS.vttUl.bg, borderColor: CHART_COLORS.vttUl.border,
      borderWidth: 1, borderRadius: 4, borderSkipped: false },
  ];
}

function chartOptions() {
  return {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#475569', font: { size: 12 }, padding: 14 } },
      tooltip: {
        backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderWidth: 1,
        titleColor: '#1e293b', bodyColor: '#64748b', padding: 12,
        callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)} GB` }
      }
    },
    scales: {
      x: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 11 } } },
      y: {
        grid: { color: '#f1f5f9' },
        ticks: { color: '#64748b', font: { size: 11 }, callback: v => v + ' GB' },
      }
    }
  };
}

// ── Charts state ───────────────────────────────────────
const charts = { daily: null, monthly: null, yearly: null };

function renderChart(id, labels, data, keys) {
  const ctx = $(id).getContext('2d');
  if (charts[id.replace('Chart','')]) charts[id.replace('Chart','')].destroy();
  const key = id.replace('Chart','');
  charts[key] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: buildDatasets(keys, data) },
    options: chartOptions()
  });
}

// ── Table builders ─────────────────────────────────────
function buildTableRows(tbodyId, keys, data, labelFn, todayKey) {
  const tbody = $(tbodyId);
  tbody.innerHTML = '';
  [...keys].reverse().forEach(k => {
    const d = data[k];
    const dl = d.fptDl + d.vttDl;
    const ul = d.fptUl + d.vttUl;
    const tr = document.createElement('tr');
    if (k === todayKey) { tr.classList.add('today-row'); }
    tr.innerHTML = `
      <td class="${k === todayKey ? 'today-label' : ''}">${labelFn(k)}</td>
      <td class="fpt-color">${kbToHuman(d.fptDl)}</td>
      <td class="fpt-color">${kbToHuman(d.fptUl)}</td>
      <td class="vtt-color">${kbToHuman(d.vttDl)}</td>
      <td class="vtt-color">${kbToHuman(d.vttUl)}</td>
      <td class="total-color">${kbToHuman(dl)}</td>
      <td class="total-color">${kbToHuman(ul)}</td>
      <td class="total-color">${kbToHuman(dl + ul)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Date label helpers ─────────────────────────────────
function labelDay(k)  {
  const [y, m, d] = k.split('-');
  return `${d}/${m}/${y}`;
}
function labelMonth(k) {
  const [y, m] = k.split('-');
  return `${MONTH_VI[parseInt(m)-1]} ${y}`;
}
function labelYear(k) { return `Năm ${k}`; }

// ── Today key ─────────────────────────────────────────
function todayKey() { return new Date().toLocaleDateString('en-CA'); }
function thisMonthKey() { return todayKey().slice(0, 7); }
function thisYearKey() { return todayKey().slice(0, 4); }

// ── Summary cards ─────────────────────────────────────
async function fetchToday() {
  try {
    const r = await fetch('/api/today');
    const d = await r.json();
    $('sumFptDl').textContent = kbToHuman(d.fptDl);
    $('sumFptUl').textContent = kbToHuman(d.fptUl);
    $('sumVttDl').textContent = kbToHuman(d.vttDl);
    $('sumVttUl').textContent = kbToHuman(d.vttUl);
    $('sumMonFptDl').textContent = kbToHuman(d.monFptDl);
    $('sumMonFptUl').textContent = kbToHuman(d.monFptUl);
    $('sumMonVttDl').textContent = kbToHuman(d.monVttDl);
    $('sumMonVttUl').textContent = kbToHuman(d.monVttUl);
    $('sumTotalDl').textContent = kbToHuman(d.fptDl + d.vttDl);
    $('sumTotalUl').textContent = kbToHuman(d.fptUl + d.vttUl);
    $('sumMonTotalDl').textContent = kbToHuman(d.monFptDl + d.monVttDl);
    $('sumMonTotalUl').textContent = kbToHuman(d.monFptUl + d.monVttUl);

    const t = d.lastModified ? new Date(d.lastModified.replace(' ','T') + '+07:00') : new Date();
    $('lastUpdate').textContent = 'Cập nhật lúc ' + t.toLocaleTimeString('vi-VN') + ' · ' + t.toLocaleDateString('vi-VN');

    const badge = $('statusBadge');
    badge.classList.remove('offline');
    $('statusText').textContent = 'Online';
  } catch(e) {
    $('statusBadge').classList.add('offline');
    $('statusText').textContent = 'Offline';
  }
}

// ── Daily ─────────────────────────────────────────────
let currentDays = 7;
async function loadDaily(days) {
  currentDays = days;
  const r = await fetch(`/api/history?range=${days}d`);
  const raw = await r.json();

  // Inject today's live data from /api/today
  try {
    const td = await (await fetch('/api/today')).json();
    const tk = todayKey();
    raw[tk] = { fptDl: td.fptDl, fptUl: td.fptUl, vttDl: td.vttDl, vttUl: td.vttUl };
  } catch(e) {}

  const keys = Object.keys(raw).sort();
  const labels = keys.map(k => { const [y,m,d] = k.split('-'); return `${d}/${m}`; });
  renderChart('dailyChart', labels, raw, keys);
  buildTableRows('dailyTableBody', keys, raw, labelDay, todayKey());
}

// ── Monthly ───────────────────────────────────────────
async function loadMonthly() {
  const r = await fetch('/api/history?range=12m');
  const raw = await r.json();

  // Inject current month live from /api/today
  try {
    const td = await (await fetch('/api/today')).json();
    const mk = thisMonthKey();
    if (raw[mk]) {
      raw[mk].fptDl  = Math.max(raw[mk].fptDl,  td.monFptDl);
      raw[mk].fptUl  = Math.max(raw[mk].fptUl,  td.monFptUl);
      raw[mk].vttDl  = Math.max(raw[mk].vttDl,  td.monVttDl);
      raw[mk].vttUl  = Math.max(raw[mk].vttUl,  td.monVttUl);
    } else {
      raw[mk] = { fptDl: td.monFptDl, fptUl: td.monFptUl, vttDl: td.monVttDl, vttUl: td.monVttUl };
    }
  } catch(e) {}

  const keys = Object.keys(raw).sort();
  const labels = keys.map(k => labelMonth(k));
  renderChart('monthlyChart', labels, raw, keys);
  buildTableRows('monthlyTableBody', keys, raw, labelMonth, thisMonthKey());
}

// ── Yearly ────────────────────────────────────────────
async function loadYearly() {
  const r = await fetch('/api/history?range=1y');
  const raw = await r.json();

  // Inject current year from monthly data
  try {
    const mr = await (await fetch('/api/history?range=12m')).json();
    const td = await (await fetch('/api/today')).json();
    const mk = thisMonthKey();
    if (mr[mk]) {
      mr[mk].fptDl = Math.max(mr[mk].fptDl||0, td.monFptDl);
      mr[mk].fptUl = Math.max(mr[mk].fptUl||0, td.monFptUl);
      mr[mk].vttDl = Math.max(mr[mk].vttDl||0, td.monVttDl);
      mr[mk].vttUl = Math.max(mr[mk].vttUl||0, td.monVttUl);
    } else {
      mr[mk] = { fptDl: td.monFptDl, fptUl: td.monFptUl, vttDl: td.monVttDl, vttUl: td.monVttUl };
    }
    const yk = thisYearKey();
    const yearTotal = { fptDl:0, fptUl:0, vttDl:0, vttUl:0 };
    Object.entries(mr).filter(([k]) => k.startsWith(yk)).forEach(([,d]) => {
      yearTotal.fptDl += d.fptDl; yearTotal.fptUl += d.fptUl;
      yearTotal.vttDl += d.vttDl; yearTotal.vttUl += d.vttUl;
    });
    raw[yk] = yearTotal;
  } catch(e) {}

  const keys = Object.keys(raw).sort();
  const labels = keys.map(k => labelYear(k));
  renderChart('yearlyChart', labels, raw, keys);
  buildTableRows('yearlyTableBody', keys, raw, labelYear, thisYearKey());
}

// ── Tab switching ──────────────────────────────────────
let activeTab = 'daily';
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    $(`tab${activeTab.charAt(0).toUpperCase()+activeTab.slice(1)}`).classList.add('active');
    $('subDaily').style.display = activeTab === 'daily' ? 'flex' : 'none';
    if (activeTab === 'daily') await loadDaily(currentDays);
    if (activeTab === 'monthly') await loadMonthly();
    if (activeTab === 'yearly') await loadYearly();
  });
});

// Daily sub-range buttons
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    await loadDaily(parseInt(btn.dataset.days));
  });
});

// ── Init ──────────────────────────────────────────────
async function init() {
  await fetchToday();
  await loadDaily(7);
}
init();

// Refresh every 60s
setInterval(async () => {
  await fetchToday();
  if (activeTab === 'daily') await loadDaily(currentDays);
  else if (activeTab === 'monthly') await loadMonthly();
  else if (activeTab === 'yearly') await loadYearly();
}, 60000);
