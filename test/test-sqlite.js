const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Configure test environment to use SQLite (NOT mock mode, NOT postgres)
const testDbPath = path.join(__dirname, '../data/test_sqlite.db');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

process.env.MOCK_MODE = 'false';
process.env.MOCK_PAYMENT = 'true';
process.env.DATABASE_URL = '';
process.env.SQLITE_DB_PATH = testDbPath;
process.env.ADMIN_PASSWORD = 'change-this-password';

const { query, isSqlite, isMockMode, isPostgres } = require('../src/config/db');
const app = require('../src/server');

let server;
const PORT = 3987;

async function runSqliteTests() {
  console.log('\n🗄️ Running Persistent SQLite Database Integration Tests...\n');

  assert.strictEqual(isMockMode, false, 'Expected isMockMode to be false');
  assert.strictEqual(isPostgres, false, 'Expected isPostgres to be false');
  assert.strictEqual(isSqlite, true, 'Expected isSqlite to be true');

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. Verify tables exist in SQLite
    console.log('  1️⃣ Verifying SQLite schema tables...');
    const tableRes = await query(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('registrations', 'registration_members', 'admin_users')
    `);
    assert.strictEqual(tableRes.rows.length, 3, 'Expected registrations, registration_members, and admin_users tables');
    console.log('     ✅ Tables registrations, registration_members, and admin_users verified in SQLite!');

    // 2. Submit Registration via API
    console.log('  2️⃣ Testing POST /api/register to persistent SQLite...');
    const regPayload = {
      name: 'Venkatesh Kumar',
      mobile: '9842154321',
      email: 'venkat@temple.org',
      address: 'Kavindapadi, Erode',
      rasi: 'Rishabha (Taurus)',
      natchathiram: 'Rohini',
      gothram: 'Kashyapa',
      member1: {
        name: 'Deepa',
        rasi: 'Kanya (Virgo)',
        natchathiram: 'Hasta',
        gothram: 'Kashyapa'
      },
      member2: {
        name: 'Rithvik',
        rasi: 'Mithuna (Gemini)',
        natchathiram: 'Ardra',
        gothram: 'Kashyapa'
      }
    };

    const regRes = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload)
    });

    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201, `Register returned ${regRes.status}: ${JSON.stringify(regData)}`);
    assert.strictEqual(regData.success, true);
    assert.ok(regData.registrationId.startsWith('NCY-'));
    assert.ok(regData.orderId.startsWith('order_NCY'));

    const { registrationId, orderId } = regData;
    console.log(`     ✅ Registration Created: ${registrationId} | Order: ${orderId}`);

    // 3. Query Database directly to verify record was inserted into SQLite
    console.log('  3️⃣ Directly querying SQLite database...');
    const dbCheck = await query('SELECT * FROM registrations WHERE registration_id = $1', [registrationId]);
    assert.strictEqual(dbCheck.rows.length, 1);
    assert.strictEqual(dbCheck.rows[0].name, 'Venkatesh Kumar');
    assert.strictEqual(String(dbCheck.rows[0].payment_status).toUpperCase(), 'PENDING');
    assert.strictEqual(Number(dbCheck.rows[0].amount), 999);

    const membersCheck = await query('SELECT * FROM registration_members WHERE registration_id = $1 ORDER BY member_number ASC', [dbCheck.rows[0].id]);
    assert.strictEqual(membersCheck.rows.length, 2);
    assert.strictEqual(membersCheck.rows[0].name, 'Deepa');
    assert.strictEqual(membersCheck.rows[1].name, 'Rithvik');
    console.log('     ✅ Direct SQLite verification passed: devotee + 2 family members saved!');

    // 4. Devotee Lookup via public API
    console.log('  4️⃣ Testing GET /api/registrations/:registrationId...');
    const lookupRes = await fetch(`${baseUrl}/api/registrations/${encodeURIComponent(registrationId)}`);
    const lookupData = await lookupRes.json();
    assert.strictEqual(lookupRes.status, 200);
    assert.strictEqual(lookupData.registration.name, 'Venkatesh Kumar');
    assert.strictEqual(lookupData.registration.members.length, 2);
    console.log('     ✅ Public API lookup verified devotee and family from SQLite!');

    // 5. Admin Login & Registration list
    console.log('  5️⃣ Testing Admin Login & GET /api/registrations...');
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'change-this-password' })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200);
    const token = loginData.token;

    const listRes = await fetch(`${baseUrl}/api/registrations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const listData = await listRes.json();
    assert.strictEqual(listRes.status, 200);
    assert.ok(listData.length >= 1);
    const found = listData.find(r => r.registration_id === registrationId);
    assert.ok(found, 'Created registration not found in admin list');
    assert.strictEqual(found.family.length, 2);
    console.log(`     ✅ Admin list returned ${listData.length} registration(s) with family members!`);

    // 6. Update payment status via Admin PATCH
    console.log('  6️⃣ Testing Admin PATCH /api/registrations/:id to "paid"...');
    const patchRes = await fetch(`${baseUrl}/api/registrations/${found.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ payment_status: 'paid' })
    });
    assert.strictEqual(patchRes.status, 200);

    // 7. Verify Admin Summary
    console.log('  7️⃣ Testing GET /api/admin/summary...');
    const sumRes = await fetch(`${baseUrl}/api/admin/summary`);
    const sumData = await sumRes.json();
    assert.strictEqual(sumRes.status, 200);
    assert.ok(Number(sumData.stats.total_registrations) >= 1);
    assert.ok(Number(sumData.stats.paid_registrations) >= 1);
    assert.ok(Number(sumData.stats.total_collected) >= 999);
    console.log(`     ✅ Summary: Total = ${sumData.stats.total_registrations}, Paid = ${sumData.stats.paid_registrations}, Collected = ₹${sumData.stats.total_collected}`);

    // 8. Test CSV Export from SQLite
    console.log('  8️⃣ Testing GET /api/export.csv...');
    const csvRes = await fetch(`${baseUrl}/api/export.csv`);
    const csvText = await csvRes.text();
    assert.strictEqual(csvRes.status, 200);
    assert.ok(csvText.includes('Venkatesh Kumar'));
    assert.ok(csvText.includes('Deepa'));
    assert.ok(csvText.includes('Rithvik'));
    console.log('     ✅ CSV Export includes devotee and family details!');

    // 9. Test Role-based Admin management in persistent SQLite
    console.log('  9️⃣ Testing Admin Creation & Deletion in persistent SQLite...');
    const newAdminRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        username: 'sqlitedesk',
        name: 'SQLite Desk Officer',
        password: 'DeskPasswordSqlite123',
        role: 'admin'
      })
    });
    assert.strictEqual(newAdminRes.status, 201);
    const newAdminData = await newAdminRes.json();
    assert.strictEqual(newAdminData.admin.username, 'sqlitedesk');

    // Verify stored directly in SQLite
    const sqliteAdminCheck = await query('SELECT * FROM admin_users WHERE username = $1', ['sqlitedesk']);
    assert.strictEqual(sqliteAdminCheck.rows.length, 1);
    assert.strictEqual(sqliteAdminCheck.rows[0].role, 'admin');

    // Delete created admin
    const delAdminRes = await fetch(`${baseUrl}/api/admin/users/${newAdminData.admin.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(delAdminRes.status, 200);

    const postDelCheck = await query('SELECT * FROM admin_users WHERE username = $1', ['sqlitedesk']);
    assert.strictEqual(postDelCheck.rows.length, 0);
    console.log('     ✅ Persistent SQLite admin creation, direct query, and deletion verified!');

    console.log('\n🎉 ALL 9 SQLITE INTEGRATION TESTS PASSED!\n');

  } finally {
    server.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }
  }
}

runSqliteTests().catch(err => {
  console.error('❌ SQLite test failed:', err);
  if (server) server.close();
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (e) {}
  }
  process.exit(1);
});
