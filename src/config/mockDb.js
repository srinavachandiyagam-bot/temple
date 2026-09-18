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

    // Helper to normalize status comparison
    const normStatus = (s) => String(s || '').trim().toUpperCase();

    // 1. INSERT INTO registrations (generic column list parsing with VALUES literal handling)
    if (/^INSERT INTO registrations/i.test(normalized)) {
      const id = this.nextRegId++;
      const colMatch = normalized.match(/INSERT INTO registrations\s*\(([^)]+)\)/i);
      const valMatch = normalized.match(/VALUES\s*\(([^)]+)\)/i);
      let columns = [];
      let valuesTokens = [];
      if (colMatch) {
        columns = colMatch[1].split(',').map(c => c.trim().replace(/"/g, '').toLowerCase());
      }
      if (valMatch) {
        // Split values by comma but respect quotes (simple)
        valuesTokens = valMatch[1].split(',').map(v => v.trim());
      }
      const record = {
        id,
        payment_status: 'PENDING',
        amount: 999,
        donation_amount: 0,
        created_at: new Date(),
        updated_at: new Date(),
        phonepe_merchant_order_id: null,
        phonepe_order_id: null,
        phonepe_transaction_id: null,
        cashfree_order_id: null,
        cf_order_id: null,
        order_id: null,
        payment_id: null,
        payment_method: null,
        payment_time: null,
        bank_reference: null,
        payment_message: null,
        email: null,
        address: null,
        rasi: null,
        natchathiram: null,
        gothram: null,
        name: null,
        mobile: null,
        registration_id: null
      };
      // Map columns to valuesTokens
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const token = valuesTokens[i] !== undefined ? valuesTokens[i] : null;
        let val = null;
        if (token === null) {
          // fallback to positional params
          val = params[i];
        } else if (/^\$\d+$/i.test(token)) {
          const idx = parseInt(token.slice(1), 10) - 1;
          val = params[idx];
        } else if (/^'.*'$/i.test(token)) {
          val = token.slice(1, -1);
        } else if (/^".*"/i.test(token)) {
          val = token.slice(1, -1);
        } else if (/^CURRENT_TIMESTAMP$/i.test(token)) {
          val = new Date();
        } else if (!isNaN(Number(token)) && token !== '') {
          // numeric literal
          val = Number(token);
        } else {
          // unknown literal, treat as token string
          val = token;
        }
        if (col === 'payment_status' && val) val = normStatus(val);
        if (col === 'amount' && val != null) val = Number(val);
        record[col] = val !== undefined ? val : record[col];
      }
      // Ensure aliases – sync all order id fields for PhonePe and legacy Cashfree
      const primaryOrderId = record.phonepe_merchant_order_id || record.cashfree_order_id || record.order_id || record.cf_order_id || record.phonepe_order_id;
      if (primaryOrderId) {
        if (!record.phonepe_merchant_order_id) record.phonepe_merchant_order_id = primaryOrderId;
        if (!record.cashfree_order_id) record.cashfree_order_id = primaryOrderId;
        if (!record.cf_order_id) record.cf_order_id = primaryOrderId;
        if (!record.order_id) record.order_id = primaryOrderId;
      }
      if (!record.payment_status) record.payment_status = 'PENDING';
      else record.payment_status = normStatus(record.payment_status);
      this.registrations.push(record);
      return { rows: [{ ...record }], rowCount: 1 };
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

    // 3. SELECT FROM registrations WHERE phonepe_merchant_order_id etc. (including legacy cashfree)
    if (/SELECT .* FROM registrations WHERE (phonepe_merchant_order_id|phonepe_order_id|phonepe_transaction_id|cashfree_order_id|cf_order_id|order_id) = \$1/i.test(normalized)) {
      const orderId = params[0];
      const match = this.registrations.find(r => r.phonepe_merchant_order_id === orderId || r.phonepe_order_id === orderId || r.phonepe_transaction_id === orderId || r.cashfree_order_id === orderId || r.cf_order_id === orderId || r.order_id === orderId);
      if (match) {
        const copy = { ...match,
          phonepe_merchant_order_id: match.phonepe_merchant_order_id || match.cashfree_order_id || match.order_id,
          order_id: match.phonepe_merchant_order_id || match.cashfree_order_id || match.order_id,
          cf_order_id: match.cf_order_id || match.cashfree_order_id || match.phonepe_merchant_order_id,
          cashfree_order_id: match.cashfree_order_id || match.phonepe_merchant_order_id
        };
        return { rows: [copy], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // Also handle SELECT with cashfree_order_id or phonepe_merchant_order_id in WHERE with extra conditions
    if (/FROM registrations WHERE (phonepe_merchant_order_id|cashfree_order_id) = \$1/i.test(normalized)) {
      const orderId = params[0];
      const match = this.registrations.find(r => r.phonepe_merchant_order_id === orderId || r.cashfree_order_id === orderId || r.cf_order_id === orderId || r.order_id === orderId);
      return { rows: match ? [{ ...match, phonepe_merchant_order_id: match.phonepe_merchant_order_id || match.cashfree_order_id, order_id: match.phonepe_merchant_order_id || match.cashfree_order_id, cf_order_id: match.cf_order_id || match.cashfree_order_id }] : [], rowCount: match ? 1 : 0 };
    }

    // 4. SELECT FROM registrations WHERE id = $1
    if (/SELECT .* FROM registrations WHERE id = \$1/i.test(normalized)) {
      const id = Number(params[0]);
      const match = this.registrations.find(r => r.id === id);
      if (match) {
        const copy = { ...match,
          phonepe_merchant_order_id: match.phonepe_merchant_order_id || match.cashfree_order_id,
          order_id: match.phonepe_merchant_order_id || match.cashfree_order_id || match.order_id,
          cf_order_id: match.cf_order_id || match.cashfree_order_id
        };
        return { rows: [copy], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 5. SELECT FROM registrations WHERE registration_id = $1
    if (/SELECT .* FROM registrations WHERE registration_id = \$1/i.test(normalized)) {
      const regId = params[0];
      const match = this.registrations.find(r => r.registration_id === regId);
      if (match) {
        const copy = { ...match,
          phonepe_merchant_order_id: match.phonepe_merchant_order_id || match.cashfree_order_id,
          order_id: match.phonepe_merchant_order_id || match.cashfree_order_id || match.order_id,
          cf_order_id: match.cf_order_id || match.cashfree_order_id
        };
        return { rows: [copy], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 6. Admin summary query (must be checked BEFORE generic SELECT * FROM registrations)
    if (/COUNT\(\*\) as total_registrations/i.test(normalized)) {
      const total = this.registrations.length;
      const paid = this.registrations.filter(r => normStatus(r.payment_status) === 'PAID').length;
      const pending = this.registrations.filter(r => ['PENDING','CREATED','PENDING_PAYMENT'].includes(normStatus(r.payment_status))).length;
      const failed = this.registrations.filter(r => normStatus(r.payment_status) === 'FAILED').length;
      const cancelled = this.registrations.filter(r => normStatus(r.payment_status) === 'CANCELLED').length;
      const expired = this.registrations.filter(r => normStatus(r.payment_status) === 'EXPIRED').length;
      const totalCollected = this.registrations
        .filter(r => normStatus(r.payment_status) === 'PAID')
        .reduce((sum, r) => sum + Number(r.amount||0), 0);

      return {
        rows: [{
          total_registrations: String(total),
          paid_registrations: String(paid),
          pending_registrations: String(pending),
          failed_registrations: String(failed),
          cancelled_registrations: String(cancelled),
          expired_registrations: String(expired),
          total_collected: String(totalCollected)
        }],
        rowCount: 1
      };
    }

    // 7. SELECT all registrations (for admin table) - handle multiple variants
    if (/SELECT .* FROM registrations/i.test(normalized) && /ORDER BY/i.test(normalized) || /^SELECT .* FROM registrations\s*$/i.test(normalized) || (/SELECT .* FROM registrations/i.test(normalized) && !normalized.includes('WHERE'))) {
      if (!normalized.includes('WHERE registration_id') && !normalized.includes('WHERE phonepe_merchant_order_id') && !normalized.includes('WHERE cashfree_order_id') && !normalized.includes('WHERE id =') && !normalized.includes('COUNT(')) {
        const copy = [...this.registrations].reverse().map(r => ({ ...r,
          phonepe_merchant_order_id: r.phonepe_merchant_order_id || r.cashfree_order_id,
          order_id: r.phonepe_merchant_order_id || r.cashfree_order_id || r.order_id,
          cf_order_id: r.cf_order_id || r.cashfree_order_id,
          cashfree_order_id: r.cashfree_order_id || r.phonepe_merchant_order_id
        }));
        return { rows: copy, rowCount: copy.length };
      }
    }
    // Fallback generic SELECT all (covers cases with no ORDER BY but with alias)
    if (/SELECT .* FROM registrations/i.test(normalized) && !normalized.includes('WHERE')) {
      const copy = [...this.registrations].reverse().map(r => ({ ...r,
        phonepe_merchant_order_id: r.phonepe_merchant_order_id || r.cashfree_order_id,
        order_id: r.phonepe_merchant_order_id || r.cashfree_order_id || r.order_id,
        cf_order_id: r.cf_order_id || r.cashfree_order_id,
        cashfree_order_id: r.cashfree_order_id || r.phonepe_merchant_order_id
      }));
      return { rows: copy, rowCount: copy.length };
    }

    // 8. SELECT FROM registration_members WHERE registration_id = $1
    if (/SELECT .* FROM registration_members WHERE registration_id = \$1/i.test(normalized)) {
      const regId = params[0];
      const matchingMembers = this.members
        .filter(m => m.registration_id === regId || m.registration_id === Number(regId))
        .sort((a, b) => a.member_number - b.member_number);
      return { rows: matchingMembers.map(m => ({ ...m })), rowCount: matchingMembers.length };
    }

    // Generic UPDATE registrations handler (supports any SET columns with proper placeholder indexing)
    if (/^UPDATE registrations SET/i.test(normalized)) {
      const setMatch = normalized.match(/UPDATE registrations SET (.+) WHERE/i);
      const whereMatch = normalized.match(/WHERE (.+)$/i);
      const setClause = setMatch ? setMatch[1] : '';
      const whereClause = whereMatch ? whereMatch[1] : '';
      let targets = [];
      // Helper to get param by placeholder number $N
      const getParam = (n) => params[parseInt(n, 10) - 1];
      if (/WHERE id = \$\d+/i.test(whereClause)) {
        const m = whereClause.match(/WHERE id = \$(\d+)/i);
        const idVal = m ? getParam(m[1]) : params[params.length - 1];
        const rec = this.registrations.find(r => r.id === Number(idVal));
        if (rec) targets = [rec];
      } else if (/WHERE (phonepe_merchant_order_id|cashfree_order_id|cf_order_id|order_id|phonepe_order_id) = \$\d+/i.test(whereClause)) {
        const m = whereClause.match(/WHERE (phonepe_merchant_order_id|cashfree_order_id|cf_order_id|order_id|phonepe_order_id) = \$(\d+)/i);
        const orderVal = m ? getParam(m[2]) : params[params.length - 1];
        const rec = this.registrations.find(r => r.phonepe_merchant_order_id === orderVal || r.phonepe_order_id === orderVal || r.cashfree_order_id === orderVal || r.cf_order_id === orderVal || r.order_id === orderVal);
        if (rec) targets = [rec];
      } else if (/WHERE registration_id = \$\d+/i.test(whereClause)) {
        const m = whereClause.match(/WHERE registration_id = \$(\d+)/i);
        const regVal = m ? getParam(m[1]) : params[params.length - 1];
        const rec = this.registrations.find(r => r.registration_id === regVal);
        if (rec) targets = [rec];
      } else if (/WHERE (phonepe_merchant_order_id|cashfree_order_id) = \$1/i.test(normalized) && !setClause.includes('$1')) {
        const orderId = params[0];
        const rec = this.registrations.find(r => r.phonepe_merchant_order_id === orderId || r.cashfree_order_id === orderId);
        if (rec) targets = [rec];
      }
      if (targets.length === 0 && params.length >= 1) {
        const possibleOrderId = params[params.length - 1];
        let rec = this.registrations.find(r => r.phonepe_merchant_order_id === possibleOrderId || r.cashfree_order_id === possibleOrderId || r.id === Number(possibleOrderId));
        if (rec) targets = [rec];
      }
      if (targets.length > 0) {
        const setParts = setClause.split(',').map(s => s.trim());
        for (const part of setParts) {
          const eqMatch = part.match(/^(\w+)\s*=\s*(.+)$/);
          if (!eqMatch) continue;
          const col = eqMatch[1].toLowerCase();
          let valExpr = eqMatch[2].trim();
          // Remove trailing spaces, handle COALESCE etc – simple case: if contains COALESCE, extract first param
          if (/^COALESCE/i.test(valExpr)) {
            const coalesceMatch = valExpr.match(/COALESCE\s*\(\s*\$(\d+)/i);
            if (coalesceMatch) {
              const val = getParam(coalesceMatch[1]);
              // Only set if val not null/undefined
              if (val !== null && val !== undefined) {
                if (col === 'payment_status' && val) targets.forEach(t => t[col] = normStatus(val));
                else if (col === 'amount' && val != null) targets.forEach(t => t[col] = Number(val));
                else if (col === 'donation_amount' && val != null) targets.forEach(t => t[col] = Number(val));
                else targets.forEach(t => t[col] = val);
              }
              continue;
            }
          }
          if (valExpr.startsWith('$')) {
            const m = valExpr.match(/^\$(\d+)/);
            const val = m ? getParam(m[1]) : null;
            if (col === 'payment_status' && val) {
              targets.forEach(t => t[col] = normStatus(val));
            } else if (col === 'amount' && val != null) {
              targets.forEach(t => t[col] = Number(val));
            } else {
              targets.forEach(t => t[col] = val);
            }
            if (col === 'phonepe_merchant_order_id' && val) targets.forEach(t => { t.cashfree_order_id = val; t.cf_order_id = val; t.order_id = val; });
            if (col === 'phonepe_order_id' && val) targets.forEach(t => { /* phonepe order id sync */ });
            if (col === 'phonepe_transaction_id' && val) targets.forEach(t => { t.payment_id = val; });
            if (col === 'cashfree_order_id' && val) targets.forEach(t => { t.phonepe_merchant_order_id = val; t.cf_order_id = val; t.order_id = val; });
            if (col === 'cf_order_id' && val) targets.forEach(t => { t.cashfree_order_id = val; t.phonepe_merchant_order_id = val; t.order_id = val; });
            if (col === 'order_id' && val) targets.forEach(t => { t.cashfree_order_id = val; t.cf_order_id = val; t.phonepe_merchant_order_id = val; });
          } else if (valExpr.startsWith("'") && valExpr.endsWith("'")) {
            const lit = valExpr.slice(1, -1);
            if (col === 'payment_status') targets.forEach(t => t[col] = normStatus(lit));
            else targets.forEach(t => t[col] = lit);
          } else if (/CURRENT_TIMESTAMP/i.test(valExpr)) {
            targets.forEach(t => t.updated_at = new Date());
          } else if (/^NULL$/i.test(valExpr)) {
            targets.forEach(t => t[col] = null);
          }
        }
        targets.forEach(t => t.updated_at = new Date());
        return { rows: targets.map(t => ({ ...t })), rowCount: targets.length };
      }
    }

    // 9. Legacy UPDATE registrations SET payment_status = $1 WHERE id = $2 (fallback)
    if (/UPDATE registrations SET payment_status = \$1.*WHERE id = \$2/i.test(normalized)) {
      const [newStatus, id] = params;
      const record = this.registrations.find(r => r.id === Number(id));
      if (record) {
        record.payment_status = normStatus(newStatus);
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
        record.payment_status = normStatus(newStatus);
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
        record.payment_status = 'PAID';
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
        record.payment_status = 'FAILED';
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
