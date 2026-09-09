const assert = require('assert');
const app = require('../src/server');

let server;
const PORT = 3456;

async function runServerTests() {
  console.log('\n🌐 Running Express Server API Integration Tests...\n');
  let passed = 0;
  let total = 0;

  function check(name, ok, msg) {
    total++;
    if (ok) {
      passed++;
      console.log(`  ✅ Passed: ${name}`);
    } else {
      console.error(`  ❌ Failed: ${name} - ${msg}`);
    }
  }

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. Test GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    check('Healthcheck endpoint (/health) returns 200 OK', healthRes.status === 200 && healthData.status === 'ok');

    // 2. Test POST /api/register validation failure
    const regRes = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' })
    });
    const regData = await regRes.json();
    check('POST /api/register with empty name returns 400', regRes.status === 400 && regData.success === false);

    // 3. Test GET /api/cashfree/verify without order_id parameter
    const verifyRes = await fetch(`${baseUrl}/api/cashfree/verify`);
    const verifyData = await verifyRes.json();
    check('GET /api/cashfree/verify without order_id returns 400', verifyRes.status === 400 && !!verifyData.error);

    // 4. Test POST /api/cashfree/webhook with missing signature returns 401
    const webhookRes = await fetch(`${baseUrl}/api/cashfree/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { order: { order_id: 'test' } } })
    });
    check('POST /api/cashfree/webhook without valid signature returns 401', webhookRes.status === 401);

    // 5. Test frontend static page serving
    const frontendRes = await fetch(`${baseUrl}/`);
    const frontendHtml = await frontendRes.text();
    check('Static frontend serves index.html with Cashfree SDK', frontendRes.status === 200 && frontendHtml.includes('sdk.cashfree.com/js/v3/cashfree.js'));

  } finally {
    server.close();
  }

  console.log(`\nServer Integration Test Results: ${passed} / ${total} passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runServerTests();
