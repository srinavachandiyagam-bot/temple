const assert = require('assert');
process.env.MOCK_MODE = 'true';
process.env.ADMIN_PASSWORD = 'change-this-password';

const app = require('../src/server');

let server;
const PORT = 3890;

async function runAdminTests() {
  console.log('\n🔐 Running Admin Panel & API Integration Tests...\n');

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. Test Admin Panel HTML route
    const adminPageRes = await fetch(`${baseUrl}/admin`);
    const adminHtml = await adminPageRes.text();
    assert.strictEqual(adminPageRes.status, 200);
    assert.ok(adminHtml.includes('Temple Admin Panel'));
    console.log('  ✅ Passed: GET /admin serves the admin panel HTML');

    // 2. Test Login Failure
    const badLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
    assert.strictEqual(badLoginRes.status, 401);
    console.log('  ✅ Passed: POST /api/login with invalid password rejected with 401');

    // 3. Test Login Success
    const goodLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'change-this-password' })
    });
    const loginData = await goodLoginRes.json();
    assert.strictEqual(goodLoginRes.status, 200);
    assert.ok(loginData.token);
    const token = loginData.token;
    console.log('  ✅ Passed: POST /api/login succeeded with valid token');

    // 4. Test Authenticated Route /api/admin/me
    const meRes = await fetch(`${baseUrl}/api/admin/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const meData = await meRes.json();
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meData.authenticated, true);
    console.log('  ✅ Passed: GET /api/admin/me returns authenticated status');

    // 5. Test Public Data
    const pubRes = await fetch(`${baseUrl}/api/public`);
    const pubData = await pubRes.json();
    assert.strictEqual(pubRes.status, 200);
    assert.ok(pubData.settings.page_title_ta);
    console.log('  ✅ Passed: GET /api/public returns settings & media');

    // 6. Test Settings Update
    const updateRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        tagline_en: 'Special Nava Chandi Yagam Worship 2026'
      })
    });
    const updateData = await updateRes.json();
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateData.settings.tagline_en, 'Special Nava Chandi Yagam Worship 2026');
    console.log('  ✅ Passed: POST /api/settings updates settings successfully');

        // 7. Test PhonePe Status
    const ppStatusRes = await fetch(`${baseUrl}/api/phonepe/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const ppStatusData = await ppStatusRes.json();
    assert.strictEqual(ppStatusRes.status, 200);
    assert.ok(ppStatusData.environment);
    console.log('  ✅ Passed: GET /api/phonepe/status returns status info');

    // 8. Test Registrations List (protected)
    const regsRes = await fetch(`${baseUrl}/api/registrations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const regsData = await regsRes.json();
    assert.strictEqual(regsRes.status, 200);
    assert.ok(Array.isArray(regsData));
    console.log('  ✅ Passed: GET /api/registrations returns registrations list');

    // 9. Test CSV Export
    const csvRes = await fetch(`${baseUrl}/api/export.csv`);
    const csvText = await csvRes.text();
    assert.strictEqual(csvRes.status, 200);
    assert.ok(csvText.includes('Registration ID'));
    console.log('  ✅ Passed: GET /api/export.csv returns CSV export');

    console.log('\n🎉 ALL 9 ADMIN PANEL API TESTS PASSED!\n');

  } finally {
    server.close();
  }
}

runAdminTests().catch(err => {
  console.error('❌ Admin test failed:', err);
  if (server) server.close();
  process.exit(1);
});
