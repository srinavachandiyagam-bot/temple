/**
 * In-memory Mock Database Store for Local Testing (without PostgreSQL)
 * Stores registrations and members in memory with identical query semantics.
 */

class MockDatabase {
  constructor() {
    this.registrations = [];
    this.members = [];
    this.adminUsers = [];
    this.auditLog = [];
    this.appSettings = new Map();
    this.nextRegId = 1;
    this.nextMemberId = 1;
    this.nextAdminId = 1;
    this.nextAuditId = 1;
  }

  reset() {
    this.registrations = [];
    this.members = [];
    this.adminUsers = [];
    this.auditLog = [];
    this.appSettings = new Map();
    this.nextRegId = 1;
    this.nextMemberId = 1;
    this.nextAdminId = 1;
    this.nextAuditId = 1;
  }

  async query(text, params = []) {
    // Normalize all whitespace so queries can be matched regardless of multiline formatting
    const normalized = text.replace(/\s+/g, ' ').trim();

    // 1. INSERT INTO registrations
    if (/^INSERT INTO registrations/i.test(normalized)) {
      const id = this.nextRegId++;
      // Supports both legacy 10-param insert and new 11-param insert with donation_amount
      const [
        registration_id, name, mobile, email, address,
        rasi, natchathiram, gothram, cashfree_order_id, amount,
        donation_amount
      ] = params;

      const normalizedDonation = Number(donation_amount || 0);
      const record = {
        id,
        registration_id,
        name,
        mobile,
        email: email || null,
        address: address || null,
        rasi: rasi || null,
        natchathiram: natchathiram || null,
        gothram: gothram || null,
        payment_status: 'pending_payment',
        cashfree_order_id,
        amount: Number(amount || 1000),
        donation_amount: Number.isFinite(normalizedDonation) ? normalizedDonation : 0,
        // Soft-archive bookkeeping: NULL = active. Rows are never removed.
        archived_at: null,
        archived_by_admin_id: null,
        archived_by_username: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      this.registrations.push(record);
      return { rows: [record], rowCount: 1 };
    }

    // 2. INSERT INTO registration_members
    if (/^INSERT INTO registration_members/i.test(normalized)) {
      const id = this.nextMemberId++;
      const [registration_id, member_number, name, rasi, natchathiram, gothram] = params;
      const member = {
        id,
        registration_id,
        member_number,
        name,
        rasi: rasi || null,
        natchathiram: natchathiram || null,
        gothram: gothram || null,
        created_at: new Date()
      };
      this.members.push(member);
      return { rows: [member], rowCount: 1 };
    }

    // 3. SELECT FROM registrations WHERE cashfree_order_id = $1
    if (/SELECT .* FROM registrations WHERE cashfree_order_id = \$1/i.test(normalized)) {
      const orderId = params[0];
      const match = this.registrations.find(r => r.cashfree_order_id === orderId);
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }

    // 4. SELECT FROM registrations WHERE id = $1
    if (/SELECT .* FROM registrations WHERE id = \$1/i.test(normalized)) {
      const id = Number(params[0]);
      const match = this.registrations.find(r => r.id === id);
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }

    // 5. SELECT FROM registrations WHERE registration_id = $1
    // Honors an "archived_at IS NULL" suffix (public lookup + active views):
    // archived rows are hidden from operational views but remain stored.
    if (/SELECT .* FROM registrations WHERE registration_id = \$1/i.test(normalized)) {
      const regId = params[0];
      const match = this.registrations.find(r => r.registration_id === regId);
      if (match && /archived_at IS NULL/i.test(normalized) && match.archived_at) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }

    // 5b. SELECT registrations WHERE id IN ($1, $2, ...)
    // Used by super-admin bulk archive to load full pre-archive snapshots.
    if (/SELECT .* FROM registrations WHERE id IN \(/i.test(normalized)) {
      const wanted = new Set((params || []).map((v) => Number(v)));
      const matches = this.registrations.filter((r) => wanted.has(Number(r.id)));
      return { rows: matches.map((r) => ({ ...r })), rowCount: matches.length };
    }

    // 5c. SELECT members WHERE registration_id IN (...) (archive family snapshot).
    if (/SELECT .* FROM registration_members WHERE registration_id IN \(/i.test(normalized)) {
      const wanted = new Set((params || []).map((v) => Number(v)));
      const matches = this.members
        .filter((m) => wanted.has(Number(m.registration_id)))
        .sort((a, b) => a.member_number - b.member_number);
      return { rows: matches.map((m) => ({ ...m })), rowCount: matches.length };
    }

    // 5d. UPDATE registrations SET archived_at ... WHERE id = $1 AND archived_at IS NULL
    // Per-row conditional archive stamp (concurrency-safe: only an active
    // row transitions; rowCount 0 means already/concurrently archived).
    // Never removes rows or members. Returns rows-matched count like PG/SQLite.
    if (/UPDATE registrations SET archived_at/i.test(normalized)) {
      const regId = Number(params[0]);
      const actorId = params[1];
      const actorUsername = params[2];
      const record = this.registrations.find((r) => Number(r.id) === regId);
      if (record && !record.archived_at) {
        record.archived_at = new Date().toISOString();
        record.archived_by_admin_id = actorId;
        record.archived_by_username = actorUsername;
        record.updated_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 5d1. Append-only guard: audit history can never be altered or purged
    // through the application (mirrors the DB-level triggers on
    // PostgreSQL/SQLite). INSERT and SELECT remain allowed.
    if (/UPDATE registration_audit_log/i.test(normalized)) {
      const err = new Error('registration_audit_log is append-only: UPDATE not allowed');
      err.code = '42501';
      throw err;
    }
    if (/DELETE FROM registration_audit_log/i.test(normalized)) {
      const err = new Error('registration_audit_log is append-only: DELETE not allowed');
      err.code = '42501';
      throw err;
    }

    // 5e. INSERT INTO registration_audit_log (append-only; no delete path exists).
    if (/^INSERT INTO registration_audit_log/i.test(normalized)) {
      const [registration_db_id, registration_id, action, actor_admin_id, actor_username, reason, snapshot_json] = params;
      const entry = {
        id: this.nextAuditId++,
        registration_db_id: Number(registration_db_id),
        registration_id,
        action,
        actor_admin_id,
        actor_username,
        reason: reason || null,
        snapshot_json: typeof snapshot_json === 'string' ? snapshot_json : JSON.stringify(snapshot_json),
        created_at: new Date().toISOString()
      };
      this.auditLog.push(entry);
      return { rows: [{ ...entry }], rowCount: 1 };
    }

    // 5f. SELECT FROM registration_audit_log (archived/audit history, newest first).
    if (/SELECT .* FROM registration_audit_log/i.test(normalized)) {
      let entries = [...this.auditLog];
      const dbIdMatch = /WHERE registration_db_id = \$1/i.test(normalized) && params.length > 0;
      if (dbIdMatch) {
        entries = entries.filter((e) => Number(e.registration_db_id) === Number(params[0]));
      }
      entries.sort((a, b) => b.id - a.id);
      return { rows: entries.map((e) => ({ ...e })), rowCount: entries.length };
    }

    // NOTE: there is intentionally NO mock handler that removes rows from
    // registrations or registration_members. Archive is stamp-only everywhere.

    // 6. Admin summary query (must be checked BEFORE generic SELECT * FROM registrations)
    // Dashboard counts ACTIVE registrations only (archived rows excluded).
    if (/COUNT\(\*\) as total_registrations/i.test(normalized)) {
      const active = this.registrations.filter(r => !r.archived_at);
      const total = active.length;
      const paid = active.filter(r => r.payment_status === 'paid').length;
      const pending = active.filter(r => r.payment_status === 'pending' || r.payment_status === 'pending_payment').length;
      const failed = active.filter(r => r.payment_status === 'failed').length;
      const totalCollected = active
        .filter(r => r.payment_status === 'paid')
        .reduce((sum, r) => sum + r.amount, 0);

      return {
        rows: [{
          total_registrations: String(total),
          paid_registrations: String(paid),
          pending_registrations: String(pending),
          failed_registrations: String(failed),
          total_collected: String(totalCollected)
        }],
        rowCount: 1
      };
    }

    // 7a. SELECT registrations WHERE archived_at IS NULL (normal active view).
    if (/FROM registrations WHERE archived_at IS NULL/i.test(normalized)) {
      const copy = this.registrations.filter(r => !r.archived_at).reverse();
      return { rows: copy.map(r => ({ ...r })), rowCount: copy.length };
    }

    // 7b. SELECT registrations WHERE archived_at IS NOT NULL (audit view).
    if (/FROM registrations WHERE archived_at IS NOT NULL/i.test(normalized)) {
      const copy = this.registrations.filter(r => r.archived_at).reverse();
      return { rows: copy.map(r => ({ ...r })), rowCount: copy.length };
    }

    // 7. SELECT all registrations (for admin table)
    if (/SELECT .* FROM registrations\s*(ORDER BY.*)?$/i.test(normalized)) {
      const copy = [...this.registrations].reverse();
      return { rows: copy.map(r => ({ ...r })), rowCount: copy.length };
    }

    // 8. SELECT FROM registration_members WHERE registration_id = $1
    if (/SELECT .* FROM registration_members WHERE registration_id = \$1/i.test(normalized)) {
      const regId = params[0];
      const matchingMembers = this.members
        .filter(m => m.registration_id === regId || m.registration_id === Number(regId))
        .sort((a, b) => a.member_number - b.member_number);
      return { rows: matchingMembers.map(m => ({ ...m })), rowCount: matchingMembers.length };
    }

    // 9. UPDATE registrations SET payment_status = $1 ... WHERE id = $2
    // (+ optional AND archived_at IS NULL AND payment_status = $3 guard).
    // Mirrors real-DB conditional semantics: archived rows and stale-state
    // writes match 0 rows so callers create no misleading audit event.
    if (/UPDATE registrations SET payment_status = \$1.*WHERE id = \$2/i.test(normalized)) {
      const [newStatus, id, expectedOld] = params;
      const record = this.registrations.find(r => r.id === Number(id));
      if (record && !record.archived_at && (expectedOld === undefined || record.payment_status === expectedOld)) {
        record.payment_status = newStatus;
        record.updated_at = new Date();
        return { rows: [record], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 10. UPDATE registrations SET payment_status = ... WHERE cashfree_order_id = $...
    if (/UPDATE registrations SET payment_status = \$1.*WHERE cashfree_order_id = \$2/i.test(normalized)) {
      const [newStatus, orderId] = params;
      const record = this.registrations.find(r => r.cashfree_order_id === orderId);
      if (record) {
        record.payment_status = newStatus;
        record.updated_at = new Date();
        return { rows: [record], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 11. Webhook query: UPDATE registrations SET payment_status = 'paid' ... WHERE cashfree_order_id = $1
    if (/UPDATE registrations SET payment_status = 'paid'.*WHERE cashfree_order_id = \$1/i.test(normalized)) {
      const orderId = params[0];
      const record = this.registrations.find(r => r.cashfree_order_id === orderId);
      if (record) {
        record.payment_status = 'paid';
        record.updated_at = new Date();
        return { rows: [record], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 12. Webhook failed: UPDATE registrations SET payment_status = 'failed' ... WHERE cashfree_order_id = $1
    if (/UPDATE registrations SET payment_status = 'failed'.*WHERE cashfree_order_id = \$1/i.test(normalized)) {
      const orderId = params[0];
      const record = this.registrations.find(r => r.cashfree_order_id === orderId);
      if (record) {
        record.payment_status = 'failed';
        record.updated_at = new Date();
        return { rows: [record], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 13. INSERT INTO admin_users
    if (/^INSERT INTO admin_users/i.test(normalized)) {
      const id = this.nextAdminId++;
      const [username, name, password_hash, salt, role] = params;
      const user = {
        id,
        username: String(username).toLowerCase(),
        name,
        password_hash,
        salt,
        role: role || 'admin',
        created_at: new Date()
      };
      this.adminUsers.push(user);
      return { rows: [user], rowCount: 1 };
    }

    // 14. SELECT FROM admin_users WHERE username = 'superadmin' OR role = 'super_admin'
    if (/SELECT .* FROM admin_users WHERE username = 'superadmin' OR role = 'super_admin'/i.test(normalized)) {
      const matches = this.adminUsers.filter(u => u.username === 'superadmin' || u.role === 'super_admin');
      return { rows: matches.map(u => ({ ...u })), rowCount: matches.length };
    }

    // 15. SELECT FROM admin_users WHERE LOWER(username) = $1
    if (/SELECT .* FROM admin_users WHERE LOWER\(username\) = \$1/i.test(normalized)) {
      const targetUser = String(params[0]).toLowerCase();
      const match = this.adminUsers.find(u => u.username.toLowerCase() === targetUser);
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }

    // 16. SELECT FROM admin_users WHERE id = $1
    if (/SELECT .* FROM admin_users WHERE id = \$1/i.test(normalized)) {
      const id = Number(params[0]);
      const match = this.adminUsers.find(u => u.id === id);
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }

    // 17. Generic SELECT FROM admin_users (for listAdmins, legacy auth)
    if (/SELECT .* FROM admin_users/i.test(normalized)) {
      const isSuperAdminFirst = /role = 'super_admin'/i.test(normalized);
      const sorted = [...this.adminUsers].sort((a, b) => {
        if (isSuperAdminFirst) {
          if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
          if (b.role === 'super_admin' && a.role !== 'super_admin') return 1;
        }
        return a.id - b.id;
      });
      return { rows: sorted.map(u => ({ ...u })), rowCount: sorted.length };
    }

    // 18. DELETE FROM admin_users WHERE id = $1
    if (/DELETE FROM admin_users WHERE id = \$1/i.test(normalized)) {
      const id = Number(params[0]);
      const idx = this.adminUsers.findIndex(u => u.id === id);
      if (idx !== -1) {
        this.adminUsers.splice(idx, 1);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 19. app_settings (degraded SQLite-unavailable fallback; mock-mode fee
    // path never queries the DB, so this only affects non-mock processes
    // whose sqlite native binary failed to load).
    if (/CREATE TABLE IF NOT EXISTS app_settings/i.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }

    if (/SELECT setting_value FROM app_settings WHERE setting_key = \$1/i.test(normalized)) {
      const key = params[0];
      if (this.appSettings.has(key)) {
        return { rows: [{ setting_value: this.appSettings.get(key) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/^INSERT INTO app_settings/i.test(normalized)) {
      const [key, value] = params;
      const isDoNothing = /ON CONFLICT.*DO NOTHING/i.test(normalized);
      if (isDoNothing && this.appSettings.has(key)) {
        return { rows: [], rowCount: 0 };
      }
      this.appSettings.set(key, String(value));
      return { rows: [], rowCount: 1 };
    }

    // Default for BEGIN / COMMIT / ROLLBACK
    return { rows: [], rowCount: 0 };
  }

  async getClient() {
    const self = this;
    return {
      query: (text, params) => self.query(text, params),
      release: () => {}
    };
  }
}

const mockDbInstance = new MockDatabase();

module.exports = mockDbInstance;
