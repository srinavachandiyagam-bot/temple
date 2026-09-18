const crypto = require('crypto');

/**
 * Generates a unique, friendly public-facing Registration ID
 * Format: NCY-###### (6 uppercase alphanumeric characters, e.g. NCY-8A2F9B)
 */
function generateRegistrationId() {
  // Use crypto for cryptographically strong random bytes
  const randomChars = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `NCY-${randomChars}`;
}

/**
 * Generates a unique PhonePe Merchant Order ID
 * PhonePe requirements: Max 63 chars, alphanumeric and underscore/hyphen only
 * Format: order_NCY_<timestamp>_<random>
 */
function generatePhonePeOrderId(registrationId) {
  const cleanReg = (registrationId || 'NCY').replace(/[^a-zA-Z0-9]/g, '');
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `order_${cleanReg}_${timestamp}_${randomSuffix}`;
}

// Backward compatibility alias (deprecated – use generatePhonePeOrderId)
function generateCashfreeOrderId(registrationId) {
  return generatePhonePeOrderId(registrationId);
}

function generateMerchantOrderId(registrationId) {
  return generatePhonePeOrderId(registrationId);
}

module.exports = {
  generateRegistrationId,
  generatePhonePeOrderId,
  generateMerchantOrderId,
  generateCashfreeOrderId
};
