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
    amount NUMERIC(10, 2) NOT NULL DEFAULT 1000.00,
    donation_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const PG_APP_SETTINGS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;

// Soft-archive columns + append-only audit log. All idempotent: pre-existing
// production rows keep archived_at = NULL (active). No destructive migration.
// archived_by_admin_id is intentionally NOT a foreign key.
const PG_ARCHIVED_AT_ALTER_SQL =
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL';
const PG_ARCHIVED_BY_ID_ALTER_SQL =
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS archived_by_admin_id BIGINT NULL';
const PG_ARCHIVED_BY_USERNAME_ALTER_SQL =
  'ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS archived_by_username VARCHAR(100) NULL';

const PG_AUDIT_LOG_CREATE_SQL = `CREATE TABLE IF NOT EXISTS registration_audit_log (
    id BIGSERIAL PRIMARY KEY,
    registration_db_id BIGINT NOT NULL,
    registration_id VARCHAR(32) NOT NULL,
    action VARCHAR(32) NOT NULL DEFAULT 'ARCHIVED',
    actor_admin_id BIGINT NULL,
    actor_username VARCHAR(100) NULL,
    reason TEXT NULL,
    snapshot_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
const PG_AUDIT_LOG_INDEXES_SQL = `CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_db_id ON registration_audit_log (registration_db_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_id ON registration_audit_log (registration_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_action ON registration_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_registrations_archived_at ON registrations (archived_at)`;

// Database-level append-only guard: blocks UPDATE/DELETE on the audit log
// from any application SQL while allowing INSERT/SELECT. Idempotent.
// (A database owner with infrastructure access could drop the guard; that is
// outside application authorization.)
const PG_AUDIT_GUARD_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION prevent_registration_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'registration_audit_log is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql`;
const PG_AUDIT_GUARD_TRIGGERS_SQL = `DROP TRIGGER IF EXISTS trg_registration_audit_log_no_update ON registration_audit_log;
DROP TRIGGER IF EXISTS trg_registration_audit_log_no_delete ON registration_audit_log;
CREATE TRIGGER trg_registration_audit_log_no_update
BEFORE UPDATE ON registration_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_registration_audit_log_mutation();
CREATE TRIGGER trg_registration_audit_log_no_delete
BEFORE DELETE ON registration_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_registration_audit_log_mutation()`;

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
  //  7. Re-assert archive columns, audit table, indexes and append-only guard
  // Any failure rejects dbReady -- never log-and-continue serving traffic.
  // Existing rows are untouched; PostgreSQL backfills donation_amount=0.
  try {
    await poolInstance.query('SELECT 1');
    await poolInstance.query(PG_REGISTRATIONS_CREATE_SQL);
    await poolInstance.query(PG_DONATION_ALTER_SQL);
    await poolInstance.query(PG_APP_SETTINGS_CREATE_SQL);
    await poolInstance.query(PG_ARCHIVED_AT_ALTER_SQL);
    await poolInstance.query(PG_ARCHIVED_BY_ID_ALTER_SQL);
    await poolInstance.query(PG_ARCHIVED_BY_USERNAME_ALTER_SQL);
    await poolInstance.query(PG_AUDIT_LOG_CREATE_SQL);
    await poolInstance.query(PG_AUDIT_GUARD_FUNCTION_SQL);
    await poolInstance.query(PG_AUDIT_GUARD_TRIGGERS_SQL);

    const schemaPath = path.join(__dirname, '../../db/schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`PostgreSQL schema file missing: ${schemaPath}`);
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await poolInstance.query(sql);

    // Re-assert after the multi-statement batch (idempotent, separate op).
    await poolInstance.query(PG_DONATION_ALTER_SQL);
    await poolInstance.query(PG_APP_SETTINGS_CREATE_SQL);
    // Soft-archive + audit guarantees (each a separate awaited operation).
    await poolInstance.query(PG_ARCHIVED_AT_ALTER_SQL);
    await poolInstance.query(PG_ARCHIVED_BY_ID_ALTER_SQL);
    await poolInstance.query(PG_ARCHIVED_BY_USERNAME_ALTER_SQL);
    await poolInstance.query(PG_AUDIT_LOG_CREATE_SQL);
    await poolInstance.query(PG_AUDIT_LOG_INDEXES_SQL);
    await poolInstance.query(PG_AUDIT_GUARD_FUNCTION_SQL);
    await poolInstance.query(PG_AUDIT_GUARD_TRIGGERS_SQL);

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
            // Migration order matters: backfill columns on pre-existing DB
            // files FIRST, because the full schema file below references the
            // new columns (e.g. index on archived_at) and would fail against
            // a legacy table otherwise. Each step is a separate awaited op.
            const existingTables = await sqliteAll(
              dbInstance,
              `SELECT name FROM sqlite_master WHERE type='table' AND name='registrations'`
            );
            if ((existingTables || []).length > 0) {
              const preCols = await sqliteAll(dbInstance, 'PRAGMA table_info(registrations)');
              const preNames = new Set((preCols || []).map((c) => c.name));
              if (!preNames.has('donation_amount')) {
                await sqliteRun(
                  dbInstance,
                  'ALTER TABLE registrations ADD COLUMN donation_amount REAL NOT NULL DEFAULT 0'
                );
                preNames.add('donation_amount');
              }
              // Nullable archive columns: historical rows keep NULL (active).
              if (!preNames.has('archived_at')) {
                await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN archived_at DATETIME NULL');
              }
              if (!preNames.has('archived_by_admin_id')) {
                await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN archived_by_admin_id INTEGER NULL');
              }
              if (!preNames.has('archived_by_username')) {
                await sqliteRun(dbInstance, 'ALTER TABLE registrations ADD COLUMN archived_by_username TEXT NULL');
              }
            }

            const schemaPath = path.join(__dirname, '../../db/schema_sqlite.sql');
            if (!fs.existsSync(schemaPath)) {
              throw new Error(`SQLite schema file missing: ${schemaPath}`);
            }
            const sql = fs.readFileSync(schemaPath, 'utf8');
            await sqliteExec(dbInstance, sql);

            // Append-only audit log (separate awaited op).
            await sqliteExec(dbInstance, `CREATE TABLE IF NOT EXISTS registration_audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              registration_db_id INTEGER NOT NULL,
              registration_id TEXT NOT NULL,
              action TEXT NOT NULL DEFAULT 'ARCHIVED',
              actor_admin_id INTEGER NULL,
              actor_username TEXT NULL,
              reason TEXT NULL,
              snapshot_json TEXT NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);
            await sqliteExec(dbInstance, 'CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_db_id ON registration_audit_log (registration_db_id)');
            await sqliteExec(dbInstance, 'CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_id ON registration_audit_log (registration_id)');
            await sqliteExec(dbInstance, 'CREATE INDEX IF NOT EXISTS idx_registration_audit_log_action ON registration_audit_log (action)');
            await sqliteExec(dbInstance, 'CREATE INDEX IF NOT EXISTS idx_registrations_archived_at ON registrations (archived_at)');
            // Database-level append-only guard (separate awaited ops, idempotent).
            await sqliteExec(dbInstance, `CREATE TRIGGER IF NOT EXISTS trg_registration_audit_log_no_update
              BEFORE UPDATE ON registration_audit_log
              FOR EACH ROW
              BEGIN
                SELECT RAISE(ABORT, 'registration_audit_log is append-only: UPDATE not allowed');
              END`);
            await sqliteExec(dbInstance, `CREATE TRIGGER IF NOT EXISTS trg_registration_audit_log_no_delete
              BEFORE DELETE ON registration_audit_log
              FOR EACH ROW
              BEGIN
                SELECT RAISE(ABORT, 'registration_audit_log is append-only: DELETE not allowed');
              END`);

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
