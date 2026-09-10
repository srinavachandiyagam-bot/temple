/**
 * ====================================================================
 * Nava Chandi Yagam - Server-side Pricing Source
 * ====================================================================
 * Single authoritative source for the registration fee + donation total.
 *
 * - Registration fee comes from the SAME admin-managed settings source
 *   used by the public website (data/settings.json -> settings.amount
 *   via settingsManager), with REGISTRATION_AMOUNT env as fallback.
 * - The frontend MUST NOT submit or override the registration fee.
 * - Only `donationAmount` is participant-controlled and is validated here.
 * - All arithmetic uses integer paise to avoid float errors
 *   (e.g. 999.50 + 0.50 must equal 1000.00 exactly).
 */

const DEFAULT_REGISTRATION_FEE = 1000;
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
 * Order: 1) admin settings.amount 2) REGISTRATION_AMOUNT env 3) safe default.
 * Always returns a positive 2-decimal Number.
 */
function getRegistrationFee() {
  // 1. Admin-managed settings (same source as public website)
  try {
    const { getPublicData } = require('./settingsManager');
    const data = getPublicData();
    const raw = data && data.settings ? data.settings.amount : undefined;
    const parsed = parseFeeValue(raw);
    if (parsed !== null) return parsed;
  } catch (e) {
    // Fall through to env/default; never throw for pricing reads
  }

  // 2. Environment fallback
  const envParsed = parseFeeValue(process.env.REGISTRATION_AMOUNT);
  if (envParsed !== null) return envParsed;

  // 3. Safe default
  return DEFAULT_REGISTRATION_FEE;
}

/**
 * Validates admin amount before it can become the live fee.
 * Returns normalized Number or null.
 */
function normalizeAdminAmount(raw) {
  return parseFeeValue(raw);
}

/**
 * Normalizes participant donation.
 * missing/empty/null -> 0 (valid). 0 -> valid.
 * Otherwise must be finite, > 0, <= MAX, max 2 decimals.
 * Returns { valid, value, error }.
 */
function normalizeDonationAmount(raw) {
  if (raw === undefined || raw === null) return { valid: true, value: 0 };
  if (typeof raw === 'string' && raw.trim() === '') return { valid: true, value: 0 };
  if (typeof raw === 'number' && raw === 0) return { valid: true, value: 0 };
  if (typeof raw === 'string' && raw.trim() === '0') return { valid: true, value: 0 };
  if (typeof raw === 'string' && raw.trim() === '0.00') return { valid: true, value: 0 };

  const parsed = parseMoneyValue(raw, { allowZero: true });
  if (parsed === null) {
    return { valid: false, value: 0, error: 'Invalid donation amount.' };
  }
  if (parsed === 0) return { valid: true, value: 0 };
  return { valid: true, value: parsed };
}

/**
 * Calculates total using paise arithmetic.
 * Returns { registrationFee, donationAmount, totalAmount } all normalized.
 */
function calculatePaymentAmounts(donationRaw) {
  const registrationFee = getRegistrationFee();
  const donation = normalizeDonationAmount(donationRaw);
  if (!donation.valid) {
    const err = new Error(donation.error || 'Invalid donation amount.');
    err.status = 400;
    throw err;
  }
  const totalPaise = toPaise(registrationFee) + toPaise(donation.value);
  if (totalPaise > MAX_PAISE) {
    const err = new Error('Total amount exceeds maximum allowed.');
    err.status = 400;
    throw err;
  }
  return {
    registrationFee,
    donationAmount: donation.value,
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
