/**
 * Centralized constants for Nava Chandi Yagam
 * - Rasi (12)
 * - Natchathiram / Nakshatra (27)
 * - Payment statuses and validation helpers
 * Single source of truth, used by backend validation and frontend generation.
 */

// Rasi - 12 (Tamil, English) pairs. English names match spec exactly where possible.
const RASI_LIST = [
  ["மேஷம்", "Mesham"],
  ["ரிஷபம்", "Rishabam"],
  ["மிதுனம்", "Mithunam"],
  ["கடகம்", "Kadakam"],
  ["சிம்மம்", "Simmam"],
  ["கன்னி", "Kanni"],
  ["துலாம்", "Thulam"],
  ["விருச்சிகம்", "Viruchigam"],
  ["தனுசு", "Dhanusu"],
  ["மகரம்", "Magaram"],
  ["கும்பம்", "Kumbam"],
  ["மீனம்", "Meenam"]
];

// Keep legacy English variants for backward compatibility validation (allow both)
const RASI_LEGACY_MAP = {
  "Mesha (Aries)": "Mesham",
  "Mesham (Aries)": "Mesham",
  "Rishabha (Taurus)": "Rishabam",
  "Rishabham (Taurus)": "Rishabam",
  "Mithuna (Gemini)": "Mithunam",
  "Mithunam (Gemini)": "Mithunam",
  "Kataka (Cancer)": "Kadakam",
  "Kadakam (Cancer)": "Kadakam",
  "Simha (Leo)": "Simmam",
  "Simmam (Leo)": "Simmam",
  "Kanni (Virgo)": "Kanni",
  "Kanya (Virgo)": "Kanni",
  "Kanni": "Kanni",
  "Kanya": "Kanni",
  "Thula (Libra)": "Thulam",
  "Thulam (Libra)": "Thulam",
  "Vrischika (Scorpio)": "Viruchigam",
  "Viruchigam (Scorpio)": "Viruchigam",
  "Dhanus (Sagittarius)": "Dhanusu",
  "Dhanusu (Sagittarius)": "Dhanusu",
  "Makara (Capricorn)": "Magaram",
  "Magaram (Capricorn)": "Magaram",
  "Kumbha (Aquarius)": "Kumbam",
  "Kumbam (Aquarius)": "Kumbam",
  "Meena (Pisces)": "Meenam",
  "Meenam (Pisces)": "Meenam"
};

const NAKSHATRA_LIST = [
  ["அஸ்வினி", "Ashwini"],
  ["பரணி", "Bharani"],
  ["கார்த்திகை", "Krittika"],
  ["ரோகிணி", "Rohini"],
  ["மிருகசீரிஷம்", "Mrigashirsha"],
  ["திருவாதிரை", "Ardra"],
  ["புனர்பூசம்", "Punarvasu"],
  ["பூசம்", "Pushya"],
  ["ஆயில்யம்", "Ashlesha"],
  ["மகம்", "Magha"],
  ["பூரம்", "Purva Phalguni"],
  ["உத்திரம்", "Uttara Phalguni"],
  ["ஹஸ்தம்", "Hasta"],
  ["சித்திரை", "Chitra"],
  ["சுவாதி", "Swati"],
  ["விசாகம்", "Vishakha"],
  ["அனுஷம்", "Anuradha"],
  ["கேட்டை", "Jyeshtha"],
  ["மூலம்", "Mula"],
  ["பூராடம்", "Purva Ashadha"],
  ["உத்திராடம்", "Uttara Ashadha"],
  ["திருவோணம்", "Shravana"],
  ["அவிட்டம்", "Dhanishta"],
  ["சதயம்", "Shatabhisha"],
  ["பூரட்டாதி", "Purva Bhadrapada"],
  ["உத்திரட்டாதி", "Uttara Bhadrapada"],
  ["ரேவதி", "Revati"]
];

const PAYMENT_STATUSES = ["CREATED", "PENDING", "PAID", "FAILED", "CANCELLED", "EXPIRED"];

function normalizeStatus(s) {
  if (!s) return "PENDING";
  return String(s).trim().toUpperCase();
}

function isValidRasi(value) {
  if (!value) return true; // optional field; no error if empty
  const trimmed = String(value).trim();
  // Accept any of the English or Tamil values in lists, plus legacy map keys/values
  const allVals = new Set();
  RASI_LIST.forEach(([ta, en]) => { allVals.add(ta); allVals.add(en); });
  Object.keys(RASI_LEGACY_MAP).forEach(k => allVals.add(k));
  Object.values(RASI_LEGACY_MAP).forEach(v => allVals.add(v));
  return allVals.has(trimmed);
}

function isValidNakshatra(value) {
  if (!value) return true;
  const trimmed = String(value).trim();
  const allVals = new Set();
  NAKSHATRA_LIST.forEach(([ta, en]) => { allVals.add(ta); allVals.add(en); });
  return allVals.has(trimmed);
}

module.exports = {
  RASI_LIST,
  RASI_LEGACY_MAP,
  NAKSHATRA_LIST,
  PAYMENT_STATUSES,
  normalizeStatus,
  isValidRasi,
  isValidNakshatra
};
