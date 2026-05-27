let appConfig = { interfaces: [] };

function kbToHuman(kb) {
  if (kb === 0) return '0 MB';
  if (kb < 1024) return kb.toFixed(0) + ' KB';
  if (kb < 1024 * 1024) return (kb / 1024).toFixed(1) + ' MB';
  return (kb / (1024 * 1024)).toFixed(2) + ' GB';
}
function kbToGbNum(kb) { return kb / (1024 * 1024); }

const MONTH_VI = ['Th.1','Th.2','Th.3','Th.4','Th.5','Th.6','Th.7','Th.8','Th.9','Th.10','Th.11','Th.12'];
const $ = id => document.getElementById(id);

Chart.defaults.color = '#64748b';
Chart.defaults.font.family = 'Inter';

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildDatasets(keys, data) {
  const ds = [];
  appConfig.interfaces.forEach(iface => {
    ds.push({
      label: `${iface.label} ↓`,
      data: keys.map(k => +kbToGbNum(data[k][iface.id] ? data[k][iface.id].dl : 0).toFixed(3)),
      backgroundColor: hexToRgba(iface.color, 0.75), borderColor: iface.color,
      borderWidth: 1, borderRadius: 4, borderSkipped: false
    });
    ds.push({
      label: `${iface.label} ↑`,
      data: keys.map(k => +kbToGbNum(data[k][iface.id] ? data[k][iface.id].ul : 0).toFixed(3)),
      backgroundColor: hexToRgba(iface.color, 0.25), borderColor: hexToRgba(iface.color, 0.6),
      borderWidth: 1, borderRadius: 4, borderSkipped: false
    });
  });
  return ds;
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
      y: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 11 }, callback: v => v + ' GB' } }
    }
  };
}

const charts = { hourly: null, daily: null, monthly: null, yearly: null };
const rawCache = { hourly: null, daily: null, monthly: null, yearly: null };
const sortConfig = {
  hourlyTable: { col: 'date', dir: 'desc' },
  dailyTable: { col: 'date', dir: 'desc' },
  monthlyTable: { col: 'date', dir: 'desc' },
  yearlyTable: { col: 'date', dir: 'desc' }
};

function renderChart(id, labels, data, keys) {
  const ctx = $(id).getContext('2d');
  const key = id.replace('Chart','');
  if (charts[key]) charts[key].destroy();
  charts[key] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: buildDatasets(keys, data) },
    options: chartOptions()
  });
}

function initTableHeaders() {
  ['hourlyTable', 'dailyTable', 'monthlyTable', 'yearlyTable'].forEach(tid => {
    let typeName = tid === 'hourlyTable' ? 'Giờ' : tid === 'dailyTable' ? 'Ngày' : tid === 'monthlyTable' ? 'Tháng' : 'Năm';
    let thead = `<thead><tr><th data-sort="date" class="sortable sort-desc">${typeName} <span class="sort-icon"></span></th>`;
    appConfig.interfaces.forEach(iface => {
      thead += `<th data-sort="${iface.id}Dl" class="sortable" style="color:${iface.color}">${iface.label} (DL) <span class="sort-icon"></span></th>`;
      thead += `<th data-sort="${iface.id}Ul" class="sortable" style="color:${iface.color}">${iface.label} (UL) <span class="sort-icon"></span></th>`;
    });
    thead += `<th data-sort="totalDl" class="total-color sortable">Tổng (DL) <span class="sort-icon"></span></th>`;
    thead += `<th data-sort="totalUl" class="total-color sortable">Tổng (UL) <span class="sort-icon"></span></th>`;
    thead += `<th data-sort="total" class="total-color sortable">Tổng <span class="sort-icon"></span></th></tr></thead><tbody id="${tid}Body"></tbody>`;
    $(tid).innerHTML = thead;
  });
  
  // Attach sort listeners
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const tableId = th.closest('table').id;
      const col = th.dataset.sort;
      th.closest('tr').querySelectorAll('.sortable').forEach(el => {
        if (el !== th) el.classList.remove('sort-asc', 'sort-desc');
      });
      let dir = 'desc';
      if (th.classList.contains('sort-desc')) {
        dir = 'asc'; th.classList.remove('sort-desc'); th.classList.add('sort-asc');
      } else {
        th.classList.remove('sort-asc'); th.classList.add('sort-desc');
      }
      sortConfig[tableId] = { col, dir };
      
      const tabName = tableId.replace('Table', '');
      if (rawCache[tabName]) {
        let keys = tabName === 'hourly' ? getNonEmptyKeys(rawCache.hourly) : Object.keys(rawCache[tabName]);
        keys = keys.sort();
        const lblFn = tabName==='hourly'?labelHour : tabName==='daily'?labelDay : tabName==='monthly'?labelMonth:labelYear;
        buildTableRows(tableId + 'Body', keys, rawCache[tabName], lblFn, null, '');
      }
    });
  });
}

function buildTableRows(tbodyId, keys, data, labelFn, activeKey, activeClass) {
  const tbody = $(tbodyId);
  tbody.innerHTML = '';
  const tableId = tbodyId.replace('Body', '');
  const { col, dir } = sortConfig[tableId];

  let rows = keys.map(k => {
    const d = data[k];
    let rowObj = { k, d, date: k, totalDl: 0, totalUl: 0, total: 0 };
    appConfig.interfaces.forEach(iface => {
      let dl = d[iface.id] ? d[iface.id].dl : 0;
      let ul = d[iface.id] ? d[iface.id].ul : 0;
      rowObj[`${iface.id}Dl`] = dl;
      rowObj[`${iface.id}Ul`] = ul;
      rowObj.totalDl += dl;
      rowObj.totalUl += ul;
    });
    rowObj.total = rowObj.totalDl + rowObj.totalUl;
    return rowObj;
  });
  
  rows.sort((a, b) => {
    let valA = a[col], valB = b[col];
    if (valA < valB) return dir === 'asc' ? -1 : 1;
    if (valA > valB) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  rows.forEach(r => {
    const tr = document.createElement('tr');
    if (r.k === activeKey) tr.classList.add('today-row');
    let html = `<td class="${r.k === activeKey ? activeClass : ''}">${labelFn(r.k)}</td>`;
    appConfig.interfaces.forEach(iface => {
      html += `<td style="color:${iface.color}">${kbToHuman(r[`${iface.id}Dl`])}</td>`;
      html += `<td style="color:${iface.color}">${kbToHuman(r[`${iface.id}Ul`])}</td>`;
    });
    html += `<td class="total-color">${kbToHuman(r.totalDl)}</td>`;
    html += `<td class="total-color">${kbToHuman(r.totalUl)}</td>`;
    html += `<td class="total-color">${kbToHuman(r.total)}</td>`;
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}

function labelHour(k) { return k; }
function labelDay(k)  { const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; }
function labelMonth(k) { const [y, m] = k.split('-'); return `${MONTH_VI[parseInt(m)-1]} ${y}`; }
function labelYear(k) { return `Năm ${k}`; }
function todayKey() { return new Date().toLocaleDateString('en-CA'); }
function thisMonthKey() { return todayKey().slice(0, 7); }
function thisYearKey() { return todayKey().slice(0, 4); }

function getNonEmptyKeys(raw) {
  return Object.keys(raw).filter(k => {
    let sum = 0;
    appConfig.interfaces.forEach(i => sum += (raw[k][i.id] ? raw[k][i.id].dl + raw[k][i.id].ul : 0));
    return sum > 0;
  });
}

function buildSummaryCards(td) {
  const sec = $('summarySection');
  sec.innerHTML = '';
  let totDl = 0, totUl = 0;
  appConfig.interfaces.forEach(iface => {
    let dl = td[iface.id] ? td[iface.id].dl : 0;
    let ul = td[iface.id] ? td[iface.id].ul : 0;
    totDl += dl; totUl += ul;
    sec.innerHTML += `
      <div class="summary-card">
        <div class="summary-isp" style="color:${iface.color}">
          <span class="isp-dot" style="background:${iface.color}"></span>${iface.label}
        </div>
        <div class="summary-row">
          <div class="summary-stat"><div class="summary-label">Hôm nay ↓</div><div class="summary-val" style="color:${iface.color}">${kbToHuman(dl)}</div></div>
          <div class="summary-stat"><div class="summary-label">Hôm nay ↑</div><div class="summary-val" style="color:${iface.color}">${kbToHuman(ul)}</div></div>
        </div>
      </div>
    `;
  });
  sec.innerHTML += `
    <div class="summary-card total-card">
      <div class="summary-isp"><span class="isp-dot total-dot"></span>Tổng cộng</div>
      <div class="summary-row">
        <div class="summary-stat"><div class="summary-label">Hôm nay ↓</div><div class="summary-val total-color">${kbToHuman(totDl)}</div></div>
        <div class="summary-stat"><div class="summary-label">Hôm nay ↑</div><div class="summary-val total-color">${kbToHuman(totUl)}</div></div>
      </div>
    </div>
  `;
}

async function fetchToday() {
  try {
    const [rData, rStatus] = await Promise.all([
      fetch('/api/today').then(res => res.json()),
      fetch('/api/status').then(res => res.json())
    ]);
    buildSummaryCards(rData);
    const t = rData.lastModified ? new Date(rData.lastModified.replace(' ','T') + '+07:00') : new Date();
    $('lastUpdate').textContent = 'Cập nhật lúc ' + t.toLocaleTimeString('vi-VN') + ' · ' + t.toLocaleDateString('vi-VN');
    
    if (rStatus.online) {
      $('statusBadge').classList.remove('offline');
      $('statusText').textContent = 'Online';
      $('statusBadge').title = 'Kết nối tới MikroTik ổn định';
    } else {
      $('statusBadge').classList.add('offline');
      $('statusText').textContent = 'Lỗi kết nối';
      $('statusBadge').title = rStatus.error || 'Mất kết nối tới MikroTik';
    }
    return rData;
  } catch(e) {
    $('statusBadge').classList.add('offline');
    $('statusText').textContent = 'Offline';
    $('statusBadge').title = 'Mất kết nối tới Server Dashboard';
    return {};
  }
}

async function loadHourly(dayStr) {
  const r = await fetch(dayStr ? `/api/hourly?day=${dayStr}` : `/api/hourly`);
  const raw = await r.json();
  rawCache.hourly = raw;
  if (!raw) return;
  const keys = getNonEmptyKeys(raw).sort();
  renderChart('hourlyChart', keys, raw, keys);
  buildTableRows('hourlyTableBody', keys, raw, labelHour, null, '');
}

let currentDays = 7;
async function loadDaily(days) {
  currentDays = days;
  const r = await fetch(`/api/history?range=${days}d`);
  const raw = await r.json();
  try {
    const td = await fetchToday();
    const tk = todayKey();
    raw[tk] = {};
    appConfig.interfaces.forEach(i => raw[tk][i.id] = { dl: td[i.id]?td[i.id].dl:0, ul: td[i.id]?td[i.id].ul:0 });
  } catch(e) {}
  rawCache.daily = raw;
  const keys = Object.keys(raw).sort();
  const labels = keys.map(k => { const [y,m,d] = k.split('-'); return `${d}/${m}`; });
  renderChart('dailyChart', labels, raw, keys);
  buildTableRows('dailyTableBody', keys, raw, labelDay, todayKey(), 'today-label');
}

async function loadMonthly() {
  const r = await fetch('/api/history?range=12m');
  const raw = await r.json();
  try {
    const td = await fetchToday();
    const mk = thisMonthKey();
    if (!raw[mk]) {
      raw[mk] = {};
      appConfig.interfaces.forEach(i => raw[mk][i.id] = { dl: td[i.id]?td[i.id].dl:0, ul: td[i.id]?td[i.id].ul:0 });
    }
  } catch(e) {}
  rawCache.monthly = raw;
  const keys = Object.keys(raw).sort();
  renderChart('monthlyChart', keys.map(labelMonth), raw, keys);
  buildTableRows('monthlyTableBody', keys, raw, labelMonth, thisMonthKey(), 'month-label');
}

async function loadYearly() {
  const r = await fetch('/api/history?range=1y');
  const raw = await r.json();
  rawCache.yearly = raw;
  const keys = Object.keys(raw).sort();
  renderChart('yearlyChart', keys.map(labelYear), raw, keys);
  buildTableRows('yearlyTableBody', keys, raw, labelYear, thisYearKey(), 'year-label');
}

let activeTab = 'hourly';
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    $(`tab${activeTab.charAt(0).toUpperCase()+activeTab.slice(1)}`).classList.add('active');
    $('subDaily').style.display = activeTab === 'daily' ? 'flex' : 'none';
    $('hourlyFilter').style.display = activeTab === 'hourly' ? 'flex' : 'none';
    if (activeTab === 'hourly') await loadHourly($('hourlyDate').value);
    if (activeTab === 'daily') await loadDaily(currentDays);
    if (activeTab === 'monthly') await loadMonthly();
    if (activeTab === 'yearly') await loadYearly();
  });
});

$('hourlyDate').addEventListener('change', async (e) => await loadHourly(e.target.value));
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    await loadDaily(parseInt(btn.dataset.days));
  });
});

async function init() {
  const r = await fetch('/api/config');
  appConfig = await r.json();
  initTableHeaders();
  const localNow = new Date(Date.now() + 7 * 3600 * 1000);
  $('hourlyDate').value = localNow.toISOString().slice(0, 10);
  await fetchToday();
  await loadHourly($('hourlyDate').value);
}

init();
setInterval(async () => {
  await fetchToday();
  if (activeTab === 'hourly') await loadHourly($('hourlyDate').value);
  else if (activeTab === 'daily') await loadDaily(currentDays);
  else if (activeTab === 'monthly') await loadMonthly();
  else if (activeTab === 'yearly') await loadYearly();
}, 60000);

// Setup Modal logic
function openSetupModal() {
  let collectorScript = `:global trafDayRx; :global trafDayTx;\n`;
  collectorScript += `:if ([:typeof $trafDayRx] != "array") do={ :set trafDayRx [:toarray ""] }\n`;
  collectorScript += `:if ([:typeof $trafDayTx] != "array") do={ :set trafDayTx [:toarray ""] }\n\n`;
  collectorScript += `:local wans { `;
  collectorScript += appConfig.interfaces.map(i => `"${i.mk_name}"`).join('; ') + ` }\n`;
  collectorScript += `:local dataStr ""\n\n`;
  collectorScript += `:foreach wan in=$wans do={\n`;
  collectorScript += `    :local rx [/interface get [find name=$wan] rx-byte]\n`;
  collectorScript += `    :local tx [/interface get [find name=$wan] tx-byte]\n`;
  collectorScript += `    :local prevRx ($trafDayRx->$wan)\n`;
  collectorScript += `    :local prevTx ($trafDayTx->$wan)\n\n`;
  collectorScript += `    :if ([:typeof $prevRx] = "nothing") do={\n`;
  collectorScript += `        :set ($trafDayRx->$wan) $rx\n`;
  collectorScript += `        :set ($trafDayTx->$wan) $tx\n`;
  collectorScript += `        :set prevRx $rx; :set prevTx $tx\n    }\n\n`;
  collectorScript += `    :local dRx 0; :local dTx 0\n`;
  collectorScript += `    :if ($rx >= $prevRx) do={ :set dRx (($rx - $prevRx)/1024) } else={ :set dRx ($rx/1024) }\n`;
  collectorScript += `    :if ($tx >= $prevTx) do={ :set dTx (($tx - $prevTx)/1024) } else={ :set dTx ($tx/1024) }\n\n`;
  collectorScript += `    :if ($dataStr = "") do={ :set dataStr "$dRx,$dTx" } else={ :set dataStr "$dataStr,$dRx,$dTx" }\n}\n\n`;
  collectorScript += `/file set [find name="traf-data.txt"] contents=$dataStr\n`;

  let reporterScript = `/file set [find name="traf-data.txt"] contents="`;
  reporterScript += appConfig.interfaces.map(() => "0,0").join(",") + `"\n`;
  reporterScript += `:global trafDayRx [:toarray ""]\n`;
  reporterScript += `:global trafDayTx [:toarray ""]\n`;

  $('scriptCollector').value = collectorScript;
  $('scriptReporter').value = reporterScript;
  $('setupModal').style.display = "block";
}

function closeSetupModal() {
  $('setupModal').style.display = "none";
}

// System Config Modal Logic
function openSysConfigModal() {
  $('cfgIp').value = '';
  $('cfgUser').value = '';
  $('cfgPass').value = '';
  $('interfaceList').innerHTML = '';
  appConfig.interfaces.forEach(iface => addInterfaceRow(iface));
  $('sysConfigModal').style.display = "block";
}

function closeSysConfigModal() {
  $('sysConfigModal').style.display = "none";
}

function addInterfaceRow(iface = null) {
  const list = $('interfaceList');
  const div = document.createElement('div');
  div.className = 'iface-row';
  div.innerHTML = `
    <input type="text" placeholder="wanX" class="if-id" value="${iface ? iface.id : ''}" />
    <input type="text" placeholder="Tên (VD: VNPT)" class="if-label" value="${iface ? iface.label : ''}" />
    <input type="color" class="if-color" value="${iface ? iface.color : '#000000'}" />
    <input type="text" placeholder="WAN_VNPT" class="if-mk" value="${iface ? iface.mk_name : ''}" />
    <button class="btn-del" onclick="this.parentElement.remove()">X</button>
  `;
  list.appendChild(div);
}

async function saveSysConfig() {
  const ip = $('cfgIp').value.trim();
  const user = $('cfgUser').value.trim();
  const pass = $('cfgPass').value.trim();

  const newConfig = {
    mikrotik: { ip, user, pass },
    interfaces: []
  };
  
  document.querySelectorAll('.iface-row').forEach(row => {
    const id = row.querySelector('.if-id').value.trim();
    const label = row.querySelector('.if-label').value.trim();
    const color = row.querySelector('.if-color').value;
    const mk = row.querySelector('.if-mk').value.trim();
    if (id && label && mk) {
      newConfig.interfaces.push({ id, label, color, mk_name: mk });
    }
  });

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
    const data = await res.json();
    if (data.success) {
      window.location.reload();
    } else {
      alert("Lỗi lưu cấu hình: " + data.error);
    }
  } catch (e) {
    alert("Không thể kết nối đến máy chủ.");
  }
}

async function testConnection() {
  const ip = $('cfgIp').value.trim();
  const user = $('cfgUser').value.trim();
  const pass = $('cfgPass').value.trim();
  
  const btn = $('btnTestConn');
  const oldText = btn.textContent;
  btn.textContent = "Đang kiểm tra...";
  btn.disabled = true;

  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, user, pass })
    });
    const data = await res.json();
    if (data.success) {
      alert("✅ " + data.message);
    } else {
      alert("❌ Kết nối thất bại: \n\n" + data.error);
    }
  } catch (e) {
    alert("❌ Không thể kết nối đến máy chủ Dashboard để thử nghiệm.");
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}
