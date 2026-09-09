const assert = require('assert');
process.env.MOCK_MODE = 'true';
process.env.ADMIN_PASSWORD = 'change-this-password';

const app = require('../src/server');

let server;
const PORT = 3892;

async function runRoleTests() {
  console.log('\n👑 Running Role-Based Admin Management Integration Tests...\n');

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  try {
    // 1. Super Admin login with username & password
    const superLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'change-this-password' })
    });
    const superLoginData = await superLoginRes.json();
    assert.strictEqual(superLoginRes.status, 200, 'Super admin login should return 200');
    assert.ok(superLoginData.token, 'Super admin should receive auth token');
    assert.strictEqual(superLoginData.user.role, 'super_admin', 'Role should be super_admin');
    const superToken = superLoginData.token;
    const superUserId = superLoginData.user.id;
    console.log('  ✅ Passed: Super Admin logged in with username & password (role: super_admin)');

    // 2. Super Admin lists admin users
    const listRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${superToken}` }
    });
    const listData = await listRes.json();
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listData.admins));
    assert.ok(listData.admins.some(a => a.username === 'superadmin'));
    console.log(`  ✅ Passed: Super Admin listed ${listData.admins.length} admin account(s)`);

    // 3. Super Admin creates a secondary Admin
    const createRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superToken}`
      },
      body: JSON.stringify({
        username: 'templemanager',
        name: 'Temple Desk Manager (கோயில் மேலாளர்)',
        password: 'DeskPassword456',
        role: 'admin'
      })
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 201, 'Admin creation should return 201');
    assert.strictEqual(createData.admin.username, 'templemanager');
    assert.strictEqual(createData.admin.role, 'admin');
    const secondaryAdminId = createData.admin.id;
    console.log(`  ✅ Passed: Super Admin created secondary admin "${createData.admin.username}" (ID: ${secondaryAdminId})`);

    // 4. Secondary Admin logs in
    const secLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'templemanager', password: 'DeskPassword456' })
    });
    const secLoginData = await secLoginRes.json();
    assert.strictEqual(secLoginRes.status, 200);
    assert.strictEqual(secLoginData.user.role, 'admin');
    const secToken = secLoginData.token;
    console.log('  ✅ Passed: Secondary Admin logged in successfully (role: admin)');

    // 5. Secondary Admin CAN access normal admin endpoints (registrations, settings)
    const regRes = await fetch(`${baseUrl}/api/registrations`, {
      headers: { Authorization: `Bearer ${secToken}` }
    });
    assert.strictEqual(regRes.status, 200, 'Secondary admin should be able to view registrations');
    console.log('  ✅ Passed: Secondary Admin authorized to access standard admin routes');

    // 6. Secondary Admin FORBIDDEN from listing admin users (403)
    const secListRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${secToken}` }
    });
    assert.strictEqual(secListRes.status, 403, 'Secondary admin listing admins should return 403');
    console.log('  ✅ Passed: Secondary Admin rejected with 403 on GET /api/admin/users');

    // 7. Secondary Admin FORBIDDEN from creating an admin (403)
    const secCreateRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secToken}`
      },
      body: JSON.stringify({
        username: 'hackeradmin',
        name: 'Unauthorized Admin',
        password: 'password123',
        role: 'admin'
      })
    });
    assert.strictEqual(secCreateRes.status, 403, 'Secondary admin creating admin should return 403');
    console.log('  ✅ Passed: Secondary Admin rejected with 403 on POST /api/admin/users');

    // 8. Secondary Admin FORBIDDEN from deleting an admin (403)
    const secDeleteRes = await fetch(`${baseUrl}/api/admin/users/${superUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secToken}` }
    });
    assert.strictEqual(secDeleteRes.status, 403, 'Secondary admin deleting admin should return 403');
    console.log('  ✅ Passed: Secondary Admin rejected with 403 on DELETE /api/admin/users/:id');

    // 9. Super Admin cannot delete their own account
    const selfDeleteRes = await fetch(`${baseUrl}/api/admin/users/${superUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${superToken}` }
    });
    assert.strictEqual(selfDeleteRes.status, 400);
    const selfDelData = await selfDeleteRes.json();
    assert.ok(selfDelData.error.includes('cannot delete your own admin account'));
    console.log('  ✅ Passed: Super Admin self-deletion prevented with 400 Bad Request');

    // 10. Super Admin successfully deletes secondary Admin
    const delRes = await fetch(`${baseUrl}/api/admin/users/${secondaryAdminId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${superToken}` }
    });
    assert.strictEqual(delRes.status, 200);
    console.log(`  ✅ Passed: Super Admin deleted secondary admin ID: ${secondaryAdminId}`);

    // 11. Deleted Secondary Admin cannot login anymore
    const postDelLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'templemanager', password: 'DeskPassword456' })
    });
    assert.strictEqual(postDelLoginRes.status, 401);
    console.log('  ✅ Passed: Deleted secondary admin credentials properly rejected with 401');

    // 12. Legacy backwards-compatible password-only login still works
    const legacyLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'change-this-password' })
    });
    assert.strictEqual(legacyLoginRes.status, 200);
    const legacyData = await legacyLoginRes.json();
    assert.ok(legacyData.token);
    assert.strictEqual(legacyData.user.role, 'super_admin');
    console.log('  ✅ Passed: Legacy password-only login successfully authenticates as Super Admin');

    console.log('\n🎉 ALL 12 ROLE-BASED ADMIN MANAGEMENT TESTS PASSED!\n');
  } catch (err) {
    console.error('❌ Role-based admin test failed:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

runRoleTests();
