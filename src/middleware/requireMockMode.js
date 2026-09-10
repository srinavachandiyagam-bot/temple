const { getIsMockMode } = require('../config/cashfree');

/**
 * Blocks mock/simulator endpoints when the app is not genuinely in mock mode.
 * Uses the same authoritative determination as createCashfreeOrder().
 * Returns 404 so production does not advertise simulator endpoints.
 */
function requireMockMode(req, res, next) {
  if (!getIsMockMode()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

module.exports = requireMockMode;
module.exports.requireMockMode = requireMockMode;
