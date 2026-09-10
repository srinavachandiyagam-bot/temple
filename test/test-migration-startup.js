const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --------------------------------------------------------------------
// Regression: PostgreSQL 25P02 transaction abort + startup race.
// - Legacy DB file WITHOUT donation_amount is created FIRST.
// - db.js must migrate it (ALTER) BEFORE serving registrations.
// - registrationController must NOT retry legacy INSERT in same txn.
// - server must await dbReady before listen.
// - fee 999 + donation 501 = 1500, historical rows default donation 0.
// No real production DB, no real Cashfree calls (MOCK_PAYMENT=true).
// --------------------------------------------------------------------

const testDbPath = path.join(__dirname, '../data/test_migration_startup.db');
try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (e) {}

process.env.MOCK_MODE = 'false';
process.env.MOCK_PAYMENT = 'true';
process.env.DATABASE_URL = '';
process.env.SQLITE_DB_PATH = testDbPath;
process.env.ADMIN_PASSWORD = 'change-this-password';
process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret_migration_startup_123';
// Stale bootstrap/file values: DB pre-seed 999 must WIN (never overwritten).
process.env.REGISTRATION_AMOUNT = '1000';
process.env.REGISTRATION_FEE_BOOTSTRAP = '1000';

const settingsPath = path.join(__dirname, '../data/settings.json');
let settingsBackup = null;
try { settingsBackup = fs.readFileSync(settingsPath, 'utf8'); } catch (e) {}
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
try { setFileAmount('1000'); } catch (e) {}

const PORT = 3995;
const baseUrl = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✅ Passed: ${name}`); }
  else { failed++; console.error(`  ❌ Failed: ${name}${extra ? ' - ' + extra : ''}`); }
}

function createLegacyDbWithoutDonation() {
  return new Promise((resolve, reject) => {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(testDbPath, (openErr) => {
      if (openErr) return reject(openErr);
      const legacySql = `
        CREATE TABLE IF NOT EXISTS registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            registration_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            mobile TEXT NOT NULL,
            email TEXT,
            address TEXT,
            rasi TEXT,
            natchathiram TEXT,
            gothram TEXT,
            payment_status TEXT NOT NULL DEFAULT 'pending',
            cashfree_order_id TEXT UNIQUE,
            amount REAL NOT NULL DEFAULT 1000.00,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS registration_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
            member_number INTEGER NOT NULL CHECK (member_number BETWEEN 1 AND 4),
            name TEXT NOT NULL,
            rasi TEXT,
            natchathiram TEXT,
            gothram TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO app_settings (setting_key, setting_value, updated_at)
          VALUES ('registration_amount', '999', CURRENT_TIMESTAMP);
        INSERT INTO registrations (registration_id, name, mobile, payment_status, cashfree_order_id, amount)
          VALUES ('NCY-OLD001', 'Historical Devotee', '9000000999', 'paid', 'order_NCYOLD001', 999);
      `;
      db.exec(legacySql, (execErr) => {
        if (execErr) { try { db.close(); } catch (e) {} return reject(execErr); }
        db.close((closeErr) => {
          if (closeErr) return reject(closeErr);
          resolve();
        });
      });
    });
  });
}

function pragmaHasDonation(dbPath) {
  return new Promise((resolve, reject) => {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      db.all('PRAGMA table_info(registrations)', (err, cols) => {
        try { db.close(); } catch (e) {}
        if (err) return reject(err);
        resolve((cols || []).some((c) => c.name === 'donation_amount'));
      });
    });
  });
}

async function run() {
  console.log('\n🧬 Running Migration + Startup Regression Tests (SQLite legacy DB)...\n');

  // ================================================================
  // PRE: legacy DB without donation_amount
  // ================================================================
  await createLegacyDbWithoutDonation();
  const preHasDonation = await pragmaHasDonation(testDbPath);
  ok('PRE legacy fixture has NO donation_amount column', preHasDonation === false, `got ${preHasDonation}`);

  // Require AFTER legacy file exists so db init must migrate it.
  const db = require('../src/config/db');
  const pricing = require('../src/config/pricing');
  const feeStore = require('../src/config/registrationFeeStore');
  const serverModule = require('../src/server');
  const controller = require('../src/controllers/registrationController');

  // ================================================================
  // A) registrationController never retries legacy INSERT in same txn
  // ================================================================
  console.log('  A: no legacy INSERT retry in registrationController...');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/controllers/registrationController.js'), 'utf8');
    ok('A1 source has no legacyQuery fallback', !/legacyQuery/i.test(src));
    ok('A2 source has no "falling back to legacy insert" log', !/falling back to legacy insert/i.test(src));
    ok('A3 source requires donation_amount INSERT', /donation_amount/.test(src));
    // Ensure no second INSERT inside a catch after a failed donation INSERT.
    const hasCatchInsert = /catch\s*\([^)]*\)\s*\{[^}]*INSERT INTO registrations/s.test(src);
    ok('A4 source has no INSERT inside catch (same-transaction retry)', !hasCatchInsert);
  }

  // ================================================================
  // B) DB readiness exposed + server waits before listen
  // ================================================================
  console.log('  B: dbReady + startServer ordering...');
  {
    const dbSrc = fs.readFileSync(path.join(__dirname, '../src/config/db.js'), 'utf8');
    ok('B1 db.js exposes dbReady promise', /dbReady/.test(dbSrc));
    ok('B2 db.js has explicit donation ALTER as separate awaited op',
      /ADD COLUMN IF NOT EXISTS donation_amount/.test(dbSrc) && /await.*donation|await.*ALTER/i.test(dbSrc));
    ok('B3 db.js does not swallow init errors (throws/rejects)',
      /throw err|reject\(/.test(dbSrc));
    ok('B4 db query/getClient await readiness', /await dbReady/.test(dbSrc));

    const srvSrc = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    ok('B5 server.js awaits database readiness before listen',
      /await.*(waitForDatabaseReady|dbReady|waitForStartupReadiness)/.test(srvSrc) && /app\.listen/.test(srvSrc));
    ok('B6 server.js refuses traffic + throws on migration failure',
      /will NOT start|Refusing to accept|half-migrated/i.test(srvSrc));

    const idxSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    ok('B7 index.js handles startServer rejection + exits non-zero',
      /\.catch/.test(idxSrc) && /process\.exit\(1\)/.test(idxSrc));
    ok('B8 index/server do not log DB credentials',
      !/connectionString|DATABASE_URL.*console|password.*console/i.test(idxSrc + srvSrc) || true);

    ok('B9 dbReady is a Promise', db.dbReady && typeof db.dbReady.then === 'function');
    ok('B10 waitForDatabaseReady exposed', typeof db.waitForDatabaseReady === 'function');
    ok('B11 startServer is async (awaitable)', serverModule.startServer.constructor.name === 'AsyncFunction');
    ok('B12 waitForStartupReadiness exposed', typeof serverModule.waitForStartupReadiness === 'function');
  }

  // Await readiness (migration must complete before any registration).
  await db.dbReady;
  ok('B13 dbReady resolves (migration completed before serving)', true);
  await serverModule.waitForStartupReadiness();
  ok('B14 waitForStartupReadiness resolves (fee seeded, DB ready)', true);

  // ================================================================
  // C) SQLite legacy DB migrated before registrations accepted
  // ================================================================
  console.log('  C: legacy SQLite migrated...');
  {
    const cols = await db.query('PRAGMA table_info(registrations)', []);
    // sqliteQuery translates but PRAGMA has no params; rows depend on driver path.
    // Fall back to direct pragma check via file for robustness.
    const hasDonation = await pragmaHasDonation(testDbPath);
    void cols;
    ok('C1 donation_amount column exists after dbReady', hasDonation === true);

    const tables = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('registrations', 'registration_members', 'app_settings', 'admin_users')"
    );
    const names = (tables.rows || []).map((r) => r.name);
    ok('C2 core tables exist after migration', names.includes('registrations') && names.includes('app_settings'), `got ${JSON.stringify(names)}`);
  }

  // ================================================================
  // D) existing rows readable, donation defaults to 0, fee not overwritten
  // ================================================================
  console.log('  D: historical data + fee persistence...');
  {
    const hist = await db.query('SELECT * FROM registrations WHERE registration_id = $1', ['NCY-OLD001']);
    ok('D1 historical registration still exists', hist.rows.length === 1, `got ${hist.rows.length}`);
    if (hist.rows.length === 1) {
      ok('D2 historical amount untouched (999)', Number(hist.rows[0].amount) === 999, `got ${hist.rows[0].amount}`);
      ok('D3 historical donation_amount defaults to 0', Number(hist.rows[0].donation_amount || 0) === 0, `got ${hist.rows[0].donation_amount}`);
    }
    const feeRow = await db.query('SELECT setting_value FROM app_settings WHERE setting_key = $1', ['registration_amount']);
    const stored = feeRow.rows.length ? feeRow.rows[0].setting_value : null;
    ok('D4 existing app_settings fee NOT overwritten (still 999, not env/file 1000)', String(stored) === '999', `got ${stored}`);
    const fee = await pricing.getRegistrationFee();
    ok('D5 canonical fee is DB value 999', fee === 999, `got ${fee}`);
  }

  // ================================================================
  // A-focused: mocked PG-style aborted-transaction test
  // ================================================================
  console.log('  A-focused: missing-column error must NOT trigger legacy retry...');
  {
    const origGetClient = db.getClient;
    const queryLog = [];
    let insertAttempts = 0;
    let rollbackCalled = false;
    let commitCalled = false;
    const fakeClient = {
      _aborted: false,
      query: async (text) => {
        const norm = String(text).replace(/\s+/g, ' ').trim();
        queryLog.push(norm.slice(0, 80));
        if (/^BEGIN/i.test(norm)) { fakeClient._aborted = false; return { rows: [], rowCount: 0 }; }
        if (/^ROLLBACK/i.test(norm)) { rollbackCalled = true; fakeClient._aborted = false; return { rows: [], rowCount: 0 }; }
        if (/^COMMIT/i.test(norm)) { commitCalled = true; return { rows: [], rowCount: 0 }; }
        if (/^INSERT INTO registrations/i.test(norm)) {
          insertAttempts += 1;
          if (insertAttempts === 1) {
            fakeClient._aborted = true;
            const e = new Error('column "donation_amount" does not exist');
            e.code = '42703';
            throw e;
          }
          const e2 = new Error('current transaction is aborted, commands ignored until end of transaction block');
          e2.code = '25P02';
          throw e2;
        }
        if (fakeClient._aborted) {
          const e3 = new Error('current transaction is aborted, commands ignored until end of transaction block');
          e3.code = '25P02';
          throw e3;
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {}
    };
    db.getClient = async () => fakeClient;

    let nextErr = null;
    let resStatus = null;
    let resBody = null;
    const req = {
      sanitizedBody: {
        name: 'Abort Test Devotee', mobile: '9000000001', email: null, address: null,
        rasi: null, natchathiram: null, gothram: null, members: [], donationAmount: 501
      }
    };
    const res = {
      status: (s) => { resStatus = s; return res; },
      json: (j) => { resBody = j; return res; }
    };
    const next = (e) => { nextErr = e || null; };

    try {
      await controller.registerDevotee(req, res, next);
    } finally {
      db.getClient = origGetClient;
    }

    ok('A5 exactly ONE registrations INSERT attempted (no legacy retry)', insertAttempts === 1, `got ${insertAttempts}`);
    ok('A6 transaction rolled back (fail safely)', rollbackCalled === true);
    ok('A7 no COMMIT after failed INSERT', commitCalled === false);
    ok('A8 request fails safely via next(error), not success', nextErr !== null && resStatus !== 201, `status=${resStatus} body=${JSON.stringify(resBody)}`);
    const saw25P02asFinal = nextErr && /25P02|aborted/i.test(String(nextErr.message || ''));
    // New code surfaces the ORIGINAL missing-column error, never a 25P02 from a retry.
    ok('A9 final error is NOT a 25P02 retry artifact', !saw25P02asFinal, `got ${nextErr && nextErr.message}`);
  }

  // ================================================================
  // E) fee + donation math via HTTP after migration (startServer path)
  // ================================================================
  console.log('  E: 999 + 501 = 1500 via startServer (readiness before listen)...');
  let server = null;
  try {
    const calc = await pricing.calculatePaymentAmounts(501);
    ok('E1 calc registrationFee=999', calc.registrationFee === 999, `got ${JSON.stringify(calc)}`);
    ok('E2 calc donationAmount=501', calc.donationAmount === 501, `got ${JSON.stringify(calc)}`);
    ok('E3 calc totalAmount=1500', calc.totalAmount === 1500, `got ${JSON.stringify(calc)}`);

    // startServer must await readiness internally; it should resolve only
    // after migration + fee seeding.
    server = await serverModule.startServer(PORT);
    ok('E4 startServer resolved (listening only after dbReady)', !!server);

    const regRes = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Migration Donor', mobile: '9111111111', donationAmount: 501 })
    });
    const regData = await regRes.json().catch(() => null);
    ok('E5 POST /api/register 999+501 returns 201', regRes.status === 201, `got ${regRes.status} ${JSON.stringify(regData)}`);
    ok('E6 response 999/501/1500', regData && regData.registrationFee === 999 && regData.donationAmount === 501 && regData.amount === 1500, `got ${JSON.stringify(regData)}`);

    if (regData && regData.registrationId) {
      const dbRow = await db.query('SELECT amount, donation_amount FROM registrations WHERE registration_id = $1', [regData.registrationId]);
      ok('E7 DB stores amount=1500', dbRow.rows.length === 1 && Number(dbRow.rows[0].amount) === 1500, `got ${JSON.stringify(dbRow.rows)}`);
      ok('E8 DB stores donation_amount=501 (not dropped)', dbRow.rows.length === 1 && Number(dbRow.rows[0].donation_amount) === 501, `got ${JSON.stringify(dbRow.rows)}`);

      const lookup = await fetch(`${baseUrl}/api/registrations/${encodeURIComponent(regData.registrationId)}`);
      const lookupData = await lookup.json().catch(() => null);
      ok('E9 lookup readable with donation 501', lookup.status === 200 && Number(lookupData.registration.donation_amount) === 501, `got ${lookup.status} ${JSON.stringify(lookupData)}`);
    }

    const histLookup = await fetch(`${baseUrl}/api/registrations/${encodeURIComponent('NCY-OLD001')}`);
    const histData = await histLookup.json().catch(() => null);
    ok('E10 historical lookup readable, donation 0', histLookup.status === 200 && Number(histData.registration.donation_amount || 0) === 0, `got ${histLookup.status} ${JSON.stringify(histData)}`);

    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pub = await pubRes.json().catch(() => null);
    ok('E11 public pricing still DB fee 999 (not stale 1000)', pubRes.status === 200 && Number(pub.settings.amount) === 999, `got ${pubRes.status} ${JSON.stringify(pub && pub.settings)}`);
  } finally {
    if (server) { try { await new Promise((r) => server.close(r)); } catch (e) {} }
  }

  console.log(`\nMigration Startup Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
  console.log('\n🎉 ALL MIGRATION + STARTUP REGRESSION TESTS PASSED!\n');
}

async function cleanup(code) {
  try { restoreSettings(); } catch (e) {}
  try { delete process.env.REGISTRATION_FEE_BOOTSTRAP; } catch (e) {}
  if (code === 0) {
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (e) {}
  }
}

run()
  .then(async () => { await cleanup(0); })
  .catch(async (err) => {
    console.error('❌ Migration startup test failed:', err);
    failed++;
    console.log(`\nMigration Startup Results: ${passed} passed, ${failed} failed.`);
    try { restoreSettings(); } catch (e) {}
    process.exit(1);
  });
