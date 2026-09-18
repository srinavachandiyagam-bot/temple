const crypto = require('crypto');

/**
 * ====================================================================
 * PhonePe Payment Gateway Integration – Standard Checkout (V2)
 * ====================================================================
 * Implements official PhonePe flows:
 * - OAuth 2.0 token generation (client_credentials)
 * - Create Payment (POST /checkout/v2/pay) – hosted checkout
 * - Order Status (GET /checkout/v2/order/{merchantOrderId}/status)
 * - Webhook verification via SHA256(username:password) vs Authorization header
 *   and optional HMAC fallback
 * - Mock mode for local testing without credentials
 *
 * Official docs:
 * https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization
 * https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment
 * https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/check-order-status
 * https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
 */

/**
 * Mock mode requires EXPLICIT opt-in (fail closed).
 * Missing or placeholder PhonePe credentials MUST NOT enable mock mode.
 */
function getIsMockMode() {
  return process.env.MOCK_MODE === 'true' ||
    process.env.MOCK_PAYMENT === 'true';
}

const PHONEPE_ENV = (process.env.PHONEPE_ENV || 'sandbox').toLowerCase();
const PHONEPE_IS_PROD = PHONEPE_ENV === 'production' || PHONEPE_ENV === 'prod' || PHONEPE_ENV === 'live';

const PHONEPE_AUTH_URL = PHONEPE_IS_PROD
  ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';

const PHONEPE_PAY_BASE_URL = PHONEPE_IS_PROD
  ? 'https://api.phonepe.com/apis/pg'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

// OAuth token cache
let cachedToken = null;
let cachedExpiresAt = 0; // epoch seconds

// In-memory mock orders store
const mockOrders = new Map();

/**
 * Fetches OAuth access token, cached until expiry.
 * In mock mode returns a fake token.
 */
async function getAccessToken() {
  if (getIsMockMode()) {
    return 'mock_phonepe_token';
  }

  const now = Math.floor(Date.now() / 1000);
  // Reuse if still valid for at least 60s
  if (cachedToken && cachedExpiresAt && now < (cachedExpiresAt - 60)) {
    return cachedToken;
  }

  const clientId = process.env.PHONEPE_CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
  const clientVersion = process.env.PHONEPE_CLIENT_VERSION || '1';

  if (!clientId || !clientSecret) {
    throw new Error('PHONEPE_CLIENT_ID or PHONEPE_CLIENT_SECRET missing');
  }

  const form = new URLSearchParams();
  form.append('client_id', clientId);
  form.append('client_version', String(clientVersion));
  form.append('client_secret', clientSecret);
  form.append('grant_type', 'client_credentials');

  const response = await fetch(PHONEPE_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: form.toString()
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.error_description || data.error || data.message || `PhonePe OAuth failed (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  const accessToken = data.access_token || data.encrypted_access_token;
  const expiresAt = data.expires_at || data.expiresAt || (now + 3600);
  const tokenType = data.token_type || 'O-Bearer';

  if (!accessToken) {
    throw new Error('PhonePe OAuth: no access_token in response');
  }

  // Normalize tokenType prefix handling
  cachedToken = accessToken;
  // expires_at is epoch seconds
  cachedExpiresAt = Number(expiresAt) || (now + 3600);

  // Store with prefix awareness; we return raw token, caller adds prefix
  // Keep tokenType for header formation
  cachedTokenType = tokenType;

  return accessToken;
}

let cachedTokenType = 'O-Bearer';

function getAuthHeader(token) {
  // According to docs, header is: Authorization: O-Bearer <token>
  const type = cachedTokenType || 'O-Bearer';
  return `${type} ${token}`;
}

/**
 * Creates a PhonePe hosted checkout order.
 * @param {Object} params
 * @param {string} params.merchantOrderId - unique merchant order id (max 63 chars, no special chars except _ and -)
 * @param {number} params.amountPaise - amount in paise (e.g., 99900 for ₹999)
 * @param {string} params.redirectUrl - URL to redirect after payment
 * @param {Object} [params.metaInfo] - optional udf fields (udf1..udf15)
 */
async function createPhonePeOrder({
  merchantOrderId,
  amountPaise,
  redirectUrl,
  metaInfo,
  message
}) {
  // Mock mode: no network
  if (getIsMockMode()) {
    const paise = Number(amountPaise);
    console.log(`💡 [Mock Mode] Created mock PhonePe order: ${merchantOrderId} (₹${(paise/100).toFixed(2)} – ${paise} paise)`);
    const mockOrder = {
      orderId: `mock_ph_${Date.now()}`,
      merchantOrderId: merchantOrderId,
      state: 'PENDING',
      amount: paise,
      expireAt: Date.now() + 30 * 60 * 1000,
      redirectUrl: `/mock-checkout?order_id=${encodeURIComponent(merchantOrderId)}`,
      mock_checkout_url: `/mock-checkout?order_id=${encodeURIComponent(merchantOrderId)}`
    };
    mockOrders.set(merchantOrderId, mockOrder);
    return mockOrder;
  }

  const token = await getAccessToken();
  const endpoint = `${PHONEPE_PAY_BASE_URL}/checkout/v2/pay`;

  const payload = {
    merchantOrderId: merchantOrderId,
    amount: Number(amountPaise),
    paymentFlow: {
      type: 'PG_CHECKOUT',
      merchantUrls: {
        redirectUrl: redirectUrl
      }
    }
  };

  if (message) {
    payload.paymentFlow.message = message;
  }

  if (metaInfo && typeof metaInfo === 'object') {
    payload.metaInfo = metaInfo;
  }

  // Optional: set expireAfter (seconds, 300-3600). Default 3600.
  // We set 1800 (30 min) for better UX
  payload.expireAfter = 1800;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': getAuthHeader(token)
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.message || data.error || data.error_description || `Failed to create PhonePe order (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  // Expected response: { orderId, merchantOrderId, state, redirectUrl, expireAt }
  // Normalize for compatibility
  const normalized = {
    orderId: data.orderId || data.order_id,
    merchantOrderId: data.merchantOrderId || data.merchant_order_id || merchantOrderId,
    state: data.state || 'PENDING',
    redirectUrl: data.redirectUrl || data.redirect_url,
    expireAt: data.expireAt || data.expire_at,
    raw: data
  };

  if (!normalized.redirectUrl) {
    throw new Error('PhonePe create order: missing redirectUrl in response');
  }

  return normalized;
}

/**
 * Fetches PhonePe order status.
 * @param {string} merchantOrderId
 */
async function getPhonePeOrderStatus(merchantOrderId) {
  if (getIsMockMode()) {
    const order = mockOrders.get(merchantOrderId);
    if (!order) {
      console.log(`💡 [Mock Mode] Order ${merchantOrderId} not found in mock store, returning PENDING`);
      return {
        orderId: `mock_notfound_${merchantOrderId}`,
        merchantOrderId: merchantOrderId,
        state: 'PENDING',
        amount: 99900,
        paymentDetails: []
      };
    }
    // Map mock state to PhonePe style COMPLETED etc.
    let state = order.state || 'PENDING';
    // Normalize mock internal state to PhonePe state
    if (state === 'PAID' || state === 'COMPLETED' || state === 'SUCCESS') state = 'COMPLETED';
    else if (state === 'FAILED') state = 'FAILED';
    else state = 'PENDING';
    return {
      orderId: order.orderId,
      merchantOrderId: merchantOrderId,
      state: state,
      amount: order.amount,
      expireAt: order.expireAt,
      paymentDetails: order.paymentDetails || [],
      metaInfo: order.metaInfo || {}
    };
  }

  const token = await getAccessToken();
  const endpoint = `${PHONEPE_PAY_BASE_URL}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false&errorContext=true`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': getAuthHeader(token)
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 404) {
      const err = new Error(`PhonePe order not found: ${merchantOrderId}`);
      err.status = 404;
      err.details = data;
      throw err;
    }
    const msg = data.message || data.error || `Failed to fetch PhonePe order status (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  // Response contains: orderId, merchantOrderId, state (PENDING/COMPLETED/FAILED), amount, expireAt, paymentDetails, metaInfo, errorCode etc.
  return data;
}

// Legacy alias for compatibility during migration
const getPhonePeOrder = getPhonePeOrderStatus;

/**
 * Allows simulating payment outcome in mock mode.
 * @param {string} merchantOrderId
 * @param {string} status - PENDING | COMPLETED | FAILED (or PAID)
 */
function setMockOrderStatus(merchantOrderId, status = 'COMPLETED', orderAmount = null) {
  let norm = String(status).toUpperCase().trim();
  if (norm === 'PAID' || norm === 'SUCCESS') norm = 'COMPLETED';
  if (!['PENDING', 'COMPLETED', 'FAILED'].includes(norm)) norm = 'PENDING';
  let paise = orderAmount !== null && orderAmount !== undefined ? Math.round(Number(orderAmount) * 100) : null;
  // If orderAmount is already in paise (e.g., 99900) and > 1000, detect
  if (paise !== null && paise === Number(orderAmount) && Number(orderAmount) > 1000) paise = Number(orderAmount);
  if (mockOrders.has(merchantOrderId)) {
    const order = mockOrders.get(merchantOrderId);
    order.state = norm;
    if (paise !== null && Number.isFinite(paise)) order.amount = paise;
    mockOrders.set(merchantOrderId, order);
    console.log(`💡 [Mock Mode] Order ${merchantOrderId} state set to: ${norm}${paise!==null?` amount ${paise}`:''}`);
    return order;
  }
  const newOrder = {
    orderId: `mock_${Date.now()}`,
    merchantOrderId: merchantOrderId,
    state: norm,
    amount: paise !== null && Number.isFinite(paise) ? paise : 99900,
    expireAt: Date.now() + 30 * 60 * 1000,
    redirectUrl: `/mock-checkout?order_id=${encodeURIComponent(merchantOrderId)}`
  };
  mockOrders.set(merchantOrderId, newOrder);
  return newOrder;
}

/**
 * Verifies PhonePe webhook/callback authenticity.
 * Supports:
 * - SHA256(username:password) comparison against Authorization header (recommended)
 * - HMAC SHA256 fallback using PHONEPE_WEBHOOK_SECRET (if configured)
 * In MOCK_MODE, returns true to allow local testing.
 *
 * @param {string} authHeader - value of Authorization header
 * @param {string} rawBody - raw request body string
 * @param {Object} headers - full headers object for alternative checksum headers
 */
function verifyPhonePeWebhook(authHeader, rawBody, headers = {}) {
  const username = process.env.PHONEPE_CALLBACK_USERNAME || process.env.PHONEPE_WEBHOOK_USERNAME || process.env.PHONEPE_USERNAME || '';
  const password = process.env.PHONEPE_CALLBACK_PASSWORD || process.env.PHONEPE_WEBHOOK_PASSWORD || process.env.PHONEPE_PASSWORD || '';

  // If credentials are configured, verify via SHA256(username:password)
  if (username && password) {
    const expectedHex = crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
    // Authorization header may contain just hex, or "Bearer <hex>", or with prefix
    const receivedRaw = String(authHeader || '').trim();
    // Extract hex token: take last whitespace-separated part if contains spaces
    let received = receivedRaw;
    if (receivedRaw.includes(' ')) {
      // e.g., "Bearer abc123" -> take last part
      received = receivedRaw.split(' ').pop().trim();
    }
    // Also support X-Verify style? but for SHA mode it's Authorization
    if (!received) return false;
    try {
      const a = Buffer.from(received.toLowerCase(), 'utf8');
      const b = Buffer.from(expectedHex.toLowerCase(), 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // HMAC fallback via checksum headers
  const checksumSecret = process.env.PHONEPE_WEBHOOK_SECRET || process.env.PHONEPE_CHECKSUM_KEY || process.env.PHONEPE_SALT_KEY || '';
  const checksumSignature = headers['x-phonepe-checksum-signature'] || headers['x-phonepe-checksum'] || headers['x-verify'] || authHeader;
  if (checksumSecret && checksumSignature && rawBody) {
    try {
      // PhonePe HMAC: HMAC-SHA256 of rawBody with secret
      const computedHex = crypto.createHmac('sha256', checksumSecret).update(rawBody).digest('hex');
      const computedB64 = crypto.createHmac('sha256', checksumSecret).update(rawBody).digest('base64');
      const received = String(checksumSignature).trim().split('###')[0].trim(); // remove salt index suffix if present
      const candidates = [computedHex, computedB64, crypto.createHmac('sha256', checksumSecret).update(rawBody).digest('hex').toLowerCase()];
      for (const cand of candidates) {
        if (cand && received) {
          try {
            const a = Buffer.from(received, 'utf8');
            const b = Buffer.from(cand, 'utf8');
            if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('PhonePe HMAC verify error:', e.message);
    }
    return false;
  }

  // If in mock mode and no credentials, allow for testing
  if (getIsMockMode()) {
    // No strict verification in mock; log but allow
    if (!authHeader && !checksumSignature) {
      console.warn('⚠️ PhonePe webhook verification skipped in MOCK_MODE (no auth header)');
      return true;
    }
    // In mock mode, even if header present but credentials missing, allow
    console.warn('⚠️ PhonePe webhook verification skipped in MOCK_MODE (missing credentials)');
    return true;
  }

  // No credentials configured and not mock -> reject
  if (!username || !password) {
    console.error('❌ Cannot verify PhonePe webhook: PHONEPE_CALLBACK_USERNAME/PASSWORD not configured');
  }
  return false;
}

function setMockOrderAmount(orderId, amount) {
  const paise = Math.round(Number(amount) * 100);
  const order = mockOrders.get(orderId);
  if (order) {
    order.amount = Number.isFinite(paise) ? paise : order.amount;
    mockOrders.set(orderId, order);
    return order;
  }
  return setMockOrderStatus(orderId, 'PENDING');
}
// Alias for older name
const verifyWebhookSignature = verifyPhonePeWebhook;

module.exports = {
  getIsMockMode,
  get isMockMode() { return getIsMockMode(); },
  PHONEPE_ENV,
  PHONEPE_AUTH_URL,
  PHONEPE_PAY_BASE_URL,
  getAccessToken,
  createPhonePeOrder,
  getPhonePeOrderStatus,
  getPhonePeOrder,
  setMockOrderStatus,
  setMockOrderAmount,
  verifyPhonePeWebhook,
  verifyWebhookSignature,
  // Mock store exposure for testing
  mockOrders
};
