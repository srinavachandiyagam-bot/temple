/**
 * ====================================================================
 * Nava Chandi Yagam - Server-side Pricing Source
 * ====================================================================
 * Single authoritative source for the registration fee (FIXED ₹999, NO donation).
 *
 * - MOCK_MODE=true: fee from admin settings.json (settings.amount),
 *   with REGISTRATION_AMOUNT env as fallback (file-backed, no DB).
 *   REGISTRATION_FEE_BOOTSTRAP is ignored in mock mode.
 * - MOCK_MODE=false (PostgreSQL/SQLite): fee from app_settings
 *   registration_amount row (authoritative). When the row is genuinely
 *   absent, it is seeded once from REGISTRATION_FEE_BOOTSTRAP, then
 *   REGISTRATION_AMOUNT env (bootstrap-only), then settings.json compat
 *   fallback, then default 999. Once the row exists, env/file are ignored.
 *   Any DB/table/query failure throws 503 (fail closed, never fallback).
 * - The frontend MUST NOT submit or override the registration fee.
 * - Donation functionality REMOVED: participation is fixed ₹999 only.
 * - All arithmetic uses integer paise to avoid float errors.
 */

const DEFAULT_REGISTRATION_FEE = 999;
const MAX_AMOUNT = 99999999.99;
const MAX_PAISE = Math.round(MAX_AMOUNT * 100);

function toPaise(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * 100);
}

function fromPaise(paise) {
  return Number((paise / 100).toFixed(2));
}

function hasMaxTwoDecimalsString(str) {
  return /^\d+(\.\d{1,2})?$/.test(str);
}

/**
 * Strictly parses an INR money value.
 * Returns normalized Number (2-decimal) or null if invalid.
 * Options: { allowZero: boolean, minExclusiveZero: boolean }
 */
function parseMoneyValue(raw, { allowZero = false } = {}) {
  if (raw === undefined || raw === null) return null;
  let str;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    str = String(raw);
  } else if (typeof raw === 'string') {
    str = raw.trim();
    if (str.length === 0) return null;
  } else {
    return null;
  }

  // Reject hex, exponent, whitespace-inside, signs handled below
  if (/[eExX]/.test(str)) return null;
  if (!/^-?\d+(\.\d+)?$/.test(str)) return null;

  const num = Number(str);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  if (!allowZero && num <= 0) return null;
  if (allowZero && num === 0) return 0;
  if (num <= 0) return null;
  if (num > MAX_AMOUNT) return null;
  if (!hasMaxTwoDecimalsString(str)) {
    // Allow "999.5" (1 decimal) but reject 3+ decimals; also guard
    // against float dust like 999.999 -> invalid
    return null;
  }
  const paise = toPaise(num);
  if (!Number.isFinite(paise) || paise <= 0 || paise > MAX_PAISE) return null;
  return fromPaise(paise);
}

function parseFeeValue(raw) {
  return parseMoneyValue(raw, { allowZero: false });
}

/**
 * Canonical registration fee.
 *
 * MOCK_MODE=true (file-backed, no database required):
 *   1) admin settings.amount (settings.json)
 *   2) REGISTRATION_AMOUNT env
 *   3) safe default
 *
 * DB-backed mode (MOCK_MODE=false, PostgreSQL or SQLite):
 *   Delegates to registrationFeeStore.ensureRegistrationFeeSeeded():
 *   1) app_settings registration_amount row (authoritative, survives restarts)
 *   2) one-time seed ONLY when the row is genuinely absent:
 *      REGISTRATION_FEE_BOOTSTRAP -> REGISTRATION_AMOUNT -> settings.json -> 1000
 *
 * Once an app_settings row exists, env/file changes must NOT overwrite it.
 * DB/table/query failures and invalid stored rows THROW 503 (fail closed).
 * Mock reads never throw; DB-backed reads throw instead of stale fallback.
 */
async function getRegistrationFee() {
  const isMock = process.env.MOCK_MODE === 'true';

  if (isMock) {
    // 1. Admin-managed settings (same source as public website)
    try {
      const { getPublicData } = require('./settingsManager');
      const data = getPublicData();
      const raw = data && data.settings ? data.settings.amount : undefined;
      const parsed = parseFeeValue(raw);
      if (parsed !== null) return parsed;
    } catch (e) {
      // Fall through to env/default; never throw for mock pricing reads
    }

    // 2. Environment fallback (REGISTRATION_FEE_BOOTSTRAP intentionally ignored in mock)
    const envParsed = parseFeeValue(process.env.REGISTRATION_AMOUNT);
    if (envParsed !== null) return envParsed;

    // 3. Safe default
    return DEFAULT_REGISTRATION_FEE;
  }

  // DB-backed mode: authoritative store. Fail closed on any DB problem.
  const store = require('./registrationFeeStore');
  return store.ensureRegistrationFeeSeeded();
}

/**
 * Validates admin amount before it can become the live fee.
 * Returns normalized Number or null.
 */
function normalizeAdminAmount(raw) {
  return parseFeeValue(raw);
}

/**
 * Normalizes participant donation - DEPRECATED: Participation is fixed at ₹999, no donation.
 * Always returns 0 for backward compatibility; any non-zero donation is ignored.
 * Returns { valid, value, error }.
 */
function normalizeDonationAmount(raw) {
  // Donation functionality removed: fixed ₹999 only. Always 0.
  if (raw !== undefined && raw !== null && String(raw).trim() !== '' && String(raw).trim() !== '0' && String(raw).trim() !== '0.00') {
    // Silently ignore any donation attempt; log for debugging if needed
    // Do not throw - treat as 0 to enforce fixed amount
  }
  return { valid: true, value: 0 };
}

/**
 * Calculates total using paise arithmetic.
 * FIXED: Participation amount is ₹999 only, no donation. Total always equals fee.
 * Returns { registrationFee, donationAmount:0, totalAmount:fee } all normalized.
 */
async function calculatePaymentAmounts(donationRaw) {
  const registrationFee = await getRegistrationFee();
  // Donation removed: always 0, total = fee (₹999 fixed)
  const donationValue = 0;
  const totalPaise = toPaise(registrationFee);
  if (totalPaise > MAX_PAISE) {
    const err = new Error('Total amount exceeds maximum allowed.');
    err.status = 400;
    throw err;
  }
  return {
    registrationFee,
    donationAmount: donationValue,
    totalAmount: fromPaise(totalPaise)
  };
}

/**
 * Paise-safe equality for verification (verify/webhook/sync share this).
 * Returns false if either side is missing/non-finite.
 */
function amountsEqual(a, b) {
  const pa = toPaise(a);
  const pb = toPaise(b);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return false;
  return pa === pb;
}

module.exports = {
  DEFAULT_REGISTRATION_FEE,
  MAX_AMOUNT,
  toPaise,
  fromPaise,
  getRegistrationFee,
  normalizeAdminAmount,
  normalizeDonationAmount,
  calculatePaymentAmounts,
  amountsEqual
};
