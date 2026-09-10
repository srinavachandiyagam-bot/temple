const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Save original env so we can restore after the non-mock safety case.
const origEnv = {
  MOCK_MODE: process.env.MOCK_MODE,
  MOCK_PAYMENT: process.env.MOCK_PAYMENT,
  CASHFREE_APP_ID: process.env.CASHFREE_APP_ID,
  CASHFREE_SECRET_KEY: process.env.CASHFREE_SECRET_KEY,
};

function restoreOrigEnv() {
  for (const [k, v] of Object.entries(origEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function enableMockMode() {
  process.env.MOCK_MODE = 'true';
  delete process.env.MOCK_PAYMENT;
}

function enableNonMockMode() {
  // Fail-closed: only explicit MOCK_MODE/MOCK_PAYMENT opt-in enables mock.
  process.env.MOCK_MODE = 'false';
  process.env.MOCK_PAYMENT = 'false';
  process.env.CASHFREE_APP_ID = 'LIVE_REAL_KEY_1234567890';
  process.env.CASHFREE_SECRET_KEY = 'live_secret_for_routing_test_123456';
}

function enableNonMockMissingCreds() {
  // Production-lost-credentials scenario: flags false + no credentials.
  // Must still be non-mock (fail closed), never fall back to simulator.
  process.env.MOCK_MODE = 'false';
  process.env.MOCK_PAYMENT = 'false';
  delete process.env.CASHFREE_APP_ID;
  delete process.env.CASHFREE_SECRET_KEY;
}

function enableNonMockPlaceholderCreds() {
  // Placeholder-looking keys must NOT implicitly enable mock mode.
  process.env.MOCK_MODE = 'false';
  process.env.MOCK_PAYMENT = 'false';
  process.env.CASHFREE_APP_ID = 'TEST10000000000000000000000000000001';
  process.env.CASHFREE_SECRET_KEY = 'placeholder_secret_for_routing_test';
}

async function assertMockEndpointsBlocked(baseUrl, orderId, label) {
  const payRes = await fetch(`${baseUrl}/api/mock/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, status: 'paid' }),
  });
  await payRes.text();
  assert.strictEqual(payRes.status, 404, `${label}: POST /api/mock/pay should be 404 (got ${payRes.status})`);

  const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(orderId)}`);
  await infoRes.text();
  assert.strictEqual(infoRes.status, 404, `${label}: GET /api/mock/order-info should be 404 (got ${infoRes.status})`);

  const pageRes = await fetch(`${baseUrl}/mock-checkout?order_id=${encodeURIComponent(orderId)}`);
  await pageRes.text();
  assert.strictEqual(pageRes.status, 404, `${label}: GET /mock-checkout should be 404 (got ${pageRes.status})`);
}

// Must set mock mode BEFORE requiring server/db so the in-memory DB is used
// and no real Postgres/SQLite connection is attempted.
enableMockMode();

const app = require('../src/server');
const { getIsMockMode } = require('../src/config/cashfree');
const { query } = require('../src/config/db');
const requireMockMode = require('../src/middleware/requireMockMode');

let server;
const PORT = 3927;

async function getRegistrationStatusByOrderId(orderId) {
  const r = await query('SELECT payment_status FROM registrations WHERE cashfree_order_id = $1', [orderId]);
  if (r.rows.length === 0) return null;
  return r.rows[0].payment_status;
}

async function runMockRoutingTests() {
  console.log('\n🧪 Running Mock Checkout Routing & Mock API Safety Tests...\n');

  assert.strictEqual(getIsMockMode(), true, 'Precondition: expected mock mode to be enabled');

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
  const baseUrl = `http://localhost:${PORT}`;

  try {
    // ================================================================
    // CASE A — mock checkout route in mock mode
    // ================================================================
    console.log('  CASE A: GET /mock-checkout?order_id=test_order serves mock page...');
    {
      const res = await fetch(`${baseUrl}/mock-checkout?order_id=test_order`);
      const html = await res.text();
      assert.strictEqual(res.status, 200, `Expected 200 for /mock-checkout in mock mode, got ${res.status}`);
      assert.ok(html.includes('Simulate Success'), 'Mock checkout page should contain "Simulate Success"');
      assert.ok(
        html.includes('Mock Payment Gateway') || html.includes('Cashfree Mock Gateway') || html.includes('TEST / MOCK MODE'),
        'Mock checkout page should contain recognizable mock UI text'
      );
      // Must NOT return the public registration page (index.html has Cashfree SDK; mock page does not).
      assert.ok(
        !html.includes('sdk.cashfree.com/js/v3/cashfree.js'),
        'Mock checkout route must NOT return public/index.html (found Cashfree SDK marker)'
      );
      // Cross-check against the file on disk to prove it is mock-checkout.html.
      const expected = fs.readFileSync(path.join(__dirname, '../public/mock-checkout.html'), 'utf8');
      assert.ok(html.includes(expected.slice(0, 120).trim().slice(0, 60)), 'Response should match public/mock-checkout.html content');
      console.log('     ✅ CASE A passed: /mock-checkout serves mock-checkout.html, not index.html');
    }

    // ================================================================
    // CASE B — mock API works in mock mode
    // ================================================================
    console.log('  CASE B: full mock registration -> pay -> verify flow...');
    let orderId;
    let registrationId;
    {
      const regRes = await fetch(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Routing Test Devotee',
          mobile: '9000000091',
          email: 'routing@temple.org',
          address: 'Test Street',
          rasi: 'Mesha (Aries)',
          natchathiram: 'Ashwini',
          gothram: 'Shiva',
        }),
      });
      const regData = await regRes.json();
      assert.strictEqual(regRes.status, 201, `Registration failed: ${regRes.status} ${JSON.stringify(regData)}`);
      assert.strictEqual(regData.success, true);
      assert.ok(regData.mockCheckoutUrl && regData.mockCheckoutUrl.includes(regData.orderId));
      orderId = regData.orderId;
      registrationId = regData.registrationId;
      console.log(`     ✅ Registered ${registrationId} | ${orderId}`);

      const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(orderId)}`);
      const infoData = await infoRes.json();
      assert.strictEqual(infoRes.status, 200, `order-info failed: ${infoRes.status} ${JSON.stringify(infoData)}`);
      assert.strictEqual(infoData.success, true);
      assert.ok(infoData.order);
      console.log('     ✅ GET /api/mock/order-info works in mock mode');

      const payRes = await fetch(`${baseUrl}/api/mock/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, status: 'paid' }),
      });
      const payData = await payRes.json();
      assert.strictEqual(payRes.status, 200, `mock pay failed: ${payRes.status} ${JSON.stringify(payData)}`);
      assert.strictEqual(payData.success, true);
      console.log('     ✅ POST /api/mock/pay works in mock mode');

      const verifyRes = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`);
      const verifyData = await verifyRes.json();
      assert.strictEqual(verifyRes.status, 200, `verify failed: ${verifyRes.status} ${JSON.stringify(verifyData)}`);
      assert.strictEqual(verifyData.status, 'paid');
      assert.strictEqual(verifyData.registrationId, registrationId);
      console.log('     ✅ GET /api/cashfree/verify returns paid after mock pay');
    }

    // ================================================================
    // CASE C — production/non-mock safety (no real Cashfree calls)
    // ================================================================
    console.log('  CASE C: mock simulator must be unavailable when mock mode is false...');
    {
      // Create a fresh registration while still in mock mode.
      const regRes = await fetch(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Safety Check Devotee', mobile: '9000000092' }),
      });
      const regData = await regRes.json();
      assert.strictEqual(regRes.status, 201, `Safety registration failed: ${regRes.status} ${JSON.stringify(regData)}`);
      const safetyOrderId = regData.orderId;
      const beforeStatus = await getRegistrationStatusByOrderId(safetyOrderId);
      assert.ok(
        beforeStatus === 'pending' || beforeStatus === 'pending_payment',
        `Expected fresh registration to be pending/pending_payment, got ${beforeStatus}`
      );

      // Direct middleware unit check + route checks under non-mock env.
      enableNonMockMode();
      try {
        assert.strictEqual(getIsMockMode(), false, 'Precondition: expected mock mode to be DISABLED for CASE C');

        // 1. requireMockMode middleware directly blocks non-mock.
        {
          let statusCode = null;
          let jsonBody = null;
          let nextCalled = false;
          const req = {};
          const res = {
            status: (s) => { statusCode = s; return res; },
            json: (j) => { jsonBody = j; return res; },
          };
          requireMockMode(req, res, () => { nextCalled = true; });
          assert.strictEqual(nextCalled, false, 'requireMockMode must NOT call next() when mock mode is false');
          assert.strictEqual(statusCode, 404, `requireMockMode should return 404 when mock is off, got ${statusCode}`);
          assert.ok(jsonBody && jsonBody.error, 'requireMockMode 404 should include error body');
        }

        // 2. POST /api/mock/pay must NOT succeed and must NOT alter the registration.
        {
          const payRes = await fetch(`${baseUrl}/api/mock/pay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: safetyOrderId, status: 'paid' }),
          });
          // Drain body without assuming JSON shape.
          await payRes.text();
          assert.notStrictEqual(payRes.status, 200, `POST /api/mock/pay must NOT succeed in non-mock mode (got ${payRes.status})`);
          assert.strictEqual(payRes.status, 404, `POST /api/mock/pay should return 404 in non-mock mode (got ${payRes.status})`);
          console.log('     ✅ POST /api/mock/pay blocked with 404 in non-mock mode');
        }

        // 3. GET /api/mock/order-info must be unavailable (must not leak registration details).
        {
          const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(safetyOrderId)}`);
          await infoRes.text();
          assert.notStrictEqual(infoRes.status, 200, `GET /api/mock/order-info must NOT succeed in non-mock mode (got ${infoRes.status})`);
          assert.strictEqual(infoRes.status, 404, `GET /api/mock/order-info should return 404 in non-mock mode (got ${infoRes.status})`);
          console.log('     ✅ GET /api/mock/order-info blocked with 404 in non-mock mode');
        }

        // 4. Mock checkout page must not expose a usable simulator in non-mock mode.
        {
          const pageRes = await fetch(`${baseUrl}/mock-checkout?order_id=${encodeURIComponent(safetyOrderId)}`);
          await pageRes.text();
          assert.strictEqual(pageRes.status, 404, `GET /mock-checkout should return 404 in non-mock mode (got ${pageRes.status})`);
          console.log('     ✅ GET /mock-checkout blocked with 404 in non-mock mode');
        }
      } finally {
        // Restore mock mode BEFORE verifying DB state, so reads use the mock helper path.
        enableMockMode();
      }

      // 5. Registration must remain unmodified (still pending-like, not paid).
      {
        assert.strictEqual(getIsMockMode(), true, 'Mock mode should be restored before DB check');
        const afterStatus = await getRegistrationStatusByOrderId(safetyOrderId);
        assert.strictEqual(afterStatus, beforeStatus, `Blocked mock pay must NOT alter registration (before=${beforeStatus}, after=${afterStatus})`);
        assert.notStrictEqual(afterStatus, 'paid', 'Blocked mock pay must NOT mark registration as paid');
        console.log('     ✅ Blocked mock pay did not alter registration (still pending)');
      }

      // 6. Missing credentials must NOT enable mock (fail closed, no real Cashfree call).
      {
        enableNonMockMissingCreds();
        try {
          assert.strictEqual(getIsMockMode(), false, 'Missing creds with flags false must be non-mock');
          await assertMockEndpointsBlocked(baseUrl, safetyOrderId, 'missing-creds');
          console.log('     ✅ Missing CASHFREE_APP_ID does not enable mock; simulator stays 404');
        } finally {
          enableMockMode();
        }
        const statusAfterMissing = await getRegistrationStatusByOrderId(safetyOrderId);
        assert.notStrictEqual(statusAfterMissing, 'paid', 'Missing-creds blocked pay must not mark paid');
      }

      // 7. Placeholder credentials must NOT implicitly enable mock mode.
      {
        enableNonMockPlaceholderCreds();
        try {
          assert.strictEqual(getIsMockMode(), false, 'Placeholder creds with flags false must be non-mock');
          await assertMockEndpointsBlocked(baseUrl, safetyOrderId, 'placeholder-creds');
          console.log('     ✅ Placeholder CASHFREE_APP_ID does not enable mock; simulator stays 404');
        } finally {
          enableMockMode();
        }
        const statusAfterPlaceholder = await getRegistrationStatusByOrderId(safetyOrderId);
        assert.notStrictEqual(statusAfterPlaceholder, 'paid', 'Placeholder-creds blocked pay must not mark paid');
      }
    }

    console.log('\n🎉 ALL MOCK ROUTING & SAFETY TESTS PASSED!\n');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    restoreOrigEnv();
  }
}

runMockRoutingTests().catch((err) => {
  console.error('❌ Mock routing test failed:', err);
  try { restoreOrigEnv(); } catch (e) {}
  if (server) {
    try { server.close(); } catch (e) {}
  }
  process.exit(1);
});
