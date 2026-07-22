const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3001;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const HOURLY_FILE = path.join(__dirname, 'hourly.json');

let config = { mikrotik: {}, interfaces: [] };
if (fs.existsSync(CONFIG_FILE)) {
  try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { console.error("Bad config.json"); }
}

let MT_HOST = config.mikrotik.ip || '192.168.69.1';
let MT_USER = config.mikrotik.user || 'api-user';
let MT_PASS = config.mikrotik.pass || 'password';
let MT_AUTH = 'Basic ' + Buffer.from(`${MT_USER}:${MT_PASS}`).toString('base64');

let todayData = {};
let bgStatus = { online: true, error: null };

let history = {};
if (fs.existsSync(HISTORY_FILE)) {
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e) { history = {}; }
}
function saveHistory() { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2)); }

let hourly = {};
if (fs.existsSync(HOURLY_FILE)) {
  try { hourly = JSON.parse(fs.readFileSync(HOURLY_FILE, 'utf8')); } catch(e) { hourly = {}; }
}
function saveHourly() { fs.writeFileSync(HOURLY_FILE, JSON.stringify(hourly, null, 2)); }

function mtFetch(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: MT_HOST, port: 80, path: `/rest${path}`,
      method: 'GET',
      headers: { 'Authorization': MT_AUTH, 'Content-Type': 'application/json' },
      timeout: 5000
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function poll() {
  try {
    const trafficFile = await mtFetch('/file/traf-data.txt');
    bgStatus = { online: true, error: null };
    const contents = (trafficFile.contents || '').trim();
    if (!contents) return;
    const parts = contents.split(',').map(Number);

    todayData = { lastModified: trafficFile['last-modified'] || null };
    config.interfaces.forEach((iface, i) => {
      todayData[iface.id] = {
        dl: parts[i * 2] || 0,
        ul: parts[i * 2 + 1] || 0
      };
    });

    const localNow = new Date(Date.now() + 7 * 3600 * 1000);
    const dateStr = localNow.toISOString().slice(0, 10);
    const hourStr = localNow.toISOString().slice(11, 13);
    const isResetWindow = (localNow.getHours() === 0 && localNow.getMinutes() <= 5);

    // Daily Snapshot
    const prev = history[dateStr];
    const newSnap = {};
    let dailyChanged = !prev;

    config.interfaces.forEach(iface => {
      newSnap[iface.id] = { ...todayData[iface.id] };
      if (!isResetWindow && prev && prev[iface.id]) {
        newSnap[iface.id].dl = Math.max(prev[iface.id].dl || 0, todayData[iface.id].dl);
        newSnap[iface.id].ul = Math.max(prev[iface.id].ul || 0, todayData[iface.id].ul);
      }
      if (prev && (!prev[iface.id] || prev[iface.id].dl !== newSnap[iface.id].dl || prev[iface.id].ul !== newSnap[iface.id].ul)) {
        dailyChanged = true;
      }
    });

    if (dailyChanged) {
      history[dateStr] = newSnap;
      saveHistory();
    }

    // Hourly Snapshot
    const hourKey = `${dateStr}T${hourStr}`;
    const prevHr = hourly[hourKey];
    const newHrSnap = {};
    let hrChanged = !prevHr;

    config.interfaces.forEach(iface => {
      newHrSnap[iface.id] = { ...todayData[iface.id] };
      if (!isResetWindow && prevHr && prevHr[iface.id]) {
        newHrSnap[iface.id].dl = Math.max(prevHr[iface.id].dl || 0, todayData[iface.id].dl);
        newHrSnap[iface.id].ul = Math.max(prevHr[iface.id].ul || 0, todayData[iface.id].ul);
      }
      if (prevHr && (!prevHr[iface.id] || prevHr[iface.id].dl !== newHrSnap[iface.id].dl || prevHr[iface.id].ul !== newHrSnap[iface.id].ul)) {
        hrChanged = true;
      }
    });

    if (hrChanged) {
      hourly[hourKey] = newHrSnap;
      saveHourly();
    }

  } catch(e) {
    bgStatus = { online: false, error: e.message };
    console.error('[Poll error]', e.message);
  }
}

poll();
setInterval(poll, 30000);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    mikrotik: { ip: "" }, // Always return empty IP to keep UI blank as requested
    interfaces: config.interfaces
  });
});
app.post('/api/config', express.json(), (req, res) => {
  try {
    const newConfig = req.body;
    if (newConfig.mikrotik) {
      if (newConfig.mikrotik.ip) {
        config.mikrotik.ip = newConfig.mikrotik.ip;
        MT_HOST = config.mikrotik.ip;
      }
      if (newConfig.mikrotik.user) {
        config.mikrotik.user = newConfig.mikrotik.user;
        MT_USER = config.mikrotik.user;
      }
      if (newConfig.mikrotik.pass) {
        config.mikrotik.pass = newConfig.mikrotik.pass;
        MT_PASS = config.mikrotik.pass;
      }
      MT_AUTH = 'Basic ' + Buffer.from(`${MT_USER}:${MT_PASS}`).toString('base64');
    }
    config.interfaces = newConfig.interfaces;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/today', (req, res) => res.json(todayData));
app.get('/api/status', (req, res) => res.json(bgStatus));

app.post('/api/test-connection', express.json(), async (req, res) => {
  const testHost = req.body.ip || MT_HOST;
  const testUser = req.body.user || MT_USER;
  const testPass = req.body.pass || MT_PASS;
  const testAuth = 'Basic ' + Buffer.from(`${testUser}:${testPass}`).toString('base64');
  
  try {
    const opts = {
      hostname: testHost, port: 80, path: `/rest/system/identity`,
      method: 'GET',
      headers: { 'Authorization': testAuth, 'Content-Type': 'application/json' },
      timeout: 3000
    };
    
    const reqTest = http.request(opts, response => {
      let data = '';
      response.on('data', c => data += c);
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          res.json({ success: true, message: 'Kết nối MikroTik thành công!' });
        } else {
          try {
            const errBody = JSON.parse(data);
            res.json({ success: false, error: `HTTP ${response.statusCode}: ${errBody.detail || errBody.error || 'Lỗi không xác định'}` });
          } catch(e) {
            res.json({ success: false, error: `HTTP ${response.statusCode}: Sai tài khoản/mật khẩu hoặc API không hợp lệ.` });
          }
        }
      });
    });
    reqTest.on('error', err => res.json({ success: false, error: err.message === 'timeout' ? 'Timeout: Không thể tìm thấy IP này' : err.message }));
    reqTest.on('timeout', () => { reqTest.destroy(); res.json({ success: false, error: 'Timeout: Không thể kết nối tới IP MikroTik.' }); });
    reqTest.end();
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/history', (req, res) => {
  const range = req.query.range || '7d';
  const now = new Date();
  const allKeys = Object.keys(history).sort();

  let filtered = {};

  const daysMatch = range.match(/^(\d+)d$/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days);
    for (const k of allKeys) { if (new Date(k) >= cutoff) filtered[k] = history[k]; }
    return res.json(filtered);
  }

  const initIfaceObj = () => {
    const obj = {};
    config.interfaces.forEach(i => obj[i.id] = { dl: 0, ul: 0 });
    return obj;
  };

  if (range === '12m') {
    const byMonth = {};
    for (const k of allKeys) {
      const m = k.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = initIfaceObj();
      const d = history[k];
      config.interfaces.forEach(i => {
        if (d[i.id]) {
          byMonth[m][i.id].dl += d[i.id].dl;
          byMonth[m][i.id].ul += d[i.id].ul;
        }
      });
    }
    filtered = byMonth;
  } else if (range === '1y') {
    const byYear = {};
    for (const k of allKeys) {
      const y = k.slice(0, 4);
      if (!byYear[y]) byYear[y] = initIfaceObj();
      const d = history[k];
      config.interfaces.forEach(i => {
        if (d[i.id]) {
          byYear[y][i.id].dl += d[i.id].dl;
          byYear[y][i.id].ul += d[i.id].ul;
        }
      });
    }
    filtered = byYear;
  }

  res.json(filtered);
});

app.get('/api/hourly', (req, res) => {
  const localNow = new Date(Date.now() + 7 * 3600 * 1000);
  const defaultDay = localNow.toISOString().slice(0, 10);
  const targetDay = req.query.day || defaultDay;
  
  const result = {};
  
  for (let h = 0; h < 24; h++) {
    const hh = h.toString().padStart(2, '0');
    const curKey = `${targetDay}T${hh}`;
    
    let baseline = null;
    for (let prevH = h - 1; prevH >= 0; prevH--) {
      const prevKey = `${targetDay}T${prevH.toString().padStart(2, '0')}`;
      if (hourly[prevKey]) {
        baseline = hourly[prevKey];
        break;
      }
    }
    
    let curSnap = hourly[curKey];
    if (!curSnap && targetDay === defaultDay && hh > localNow.toISOString().slice(11, 13)) continue; 

    if (!baseline && curSnap) {
      // Find the last snapshot of the previous day to use as baseline
      // This prevents a huge traffic spike if the midnight reset was missed due to downtime
      const prevDate = new Date(new Date(targetDay).getTime() - 86400000).toISOString().slice(0, 10);
      for (let prevH = 23; prevH >= 0; prevH--) {
        const prevKey = `${prevDate}T${prevH.toString().padStart(2, '0')}`;
        if (hourly[prevKey]) {
          let isValid = true;
          config.interfaces.forEach(i => {
            const cDl = curSnap[i.id] ? curSnap[i.id].dl : 0;
            const pDl = hourly[prevKey][i.id] ? hourly[prevKey][i.id].dl : 0;
            if (cDl < pDl) isValid = false; // A reset happened, so this baseline is invalid
          });
          if (isValid) baseline = hourly[prevKey];
          break;
        }
      }
    }

    if (!baseline) {
      baseline = {};
      config.interfaces.forEach(i => baseline[i.id] = {dl: 0, ul: 0});
    }

    if (!curSnap) curSnap = baseline;

    result[`${hh}:00`] = {};
    config.interfaces.forEach(i => {
      const bDl = baseline[i.id] ? baseline[i.id].dl : 0;
      const bUl = baseline[i.id] ? baseline[i.id].ul : 0;
      const cDl = curSnap[i.id] ? curSnap[i.id].dl : 0;
      const cUl = curSnap[i.id] ? curSnap[i.id].ul : 0;
      result[`${hh}:00`][i.id] = {
        dl: Math.max(0, cDl - bDl),
        ul: Math.max(0, cUl - bUl)
      };
    });
  }
  
  res.json(result);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Traffic Dashboard running on http://192.168.69.5:${PORT}`));
