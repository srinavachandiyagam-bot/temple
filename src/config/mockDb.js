/**
 * In-memory Mock Database Store for Local Testing (without PostgreSQL)
 * Stores registrations and members in memory with identical query semantics.
 */

class MockDatabase {
  constructor() {
    this.registrations = [];
    this.members = [];
    this.adminUsers = [];
    this.nextRegId = 1;
    this.nextMemberId = 1;
    this.nextAdminId = 1;
  }

  reset() {
    this.registrations = [];
    this.members = [];
    this.adminUsers = [];
    this.nextRegId = 1;
    this.nextMemberId = 1;
    this.nextAdminId = 1;
  }

  async query(text, params = []) {
    // Normalize all whitespace so queries can be matched regardless of multiline formatting
    const normalized = text.replace(/\s+/g, ' ').trim();

    // 1. INSERT INTO registrations
    if (/^INSERT INTO registrations/i.test(normalized)) {
      const id = this.nextRegId++;
      const [
        registration_id, name, mobile, email, address,
        rasi, natchathiram, gothram, cashfree_order_id, amount
      ] = params;

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
    if (/SELECT .* FROM registrations WHERE registration_id = \$1/i.test(normalized)) {
      const regId = params[0];
      const match = this.registrations.find(r => r.registration_id === regId);
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }

    // 6. Admin summary query (must be checked BEFORE generic SELECT * FROM registrations)
    if (/COUNT\(\*\) as total_registrations/i.test(normalized)) {
      const total = this.registrations.length;
      const paid = this.registrations.filter(r => r.payment_status === 'paid').length;
      const pending = this.registrations.filter(r => r.payment_status === 'pending' || r.payment_status === 'pending_payment').length;
      const failed = this.registrations.filter(r => r.payment_status === 'failed').length;
      const totalCollected = this.registrations
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

    // 9. UPDATE registrations SET payment_status = $1 WHERE id = $2
    if (/UPDATE registrations SET payment_status = \$1.*WHERE id = \$2/i.test(normalized)) {
      const [newStatus, id] = params;
      const record = this.registrations.find(r => r.id === Number(id));
      if (record) {
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
