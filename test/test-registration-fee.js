const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// --------------------------------------------------------------------
// Setup: DB-backed mode with local SQLite (no paid Render DB needed).
// MOCK_MODE=false => canonical fee from app_settings.
// MOCK_PAYMENT=true => simulated Cashfree (no real gateway calls).
// --------------------------------------------------------------------
const testDbPath = path.join(__dirname, '../data/test_fee_persist.db');
try {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
} catch (e) {}

process.env.MOCK_MODE = 'false';
process.env.MOCK_PAYMENT = 'true';
process.env.DATABASE_URL = '';
process.env.SQLITE_DB_PATH = testDbPath;
process.env.ADMIN_PASSWORD = 'change-this-password';
process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret_fee_persist_123';
process.env.REGISTRATION_AMOUNT = '999';
delete process.env.REGISTRATION_FEE_BOOTSTRAP;

const settingsPath = path.join(__dirname, '../data/settings.json');
let settingsBackup = null;
try {
  settingsBackup = fs.readFileSync(settingsPath, 'utf8');
} catch (e) {
  settingsBackup = null;
}

function setFileAmount(value) {
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const data = JSON.parse(raw);
  data.settings = data.settings || {};
  data.settings.amount = String(value);
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
}

function restoreSettings() {
  if (settingsBackup !== null) {
    try { fs.writeFileSync(settingsPath, settingsBackup, 'utf8'); } catch (e) {}
  }
}

// Deterministic starting point: file says 1000, env says 999.
// DB-backed bootstrap must prefer env 999 over file 1000 when DB is empty.
try { setFileAmount('1000'); } catch (e) { console.error('setup file fee failed:', e.message); }

const { query } = require('../src/config/db');
const pricing = require('../src/config/pricing');
const feeStore = require('../src/config/registrationFeeStore');
const { getCashfreeOrder } = require('../src/config/cashfree');
const app = require('../src/server');

let server;
const PORT = 3991;
const baseUrl = `http://localhost:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTables() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('registrations', 'app_settings')`
      );
      const names = (r.rows || []).map((x) => x.name);
      if (names.includes('registrations') && names.includes('app_settings')) return;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('Timed out waiting for SQLite tables (registrations/app_settings)');
}

async function getDbFeeRow() {
  const r = await query('SELECT setting_value FROM app_settings WHERE setting_key = $1', ['registration_amount']);
  if (!r.rows || r.rows.length === 0) return null;
  return r.rows[0].setting_value;
}

async function adminLogin() {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'change-this-password' })
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `admin login failed: ${res.status} ${JSON.stringify(data)}`);
  return data.token;
}

async function postRegister(body) {
  const res = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { res, data };
}

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✅ Passed: ${name}`);
  } else {
    failed++;
    console.error(`  ❌ Failed: ${name}${extra ? ' - ' + extra : ''}`);
  }
}

async function runFeePersistenceTests() {
  console.log('\n💰 Running Registration Fee Persistence Tests (SQLite, DB-backed)...\n');

  await new Promise((resolve) => { server = app.listen(PORT, resolve); });
  await waitForTables();
  // Give server.js setImmediate bootstrap a moment, then start from clean slate.
  await sleep(500);

  const token = await adminLogin();

  // ================================================================
  // CASE 1 — bootstrap: empty DB + REGISTRATION_AMOUNT=999 + file=1000
  // ================================================================
  console.log('  CASE 1: bootstrap from env when DB row missing...');
  try { await query('DELETE FROM app_settings WHERE setting_key = $1', ['registration_amount']); } catch (e) {}
  delete process.env.REGISTRATION_FEE_BOOTSTRAP;
  process.env.REGISTRATION_AMOUNT = '999';
  setFileAmount('1000');

  const fee1 = await pricing.getRegistrationFee();
  ok('CASE 1 canonical fee = 999 (env bootstrap wins over file 1000)', fee1 === 999, `got ${fee1}`);

  const row1 = await getDbFeeRow();
  ok('CASE 1 database row becomes/stays 999', String(row1) === '999', `got ${row1}`);

  {
    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pub = await pubRes.json();
    ok('CASE 1 GET /api/public returns 999 despite file 1000', Number(pub.settings.amount) === 999, `got ${pub.settings && pub.settings.amount}`);
  }

  // ================================================================
  // CASE 2 — admin changes fee to 1500
  // ================================================================
  console.log('  CASE 2: admin saves 1500 via POST /api/settings...');
  {
    const updRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 1500 })
    });
    const upd = await updRes.json();
    ok('CASE 2 POST /api/settings 1500 returns 200', updRes.status === 200, `got ${updRes.status} ${JSON.stringify(upd)}`);
    ok('CASE 2 response contains authoritative saved fee 1500', upd && upd.settings && Number(upd.settings.amount) === 1500, `got ${JSON.stringify(upd)}`);

    const row2 = await getDbFeeRow();
    ok('CASE 2 app_settings registration_amount = 1500', String(row2) === '1500', `got ${row2}`);

    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pub = await pubRes.json();
    ok('CASE 2 GET /api/public returns 1500', Number(pub.settings.amount) === 1500, `got ${pub.settings && pub.settings.amount}`);

    const { res, data } = await postRegister({ name: 'Fee Persist Devotee', mobile: '9111111111', donationAmount: 0 });
    ok('CASE 2 new registration returns 201', res.status === 201, `got ${res.status} ${JSON.stringify(data)}`);
    ok('CASE 2 new registration fee = 1500', data && data.registrationFee === 1500 && data.amount === 1500, `got ${JSON.stringify(data)}`);
  }

  // ================================================================
  // CASE 3 — persistence across restart (fresh Node process, same DB)
  // ================================================================
  console.log('  CASE 3: fresh process against SAME SQLite DB keeps 1500...');
  setFileAmount('1000'); // reset file to prove DB wins
  delete process.env.REGISTRATION_FEE_BOOTSTRAP;
  process.env.REGISTRATION_AMOUNT = '999'; // keep env stale at 999
  {
    const dbRowBefore = await getDbFeeRow();
    ok('CASE 3 precondition DB row is 1500 before restart', String(dbRowBefore) === '1500', `got ${dbRowBefore}`);

    // Build a fresh-process checker script (separate file to avoid quoting issues).
    const repoRoot = path.join(__dirname, '..');
    const childPath = path.join(__dirname, '../data/test_fee_child_restart.tmp.js');
    const childCode =
      `process.env.MOCK_MODE='false';\n` +
      `process.env.MOCK_PAYMENT='true';\n` +
      `process.env.DATABASE_URL='';\n` +
      `process.env.SQLITE_DB_PATH=${JSON.stringify(testDbPath)};\n` +
      `process.env.REGISTRATION_AMOUNT='999';\n` +
      `process.env.ADMIN_PASSWORD='change-this-password';\n` +
      `(async () => {\n` +
      `  const pricing = require(${JSON.stringify(path.join(repoRoot, 'src/config/pricing.js'))});\n` +
      `  const store = require(${JSON.stringify(path.join(repoRoot, 'src/config/registrationFeeStore.js'))});\n` +
      `  const fee = await pricing.getRegistrationFee();\n` +
      `  const stored = await store.getStoredRegistrationFee();\n` +
      `  console.log(JSON.stringify({ fee, stored }));\n` +
      `})().catch((e) => { console.error(e && e.message || e); process.exit(1); });\n`;
    fs.writeFileSync(childPath, childCode, 'utf8');
    let childOut = '';
    try {
      childOut = execFileSync(process.execPath, [childPath], { encoding: 'utf8', timeout: 30000 });
    } finally {
      try { fs.unlinkSync(childPath); } catch (e) {}
    }
    const parsed = JSON.parse(childOut.trim().split('\n').pop());
    ok('CASE 3 fresh process canonical fee STILL 1500 (not env 999/file 1000)', Number(parsed.fee) === 1500, `got ${JSON.stringify(parsed)}`);
    ok('CASE 3 fresh process DB row STILL 1500', String(parsed.stored) === '1500', `got ${JSON.stringify(parsed)}`);

    // Parent process must also still see 1500 (no revert).
    const feeAfter = await pricing.getRegistrationFee();
    ok('CASE 3 parent process fee remains 1500 after file reset to 1000', feeAfter === 1500, `got ${feeAfter}`);
    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pub = await pubRes.json();
    ok('CASE 3 GET /api/public still 1500 after file reset', Number(pub.settings.amount) === 1500, `got ${pub.settings && pub.settings.amount}`);
  }

  // ================================================================
  // CASE 4 — donation still works (fee 999 + donation 501 = 1500)
  // ================================================================
  console.log('  CASE 4: donation math with persisted fee 999...');
  {
    const updRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 999 })
    });
    const upd = await updRes.json();
    ok('CASE 4 admin reset fee to 999 returns 200', updRes.status === 200 && Number(upd.settings.amount) === 999, `got ${updRes.status} ${JSON.stringify(upd)}`);

    const calc = await pricing.calculatePaymentAmounts(501);
    ok('CASE 4 calc registrationFee=999', calc.registrationFee === 999, `got ${JSON.stringify(calc)}`);
    ok('CASE 4 calc donationAmount=0 (removed)', calc.donationAmount === 0, `got ${JSON.stringify(calc)}`);
    ok('CASE 4 calc amount=999 (fixed)', calc.totalAmount === 999, `got ${JSON.stringify(calc)}`);

    const { res, data } = await postRegister({ name: 'Donation Persist Devotee', mobile: '9222222222', donationAmount: 501 });
    ok('CASE 4 register 999+501 returns 201', res.status === 201, `got ${res.status} ${JSON.stringify(data)}`);
    ok('CASE 4 register response 999/0/999 (fixed)', data && data.registrationFee === 999 && data.donationAmount === 0 && data.amount === 999, `got ${JSON.stringify(data)}`);
    if (data && data.orderId) {
      const cf = await getCashfreeOrder(data.orderId);
      ok('CASE 4 mock Cashfree order = 999 (fixed)', Number(cf.order_amount) === 999, `got ${JSON.stringify(cf)}`);
    }
  }

  // ================================================================
  // CASE 5 — existing DB row wins over env + file
  // ================================================================
  console.log('  CASE 5: DB=1250 beats env=999 and file=1000...');
  {
    await feeStore.setStoredRegistrationFee(1250);
    delete process.env.REGISTRATION_FEE_BOOTSTRAP;
    process.env.REGISTRATION_AMOUNT = '999';
    setFileAmount('1000');

    const fee5 = await pricing.getRegistrationFee();
    ok('CASE 5 canonical fee = 1250 (DB wins)', fee5 === 1250, `got ${fee5}`);

    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pub = await pubRes.json();
    ok('CASE 5 GET /api/public returns 1250', Number(pub.settings.amount) === 1250, `got ${pub.settings && pub.settings.amount}`);
  }

  // ================================================================
  // CASE 6 — mock mode unchanged (fresh MOCK_MODE=true process)
  // ================================================================
  console.log('  CASE 6: mock mode file-backed fee (fresh process, no DB)...');
  {
    const repoRoot = path.join(__dirname, '..');
    const childPath = path.join(__dirname, '../data/test_fee_child_mock.tmp.js');
    const mockPort = 3993;
    const childCode =
      `process.env.MOCK_MODE='true';\n` +
      `delete process.env.MOCK_PAYMENT;\n` +
      `process.env.ADMIN_PASSWORD='change-this-password';\n` +
      `delete process.env.REGISTRATION_AMOUNT;\n` +
      `(async () => {\n` +
      `  const fs = require('fs');\n` +
      `  const path = require('path');\n` +
      `  const settingsPath = ${JSON.stringify(settingsPath)};\n` +
      `  function setFee(v) {\n` +
      `    const raw = fs.readFileSync(settingsPath, 'utf8');\n` +
      `    const data = JSON.parse(raw);\n` +
      `    data.settings = data.settings || {};\n` +
      `    data.settings.amount = String(v);\n` +
      `    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');\n` +
      `  }\n` +
      `  setFee('1000');\n` +
      `  const pricing = require(${JSON.stringify(path.join(repoRoot, 'src/config/pricing.js'))});\n` +
      `  const app = require(${JSON.stringify(path.join(repoRoot, 'src/server.js'))});\n` +
      `  const fee1000 = await pricing.getRegistrationFee();\n` +
      `  if (fee1000 !== 1000) { console.error('mock initial fee expected 1000 got ' + fee1000); process.exitCode = 1; return; }\n` +
      `  const server = app.listen(${mockPort}, async () => {\n` +
      `    try {\n` +
      `      const loginRes = await fetch('http://localhost:${mockPort}/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'change-this-password' }) });\n` +
      `      const login = await loginRes.json();\n` +
      `      if (loginRes.status !== 200) throw new Error('mock login failed ' + loginRes.status);\n` +
      `      const updRes = await fetch('http://localhost:${mockPort}/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify({ amount: 999 }) });\n` +
      `      const upd = await updRes.json();\n` +
      `      if (updRes.status !== 200 || Number(upd.settings.amount) !== 999) throw new Error('mock settings save failed ' + updRes.status + ' ' + JSON.stringify(upd));\n` +
      `      const pubRes = await fetch('http://localhost:${mockPort}/api/public');\n` +
      `      const pub = await pubRes.json();\n` +
      `      if (Number(pub.settings.amount) !== 999) throw new Error('mock public expected 999 got ' + pub.settings.amount);\n` +
      `      const regRes = await fetch('http://localhost:${mockPort}/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mock Fee Devotee', mobile: '9333333333', donationAmount: 0 }) });\n` +
      `      const reg = await regRes.json();\n` +
      `      if (regRes.status !== 201 || reg.registrationFee !== 999 || reg.amount !== 999) throw new Error('mock register expected 999 got ' + JSON.stringify(reg));\n` +
      `      console.log(JSON.stringify({ ok: true, fee1000, mockFee: 999 }));\n` +
      `      server.close();\n` +
      `    } catch (e) { console.error(e && e.message || e); server.close(); process.exitCode = 1; }\n` +
      `  });\n` +
      `})().catch((e) => { console.error(e && e.message || e); process.exitCode = 1; });\n`;
    fs.writeFileSync(childPath, childCode, 'utf8');
    let childOut = '';
    let childFailed = false;
    try {
      childOut = execFileSync(process.execPath, [childPath], { encoding: 'utf8', timeout: 30000 });
    } catch (e) {
      childFailed = true;
      childOut = (e.stdout || '') + '\n' + (e.message || '');
    } finally {
      try { fs.unlinkSync(childPath); } catch (e) {}
    }
    let parsed = null;
    try {
      const lines = String(childOut).trim().split('\n');
      parsed = JSON.parse(lines[lines.length - 1]);
    } catch (e) {}
    ok('CASE 6 mock mode admin file-backed change 1000->999 works end-to-end', !childFailed && parsed && parsed.ok === true, `got ${childOut}`);
    // Restore DB-backed env/file state for parent after mock child touched settings.json.
    delete process.env.REGISTRATION_FEE_BOOTSTRAP;
    process.env.REGISTRATION_AMOUNT = '999';
    // CASE 6 child left settings.json at 999; reset to 1000 for upcoming cases.
    try { setFileAmount('1000'); } catch (e) {}
  }

  // ================================================================
  // CASE 7 — dedicated bootstrap variable wins on empty DB
  // ================================================================
  console.log('  CASE 7: REGISTRATION_FEE_BOOTSTRAP=999 wins on empty DB...');
  {
    try { await query('DELETE FROM app_settings WHERE setting_key = $1', ['registration_amount']); } catch (e) {}
    process.env.REGISTRATION_FEE_BOOTSTRAP = '999';
    process.env.REGISTRATION_AMOUNT = '1000';
    setFileAmount('1000');

    const fee7 = await pricing.getRegistrationFee();
    ok('CASE 7 canonical fee = 999 (dedicated bootstrap wins)', fee7 === 999, `got ${fee7}`);

    const row7 = await getDbFeeRow();
    ok('CASE 7 database row becomes 999', String(row7) === '999', `got ${row7}`);

    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pub = await pubRes.json();
    ok('CASE 7 GET /api/public returns 999', Number(pub.settings.amount) === 999, `got ${pub.settings && pub.settings.amount}`);
  }

  // ================================================================
  // CASE 8 — dedicated bootstrap cannot overwrite existing DB (fresh process)
  // ================================================================
  console.log('  CASE 8: bootstrap vars ignored once DB row exists...');
  {
    await feeStore.setStoredRegistrationFee(1500);
    process.env.REGISTRATION_FEE_BOOTSTRAP = '999';
    process.env.REGISTRATION_AMOUNT = '1000';
    setFileAmount('1000');

    const repoRoot = path.join(__dirname, '..');
    const childPath = path.join(__dirname, '../data/test_fee_child_bootstrap.tmp.js');
    const childCode =
      `process.env.MOCK_MODE='false';\n` +
      `process.env.MOCK_PAYMENT='true';\n` +
      `process.env.DATABASE_URL='';\n` +
      `process.env.SQLITE_DB_PATH=${JSON.stringify(testDbPath)};\n` +
      `process.env.REGISTRATION_FEE_BOOTSTRAP='999';\n` +
      `process.env.REGISTRATION_AMOUNT='1000';\n` +
      `process.env.ADMIN_PASSWORD='change-this-password';\n` +
      `(async () => {\n` +
      `  const pricing = require(${JSON.stringify(path.join(repoRoot, 'src/config/pricing.js'))});\n` +
      `  const store = require(${JSON.stringify(path.join(repoRoot, 'src/config/registrationFeeStore.js'))});\n` +
      `  const fee = await pricing.getRegistrationFee();\n` +
      `  const stored = await store.getStoredRegistrationFee();\n` +
      `  console.log(JSON.stringify({ fee, stored }));\n` +
      `})().catch((e) => { console.error((e && e.message) || e); process.exitCode = 1; });\n`;
    fs.writeFileSync(childPath, childCode, 'utf8');
    let childOut = '';
    let childFailed = false;
    try {
      childOut = execFileSync(process.execPath, [childPath], { encoding: 'utf8', timeout: 30000 });
    } catch (e) {
      childFailed = true;
      childOut = (e.stdout || '') + '\n' + (e.message || '');
    } finally {
      try { fs.unlinkSync(childPath); } catch (e) {}
    }
    let parsed = null;
    try {
      const lines = String(childOut).trim().split('\n');
      parsed = JSON.parse(lines[lines.length - 1]);
    } catch (e) {}
    ok('CASE 8 fresh process fee remains 1500 (bootstrap ignored)', !childFailed && parsed && Number(parsed.fee) === 1500, `got ${childOut}`);
    ok('CASE 8 fresh process DB remains 1500', !childFailed && parsed && String(parsed.stored) === '1500', `got ${childOut}`);

    const feeAfter = await pricing.getRegistrationFee();
    ok('CASE 8 parent fee remains 1500', feeAfter === 1500, `got ${feeAfter}`);
  }

  // ================================================================
  // CASE 9 — DB failure fails closed (no bootstrap/env/file fallback)
  // ================================================================
  console.log('  CASE 9: DB outage must throw, never fallback...');
  {
    const db = require('../src/config/db');
    const origQuery = db.query;
    process.env.REGISTRATION_FEE_BOOTSTRAP = '999';
    process.env.REGISTRATION_AMOUNT = '1000';
    setFileAmount('1000');

    db.query = async () => { throw new Error('simulated DB outage CASE9'); };
    let threw = false;
    let errStatus = null;
    let returnedValue = null;
    try {
      returnedValue = await pricing.getRegistrationFee();
    } catch (e) {
      threw = true;
      errStatus = e && e.status;
    } finally {
      db.query = origQuery;
    }
    ok('CASE 9 getRegistrationFee throws on DB failure', threw === true, `returned ${returnedValue}`);
    ok('CASE 9 error carries 503 status', errStatus === 503, `got status ${errStatus}`);
    ok('CASE 9 does NOT return bootstrap/env/file fallback', returnedValue === null || returnedValue === undefined, `got ${returnedValue}`);

    // Invalid stored row must also fail closed (not ignored/replaced).
    await query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
      ['registration_amount', 'not-a-number']
    );
    let invalidThrew = false;
    try {
      await pricing.getRegistrationFee();
    } catch (e) {
      invalidThrew = true;
    }
    ok('CASE 9 invalid stored row fails closed (throws)', invalidThrew === true);
    // Restore a valid row for subsequent cases.
    await feeStore.setStoredRegistrationFee(1500);
    delete process.env.REGISTRATION_FEE_BOOTSTRAP;
    process.env.REGISTRATION_AMOUNT = '999';
  }

  // ================================================================
  // CASE 10 — registration cannot create payment when pricing DB fails
  // ================================================================
  console.log('  CASE 10: POST /api/register fails closed on pricing DB outage...');
  {
    const db = require('../src/config/db');
    const origQuery = db.query;
    process.env.REGISTRATION_FEE_BOOTSTRAP = '999';
    process.env.REGISTRATION_AMOUNT = '1000';
    setFileAmount('1000');
    db.query = async () => { throw new Error('simulated pricing DB outage CASE10'); };
    let res;
    let data;
    try {
      ({ res, data } = await postRegister({ name: 'Outage Devotee', mobile: '9444444444', donationAmount: 0 }));
    } finally {
      db.query = origQuery;
    }
    ok('CASE 10 register does NOT succeed (no 201) during DB outage', res && res.status !== 201, `got ${res && res.status} ${JSON.stringify(data)}`);
    ok('CASE 10 register returns 503/5xx service-unavailable', res && res.status >= 500 && res.status < 600, `got ${res && res.status}`);
    ok('CASE 10 register does NOT return a payment order', !data || !data.orderId, `got ${JSON.stringify(data)}`);
    delete process.env.REGISTRATION_FEE_BOOTSTRAP;
    process.env.REGISTRATION_AMOUNT = '999';
  }

  // ================================================================
  // CASE 11 — public endpoint does not expose stale fallback on DB failure
  // ================================================================
  console.log('  CASE 11: GET /api/public returns 503 (not stale file fee) on DB outage...');
  {
    const db = require('../src/config/db');
    const origQuery = db.query;
    process.env.REGISTRATION_FEE_BOOTSTRAP = '999';
    process.env.REGISTRATION_AMOUNT = '1000';
    setFileAmount('1000');
    db.query = async () => { throw new Error('simulated public DB outage CASE11'); };
    let pubRes;
    let pubBody = null;
    try {
      pubRes = await fetch(`${baseUrl}/api/public`);
      try { pubBody = await pubRes.json(); } catch (e) { pubBody = null; }
    } finally {
      db.query = origQuery;
    }
    ok('CASE 11 public does NOT return 200 with stale fee during DB outage', pubRes && pubRes.status !== 200, `got ${pubRes && pubRes.status} ${JSON.stringify(pubBody)}`);
    ok('CASE 11 public returns 503 service-unavailable', pubRes && pubRes.status === 503, `got ${pubRes && pubRes.status}`);
    delete process.env.REGISTRATION_FEE_BOOTSTRAP;
    process.env.REGISTRATION_AMOUNT = '999';
  }

  console.log(`\nFee Persistence Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
  console.log('\n🎉 ALL FEE PERSISTENCE TESTS PASSED!\n');
}

async function cleanup(code) {
  try { if (server) server.close(); } catch (e) {}
  try { restoreSettings(); } catch (e) {}
  try { delete process.env.REGISTRATION_FEE_BOOTSTRAP; } catch (e) {}
  // Remove temp child scripts if left behind.
  try { if (fs.existsSync(path.join(__dirname, '../data/test_fee_child_restart.tmp.js'))) fs.unlinkSync(path.join(__dirname, '../data/test_fee_child_restart.tmp.js')); } catch (e) {}
  try { if (fs.existsSync(path.join(__dirname, '../data/test_fee_child_mock.tmp.js'))) fs.unlinkSync(path.join(__dirname, '../data/test_fee_child_mock.tmp.js')); } catch (e) {}
  try { if (fs.existsSync(path.join(__dirname, '../data/test_fee_child_bootstrap.tmp.js'))) fs.unlinkSync(path.join(__dirname, '../data/test_fee_child_bootstrap.tmp.js')); } catch (e) {}
  // Keep the SQLite test DB for inspection on failure; delete on success.
  if (code === 0) {
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (e) {}
  }
}

runFeePersistenceTests()
  .then(async () => { await cleanup(0); })
  .catch(async (err) => {
    console.error('❌ Fee persistence test failed:', err);
    failed++;
    console.log(`\nFee Persistence Results: ${passed} passed, ${failed} failed.`);
    try { if (server) server.close(); } catch (e) {}
    try { restoreSettings(); } catch (e) {}
    process.exit(1);
  });
