const path = require('path');
const fs = require('fs');
const mockDb = require('./mockDb');

const isMockMode = process.env.MOCK_MODE === 'true';
const databaseUrl = process.env.DATABASE_URL || '';

const isPostgres = !isMockMode && (
  databaseUrl.startsWith('postgres://') ||
  databaseUrl.startsWith('postgresql://')
);

const isSqlite = !isMockMode && !isPostgres;

let pool = null;
let sqliteDb = null;

// Critical backward-compatible migration. Must run as an explicit, separate
// awaited operation -- never bundled inside the multi-statement schema.sql
// execution -- so a failure in the full schema can never prevent this ALTER
// from being attempted.
const PG_DONATION_ALTER_SQL =
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS donation_amount NUMERIC(10, 2) NOT NULL DEFAULT 0';
const PG_PHONEPE_ALTER_SQLS = [
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS phonepe_merchant_order_id VARCHAR(100)',
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS phonepe_order_id VARCHAR(100)',
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS phonepe_transaction_id VARCHAR(100)',
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS cashfree_order_id VARCHAR(100)'
];

const PG_REGISTRATIONS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS registrations (
    id BIGSERIAL PRIMARY KEY,
    registration_id VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    rasi VARCHAR(100),
    natchathiram VARCHAR(100),
    gothram VARCHAR(100),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    cashfree_order_id VARCHAR(100) UNIQUE,
    phonepe_merchant_order_id VARCHAR(100) UNIQUE,
    phonepe_order_id VARCHAR(100),
    phonepe_transaction_id VARCHAR(100),
    amount NUMERIC(10, 2) NOT NULL DEFAULT 999.00,
    donation_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const PG_APP_SETTINGS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;

const SQLITE_APP_SETTINGS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

let dbReady;

if (isMockMode) {
  console.log('💡 [Mock Mode] Using in-memory database store (no PostgreSQL or SQLite connection needed).');
  // Mock mode requires no schema work: resolve immediately.
  dbReady = Promise.resolve();
} else if (isPostgres) {
  const { Pool } = require('pg');
  const isCloudPostgres = (
    process.env.NODE_ENV === 'production' ||
    databaseUrl.includes('supabase') ||
    databaseUrl.includes('neon.tech') ||
    databaseUrl.includes('render.com') ||
    databaseUrl.includes('railway') ||
    databaseUrl.includes('sslmode=require')
  );

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: isCloudPostgres ? { rejectUnauthorized: false } : false
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });
  console.log('🐘 Using PostgreSQL database connection.');
  dbReady = initPostgres(pool);
} else {
  // SQLite Mode (Default for local development & single-instance deployments)
  dbReady = initSqliteDb();
}

// Prevent unhandled-rejection warnings during the gap before startServer or
// first query attaches. Awaiting dbReady elsewhere still observes rejection.
dbReady.catch(() => {});

async function initPostgres(poolInstance) {
  // Exact initialization order (each step a separate awaited operation):
  //  1. Connectivity check (SELECT 1)
  //  2. CREATE TABLE IF NOT EXISTS registrations (minimal, includes donation_amount)
  //  3. Critical ALTER for pre-existing tables missing donation_amount
  //  4. Explicit app_settings table (fee persistence must survive restarts)
  //  5. Full db/schema.sql for remaining objects (members, indexes, triggers)
  //  6. Re-assert critical donation ALTER after full schema (idempotent)
  // Any failure rejects dbReady -- never log-and-continue serving traffic.
  // Existing rows are untouched; PostgreSQL backfills donation_amount=0.
  try {
    await poolInstance.query('SELECT 1');
    await poolInstance.query(PG_REGISTRATIONS_CREATE_SQL);
    await poolInstance.query(PG_DONATION_ALTER_SQL);
    for (const sql of PG_PHONEPE_ALTER_SQLS) {
      try { await poolInstance.query(sql); } catch (e) { console.warn('⚠️ PG phonepe alter warn:', e.message); }
    }
    await poolInstance.query(PG_APP_SETTINGS_CREATE_SQL);

    const schemaPath = path.join(__dirname, '../../db/schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`PostgreSQL schema file missing: ${schemaPath}`);
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await poolInstance.query(sql);

    // Re-assert after the multi-statement batch (idempotent, separate op).
    await poolInstance.query(PG_DONATION_ALTER_SQL);
    for (const sql of PG_PHONEPE_ALTER_SQLS) {
      try { await poolInstance.query(sql); } catch (e) {}
    }
    await poolInstance.query(PG_APP_SETTINGS_CREATE_SQL);

    console.log('✅ PostgreSQL schema verified/initialized successfully.');
  } catch (err) {
    console.error('❌ PostgreSQL schema initialization failed:', err && err.message ? err.message : err);
    throw err;
  }
}

function sqliteExec(dbInstance, sql) {
  return new Promise((resolve, reject) => {
    dbInstance.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sqliteRun(dbInstance, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function sqliteAll(dbInstance, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function initSqliteDb() {
  return new Promise((resolveInit, rejectInit) => {
    let sqlite3;
    try {
      sqlite3 = require('sqlite3').verbose();
    } catch (err) {
      console.error('❌ Could not load sqlite3 native binary:', err.message);
      rejectInit(err);
      return;
    }

    const sqliteDbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../data/temple.db');
    const dataDir = path.dirname(sqliteDbPath);
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch (dirErr) {
      console.error('❌ Could not create SQLite data directory:', dirErr.message);
      rejectInit(dirErr);
      return;
    }

    let dbInstance;
    try {
      dbInstance = new sqlite3.Database(sqliteDbPath, (openErr) => {
        if (openErr) {
          console.error('❌ Failed to connect to SQLite database:', openErr.message);
          rejectInit(openErr);
          return;
        }
        sqliteDb = dbInstance;
        console.log(`🗄️ Using persistent SQLite database at: ${sqliteDbPath}`);

        (async () => {
          try {
            const schemaPath = path.join(__dirname, '../../db/schema_sqlite.sql');
            if (!fs.existsSync(schemaPath)) {
              throw new Error(`SQLite schema file missing: ${schemaPath}`);
            }
            const sql = fs.readFileSync(schemaPath, 'utf8');
            await sqliteExec(dbInstance, sql);

            // Backward-compatible: ensure phonepe/cashfree/donation columns on pre-existing DB files.
            const cols = await sqliteAll(dbInstance, 'PRAGMA table_info(registrations)');
            const existing = new Set((cols || []).map(c => c.name));
            if (!existing.has('donation_amount')) {
              await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN donation_amount REAL NOT NULL DEFAULT 0');
            }
            if (!existing.has('phonepe_merchant_order_id')) {
              await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN phonepe_merchant_order_id TEXT');
            }
            if (!existing.has('phonepe_order_id')) {
              await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN phonepe_order_id TEXT');
            }
            if (!existing.has('phonepe_transaction_id')) {
              await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN phonepe_transaction_id TEXT');
            }
            if (!existing.has('cashfree_order_id')) {
              await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN cashfree_order_id TEXT');
            }
            // Ensure indexes exist after columns are added
            try { await sqliteExec(dbInstance, 'CREATE INDEX IF NOT EXISTS idx_registrations_phonepe_merchant_order_id ON registrations (phonepe_merchant_order_id)'); } catch(e) {}
            try { await sqliteExec(dbInstance, 'CREATE INDEX IF NOT EXISTS idx_registrations_cashfree_order_id ON registrations (cashfree_order_id)'); } catch(e) {}

            // Explicit app_settings guarantee (separate awaited op).
            await sqliteExec(dbInstance, SQLITE_APP_SETTINGS_CREATE_SQL);

            console.log('✅ SQLite schema verified/initialized successfully.');
            resolveInit();
          } catch (migrateErr) {
            console.error(
              '❌ SQLite schema initialization failed:',
              migrateErr && migrateErr.message ? migrateErr.message : migrateErr
            );
            rejectInit(migrateErr);
          }
        })();
      });
    } catch (err) {
      console.error('❌ Failed to open SQLite database:', err.message);
      rejectInit(err);
    }
  });
}

/**
 * Translates PostgreSQL parameterized query ($1, $2, ...) to SQLite (?)
 */
function translatePgQueryToSqlite(sql, params) {
  if (!params || params.length === 0) {
    return { sql, params: [] };
  }
  const newParams = [];
  const translatedSql = sql.replace(/\$([0-9]+)/g, (match, p1) => {
    const idx = parseInt(p1, 10) - 1;
    newParams.push(params[idx]);
    return '?';
  });
  return { sql: translatedSql, params: newParams };
}

/**
 * Executes a query against SQLite
 */
function sqliteQuery(text, params = []) {
  if (!sqliteDb) {
    return mockDb.query(text, params);
  }

  return new Promise((resolve, reject) => {
    const { sql, params: mappedParams } = translatePgQueryToSqlite(text, params);
    const trimmed = text.trim();
    const isReturning = /RETURNING/i.test(trimmed);
    const isSelect = /^SELECT/i.test(trimmed);

    if (isSelect || isReturning) {
      sqliteDb.all(sql, mappedParams, (err, rows) => {
        if (err) return reject(err);
        resolve({
          rows: rows || [],
          rowCount: rows ? rows.length : 0
        });
      });
    } else {
      sqliteDb.run(sql, mappedParams, function (err) {
        if (err) return reject(err);
        resolve({
          rows: [],
          rowCount: this.changes || 0,
          lastID: this.lastID
        });
      });
    }
  });
}

async function waitForDatabaseReady() {
  await dbReady;
  return true;
}

async function query(text, params) {
  if (isMockMode) {
    return mockDb.query(text, params);
  }
  // Guarantee schema/migrations finished before any query is served.
  // If migration failed, this throws (fail closed) instead of hitting a
  // half-migrated DB.
  await dbReady;
  if (isPostgres) {
    return pool.query(text, params);
  }
  return sqliteQuery(text, params);
}

async function getClient() {
  if (isMockMode) {
    return mockDb.getClient();
  }
  await dbReady;
  if (isPostgres) {
    return pool.connect();
  }
  return {
    query: (text, params) => sqliteQuery(text, params),
    release: () => {}
  };
}

module.exports = {
  isMockMode,
  isPostgres,
  isSqlite,
  get pool() { return pool; },
  get sqliteDb() { return sqliteDb; },
  query,
  getClient,
  dbReady,
  waitForDatabaseReady,
  ensureDatabaseReady: waitForDatabaseReady
};
