const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3001;
const HISTORY_FILE = path.join(__dirname, 'history.json');

// MikroTik config
const MT_HOST = '192.168.69.1';
const MT_USER = 'YOUR_USERNAME';
const MT_PASS = 'YOUR_PASSWORD';
const MT_AUTH = 'Basic ' + Buffer.from(`${MT_USER}:${MT_PASS}`).toString('base64');

// State
let todayData = { fptDl: 0, fptUl: 0, vttDl: 0, vttUl: 0, monFptDl: 0, monFptUl: 0, monVttDl: 0, monVttUl: 0 };

// Load history
let history = {};
if (fs.existsSync(HISTORY_FILE)) {
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e) { history = {}; }
}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

const HOURLY_FILE = path.join(__dirname, 'hourly.json');
let hourly = {};
if (fs.existsSync(HOURLY_FILE)) {
  try { hourly = JSON.parse(fs.readFileSync(HOURLY_FILE, 'utf8')); } catch(e) { hourly = {}; }
}
function saveHourly() {
  fs.writeFileSync(HOURLY_FILE, JSON.stringify(hourly, null, 2));
}

// Fetch from MikroTik
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

// Poll MikroTik every 30s
async function poll() {
  try {
    const trafficFile = await mtFetch('/file/traf-data.txt');

    // Parse traf-data.txt (unit: KB)
    // format: dayRxF,dayTxF,dayRxV,dayTxV,monRxF,monTxF,monRxV,monTxV
    const contents = (trafficFile.contents || '0,0,0,0,0,0,0,0').trim();
    const parts = contents.split(',').map(Number);
    if (parts.length !== 8) return;

    todayData = {
      fptDl: parts[0], fptUl: parts[1],
      vttDl: parts[2], vttUl: parts[3],
      monFptDl: parts[4], monFptUl: parts[5],
      monVttDl: parts[6], monVttUl: parts[7],
      lastModified: trafficFile['last-modified'] || null
    };

    // --- Snapshot daily history ---
    // Key = router's local date (UTC+7)
    const localNow = new Date(Date.now() + 7 * 3600 * 1000);
    const dateStr = localNow.toISOString().slice(0, 10); // YYYY-MM-DD
    const hourStr = localNow.toISOString().slice(11, 13); // HH
    const isResetWindow = (localNow.getHours() === 0 && localNow.getMinutes() <= 5);

    const prev = history[dateStr];
    const newSnap = { ...todayData };
    if (!isResetWindow && prev) {
      newSnap.fptDl = Math.max((prev||{}).fptDl||0, todayData.fptDl);
      newSnap.fptUl = Math.max((prev||{}).fptUl||0, todayData.fptUl);
      newSnap.vttDl = Math.max((prev||{}).vttDl||0, todayData.vttDl);
      newSnap.vttUl = Math.max((prev||{}).vttUl||0, todayData.vttUl);
    }

    // Only write to disk when value actually changed
    if (!prev ||
        prev.fptDl !== newSnap.fptDl || prev.fptUl !== newSnap.fptUl ||
        prev.vttDl !== newSnap.vttDl || prev.vttUl !== newSnap.vttUl) {
      history[dateStr] = newSnap;
      saveHistory();
    }

    // --- Snapshot hourly history ---
    const hourKey = `${dateStr}T${hourStr}`;
    const prevHr = hourly[hourKey];
    const newHrSnap = { ...todayData };
    if (!isResetWindow && prevHr) {
      newHrSnap.fptDl = Math.max((prevHr||{}).fptDl||0, todayData.fptDl);
      newHrSnap.fptUl = Math.max((prevHr||{}).fptUl||0, todayData.fptUl);
      newHrSnap.vttDl = Math.max((prevHr||{}).vttDl||0, todayData.vttDl);
      newHrSnap.vttUl = Math.max((prevHr||{}).vttUl||0, todayData.vttUl);
    }
    if (!prevHr || prevHr.fptDl !== newHrSnap.fptDl || prevHr.fptUl !== newHrSnap.fptUl ||
        prevHr.vttDl !== newHrSnap.vttDl || prevHr.vttUl !== newHrSnap.vttUl) {
      hourly[hourKey] = newHrSnap;
      saveHourly();
    }

  } catch(e) {
    console.error('[Poll error]', e.message);
  }
}

// Start polling
poll();
setInterval(poll, 30000);

// API routes
app.use(express.static(path.join(__dirname, 'public')));

// realtime endpoint kept for compatibility (returns zeros since speed tracking removed)
app.get('/api/realtime', (req, res) => res.json({ updatedAt: new Date().toISOString() }));

app.get('/api/today', (req, res) => res.json(todayData));

app.get('/api/history', (req, res) => {
  const range = req.query.range || '7d';
  const now = new Date();
  const allKeys = Object.keys(history).sort();

  let filtered = {};

  // Support Nd format (e.g. 7d, 14d, 30d)
  const daysMatch = range.match(/^(\d+)d$/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - days);
    for (const k of allKeys) { if (new Date(k) >= cutoff) filtered[k] = history[k]; }
    return res.json(filtered);
  }

  if (range === '12m') {
    // Aggregate by month = SUM of all daily records in that month
    const byMonth = {};
    for (const k of allKeys) {
      const m = k.slice(0, 7); // YYYY-MM
      if (!byMonth[m]) byMonth[m] = { fptDl:0, fptUl:0, vttDl:0, vttUl:0 };
      const d = history[k];
      byMonth[m].fptDl += d.fptDl;
      byMonth[m].fptUl += d.fptUl;
      byMonth[m].vttDl += d.vttDl;
      byMonth[m].vttUl += d.vttUl;
    }
    // Current month: use monFptDl from MikroTik (authoritative cumulative for this month)
    const localNow2 = new Date(Date.now() + 7 * 3600 * 1000);
    const curMonth = localNow2.toISOString().slice(0, 7);
    byMonth[curMonth] = {
      fptDl: todayData.monFptDl, fptUl: todayData.monFptUl,
      vttDl: todayData.monVttDl, vttUl: todayData.monVttUl
    };
    filtered = byMonth;
  } else if (range === '1y') {
    // Aggregate by year
    const byYear = {};
    for (const k of allKeys) {
      const y = k.slice(0, 4);
      if (!byYear[y]) byYear[y] = { fptDl:0, fptUl:0, vttDl:0, vttUl:0 };
      byYear[y].fptDl += history[k].fptDl;
      byYear[y].fptUl += history[k].fptUl;
      byYear[y].vttDl += history[k].vttDl;
      byYear[y].vttUl += history[k].vttUl;
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
    
    let baseline = { fptDl: 0, fptUl: 0, vttDl: 0, vttUl: 0 };
    for (let prevH = h - 1; prevH >= 0; prevH--) {
      const prevKey = `${targetDay}T${prevH.toString().padStart(2, '0')}`;
      if (hourly[prevKey]) {
        baseline = hourly[prevKey];
        break;
      }
    }
    
    let curSnap = hourly[curKey];
    
    if (!curSnap && targetDay === defaultDay && hh > localNow.toISOString().slice(11, 13)) {
      continue; 
    }
    
    if (!curSnap) curSnap = baseline;

    result[`${hh}:00`] = {
      fptDl: Math.max(0, curSnap.fptDl - baseline.fptDl),
      fptUl: Math.max(0, curSnap.fptUl - baseline.fptUl),
      vttDl: Math.max(0, curSnap.vttDl - baseline.vttDl),
      vttUl: Math.max(0, curSnap.vttUl - baseline.vttUl)
    };
  }
  
  res.json(result);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Traffic Dashboard running on http://192.168.69.5:${PORT}`));
