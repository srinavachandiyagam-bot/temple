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
 * Generates a unique Cashfree Order ID
 * Cashfree requirements: Alphanumeric and underscore/hyphen, max 50 characters
 * Format: order_NCY_<timestamp>_<random>
 */
function generateCashfreeOrderId(registrationId) {
  const cleanReg = (registrationId || 'NCY').replace(/[^a-zA-Z0-9]/g, '');
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `order_${cleanReg}_${timestamp}_${randomSuffix}`;
}

module.exports = {
  generateRegistrationId,
  generateCashfreeOrderId
};
