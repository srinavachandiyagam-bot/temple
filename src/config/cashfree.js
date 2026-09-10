const crypto = require('crypto');

/**
 * Mock mode requires EXPLICIT opt-in (fail closed).
 * Missing or placeholder Cashfree credentials MUST NOT enable mock mode,
 * otherwise a production deploy that loses its credentials would silently
 * expose the mock checkout simulator and mock payment APIs.
 */
function getIsMockMode() {
  return process.env.MOCK_MODE === 'true' ||
    process.env.MOCK_PAYMENT === 'true';
}

const CASHFREE_ENV = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
const CASHFREE_BASE_URL = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com'
  : 'https://sandbox.cashfree.com';

const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';

// In-memory mock orders store for local testing without Cashfree credentials
const mockOrders = new Map();

/**
 * Returns Cashfree API standard headers
 */
function getHeaders() {
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    if (!getIsMockMode()) {
      console.warn('⚠️ Warning: CASHFREE_APP_ID or CASHFREE_SECRET_KEY is missing in environment variables.');
    }
  }

  return {
    'x-client-id': appId || '',
    'x-client-secret': secretKey || '',
    'x-api-version': CASHFREE_API_VERSION,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

/**
 * Creates a payment order in Cashfree Orders API
 * Endpoint: POST /pg/orders
 */
async function createCashfreeOrder({
  orderId,
  orderAmount,
  customerName,
  customerPhone,
  customerEmail,
  returnUrl,
  notifyUrl,
  orderNote
}) {
  // 1. If explicitly in mock mode, return mock order without external network call
  if (getIsMockMode()) {
    console.log(`💡 [Mock Mode] Created mock Cashfree order: ${orderId} (₹${orderAmount})`);
    const mockOrder = {
      cf_order_id: `mock_cf_${Date.now()}`,
      order_id: orderId,
      order_status: 'ACTIVE',
      order_amount: Number(orderAmount),
      order_currency: 'INR',
      payment_session_id: `session_mock_${Date.now()}_${orderId}`,
      customer_name: customerName,
      customer_phone: customerPhone,
      return_url: returnUrl,
      created_at: new Date()
    };
    mockOrders.set(orderId, mockOrder);
    return mockOrder;
  }

  // Fail closed: missing credentials must NEVER fall back to simulated payment.
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
    console.error('❌ Cashfree is not configured: CASHFREE_APP_ID/CASHFREE_SECRET_KEY missing. Refusing to create order.');
    const err = new Error('Payment gateway is not configured. Please try again later.');
    err.status = 500;
    throw err;
  }

  const endpoint = `${CASHFREE_BASE_URL}/pg/orders`;

  // Ensure clean 10-digit phone
  const cleanPhone = String(customerPhone).replace(/\D/g, '').slice(-10);

  // Customer ID must be alphanumeric and between 3 and 50 characters
  const customerId = `cust_${cleanPhone}_${Date.now().toString().slice(-6)}`;

  const payload = {
    order_id: orderId,
    order_amount: Number(orderAmount),
    order_currency: 'INR',
    customer_details: {
      customer_id: customerId,
      customer_name: customerName || 'Temple Devotee',
      customer_phone: cleanPhone,
      customer_email: customerEmail || 'devotee@temple.org'
    },
    order_meta: {
      return_url: returnUrl
    },
    order_note: orderNote || 'Nava Chandi Yagam Registration'
  };

  if (notifyUrl) {
    payload.order_meta.notify_url = notifyUrl;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.message || data.error || 'Failed to create Cashfree order';
    const err = new Error(errorMsg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

/**
 * Fetches order details from Cashfree Orders API
 * Endpoint: GET /pg/orders/{order_id}
 */
async function getCashfreeOrder(orderId) {
  // 1. If explicitly in mock mode, return order status from mock store
  // NOTE: never invent an amount for unknown orders (would mask variable-total bugs).
  if (getIsMockMode()) {
    const order = mockOrders.get(orderId);
    if (!order) {
      console.log(`💡 [Mock Mode] Order ${orderId} not found in mock store, returning ACTIVE with unknown amount`);
      return {
        order_id: orderId,
        order_status: 'ACTIVE',
        order_amount: null
      };
    }
    return order;
  }

  // Fail closed: never query the gateway without credentials, never fall back to mock.
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
    console.error('❌ Cashfree is not configured: CASHFREE_APP_ID/CASHFREE_SECRET_KEY missing. Refusing to verify order.');
    const err = new Error('Payment gateway is not configured. Please try again later.');
    err.status = 500;
    throw err;
  }

  const endpoint = `${CASHFREE_BASE_URL}/pg/orders/${encodeURIComponent(orderId)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: getHeaders()
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.message || data.error || `Failed to fetch Cashfree order: ${orderId}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

/**
 * Allows simulating payment success or failure in mock mode.
 * Preserves the actual order amount; never invents 1000 for unknown orders.
 * Optional orderAmount lets tests simulate amount mismatches.
 */
function setMockOrderStatus(orderId, status = 'PAID', orderAmount = null) {
  if (mockOrders.has(orderId)) {
    const order = mockOrders.get(orderId);
    order.order_status = status;
    if (orderAmount !== null && orderAmount !== undefined) {
      order.order_amount = Number(orderAmount);
    }
    mockOrders.set(orderId, order);
    console.log(`💡 [Mock Mode] Order ${orderId} status set to: ${status}`);
    return order;
  } else {
    const newOrder = {
      order_id: orderId,
      order_status: status,
      order_amount: orderAmount !== null && orderAmount !== undefined ? Number(orderAmount) : null
    };
    mockOrders.set(orderId, newOrder);
    return newOrder;
  }
}

function setMockOrderAmount(orderId, orderAmount) {
  const order = mockOrders.get(orderId);
  if (order) {
    order.order_amount = Number(orderAmount);
    mockOrders.set(orderId, order);
    return order;
  }
  return setMockOrderStatus(orderId, 'ACTIVE', orderAmount);
}

/**
 * Cryptographically verifies Cashfree webhook signature using HMAC-SHA256
 * Signature data = timestamp + rawBody
 */
function verifyWebhookSignature(signature, timestamp, rawBody) {
  if (!signature || !timestamp || !rawBody) {
    return false;
  }

  const secretKey = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;
  if (!secretKey) {
    if (!getIsMockMode()) {
      console.error('❌ Cannot verify webhook: CASHFREE_WEBHOOK_SECRET or CASHFREE_SECRET_KEY is not configured');
    }
    return false;
  }

  try {
    const signatureData = timestamp + rawBody;
    const computedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(signatureData)
      .digest('base64');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const computedBuffer = Buffer.from(computedSignature, 'utf8');

    if (signatureBuffer.length !== computedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
  } catch (err) {
    console.error('Error verifying webhook signature:', err);
    return false;
  }
}

module.exports = {
  createCashfreeOrder,
  getCashfreeOrder,
  setMockOrderStatus,
  setMockOrderAmount,
  verifyWebhookSignature,
  CASHFREE_BASE_URL,
  CASHFREE_ENV,
  get isMockMode() { return getIsMockMode(); },
  getIsMockMode
};
