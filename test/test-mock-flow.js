const assert = require('assert');
process.env.MOCK_MODE = 'true';

const app = require('../src/server');

let server;
const PORT = 3789;

async function runMockFlowTest() {
  console.log('\n🧪 Running End-to-End Mock Flow Test (Without PostgreSQL or Cashfree)...\n');

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. Submit Registration
    console.log('  1️⃣ Testing POST /api/register...');
    const regPayload = {
      name: 'Karthik Raja',
      mobile: '9876543210',
      email: 'karthik@temple.org',
      address: 'Senthampalayam, Kavindapadi',
      rasi: 'Mesha (Aries)',
      natchathiram: 'Ashwini',
      gothram: 'Shiva',
      member1: {
        name: 'Anitha',
        rasi: 'Simha (Leo)',
        natchathiram: 'Magha',
        gothram: 'Shiva'
      }
    };

    const regRes = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload)
    });

    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201, `Registration failed with status ${regRes.status}`);
    assert.strictEqual(regData.success, true);
    assert.ok(regData.registrationId.startsWith('NCY-'));
    assert.ok(regData.orderId.startsWith('order_NCY'));
    assert.ok(regData.mockCheckoutUrl.includes(regData.orderId));
    console.log(`     ✅ Registration Created: ${regData.registrationId} | Order: ${regData.orderId}`);

    const { registrationId, orderId } = regData;

    // 2. Query Mock Order Info
    console.log('  2️⃣ Testing GET /api/mock/order-info...');
    const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(orderId)}`);
    const infoData = await infoRes.json();
    assert.strictEqual(infoRes.status, 200);
    assert.strictEqual(infoData.order.name, 'Karthik Raja');
    assert.strictEqual(infoData.order.amount, 1000);
    console.log(`     ✅ Mock Order Info retrieved: Devotee = ${infoData.order.name}, Amount = ₹${infoData.order.amount}`);

    // 3. Verify Payment before paying (should be pending)
    console.log('  3️⃣ Testing GET /api/cashfree/verify (before payment)...');
    const preVerifyRes = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`);
    const preVerifyData = await preVerifyRes.json();
    assert.strictEqual(preVerifyRes.status, 200);
    assert.strictEqual(preVerifyData.status, 'pending');
    assert.strictEqual(preVerifyData.registrationId, registrationId);
    console.log(`     ✅ Pre-payment status is correctly 'pending'`);

    // 4. Simulate Payment
    console.log('  4️⃣ Testing POST /api/mock/pay (simulating payment)...');
    const payRes = await fetch(`${baseUrl}/api/mock/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, status: 'paid' })
    });
    const payData = await payRes.json();
    assert.strictEqual(payRes.status, 200);
    assert.strictEqual(payData.success, true);
    console.log(`     ✅ Simulated payment SUCCESS for order: ${orderId}`);

    // 5. Verify Payment after paying (should be paid)
    console.log('  5️⃣ Testing GET /api/cashfree/verify (after payment)...');
    const postVerifyRes = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`);
    const postVerifyData = await postVerifyRes.json();
    assert.strictEqual(postVerifyRes.status, 200);
    assert.strictEqual(postVerifyData.status, 'paid');
    assert.strictEqual(postVerifyData.registrationId, registrationId);
    console.log(`     ✅ Post-payment verification returned 'paid' for Registration ID: ${postVerifyData.registrationId}`);

    // 6. Admin Record Lookup
    console.log('  6️⃣ Testing GET /api/registrations/:registrationId...');
    const lookupRes = await fetch(`${baseUrl}/api/registrations/${encodeURIComponent(registrationId)}`);
    const lookupData = await lookupRes.json();
    assert.strictEqual(lookupRes.status, 200);
    assert.strictEqual(lookupData.registration.name, 'Karthik Raja');
    assert.strictEqual(String(lookupData.registration.payment_status).toUpperCase(), 'PAID');
    assert.strictEqual(lookupData.registration.members.length, 1);
    assert.strictEqual(lookupData.registration.members[0].name, 'Anitha');
    console.log(`     ✅ Devotee & family member details verified in mock database!`);

    // 7. Admin Summary
    console.log('  7️⃣ Testing GET /api/admin/summary...');
    const sumRes = await fetch(`${baseUrl}/api/admin/summary`);
    const sumData = await sumRes.json();
    assert.strictEqual(sumRes.status, 200);
    assert.strictEqual(sumData.stats.paid_registrations, '1');
    assert.strictEqual(sumData.stats.total_collected, '1000');
    console.log(`     ✅ Admin Stats: Paid Registrations = ${sumData.stats.paid_registrations}, Total Collected = ₹${sumData.stats.total_collected}`);

    console.log('\n🎉 ALL 7 END-TO-END MOCK FLOW TESTS PASSED!\n');

  } finally {
    server.close();
  }
}

runMockFlowTest().catch(err => {
  console.error('❌ Mock flow test failed:', err);
  if (server) server.close();
  process.exit(1);
});
