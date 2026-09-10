/**
 * ====================================================================
 * Nava Chandi Yagam - Registration Fee Store (DB-backed persistence)
 * ====================================================================
 * Focused helper for persisting ONLY the canonical registration fee in
 * the existing application database (PostgreSQL or SQLite).
 *
 * - Table: app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT,
 *   updated_at TIMESTAMP/DATETIME DEFAULT CURRENT_TIMESTAMP)
 * - Key: registration_amount
 * - Uses the existing db query abstraction (works with PG + SQLite).
 * - MOCK_MODE=true: no database required; all functions avoid SQL and
 *   return null so callers fall back to file-backed settings.json behavior.
 * - Never overwrites an existing DB row on bootstrap/restart.
 *
 * Bootstrap precedence for an EMPTY row (one-time only):
 *   1) valid REGISTRATION_FEE_BOOTSTRAP (safe transition variable)
 *   2) valid REGISTRATION_AMOUNT
 *   3) valid settings.json settings.amount
 *   4) safe default 1000
 *
 * Once a row exists, ALL env/file values are ignored; the DB row wins.
 *
 * Fail-closed semantics (DB-backed mode):
 *   - valid row -> return fee
 *   - DB reachable + row genuinely absent -> seed via bootstrap precedence
 *   - DB/table/query unavailable -> THROW 503 (never fallback to env/file)
 *   - existing row present but invalid -> THROW 503 (never ignore/replace)
 */

const REGISTRATION_FEE_KEY = 'registration_amount';

function isMockModeActive() {
  return process.env.MOCK_MODE === 'true';
}

function isPostgresActive() {
  if (isMockModeActive()) return false;
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

function getCreateTableSql() {
  if (isPostgresActive()) {
    return `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;
  }
  return `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
}

function pricingUnavailableError(cause) {
  const err = new Error('Registration fee is temporarily unavailable. Please try again later.');
  err.status = 503;
  if (cause) {
    err.cause = cause;
    try {
      console.error('Registration fee store unavailable:', (cause && cause.message) || cause);
    } catch (e) {}
  }
  return err;
}

/**
 * Reads the stored registration fee from app_settings.
 * - Mock mode: returns null (no DB required).
 * - DB-backed: returns normalized Number if a valid row exists,
 *   returns null ONLY if the DB is reachable and the row is genuinely absent.
 * - THROWS 503 if the DB/table/query is unavailable, or if an existing row
 *   holds an invalid fee (authoritative corrupted row must not be ignored).
 */
async function getStoredRegistrationFee() {
  if (isMockModeActive()) return null;
  const { query } = require('./db');
  let createErr = null;
  try {
    await query(getCreateTableSql(), []);
  } catch (e) {
    throw pricingUnavailableError(e);
  }
  void createErr;
  let result;
  try {
    result = await query(
      'SELECT setting_value FROM app_settings WHERE setting_key = $1',
      [REGISTRATION_FEE_KEY]
    );
  } catch (e) {
    throw pricingUnavailableError(e);
  }
  if (!result.rows || result.rows.length === 0) return null;
  const raw = result.rows[0].setting_value;
  const { normalizeAdminAmount } = require('./pricing');
  const parsed = normalizeAdminAmount(raw);
  if (parsed === null) {
    throw pricingUnavailableError(new Error(`Invalid stored registration_amount: ${JSON.stringify(raw)}`));
  }
  return parsed;
}

/**
 * Persists the registration fee to app_settings (upsert, authoritative).
 * Returns normalized Number.
 * Throws 400 Error on invalid amount. Throws 503 on DB failure.
 * In mock mode, does NOT touch the database; just validates and returns
 * the normalized value so callers can use file-backed persistence.
 */
async function setStoredRegistrationFee(amount) {
  const { normalizeAdminAmount } = require('./pricing');
  const normalized = normalizeAdminAmount(amount);
  if (normalized === null) {
    const err = new Error('Invalid Participation Amount. Enter a positive INR amount with up to 2 decimals.');
    err.status = 400;
    throw err;
  }
  if (isMockModeActive()) {
    return normalized;
  }
  const { query } = require('./db');
  try {
    await query(getCreateTableSql(), []);
  } catch (e) {
    throw pricingUnavailableError(e);
  }
  const value = String(normalized);
  // Upsert without overwriting unrelated keys; works on PG + modern SQLite.
  // ON CONFLICT DO UPDATE ensures admin save becomes immediately authoritative.
  try {
    await query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
      [REGISTRATION_FEE_KEY, value]
    );
  } catch (e) {
    throw pricingUnavailableError(e);
  }
  return normalized;
}

/**
 * Computes the bootstrap fee without touching the database (one-time only):
 * 1) valid REGISTRATION_FEE_BOOTSTRAP
 * 2) valid REGISTRATION_AMOUNT env
 * 3) valid settings.json amount
 * 4) default 1000.
 */
function computeBootstrapFee() {
  const { normalizeAdminAmount, DEFAULT_REGISTRATION_FEE } = require('./pricing');
  const dedicated = normalizeAdminAmount(process.env.REGISTRATION_FEE_BOOTSTRAP);
  if (dedicated !== null) return dedicated;
  const envParsed = normalizeAdminAmount(process.env.REGISTRATION_AMOUNT);
  if (envParsed !== null) return envParsed;
  try {
    const { getPublicData } = require('./settingsManager');
    const data = getPublicData();
    const raw = data && data.settings ? data.settings.amount : undefined;
    const fileParsed = normalizeAdminAmount(raw);
    if (fileParsed !== null) return fileParsed;
  } catch (e) {
    // Fall through to default
  }
  return DEFAULT_REGISTRATION_FEE;
}

/**
 * Ensures app_settings exists and the initial fee is seeded exactly once.
 * - If a valid DB row exists, returns it WITHOUT overwriting (protects admin
 *   changes across redeploys; bootstrap env vars are ignored).
 * - If the row is genuinely absent (DB reachable), seeds from bootstrap
 *   precedence using INSERT ... ON CONFLICT DO NOTHING so concurrent startups
 *   cannot overwrite.
 * - THROWS 503 on any DB/table/query failure or invalid existing row.
 *   Never falls back to env/file/default when the authoritative DB is down.
 * - Safe to run repeatedly. Returns fee Number, or null in mock mode.
 */
async function ensureRegistrationFeeSeeded() {
  if (isMockModeActive()) return null;
  const { query } = require('./db');
  try {
    await query(getCreateTableSql(), []);
  } catch (e) {
    throw pricingUnavailableError(e);
  }
  // 1. Existing row wins — never overwrite. Throws on DB error/invalid row.
  const existing = await getStoredRegistrationFee();
  if (existing !== null) return existing;
  // 2. Genuinely absent: compute bootstrap and insert only if still absent.
  const bootstrap = computeBootstrapFee();
  const value = String(bootstrap);
  try {
    await query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key) DO NOTHING`,
      [REGISTRATION_FEE_KEY, value]
    );
  } catch (e) {
    throw pricingUnavailableError(e);
  }
  // 3. Re-read in case a concurrent seeder won the race with a different value.
  // If re-read yields a valid (different) value, prefer it — never overwrite.
  // Throws on DB error/invalid row; throws if the row is still absent.
  const reread = await getStoredRegistrationFee();
  if (reread !== null) return reread;
  throw pricingUnavailableError(new Error('Registration fee seed verification failed.'));
}

module.exports = {
  REGISTRATION_FEE_KEY,
  isMockModeActive,
  getStoredRegistrationFee,
  setStoredRegistrationFee,
  ensureRegistrationFeeSeeded,
  computeBootstrapFee
};
