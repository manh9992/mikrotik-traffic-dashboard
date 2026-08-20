const express = require('express');
const fs = require('fs');
const path = require('path');
const snmp = require('net-snmp');

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
const SNMP_COMMUNITY = config.mikrotik.snmp_community || 'public';

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

// --- SNMP Interface Index Cache ---
let ifIndexCache = {}; // { "WAN_FPT": 3, "WAN_VIETTEL": 4, ... }
let ifIndexReady = false;

// SNMP OIDs
const OID_IF_DESCR = '1.3.6.1.2.1.2.2.1.2';        // ifDescr (interface name)
const OID_IF_HC_IN = '1.3.6.1.2.1.31.1.1.1.6';      // ifHCInOctets (64-bit rx)
const OID_IF_HC_OUT = '1.3.6.1.2.1.31.1.1.1.10';     // ifHCOutOctets (64-bit tx)

// Previous counters for delta calculation
let prevCounters = {}; // { "wan1": { rx: BigInt, tx: BigInt }, ... }
let dailyAccum = {};   // { "wan1": { dl: 0, ul: 0 }, ... } in KB

// Load daily accum from today's history entry if exists
function loadDailyAccum() {
  const localNow = new Date(Date.now() + 7 * 3600 * 1000);
  const dateStr = localNow.toISOString().slice(0, 10);
  if (history[dateStr]) {
    config.interfaces.forEach(iface => {
      if (history[dateStr][iface.id]) {
        dailyAccum[iface.id] = { ...history[dateStr][iface.id] };
      }
    });
    console.log(`[SNMP] Restored daily accum from history for ${dateStr}`);
  }
}

function createSession() {
  return snmp.createSession(MT_HOST, SNMP_COMMUNITY, {
    version: snmp.Version2c,
    timeout: 5000,
    retries: 1
  });
}

// Discover interface indexes via SNMP walk
async function discoverInterfaces() {
  return new Promise((resolve, reject) => {
    const session = createSession();
    const mapping = {};
    const neededNames = config.interfaces.map(i => i.mk_name);

    session.subtree(OID_IF_DESCR, (varbinds) => {
      varbinds.forEach(vb => {
        const name = vb.value.toString();
        if (neededNames.includes(name)) {
          const idx = vb.oid.split('.').pop();
          mapping[name] = parseInt(idx);
        }
      });
    }, (error) => {
      session.close();
      if (error) {
        reject(error);
      } else {
        ifIndexCache = mapping;
        const found = Object.keys(mapping).length;
        console.log(`[SNMP] Discovered ${found}/${neededNames.length} interfaces:`, mapping);
        if (found === neededNames.length) {
          ifIndexReady = true;
          resolve(mapping);
        } else {
          const missing = neededNames.filter(n => !mapping[n]);
          reject(new Error(`Missing interfaces: ${missing.join(', ')}`));
        }
      }
    });
  });
}

// Poll traffic counters via SNMP
async function pollSNMP() {
  if (!ifIndexReady) {
    try {
      await discoverInterfaces();
    } catch (e) {
      bgStatus = { online: false, error: `SNMP discovery failed: ${e.message}` };
      console.error('[SNMP] Discovery error:', e.message);
      return;
    }
  }

  const oids = [];
  const oidMap = {}; // oid string -> { ifaceId, direction }

  config.interfaces.forEach(iface => {
    const idx = ifIndexCache[iface.mk_name];
    if (idx === undefined) return;

    const rxOid = `${OID_IF_HC_IN}.${idx}`;
    const txOid = `${OID_IF_HC_OUT}.${idx}`;
    oids.push(rxOid, txOid);
    oidMap[rxOid] = { ifaceId: iface.id, direction: 'rx' };
    oidMap[txOid] = { ifaceId: iface.id, direction: 'tx' };
  });

  return new Promise((resolve) => {
    const session = createSession();

    session.get(oids, (error, varbinds) => {
      session.close();

      if (error) {
        bgStatus = { online: false, error: error.message };
        console.error('[SNMP] Poll error:', error.message);
        resolve();
        return;
      }

      bgStatus = { online: true, error: null };
      const currentCounters = {};

      varbinds.forEach(vb => {
        if (snmp.isVarbindError(vb)) {
          console.error('[SNMP] Varbind error:', snmp.varbindError(vb));
          return;
        }
        const info = oidMap[vb.oid];
        if (!info) return;

        if (!currentCounters[info.ifaceId]) {
          currentCounters[info.ifaceId] = { rx: BigInt(0), tx: BigInt(0) };
        }

        // net-snmp returns Counter64 as Buffer, convert to BigInt
        let val;
        if (Buffer.isBuffer(vb.value)) {
          val = BigInt('0x' + vb.value.toString('hex'));
        } else {
          val = BigInt(vb.value.toString());
        }

        currentCounters[info.ifaceId][info.direction] = val;
      });

      // Calculate deltas
      const localNow = new Date(Date.now() + 7 * 3600 * 1000);
      const dateStr = localNow.toISOString().slice(0, 10);
      const hourStr = localNow.toISOString().slice(11, 13);
      const isNewDay = (localNow.getHours() === 0 && localNow.getMinutes() <= 1);

      // Reset daily accumulator at midnight
      if (isNewDay) {
        const hasData = Object.keys(dailyAccum).length > 0;
        if (hasData) {
          let totalKb = 0;
          config.interfaces.forEach(i => { totalKb += (dailyAccum[i.id]?.dl || 0) + (dailyAccum[i.id]?.ul || 0); });
          if (totalKb > 0) {
            console.log(`[SNMP] Midnight reset - new day ${dateStr}`);
            dailyAccum = {};
            config.interfaces.forEach(iface => {
              dailyAccum[iface.id] = { dl: 0, ul: 0 };
            });
          }
        }
      }

      config.interfaces.forEach(iface => {
        const cur = currentCounters[iface.id];
        const prev = prevCounters[iface.id];

        if (!cur) return;

        // Initialize accum if needed
        if (!dailyAccum[iface.id]) {
          dailyAccum[iface.id] = { dl: 0, ul: 0 };
        }

        if (prev) {
          let deltaRx = cur.rx - prev.rx;
          let deltaTx = cur.tx - prev.tx;

          // Handle counter wrap/reset (router reboot)
          if (deltaRx < 0n) deltaRx = cur.rx;
          if (deltaTx < 0n) deltaTx = cur.tx;

          // Convert bytes to KB
          const dRxKb = Number(deltaRx / 1024n);
          const dTxKb = Number(deltaTx / 1024n);

          if (dRxKb > 0 || dTxKb > 0) {
            dailyAccum[iface.id].dl += dRxKb;
            dailyAccum[iface.id].ul += dTxKb;
          }
        }
      });

      // Update prevCounters
      Object.keys(currentCounters).forEach(id => {
        prevCounters[id] = { ...currentCounters[id] };
      });

      // Update todayData (same format as before for API compatibility)
      todayData = { lastModified: localNow.toISOString().replace('T', ' ').slice(0, 19) };
      config.interfaces.forEach(iface => {
        todayData[iface.id] = {
          dl: dailyAccum[iface.id]?.dl || 0,
          ul: dailyAccum[iface.id]?.ul || 0
        };
      });

      // Daily Snapshot
      const prev_hist = history[dateStr];
      const newSnap = {};
      let dailyChanged = !prev_hist;

      config.interfaces.forEach(iface => {
        newSnap[iface.id] = { ...(dailyAccum[iface.id] || { dl: 0, ul: 0 }) };
        if (prev_hist && (!prev_hist[iface.id] || prev_hist[iface.id].dl !== newSnap[iface.id].dl || prev_hist[iface.id].ul !== newSnap[iface.id].ul)) {
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
        newHrSnap[iface.id] = { ...(dailyAccum[iface.id] || { dl: 0, ul: 0 }) };
        if (prevHr && (!prevHr[iface.id] || prevHr[iface.id].dl !== newHrSnap[iface.id].dl || prevHr[iface.id].ul !== newHrSnap[iface.id].ul)) {
          hrChanged = true;
        }
      });

      if (hrChanged) {
        hourly[hourKey] = newHrSnap;
        saveHourly();
      }

      resolve();
    });
  });
}

// --- REST API fallback for test-connection (keep HTTP for this) ---
const http = require('http');
function mtFetch(urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: MT_HOST, port: 80, path: `/rest${urlPath}`,
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

// Initialize and start polling
loadDailyAccum();
pollSNMP();
setInterval(pollSNMP, 30000);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    mikrotik: { ip: "" },
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

    // Reset SNMP discovery when config changes
    ifIndexReady = false;
    ifIndexCache = {};
    prevCounters = {};

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
          // Also test SNMP connectivity
          const testSession = snmp.createSession(testHost, SNMP_COMMUNITY, {
            version: snmp.Version2c,
            timeout: 3000,
            retries: 0
          });
          testSession.get(['1.3.6.1.2.1.1.5.0'], (err, vbs) => { // sysName
            testSession.close();
            if (err) {
              res.json({ success: true, message: `REST API OK! Nhưng SNMP lỗi: ${err.message}. Kiểm tra SNMP trên router.` });
            } else {
              const sysName = vbs[0]?.value?.toString() || 'unknown';
              res.json({ success: true, message: `Kết nối thành công! REST API ✅ SNMP ✅ (${sysName})` });
            }
          });
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
      const prevDate = new Date(new Date(targetDay).getTime() - 86400000).toISOString().slice(0, 10);
      for (let prevH = 23; prevH >= 0; prevH--) {
        const prevKey = `${prevDate}T${prevH.toString().padStart(2, '0')}`;
        if (hourly[prevKey]) {
          let isValid = true;
          config.interfaces.forEach(i => {
            const cDl = curSnap[i.id] ? curSnap[i.id].dl : 0;
            const pDl = hourly[prevKey][i.id] ? hourly[prevKey][i.id].dl : 0;
            if (cDl < pDl) isValid = false;
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

app.listen(PORT, '0.0.0.0', () => console.log(`Traffic Dashboard (SNMP) running on http://192.168.69.5:${PORT}`));
