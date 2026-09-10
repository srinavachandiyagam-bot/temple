const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.MOCK_MODE = 'true';
process.env.ADMIN_PASSWORD = 'change-this-password';
process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret_for_archive_tests_456';

const app = require('../src/server');
const mockDb = require('../src/config/mockDb');
const { setMockOrderStatus } = require('../src/config/cashfree');
const { applyCashfreeStatusChange } = require('../src/controllers/paymentController');

let server;
const PORT = 3895;

let mobileCounter = 9200000000;
let nameCounter = 0;

function uniqueMobile() {
  mobileCounter += 1;
  return String(mobileCounter);
}

async function createRegistration(baseUrl, overrides = {}) {
  nameCounter += 1;
  const n = nameCounter;
  const payload = Object.assign(
    {
      name: `ArchiveTest Devotee ${n}`,
      mobile: uniqueMobile(),
      email: `archivetest${n}@temple.org`,
      address: 'Test Address',
      rasi: 'Mesha (Aries)',
      natchathiram: 'Ashwini',
      gothram: 'Shiva'
    },
    overrides
  );
  const res = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  assert.strictEqual(res.status, 201, `Setup registration failed: ${JSON.stringify(data)}`);
  return data; // { registrationId, orderId, ... }
}

async function getActiveMap(baseUrl, token) {
  const res = await fetch(`${baseUrl}/api/registrations`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.strictEqual(res.status, 200);
  const list = await res.json();
  const map = new Map();
  for (const r of list) map.set(r.registration_id, r);
  return { list, map };
}

async function getArchived(baseUrl, token) {
  const res = await fetch(`${baseUrl}/api/registrations/archived`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.strictEqual(res.status, 200, 'Super admin should read archived history');
  const data = await res.json();
  assert.strictEqual(data.success, true);
  return data.archived;
}

async function getAuditLog(baseUrl, token) {
  const res = await fetch(`${baseUrl}/api/registrations/audit-log`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.strictEqual(res.status, 200, 'Super admin should read audit log');
  const data = await res.json();
  assert.strictEqual(data.success, true);
  return data.audit;
}

function dbRegistrationByPublicId(registrationId) {
  return mockDb.registrations.find((r) => r.registration_id === registrationId) || null;
}

function dbMembersOf(dbId) {
  return (mockDb.members || []).filter((m) => Number(m.registration_id) === Number(dbId));
}

function dbAuditFor(dbId) {
  return (mockDb.auditLog || []).filter((e) => Number(e.registration_db_id) === Number(dbId));
}

async function runArchiveTests() {
  console.log('\n🗄️ Running Archive-Selected (soft-delete audit) Integration Tests...\n');

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;
  const ARCHIVE_URL = `${baseUrl}/api/registrations/archive-selected`;
  const REMOVED_ALIAS_URL = `${baseUrl}/api/registrations/delete-selected`;

  try {
    // ---- Auth setup ----
    const superLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'change-this-password' })
    });
    const superLogin = await superLoginRes.json();
    assert.strictEqual(superLoginRes.status, 200, 'Super admin login should succeed');
    const superToken = superLogin.token;
    assert.ok(superToken);

    const createSecRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({
        username: 'archivetestdesk',
        name: 'Archive Test Desk',
        password: 'DeskArchive1234',
        role: 'admin'
      })
    });
    assert.strictEqual(createSecRes.status, 201, 'Setup: create secondary admin');
    const secAdmin = await createSecRes.json();

    const secLoginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'archivetestdesk', password: 'DeskArchive1234' })
    });
    const secLogin = await secLoginRes.json();
    assert.strictEqual(secLoginRes.status, 200);
    const secToken = secLogin.token;
    assert.ok(secToken);

    const archive = (body, token, url) =>
      fetch(url || ARCHIVE_URL, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: `Bearer ${token}` } : {}
        ),
        body: JSON.stringify(body)
      });

    // ---- CASE 1: unauthenticated archive -> 401 ----
    {
      const r1 = await archive({ ids: [1], confirm: true }, null);
      assert.strictEqual(r1.status, 401, 'CASE 1: unauthenticated archive should return 401');
      console.log('  ✅ CASE 1: Unauthenticated archive rejected with 401');
    }

    // ---- CASE 2: normal admin -> 403 ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      assert.ok(target, 'Setup reg should be visible');
      const r = await archive({ ids: [target.id], confirm: true }, secToken);
      assert.strictEqual(r.status, 403, 'CASE 2: normal admin archive should return 403');
      const after = await getActiveMap(baseUrl, superToken);
      assert.ok(after.map.has(setup.registrationId), 'CASE 2: record must stay active');
      const dbRow = dbRegistrationByPublicId(setup.registrationId);
      assert.ok(dbRow && !dbRow.archived_at, 'CASE 2: archived_at must stay NULL');
      console.log('  ✅ CASE 2: Normal admin rejected with 403, record untouched');
    }

    // ---- CASE 3: invalid/empty IDs -> 400 ----
    {
      for (const bad of [{ ids: [], confirm: true }, { confirm: true }, { ids: null, confirm: true }]) {
        const r = await archive(bad, superToken);
        assert.strictEqual(r.status, 400, `CASE 3: ${JSON.stringify(bad)} should return 400`);
      }
      for (const ids of [[-1], [0], ['13'], [1.5], ['abc'], [null], [13.0, 'x']]) {
        const r = await archive({ ids, confirm: true }, superToken);
        assert.strictEqual(r.status, 400, `CASE 3: ids=${JSON.stringify(ids)} should return 400`);
      }
      for (const ids of ['13', 13, {}, true]) {
        const r = await archive({ ids, confirm: true }, superToken);
        assert.strictEqual(r.status, 400, `CASE 3: non-array ids should return 400`);
      }
      console.log('  ✅ CASE 3: Invalid/empty IDs rejected with 400');
    }

    // ---- CASE 4: confirm missing/false -> 400, nothing archived ----
    {
      const setup = await createRegistration(baseUrl);
      const before = await getActiveMap(baseUrl, superToken);
      const target = before.map.get(setup.registrationId);
      assert.ok(target);
      for (const body of [{ ids: [target.id] }, { ids: [target.id], confirm: false }, { ids: [target.id], confirm: 'true' }]) {
        const r = await archive(body, superToken);
        assert.strictEqual(r.status, 400, `CASE 4: ${JSON.stringify(body)} should return 400`);
      }
      const after = await getActiveMap(baseUrl, superToken);
      assert.ok(after.map.has(setup.registrationId), 'CASE 4: record must stay active');
      assert.ok(!dbRegistrationByPublicId(setup.registrationId).archived_at, 'CASE 4: archived_at stays NULL');
      console.log('  ✅ CASE 4: Missing/false confirm rejected with 400, nothing archived');
    }

    // ---- CASE 5: archive multiple; hidden from active view but stored ----
    let case5PublicIds = [];
    let case5DbIds = [];
    {
      const a = await createRegistration(baseUrl, {
        member1: { name: 'Archive Kid One' }
      });
      const b = await createRegistration(baseUrl);
      const c = await createRegistration(baseUrl);
      case5PublicIds = [a.registrationId, b.registrationId, c.registrationId];
      const { map } = await getActiveMap(baseUrl, superToken);
      case5DbIds = case5PublicIds.map((rid) => map.get(rid).id).sort((x, y) => x - y);

      const r = await archive({ ids: [...case5DbIds], confirm: true }, superToken);
      assert.strictEqual(r.status, 200, 'CASE 5: archive should return 200');
      const j = await r.json();
      assert.strictEqual(j.success, true);
      assert.strictEqual(j.archivedCount, 3, 'CASE 5: archivedCount should be 3');
      assert.deepStrictEqual([...j.archivedIds].sort((x, y) => x - y), case5DbIds);
      assert.deepStrictEqual(j.alreadyArchivedIds, []);

      const after = await getActiveMap(baseUrl, superToken);
      for (const rid of case5PublicIds) {
        assert.ok(!after.map.has(rid), `CASE 5: ${rid} hidden from active view`);
      }

      for (const rid of case5PublicIds) {
        const dbRow = dbRegistrationByPublicId(rid);
        assert.ok(dbRow, `CASE 5: ${rid} still directly present in registrations table`);
        assert.ok(dbRow.archived_at, `CASE 5: ${rid} archived_at populated`);
        assert.ok(dbRow.archived_by_admin_id !== null && dbRow.archived_by_admin_id !== undefined, 'CASE 5: actor id populated');
        assert.ok(dbRow.archived_by_username, 'CASE 5: actor username populated');
        assert.strictEqual(String(dbRow.archived_by_username), 'superadmin', 'CASE 5: actor from auth session');
      }
      console.log('  ✅ CASE 5: 3 archived (hidden from active view, stored with actor metadata)');
    }

    // ---- CASE 6: family members remain in database after archival ----
    {
      const dbRow = dbRegistrationByPublicId(case5PublicIds[0]);
      const members = dbMembersOf(dbRow.id);
      assert.strictEqual(members.length, 1, 'CASE 6: family member row must remain stored');
      assert.strictEqual(members[0].name, 'Archive Kid One');
      const archived = await getArchived(baseUrl, superToken);
      const entry = archived.find((x) => x.registration_id === case5PublicIds[0]);
      assert.ok(entry, 'CASE 6: archived view shows the record');
      assert.strictEqual((entry.family || []).length, 1, 'CASE 6: archived view exposes family');
      console.log('  ✅ CASE 6: Family members preserved after archival');
    }

    // ---- CASE 7: audit row exists for EVERY archived registration ----
    // (Each registration also carries its own CREATED event; exactly one
    // ARCHIVED event must exist per archived registration.)
    {
      for (const rid of case5PublicIds) {
        const dbRow = dbRegistrationByPublicId(rid);
        const events = dbAuditFor(dbRow.id).filter((e) => e.action === 'ARCHIVED');
        assert.strictEqual(events.length, 1, `CASE 7: exactly one ARCHIVED audit row for ${rid}`);
        assert.strictEqual(events[0].action, 'ARCHIVED');
        assert.strictEqual(String(events[0].actor_username), 'superadmin');
      }
      console.log('  ✅ CASE 7: ARCHIVED audit row exists for every archived registration');
    }

    // ---- CASE 8: audit snapshot contents ----
    {
      const dbRow = dbRegistrationByPublicId(case5PublicIds[0]);
      const events = dbAuditFor(dbRow.id).filter((e) => e.action === 'ARCHIVED');
      assert.strictEqual(events.length, 1, 'CASE 8: ARCHIVED event present');
      const snap = JSON.parse(events[0].snapshot_json);
      assert.strictEqual(snap.name, dbRow.name, 'CASE 8: snapshot participant name');
      assert.strictEqual(snap.mobile, dbRow.mobile, 'CASE 8: snapshot mobile');
      assert.strictEqual(snap.payment_status, dbRow.payment_status, 'CASE 8: snapshot payment status');
      assert.strictEqual(snap.cashfree_order_id, dbRow.cashfree_order_id, 'CASE 8: snapshot Cashfree order');
      assert.strictEqual(Number(snap.total_amount), Number(dbRow.amount), 'CASE 8: snapshot total');
      assert.strictEqual(Number(snap.donation_amount), Number(dbRow.donation_amount), 'CASE 8: snapshot donation');
      assert.ok(Array.isArray(snap.family_members) && snap.family_members.length === 1, 'CASE 8: snapshot family');
      assert.strictEqual(snap.family_members[0].name, 'Archive Kid One');
      assert.ok(snap.registration_id, 'CASE 8: snapshot registration_id');
      assert.ok(snap.created_at, 'CASE 8: snapshot timestamps');
      console.log('  ✅ CASE 8: Snapshot holds participant + family + payment + amounts + Cashfree order');
    }

    // ---- CASE 9: paid archival keeps paid status + order, no Cashfree call ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const patchRes = await fetch(`${baseUrl}/api/registrations/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
        body: JSON.stringify({ payment_status: 'paid' })
      });
      assert.strictEqual(patchRes.status, 200);
      const orderBefore = dbRegistrationByPublicId(setup.registrationId).cashfree_order_id;

      const r = await archive({ ids: [target.id], confirm: true }, superToken);
      assert.strictEqual(r.status, 200, 'CASE 9: paid archive should succeed');
      const j = await r.json();
      assert.strictEqual(j.archivedCount, 1);

      const dbRow = dbRegistrationByPublicId(setup.registrationId);
      assert.ok(dbRow && dbRow.archived_at, 'CASE 9: row stored with archived_at');
      assert.strictEqual(dbRow.payment_status, 'paid', 'CASE 9: original paid status retained');
      assert.strictEqual(dbRow.cashfree_order_id, orderBefore, 'CASE 9: Cashfree order id retained');

      const apiSrc = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
      const fnStart = apiSrc.indexOf('async function archiveSelectedRegistrations');
      assert.ok(fnStart !== -1, 'CASE 9: archive handler must exist');
      const nextRouter = apiSrc.indexOf('router.post', fnStart + 10);
      const routeBlock = apiSrc.substring(fnStart, nextRouter === -1 ? undefined : nextRouter);
      assert.ok(!/getCashfreeOrder|createCashfreeOrder|setMockOrderStatus|require\(['"][^'"]*cashfree/i.test(routeBlock), 'CASE 9: archive must not call Cashfree');
      console.log('  ✅ CASE 9: Paid archived with status + order retained, no Cashfree call');
    }

    // ---- CASE 10: re-archive is safe/idempotent ----
    {
      const dbRow = dbRegistrationByPublicId(case5PublicIds[1]);
      const firstStamp = dbRow.archived_at;
      const auditBefore = dbAuditFor(dbRow.id).length;
      const r = await archive({ ids: [dbRow.id], confirm: true }, superToken);
      assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.strictEqual(j.archivedCount, 0, 'CASE 10: nothing newly archived');
      assert.deepStrictEqual(j.archivedIds, []);
      assert.deepStrictEqual(j.alreadyArchivedIds, [dbRow.id]);
      assert.strictEqual(dbRegistrationByPublicId(case5PublicIds[1]).archived_at, firstStamp, 'CASE 10: original stamp preserved');
      assert.strictEqual(dbAuditFor(dbRow.id).length, auditBefore, 'CASE 10: no duplicate audit row');
      console.log('  ✅ CASE 10: Re-archive safe (no overwrite, no duplicate audit)');
    }

    // ---- CASE 11: non-selected active registration unchanged ----
    {
      const keep = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const keeperBefore = Object.assign({}, map.get(keep.registrationId));
      const other = await createRegistration(baseUrl);
      const otherId = (await getActiveMap(baseUrl, superToken)).map.get(other.registrationId).id;
      const r = await archive({ ids: [otherId], confirm: true }, superToken);
      assert.strictEqual(r.status, 200);
      const after = await getActiveMap(baseUrl, superToken);
      const keeperAfter = after.map.get(keep.registrationId);
      assert.ok(keeperAfter, 'CASE 11: non-selected stays in active view');
      assert.strictEqual(keeperAfter.name, keeperBefore.name, 'CASE 11: data unchanged');
      assert.ok(!dbRegistrationByPublicId(keep.registrationId).archived_at, 'CASE 11: archived_at stays NULL');
      console.log('  ✅ CASE 11: Non-selected registration unchanged');
    }

    // ---- CASE 12: unknown ID changes nothing ----
    {
      const before = await getActiveMap(baseUrl, superToken);
      const beforeCount = before.list.length;
      const dbCountBefore = mockDb.registrations.length;
      const auditCountBefore = mockDb.auditLog.length;
      const r = await archive({ ids: [999999999], confirm: true }, superToken);
      assert.strictEqual(r.status, 200);
      const j = await r.json();
      assert.strictEqual(j.archivedCount, 0);
      assert.deepStrictEqual(j.archivedIds, []);
      const after = await getActiveMap(baseUrl, superToken);
      assert.strictEqual(after.list.length, beforeCount, 'CASE 12: active list untouched');
      assert.strictEqual(mockDb.registrations.length, dbCountBefore, 'CASE 12: table untouched');
      assert.strictEqual(mockDb.auditLog.length, auditCountBefore, 'CASE 12: audit untouched');
      console.log('  ✅ CASE 12: Unknown ID changes nothing');
    }

    // ---- CASE 13: normal admin cannot access archived/audit -> 403 ----
    {
      const r1 = await fetch(`${baseUrl}/api/registrations/archived`, {
        headers: { Authorization: `Bearer ${secToken}` }
      });
      assert.strictEqual(r1.status, 403, 'CASE 13: archived view must be 403 for normal admin');
      const r2 = await fetch(`${baseUrl}/api/registrations/audit-log`, {
        headers: { Authorization: `Bearer ${secToken}` }
      });
      assert.strictEqual(r2.status, 403, 'CASE 13: audit log must be 403 for normal admin');
      console.log('  ✅ CASE 13: Archived/audit endpoints are super-admin-only (403)');
    }

    // ---- CASE 14: super admin can retrieve archived/audit history ----
    {
      const archived = await getArchived(baseUrl, superToken);
      assert.ok(archived.length >= 3, 'CASE 14: archived history lists records');
      const entry = archived.find((x) => x.registration_id === case5PublicIds[0]);
      assert.ok(entry, 'CASE 14: known archived record present');
      assert.ok(entry.archived_at, 'CASE 14: Archived At shown');
      assert.ok(entry.archived_by_username, 'CASE 14: Archived By shown');
      assert.ok(entry.created_at, 'CASE 14: original Created At shown');
      assert.ok(entry.audit_event, 'CASE 14: audit event attached');
      const audit = await getAuditLog(baseUrl, superToken);
      assert.ok(audit.length >= 3, 'CASE 14: audit log lists events');
      console.log('  ✅ CASE 14: Super admin reads archived + audit history');
    }

    // ---- CASE 15: dashboard excludes archived ----
    {
      const paid = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(paid.registrationId);
      await fetch(`${baseUrl}/api/registrations/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
        body: JSON.stringify({ payment_status: 'paid' })
      });
      const sumBefore = await (await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Authorization: `Bearer ${superToken}` }
      })).json();
      const totalBefore = Number(sumBefore.stats.total_registrations);
      const paidBefore = Number(sumBefore.stats.paid_registrations);
      const r = await archive({ ids: [target.id], confirm: true }, superToken);
      assert.strictEqual(r.status, 200);
      const sumAfter = await (await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Authorization: `Bearer ${superToken}` }
      })).json();
      assert.strictEqual(Number(sumAfter.stats.total_registrations), totalBefore - 1, 'CASE 15: totals drop by 1');
      assert.strictEqual(Number(sumAfter.stats.paid_registrations), paidBefore - 1, 'CASE 15: paid drops by 1');
      console.log('  ✅ CASE 15: Dashboard totals exclude archived registrations');
    }

    // ---- CASE 16: archived row itself remains directly present ----
    {
      for (const rid of case5PublicIds) {
        const dbRow = dbRegistrationByPublicId(rid);
        assert.ok(dbRow, `CASE 16: ${rid} present in database`);
        assert.ok(dbRow.registration_id && dbRow.name && dbRow.mobile, 'CASE 16: core fields preserved');
        assert.ok(dbRow.cashfree_order_id, 'CASE 16: Cashfree order preserved');
        assert.ok(dbRow.created_at, 'CASE 16: timestamps preserved');
      }
      // Archived public lookup is hidden operationally (404) without erasing.
      const lookup = await fetch(`${baseUrl}/api/registrations/${encodeURIComponent(case5PublicIds[0])}`);
      assert.strictEqual(lookup.status, 404, 'CASE 16: archived public lookup returns 404');
      console.log('  ✅ CASE 16: Rows persist in DB; public lookup hides archived (404)');
    }

    // ---- CASE 17: no physical removal inside the archive route ----
    {
      const apiSrc = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
      const fnStart = apiSrc.indexOf('async function archiveSelectedRegistrations');
      assert.ok(fnStart !== -1);
      const fnEnd = apiSrc.indexOf('router.post', fnStart + 10);
      const routeBlock = apiSrc.substring(fnStart, fnEnd === -1 ? undefined : fnEnd);
      assert.ok(!/DELETE\s+FROM\s+registrations/i.test(routeBlock), 'CASE 17: no registrations removal in archive route');
      assert.ok(!/DELETE\s+FROM\s+registration_members/i.test(routeBlock), 'CASE 17: no members removal in archive route');
      console.log('  ✅ CASE 17: Archive route contains no physical removal');
    }

    // ---- CASE 18: no purge/delete-audit API route ----
    {
      const apiSrc = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
      const routePaths = [...apiSrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi)];
      for (const m of routePaths) {
        const method = m[1].toLowerCase();
        const routePath = m[2].toLowerCase();
        assert.ok(!routePath.includes('purge'), `CASE 18: no purge route (${m[2]})`);
        assert.ok(!routePath.includes('empty-trash'), `CASE 18: no empty-trash route (${m[2]})`);
        assert.ok(!routePath.includes('permanent'), `CASE 18: no permanent-delete route (${m[2]})`);
        if (routePath.includes('audit')) {
          assert.ok(method === 'get', `CASE 18: audit routes must be read-only (${method} ${m[2]})`);
        }
      }
      console.log('  ✅ CASE 18: No purge / erase-history endpoint exists');
    }

    // ---- CASE A: CSV without auth -> 401 ----
    {
      const r = await fetch(`${baseUrl}/api/export.csv`);
      assert.strictEqual(r.status, 401, 'CASE A: unauthenticated CSV should return 401');
      console.log('  ✅ CASE A: Unauthenticated CSV rejected with 401');
    }

    // ---- CASE B: authenticated CSV -> 200, active records only ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const beforeRes = await fetch(`${baseUrl}/api/export.csv`, {
        headers: { Authorization: `Bearer ${superToken}` }
      });
      assert.strictEqual(beforeRes.status, 200, 'CASE B: authenticated CSV should return 200');
      const beforeCsv = await beforeRes.text();
      assert.ok(beforeCsv.includes(setup.registrationId), 'CASE B: active record in CSV');
      const r = await archive({ ids: [target.id], confirm: true }, superToken);
      assert.strictEqual(r.status, 200);
      const afterCsv = await (await fetch(`${baseUrl}/api/export.csv`, {
        headers: { Authorization: `Bearer ${superToken}` }
      })).text();
      assert.ok(!afterCsv.includes(setup.registrationId), 'CASE B: archived record excluded from CSV');
      // Normal admin may also download the active CSV.
      const secCsv = await fetch(`${baseUrl}/api/export.csv`, {
        headers: { Authorization: `Bearer ${secToken}` }
      });
      assert.strictEqual(secCsv.status, 200, 'CASE B: normal admin CSV should return 200');
      console.log('  ✅ CASE B: Authenticated CSV works, archived rows excluded');
    }

    // ---- CASE C: summary without auth -> 401 ----
    {
      const r = await fetch(`${baseUrl}/api/admin/summary`);
      assert.strictEqual(r.status, 401, 'CASE C: unauthenticated summary should return 401');
      console.log('  ✅ CASE C: Unauthenticated summary rejected with 401');
    }

    // ---- CASE D: authenticated summary -> 200 ----
    {
      const superSum = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Authorization: `Bearer ${superToken}` }
      });
      assert.strictEqual(superSum.status, 200, 'CASE D: super admin summary should return 200');
      const secSum = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Authorization: `Bearer ${secToken}` }
      });
      assert.strictEqual(secSum.status, 200, 'CASE D: normal admin summary should return 200');
      console.log('  ✅ CASE D: Authenticated summary works for both roles');
    }

    // ---- CASE E: normal admin manual status change is audited ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const oldStatus = dbRegistrationByPublicId(setup.registrationId).payment_status;
      assert.notStrictEqual(oldStatus, 'paid', 'CASE E: precondition non-paid');
      const auditBefore = dbAuditFor(dbId).length;
      const r = await fetch(`${baseUrl}/api/registrations/${dbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ payment_status: 'paid' })
      });
      assert.strictEqual(r.status, 200, 'CASE E: manual change should succeed');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, 'paid', 'CASE E: row changed');
      const events = dbAuditFor(dbId).slice(auditBefore);
      const manual = events.filter((e) => e.action === 'PAYMENT_STATUS_MANUAL_CHANGE');
      assert.strictEqual(manual.length, 1, 'CASE E: exactly one manual-change event');
      assert.strictEqual(String(manual[0].actor_username), 'archivetestdesk', 'CASE E: actor from session');
      const snap = JSON.parse(manual[0].snapshot_json);
      assert.strictEqual(snap.before_payment_status, oldStatus, 'CASE E: before value');
      assert.strictEqual(snap.after_payment_status, 'paid', 'CASE E: after value');
      assert.strictEqual(snap.source, 'admin_manual', 'CASE E: source marker');
      console.log('  ✅ CASE E: Manual status change audited with actor + before/after');
    }

    // ---- CASE F: invalid payment status -> 400, no change, no audit ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const before = dbRegistrationByPublicId(setup.registrationId).payment_status;
      const auditBefore = dbAuditFor(dbId).length;
      const r = await fetch(`${baseUrl}/api/registrations/${dbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
        body: JSON.stringify({ payment_status: 'bogus_status' })
      });
      assert.strictEqual(r.status, 400, 'CASE F: invalid status should return 400');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, before, 'CASE F: row unchanged');
      assert.strictEqual(dbAuditFor(dbId).length, auditBefore, 'CASE F: no audit entry');
      console.log('  ✅ CASE F: Invalid status rejected with 400, nothing changed');
    }

    // ---- CASE G: same status -> success, no duplicate event ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const current = dbRegistrationByPublicId(setup.registrationId).payment_status;
      const auditBefore = dbAuditFor(dbId).length;
      const r = await fetch(`${baseUrl}/api/registrations/${dbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
        body: JSON.stringify({ payment_status: current })
      });
      assert.strictEqual(r.status, 200, 'CASE G: same-status change should succeed');
      assert.strictEqual(dbAuditFor(dbId).length, auditBefore, 'CASE G: no duplicate audit event');
      console.log('  ✅ CASE G: Same-status change creates no duplicate event');
    }

    // ---- CASE H: PATCH archived registration -> 409, row unchanged ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const arch = await archive({ ids: [dbId], confirm: true }, superToken);
      assert.strictEqual(arch.status, 200);
      const statusBefore = dbRegistrationByPublicId(setup.registrationId).payment_status;
      const auditBefore = dbAuditFor(dbId).length;
      const r = await fetch(`${baseUrl}/api/registrations/${dbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
        body: JSON.stringify({ payment_status: 'paid' })
      });
      assert.strictEqual(r.status, 409, 'CASE H: archived PATCH should return 409');
      const j = await r.json();
      assert.ok(String(j.error || '').includes('read-only'), 'CASE H: read-only message');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, statusBefore, 'CASE H: stored row unchanged');
      assert.strictEqual(dbAuditFor(dbId).length, auditBefore, 'CASE H: no audit entry for rejected change');
      // Sync on archived must also refuse without mutating.
      const syncRes = await fetch(`${baseUrl}/api/registrations/${dbId}/sync-cashfree`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${superToken}` }
      });
      assert.strictEqual(syncRes.status, 409, 'CASE H: archived sync should return 409');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, statusBefore, 'CASE H: sync changed nothing');
      console.log('  ✅ CASE H: Archived rows immutable via PATCH and sync (409)');
    }

    // ---- CASE I: cashfree sync change creates sync audit event ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      setMockOrderStatus(setup.orderId, 'PAID');
      const auditBefore = dbAuditFor(dbId).length;
      const r = await fetch(`${baseUrl}/api/registrations/${dbId}/sync-cashfree`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${superToken}` }
      });
      assert.strictEqual(r.status, 200, 'CASE I: sync should succeed');
      const j = await r.json();
      assert.strictEqual(j.status, 'paid', 'CASE I: synced to paid');
      const events = dbAuditFor(dbId).slice(auditBefore).filter((e) => e.action === 'PAYMENT_CASHFREE_SYNC');
      assert.strictEqual(events.length, 1, 'CASE I: exactly one sync event');
      assert.strictEqual(String(events[0].actor_username), 'superadmin', 'CASE I: admin actor retained');
      const snap = JSON.parse(events[0].snapshot_json);
      assert.strictEqual(snap.after_payment_status, 'paid', 'CASE I: after value');
      assert.strictEqual(snap.cashfree_order_id, setup.orderId, 'CASE I: order recorded');
      console.log('  ✅ CASE I: Sync change audited with admin actor');
    }

    // ---- CASE J: verify/webhook changes create system audit events ----
    {
      const secret = process.env.CASHFREE_WEBHOOK_SECRET;
      // verify flow
      const v = await createRegistration(baseUrl);
      const { map: vmap } = await getActiveMap(baseUrl, superToken);
      const vId = vmap.get(v.registrationId).id;
      setMockOrderStatus(v.orderId, 'PAID');
      const vAuditBefore = dbAuditFor(vId).length;
      const vRes = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(v.orderId)}`);
      assert.strictEqual(vRes.status, 200, 'CASE J: verify should succeed');
      const vEvents = dbAuditFor(vId).slice(vAuditBefore).filter((e) => e.action === 'PAYMENT_VERIFIED');
      assert.strictEqual(vEvents.length, 1, 'CASE J: exactly one verify event');
      assert.strictEqual(String(vEvents[0].actor_username), 'SYSTEM:CASHFREE_VERIFY', 'CASE J: system actor');
      assert.strictEqual(vEvents[0].actor_admin_id, null, 'CASE J: no admin id for system event');
      // webhook flow
      const w = await createRegistration(baseUrl);
      const { map: wmap } = await getActiveMap(baseUrl, superToken);
      const wId = wmap.get(w.registrationId).id;
      setMockOrderStatus(w.orderId, 'PAID');
      const payload = { data: { order: { order_id: w.orderId }, payment: { payment_status: 'SUCCESS' } } };
      const raw = JSON.stringify(payload);
      const ts = Date.now().toString();
      const sig = crypto.createHmac('sha256', secret).update(ts + raw).digest('base64');
      const wRes = await fetch(`${baseUrl}/api/cashfree/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig, 'x-webhook-timestamp': ts },
        body: raw
      });
      assert.strictEqual(wRes.status, 200, 'CASE J: webhook should succeed');
      const wEvents = dbAuditFor(wId).filter((e) => e.action === 'PAYMENT_WEBHOOK_UPDATE');
      assert.strictEqual(wEvents.length, 1, 'CASE J: exactly one webhook event');
      assert.strictEqual(String(wEvents[0].actor_username), 'SYSTEM:CASHFREE_WEBHOOK', 'CASE J: webhook system actor');
      assert.strictEqual(dbRegistrationByPublicId(w.registrationId).payment_status, 'paid', 'CASE J: webhook marked paid');
      console.log('  ✅ CASE J: Verify + webhook changes audited as system events');
    }

    // ---- CASE K: repeated paid verification creates no duplicate event ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      setMockOrderStatus(setup.orderId, 'PAID');
      const first = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(setup.orderId)}`);
      assert.strictEqual(first.status, 200);
      const countAfterFirst = dbAuditFor(dbId).filter((e) => e.action === 'PAYMENT_VERIFIED').length;
      assert.strictEqual(countAfterFirst, 1, 'CASE K: first verify creates one event');
      const second = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(setup.orderId)}`);
      assert.strictEqual(second.status, 200);
      const countAfterSecond = dbAuditFor(dbId).filter((e) => e.action === 'PAYMENT_VERIFIED').length;
      assert.strictEqual(countAfterSecond, 1, 'CASE K: repeat verify creates no duplicate');
      console.log('  ✅ CASE K: Repeated verification does not spam events');
    }

    // ---- CASE L: new registration receives CREATED event ----
    {
      const setup = await createRegistration(baseUrl, { member1: { name: 'Created Kid' } });
      const dbRow = dbRegistrationByPublicId(setup.registrationId);
      assert.ok(dbRow, 'CASE L: row stored');
      const created = dbAuditFor(dbRow.id).filter((e) => e.action === 'CREATED');
      assert.strictEqual(created.length, 1, 'CASE L: exactly one CREATED event');
      assert.strictEqual(created[0].actor_admin_id, null, 'CASE L: system actor id');
      assert.strictEqual(String(created[0].actor_username), 'SYSTEM:PARTICIPANT', 'CASE L: system actor name');
      const snap = JSON.parse(created[0].snapshot_json);
      assert.strictEqual(snap.name, dbRow.name, 'CASE L: snapshot details');
      assert.strictEqual(snap.cashfree_order_id, setup.orderId, 'CASE L: snapshot order');
      assert.ok(Array.isArray(snap.family_members) && snap.family_members.length === 1, 'CASE L: snapshot family');
      assert.ok(Number.isFinite(Number(snap.total_amount)), 'CASE L: snapshot totals');
      console.log('  ✅ CASE L: CREATED audit event recorded at registration');
    }

    // ---- CASE M: audit endpoint remains super-admin-only ----
    {
      const r1 = await fetch(`${baseUrl}/api/registrations/archived`);
      assert.strictEqual(r1.status, 401, 'CASE M: unauthenticated archived should return 401');
      const r2 = await fetch(`${baseUrl}/api/registrations/audit-log`);
      assert.strictEqual(r2.status, 401, 'CASE M: unauthenticated audit should return 401');
      console.log('  ✅ CASE M: Audit endpoints require authentication (401 unauthenticated, 403 normal admin per CASE 13)');
    }

    // ---- CASE N: database-level audit UPDATE is rejected ----
    {
      const probe = await createRegistration(baseUrl);
      const probeRow = dbRegistrationByPublicId(probe.registrationId);
      const probeEvents = dbAuditFor(probeRow.id).filter((e) => e.action === 'CREATED');
      assert.strictEqual(probeEvents.length, 1, 'CASE N: precondition CREATED event');
      let threw = false;
      try {
        await mockDb.query(`UPDATE registration_audit_log SET reason = $1 WHERE id = $2`, ['tampered', probeEvents[0].id]);
      } catch (e) {
        threw = true;
      }
      assert.ok(threw, 'CASE N: audit UPDATE must be rejected');
      const unchanged = dbAuditFor(probeRow.id).filter((e) => e.action === 'CREATED');
      assert.strictEqual(unchanged.length, 1, 'CASE N: event untouched');
      assert.strictEqual(unchanged[0].reason, probeEvents[0].reason, 'CASE N: fields unchanged');
      console.log('  ✅ CASE N: Audit UPDATE rejected at database level');
    }

    // ---- CASE O: database-level audit DELETE is rejected ----
    {
      const probe = await createRegistration(baseUrl);
      const probeRow = dbRegistrationByPublicId(probe.registrationId);
      const before = mockDb.auditLog.length;
      let threw = false;
      try {
        await mockDb.query(`DELETE FROM registration_audit_log WHERE registration_db_id = $1`, [probeRow.id]);
      } catch (e) {
        threw = true;
      }
      assert.ok(threw, 'CASE O: audit DELETE must be rejected');
      assert.strictEqual(mockDb.auditLog.length, before, 'CASE O: audit log intact');
      console.log('  ✅ CASE O: Audit DELETE rejected at database level');
    }

    // ---- CASE P: audit INSERT still works ----
    {
      const before = mockDb.auditLog.length;
      const res = await mockDb.query(
        `INSERT INTO registration_audit_log
           (registration_db_id, registration_id, action, actor_admin_id, actor_username, reason, snapshot_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [999888777, 'NCY-PROBE', 'PROBE_INSERT', null, 'SYSTEM:PROBE', 'append-only probe', JSON.stringify({ probe: true })]
      );
      assert.strictEqual(res.rowCount, 1, 'CASE P: audit INSERT must succeed');
      assert.strictEqual(mockDb.auditLog.length, before + 1, 'CASE P: event appended');
      const found = mockDb.auditLog.find((e) => e.registration_id === 'NCY-PROBE');
      assert.ok(found && found.action === 'PROBE_INSERT', 'CASE P: event readable back');
      console.log('  ✅ CASE P: Audit INSERT allowed (append works, history stays)');
    }

    // ---- CASE Q: /delete-selected alias no longer exists ----
    {
      const apiSrc = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
      assert.ok(!apiSrc.includes('/registrations/delete-selected'), 'CASE Q: alias route removed from source');
      const routePaths = [...apiSrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi)];
      for (const m of routePaths) {
        assert.ok(!m[2].toLowerCase().includes('delete-selected'), `CASE Q: no delete-selected route (${m[2]})`);
        if (m[2].startsWith('/registrations')) {
          assert.ok(!m[2].toLowerCase().includes('delete'), `CASE Q: no registration delete route (${m[2]})`);
        }
      }
      const gone = await archive({ ids: [1], confirm: true }, superToken, REMOVED_ALIAS_URL);
      assert.strictEqual(gone.status, 404, 'CASE Q: removed alias URL returns 404');
      console.log('  ✅ CASE Q: /delete-selected alias removed (404, no registration delete route)');
    }

    // ---- CASE S: archived FAILED webhook mutates nothing ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const statusBefore = dbRegistrationByPublicId(setup.registrationId).payment_status;
      const arch = await archive({ ids: [dbId], confirm: true }, superToken);
      assert.strictEqual(arch.status, 200);
      const auditAfterArchive = dbAuditFor(dbId).length;
      const secret = process.env.CASHFREE_WEBHOOK_SECRET;
      const payload = { data: { order: { order_id: setup.orderId }, payment: { payment_status: 'FAILED' } } };
      const raw = JSON.stringify(payload);
      const ts = Date.now().toString();
      const sig = crypto.createHmac('sha256', secret).update(ts + raw).digest('base64');
      const wRes = await fetch(`${baseUrl}/api/cashfree/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig, 'x-webhook-timestamp': ts },
        body: raw
      });
      assert.strictEqual(wRes.status, 200, 'CASE S: webhook must still be acknowledged');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, statusBefore, 'CASE S: archived status unchanged');
      assert.strictEqual(dbAuditFor(dbId).length, auditAfterArchive, 'CASE S: no payment-change event added');
      assert.ok(!dbAuditFor(dbId).some((e) => e.action === 'PAYMENT_WEBHOOK_UPDATE'), 'CASE S: no webhook event');
      console.log('  ✅ CASE S: Archived FAILED webhook acknowledged, row + history untouched');
    }

    // ---- CASE T: archived SUCCESS webhook mutates nothing ----
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      setMockOrderStatus(setup.orderId, 'PAID');
      const arch = await archive({ ids: [dbId], confirm: true }, superToken);
      assert.strictEqual(arch.status, 200);
      const statusAfterArchive = dbRegistrationByPublicId(setup.registrationId).payment_status;
      const auditAfterArchive = dbAuditFor(dbId).length;
      const secret = process.env.CASHFREE_WEBHOOK_SECRET;
      const payload = { data: { order: { order_id: setup.orderId }, payment: { payment_status: 'SUCCESS' } } };
      const raw = JSON.stringify(payload);
      const ts = Date.now().toString();
      const sig = crypto.createHmac('sha256', secret).update(ts + raw).digest('base64');
      const wRes = await fetch(`${baseUrl}/api/cashfree/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig, 'x-webhook-timestamp': ts },
        body: raw
      });
      assert.strictEqual(wRes.status, 200, 'CASE T: webhook must still be acknowledged');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, statusAfterArchive, 'CASE T: archived row unchanged');
      assert.strictEqual(dbAuditFor(dbId).length, auditAfterArchive, 'CASE T: no payment-change event added');
      console.log('  ✅ CASE T: Archived SUCCESS webhook acknowledged, row + history untouched');
    }

    // ---- CASE U: conditional Cashfree update loses to a later archive ----
    // Deterministically simulates "archived after the initial read but before
    // the status UPDATE" by calling the updater with the stale pre-archive
    // row snapshot.
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const staleRead = Object.assign({}, dbRegistrationByPublicId(setup.registrationId));
      const arch = await archive({ ids: [dbId], confirm: true }, superToken);
      assert.strictEqual(arch.status, 200);
      const auditAfterArchive = dbAuditFor(dbId).length;
      const updated = await applyCashfreeStatusChange({
        registration: staleRead,
        newStatus: 'paid',
        action: 'PAYMENT_VERIFIED',
        actorUsername: 'SYSTEM:CASHFREE_VERIFY',
        cashfreeDetails: { cashfree_order_status: 'PAID' }
      });
      assert.strictEqual(updated, false, 'CASE U: stale conditional update must report rowCount 0');
      assert.ok(dbRegistrationByPublicId(setup.registrationId).archived_at, 'CASE U: archive stamp intact');
      assert.notStrictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, 'paid', 'CASE U: no payment mutation');
      assert.strictEqual(dbAuditFor(dbId).length, auditAfterArchive, 'CASE U: no audit event without a transition');
      console.log('  ✅ CASE U: Stale Cashfree update blocked (rowCount 0, no mutation, no event)');
    }

    // ---- CASE V: stale manual PATCH creates no misleading event ----
    // Simulates a concurrent writer landing between the PATCH SELECT and its
    // UPDATE by flipping the row exactly when the conditional UPDATE runs.
    {
      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const target = map.get(setup.registrationId);
      const dbId = target.id;
      const auditBefore = dbAuditFor(dbId).length;
      const origQuery = mockDb.query.bind(mockDb);
      let flipped = false;
      mockDb.query = async (text, params) => {
        const normalized = String(text || '').replace(/\s+/g, ' ');
        if (!flipped && /UPDATE registrations SET payment_status = \$1/i.test(normalized) && params && params.length === 3) {
          flipped = true;
          const row = mockDb.registrations.find((r) => Number(r.id) === Number(params[1]));
          if (row) row.payment_status = 'expired'; // concurrent writer wins first
        }
        return origQuery(text, params);
      };
      let patchStatus;
      try {
        const r = await fetch(`${baseUrl}/api/registrations/${dbId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
          body: JSON.stringify({ payment_status: 'paid' })
        });
        patchStatus = r.status;
      } finally {
        mockDb.query = origQuery;
      }
      assert.strictEqual(patchStatus, 409, 'CASE V: stale write must be rejected, not silently applied');
      assert.strictEqual(dbRegistrationByPublicId(setup.registrationId).payment_status, 'expired', 'CASE V: concurrent value preserved');
      assert.strictEqual(dbAuditFor(dbId).filter((e) => e.action === 'PAYMENT_STATUS_MANUAL_CHANGE').length, 0, 'CASE V: no misleading manual-change event');
      assert.strictEqual(dbAuditFor(dbId).length, auditBefore, 'CASE V: no audit event at all');
      console.log('  ✅ CASE V: Stale manual PATCH rejected (409), no event, concurrent value kept');
    }

    // ---- CASE W: duplicate/concurrent archive cannot duplicate events ----
    {
      const apiSrc = fs.readFileSync(path.join(__dirname, '../src/routes/api.js'), 'utf8');
      const fnStart = apiSrc.indexOf('async function archiveSelectedRegistrations');
      assert.ok(fnStart !== -1);
      const fnEnd = apiSrc.indexOf('router.post', fnStart + 10);
      const archiveBlock = apiSrc.substring(fnStart, fnEnd === -1 ? undefined : fnEnd);
      assert.ok(/AND archived_at IS NULL/i.test(archiveBlock), 'CASE W: archive stamp must be conditional');
      assert.ok(/rowCount/i.test(archiveBlock), 'CASE W: archive must gate the audit event on rowCount');

      const setup = await createRegistration(baseUrl);
      const { map } = await getActiveMap(baseUrl, superToken);
      const dbId = map.get(setup.registrationId).id;
      const [r1, r2] = await Promise.all([
        archive({ ids: [dbId], confirm: true }, superToken),
        archive({ ids: [dbId], confirm: true }, superToken)
      ]);
      const j1 = await r1.json();
      const j2 = await r2.json();
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r2.status, 200);
      const totalNew = j1.archivedCount + j2.archivedCount;
      assert.strictEqual(totalNew, 1, 'CASE W: exactly one request wins the archive');
      assert.strictEqual(dbAuditFor(dbId).filter((e) => e.action === 'ARCHIVED').length, 1, 'CASE W: exactly one ARCHIVED event');
      console.log('  ✅ CASE W: Concurrent archive yields a single ARCHIVED event');
    }

    // ---- FRONTEND CHECKS ----
    {
      const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
      assert.ok(html.includes('id="selectAllRegs"'), 'Frontend: Select All checkbox must exist');
      assert.ok(html.includes('reg-select'), 'Frontend: row checkbox rendering must exist');
      assert.ok(html.includes('id="archiveSelectedBtn"'), 'Frontend: Archive Selected button must exist');
      assert.ok(html.includes('Archive Selected ('), 'Frontend: Archive Selected label must exist');
      assert.ok(!html.includes('Delete Selected'), 'Frontend: must not mislead with Delete wording');
      assert.ok(html.includes('window.confirm'), 'Frontend: confirmation must be required');
      assert.ok(html.includes('does NOT refund or modify any Cashfree transaction'), 'Frontend: Cashfree notice required');
      assert.ok(
        html.includes("CURRENT_USER.role==='super_admin'") || html.includes("CURRENT_USER.role === 'super_admin'"),
        'Frontend: UI must be restricted to super_admin'
      );
      assert.ok(html.includes('id="viewArchivedRegsBtn"') || html.includes('Archived / Audit Log'), 'Frontend: archived view toggle must exist');
      assert.ok(html.includes('id="archRows"'), 'Frontend: archived read-only table must exist');
      assert.ok(html.includes('id="auditRows"') && html.includes('Audit Events'), 'Frontend: audit event stream table must exist');
      assert.ok(html.includes('downloadCSV'), 'Frontend: authenticated CSV download must exist');
      assert.ok(!html.includes('href="/api/export.csv"'), 'Frontend: no unauthenticated CSV anchor');
      assert.ok(!html.includes('/api/registrations/delete-selected'), 'Frontend: must use the archive endpoint');
      assert.ok(!html.includes('id="deleteSelectedBtn"'), 'Frontend: no delete-named button');
      console.log('  ✅ FRONTEND: Archive wording, confirm, super_admin gate, read-only audit view present');
    }

    // ---- Cleanup: remove secondary admin ----
    {
      const delSec = await fetch(`${baseUrl}/api/admin/users/${secAdmin.admin.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${superToken}` }
      });
      assert.strictEqual(delSec.status, 200, 'Cleanup: delete secondary admin');
    }

    console.log('\n🎉 ALL ARCHIVE-SELECTED TESTS PASSED!\n');
  } finally {
    if (server) server.close();
  }
}

runArchiveTests().catch((err) => {
  console.error('❌ Archive-selected test failed:', err);
  if (server) server.close();
  process.exit(1);
});
