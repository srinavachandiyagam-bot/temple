const express = require('express');
const router = express.Router();

const validateRegistration = require('../middleware/validateRegistration');
const { registerDevotee } = require('../controllers/registrationController');
const { verifyPayment, handleWebhook } = require('../controllers/paymentController');
const { query, getClient } = require('../config/db');
const { appendAuditEvent } = require('../config/auditLog');
const { getCashfreeOrder } = require('../config/cashfree');
const { loginAdmin, loginWithCredentials, requireAdminAuth, requireSuperAdminAuth } = require('../middleware/auth');
const { listAdmins, createAdmin, deleteAdmin } = require('../config/adminUserManager');
const {
  getPublicData,
  updateSettings,
  addImage,
  updateImage,
  deleteImage,
  addVideo,
  updateVideo,
  deleteVideo
} = require('../config/settingsManager');
const { uploadImage, uploadVideo } = require('../config/uploader');
const requireMockMode = require('../middleware/requireMockMode');

// ====================================================================
// 1. PUBLIC DEVOTEE & EVENT ENDPOINTS
// ====================================================================

// Registration & Payment Endpoints
router.post('/register', validateRegistration, registerDevotee);
router.get('/cashfree/verify', verifyPayment);
router.post('/cashfree/webhook', handleWebhook);

// Public website content & settings
router.get('/public', async (req, res) => {
  const data = getPublicData();
  // Canonical fee overlay (DB-backed when MOCK_MODE=false).
  // DB-backed pricing failures must NOT fall back to stale settings.json:
  // return 503 instead of exposing a potentially wrong fee.
  try {
    const { getRegistrationFee } = require('../config/pricing');
    const canonicalFee = await getRegistrationFee();
    if (data && data.settings) {
      data.settings.amount = String(canonicalFee);
    }
    return res.json(data);
  } catch (e) {
    if (process.env.MOCK_MODE === 'true') {
      // Mock reads never throw; keep file data as a safety net.
      return res.json(data);
    }
    const status = (e && e.status) || 503;
    try {
      console.error('Failed to load canonical fee for /api/public:', (e && e.message) || e);
    } catch (logErr) {}
    return res.status(status).json({ error: 'Registration fee is temporarily unavailable. Please try again later.' });
  }
});

// Super-Admin-only archived/audit history (READ ONLY).
// NOTE: these routes must stay ABOVE '/registrations/:id' so that
// 'archived' / 'audit-log' are not mistaken for a registration_id.
// There is intentionally NO endpoint that removes audit-log rows or
// archived registrations: the audit log is append-only historical evidence.
router.get('/registrations/archived', requireSuperAdminAuth, async (req, res, next) => {
  try {
    const archResult = await query(
      `SELECT id, registration_id, name, mobile, email, address,
              rasi, natchathiram, gothram, payment_status, cashfree_order_id,
              amount, donation_amount, archived_at, archived_by_admin_id,
              archived_by_username, created_at, updated_at
       FROM registrations
       WHERE archived_at IS NOT NULL
       ORDER BY id DESC`
    );

    const archived = archResult.rows || [];
    for (const reg of archived) {
      if (reg.donation_amount === undefined || reg.donation_amount === null) reg.donation_amount = 0;
      const memResult = await query(
        `SELECT member_number, name, rasi, natchathiram, gothram
         FROM registration_members
         WHERE registration_id = $1
         ORDER BY member_number ASC`,
        [reg.id]
      );
      reg.family = memResult.rows || [];
      reg.order_id = reg.cashfree_order_id;
      const auditResult = await query(
        `SELECT id, action, actor_admin_id, actor_username, reason, created_at
         FROM registration_audit_log
         WHERE registration_db_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [reg.id]
      );
      reg.audit_event = (auditResult.rows || [])[0] || null;
    }

    res.json({ success: true, archived });
  } catch (err) {
    next(err);
  }
});

router.get('/registrations/audit-log', requireSuperAdminAuth, async (req, res, next) => {
  try {
    const auditResult = await query(
      `SELECT id, registration_db_id, registration_id, action,
              actor_admin_id, actor_username, reason, snapshot_json, created_at
       FROM registration_audit_log
       ORDER BY id DESC`
    );
    res.json({ success: true, audit: auditResult.rows || [] });
  } catch (err) {
    next(err);
  }
});

// Devotee registration lookup by Registration ID
// Archived records intentionally return 404 here so retired test/dummy rows
// stay out of the operational public view. They remain stored and inspectable
// via the super-admin archived/audit endpoints above. Nothing is erased.
router.get('/registrations/:id', async (req, res, next) => {
  try {
    const regId = req.params.id;
    let regResult;
    try {
      regResult = await query(
        `SELECT id, registration_id, name, mobile, email, address,
                rasi, natchathiram, gothram, payment_status, amount, donation_amount, created_at
         FROM registrations
         WHERE registration_id = $1 AND archived_at IS NULL`,
        [regId]
      );
    } catch (colErr) {
      const msg = String((colErr && colErr.message) || '');
      if (/donation_amount|no such column|undefined column/i.test(msg)) {
        regResult = await query(
          `SELECT id, registration_id, name, mobile, email, address,
                  rasi, natchathiram, gothram, payment_status, amount, created_at
           FROM registrations
           WHERE registration_id = $1`,
          [regId]
        );
      } else {
        throw colErr;
      }
    }

    if (regResult.rows.length === 0) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    const registration = regResult.rows[0];
    if (registration.donation_amount === undefined || registration.donation_amount === null) {
      registration.donation_amount = 0;
    }

    const membersResult = await query(
      `SELECT member_number, name, rasi, natchathiram, gothram
       FROM registration_members
       WHERE registration_id = $1
       ORDER BY member_number ASC`,
      [registration.id]
    );

    registration.members = membersResult.rows;
    delete registration.id;

    res.json({ success: true, registration });
  } catch (error) {
    next(error);
  }
});

// ====================================================================
// 2. ADMIN AUTHENTICATION & USER MANAGEMENT
// ====================================================================

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Password is required (கடவுச்சொல் தேவை)' });
    }

    const authResult = await loginWithCredentials(username, password);
    if (!authResult) {
      return res.status(401).json({ error: 'Invalid admin credentials (தவறான உள்நுழைவு விவரங்கள்)' });
    }

    res.json({
      success: true,
      token: authResult.token,
      user: authResult.user
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/me', requireAdminAuth, (req, res) => {
  res.json({
    authenticated: true,
    service: 'Nava Chandi Yagam Admin',
    user: req.user
  });
});

// Admin User Management routes (Strictly Super Admin only)
router.get('/admin/users', requireSuperAdminAuth, async (req, res, next) => {
  try {
    const admins = await listAdmins();
    res.json({ success: true, admins });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/users', requireSuperAdminAuth, async (req, res, next) => {
  try {
    const { username, name, password, role } = req.body || {};
    const newAdmin = await createAdmin({ username, name, password, role });
    res.status(201).json({
      success: true,
      admin: newAdmin,
      message: 'Admin account created successfully (நிர்வாகி கணக்கு உருவாக்கப்பட்டது)'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/admin/users/:id', requireSuperAdminAuth, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    await deleteAdmin(targetId, req.user.id);
    res.json({
      success: true,
      message: 'Admin account deleted successfully (நிர்வாகி கணக்கு நீக்கப்பட்டது)'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ====================================================================
// 3. ADMIN SETTINGS & CONTENT MANAGEMENT
// ====================================================================

router.post('/settings', requireAdminAuth, async (req, res) => {
  try {
    // Validate admin amount before it can become the live registration fee.
    let normalizedAmount = null;
    let hasValidAmount = false;
    if (req.body && req.body.amount !== undefined && req.body.amount !== null && String(req.body.amount).trim() !== '') {
      const { normalizeAdminAmount } = require('../config/pricing');
      const normalized = normalizeAdminAmount(req.body.amount);
      if (normalized === null) {
        return res.status(400).json({ error: 'Invalid Participation Amount. Enter a positive INR amount with up to 2 decimals.' });
      }
      req.body.amount = String(normalized);
      normalizedAmount = normalized;
      hasValidAmount = true;
    } else if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'amount')) {
      // Empty amount would make pricing fall back; reject to avoid accidental free registrations.
      return res.status(400).json({ error: 'Invalid Participation Amount. Enter a positive INR amount with up to 2 decimals.' });
    }

    const isMock = process.env.MOCK_MODE === 'true';

    if (hasValidAmount && !isMock) {
      // Database-backed mode: persist registration_amount to app_settings first
      // so it becomes immediately authoritative. Production correctness must
      // NOT depend on settings.json.
      try {
        const { setStoredRegistrationFee } = require('../config/registrationFeeStore');
        const savedFee = await setStoredRegistrationFee(normalizedAmount);
        // Backward compatibility: ALSO write amount to settings.json below,
        // but overlay the response with the authoritative DB fee.
        const updated = updateSettings(req.body);
        updated.amount = String(savedFee);
        return res.json({ success: true, settings: updated });
      } catch (dbErr) {
        const status = dbErr && dbErr.status ? dbErr.status : 500;
        return res.status(status).json({ error: (dbErr && dbErr.message) || 'Failed to persist registration fee.' });
      }
    }

    // MOCK_MODE=true: continue file-backed behavior as before.
    // Also used for non-amount settings updates in all modes.
    const updated = updateSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cashfree/status', requireAdminAuth, (req, res) => {
  const configured = !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
  res.json({
    configured,
    environment: process.env.CASHFREE_ENV || 'sandbox',
    apiVersion: process.env.CASHFREE_API_VERSION || '2023-08-01'
  });
});

// ====================================================================
// 4. ADMIN REGISTRATIONS MANAGEMENT & CSV EXPORT
// ====================================================================

router.get('/registrations', requireAdminAuth, async (req, res, next) => {
  try {
    let regResult;
    try {
      // Normal operational view: ACTIVE registrations only. Archived rows
      // stay stored and are visible via the super-admin archived endpoints.
      regResult = await query(
        `SELECT id, registration_id, name, mobile, email, address,
                rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                amount, donation_amount, created_at, updated_at
         FROM registrations
         WHERE archived_at IS NULL
         ORDER BY id DESC`
      );
    } catch (colErr) {
      const msg = String((colErr && colErr.message) || '');
      if (/donation_amount|no such column|undefined column/i.test(msg)) {
        regResult = await query(
          `SELECT id, registration_id, name, mobile, email, address,
                  rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                  amount, created_at, updated_at
           FROM registrations
           WHERE archived_at IS NULL
           ORDER BY id DESC`
        );
      } else {
        throw colErr;
      }
    }

    const registrations = regResult.rows;
    for (const reg of registrations) {
      if (reg.donation_amount === undefined || reg.donation_amount === null) reg.donation_amount = 0;
    }

    for (const reg of registrations) {
      const memResult = await query(
        `SELECT member_number, name, rasi, natchathiram, gothram
         FROM registration_members
         WHERE registration_id = $1
         ORDER BY member_number ASC`,
        [reg.id]
      );
      reg.family = memResult.rows || [];
      reg.order_id = reg.cashfree_order_id;
    }

    res.json(registrations);
  } catch (err) {
    next(err);
  }
});

// ====================================================================
// SUPER-ADMIN ARCHIVE (soft removal from the active view).
// Registration rows and family-member rows are NEVER physically removed:
// the handler stamps archived_at / archived_by_* and appends an ARCHIVED
// row to registration_audit_log inside one transaction. There is
// intentionally NO hard-delete / purge / empty-trash endpoint anywhere in
// this application: super admins can archive, but cannot erase history.
// Cashfree orders/transactions are external records and remain untouched;
// no Cashfree API is called here.
// Actor identity ALWAYS comes from the auth session (req.user), never from
// browser-supplied JSON.
// ====================================================================
async function archiveSelectedRegistrations(req, res, next) {
  let client;
  try {
    const { ids, confirm, reason } = req.body || {};

    if (confirm !== true) {
      return res.status(400).json({ error: 'Explicit confirmation (confirm: true) is required to archive registrations.' });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array of registration IDs.' });
    }

    if (ids.length > 100) {
      return res.status(400).json({ error: 'Cannot archive more than 100 registrations per request.' });
    }

    for (const id of ids) {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Every id must be a positive integer registration ID.' });
      }
    }

    let cleanReason = null;
    if (reason !== undefined && reason !== null && String(reason).trim() !== '') {
      cleanReason = String(reason).trim().slice(0, 500);
      if (typeof reason !== 'string') {
        return res.status(400).json({ error: 'reason must be a short text string when provided.' });
      }
    }

    const uniqueIds = [...new Set(ids)];
    const actorId = req.user && req.user.id !== undefined ? req.user.id : null;
    const actorUsername = (req.user && (req.user.username || req.user.name)) || 'super_admin';

    client = await getClient();
    await client.query('BEGIN');

    // 1. Load full pre-archive state for every requested registration.
    const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ');
    const existingResult = await client.query(
      `SELECT id, registration_id, name, mobile, email, address,
              rasi, natchathiram, gothram, payment_status, cashfree_order_id,
              amount, donation_amount, archived_at, archived_by_admin_id,
              archived_by_username, created_at, updated_at
       FROM registrations
       WHERE id IN (${placeholders})`,
      uniqueIds
    );
    const found = existingResult.rows || [];

    // Already-archived rows are left untouched (idempotent re-archive).
    const toArchive = found.filter((r) => !r.archived_at);
    const alreadyArchivedIds = found
      .filter((r) => r.archived_at)
      .map((r) => Number(r.id))
      .sort((a, b) => a - b);

    if (toArchive.length > 0) {
      const targetIds = toArchive.map((r) => Number(r.id)).sort((a, b) => a - b);

      // 2. Load associated family members for the snapshot.
      const famPlaceholders = targetIds.map((_, i) => `$${i + 1}`).join(', ');
      const famResult = await client.query(
        `SELECT registration_id, member_number, name, rasi, natchathiram, gothram
         FROM registration_members
         WHERE registration_id IN (${famPlaceholders})
         ORDER BY registration_id ASC, member_number ASC`,
        targetIds
      );
      const membersByReg = new Map(targetIds.map((id) => [id, []]));
      for (const m of famResult.rows || []) {
        const bucket = membersByReg.get(Number(m.registration_id));
        if (bucket) bucket.push(m);
      }

      // 3-5. Per registration: conditional archive stamp FIRST, then the
      // ARCHIVED audit event ONLY if the stamp actually landed (rowCount 1).
      // The WHERE id = ? AND archived_at IS NULL guard makes concurrent
      // archives safe: the loser sees rowCount 0 and is reported as already
      // archived instead of writing a duplicate audit event. Members and the
      // registration row itself are never removed.
      const newlyArchivedIds = [];
      const concurrentlyArchivedIds = [];
      for (const reg of toArchive) {
        const regId = Number(reg.id);
        const family = membersByReg.get(regId) || [];
        const donation = Number(reg.donation_amount || 0);
        const total = Number(reg.amount || 0);
        const snapshot = {
          registration_db_id: regId,
          registration_id: reg.registration_id,
          name: reg.name,
          mobile: reg.mobile,
          email: reg.email,
          address: reg.address,
          rasi: reg.rasi,
          natchathiram: reg.natchathiram,
          gothram: reg.gothram,
          payment_status: reg.payment_status,
          cashfree_order_id: reg.cashfree_order_id,
          registration_fee: Number((total - donation).toFixed(2)),
          donation_amount: donation,
          total_amount: total,
          family_members: family,
          created_at: reg.created_at,
          updated_at: reg.updated_at,
          archived_by_will_be: { admin_id: actorId, username: actorUsername }
        };
        const stampResult = await client.query(
          `UPDATE registrations
           SET archived_at = CURRENT_TIMESTAMP,
               archived_by_admin_id = $2,
               archived_by_username = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND archived_at IS NULL`,
          [regId, actorId, actorUsername]
        );
        if (stampResult && stampResult.rowCount === 1) {
          await appendAuditEvent(
            (text, params) => client.query(text, params),
            {
              registration_db_id: regId,
              registration_id: reg.registration_id,
              action: 'ARCHIVED',
              actor_admin_id: actorId,
              actor_username: actorUsername,
              reason: cleanReason,
              snapshot
            }
          );
          newlyArchivedIds.push(regId);
        } else {
          concurrentlyArchivedIds.push(regId);
        }
      }

      await client.query('COMMIT');
      return res.json({
        success: true,
        archivedCount: newlyArchivedIds.length,
        archivedIds: newlyArchivedIds.sort((a, b) => a - b),
        alreadyArchivedIds: [...alreadyArchivedIds, ...concurrentlyArchivedIds].sort((a, b) => a - b)
      });
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      archivedCount: 0,
      archivedIds: [],
      alreadyArchivedIds
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {}
    }
    return next(err);
  } finally {
    if (client && typeof client.release === 'function') {
      try { client.release(); } catch (e) {}
    }
  }
}

// Preferred (and only) bulk-archive endpoint. No backward-compatible
// delete-named alias exists: the branch was never deployed, so no client
// can depend on the old hard-delete path.
router.post('/registrations/archive-selected', requireSuperAdminAuth, archiveSelectedRegistrations);

const VALID_MANUAL_PAYMENT_STATUSES = ['paid', 'pending', 'pending_payment', 'failed', 'expired'];

router.patch('/registrations/:id', requireAdminAuth, async (req, res, next) => {
  let client;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid registration id.' });
    }
    const { payment_status } = req.body || {};
    if (payment_status === undefined) {
      return res.json({ success: true });
    }
    if (typeof payment_status !== 'string' || !VALID_MANUAL_PAYMENT_STATUSES.includes(payment_status)) {
      return res.status(400).json({ error: 'Invalid payment_status. Allowed: paid, pending, pending_payment, failed, expired.' });
    }

    client = await getClient();
    await client.query('BEGIN');

    const beforeResult = await client.query(
      `SELECT id, registration_id, payment_status, cashfree_order_id,
              amount, donation_amount, archived_at
       FROM registrations
       WHERE id = $1`,
      [id]
    );
    if (beforeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Registration not found' });
    }
    const before = beforeResult.rows[0];

    // Archived rows are historical evidence: immutable through admin APIs.
    if (before.archived_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Archived registrations are read-only.' });
    }

    if (before.payment_status === payment_status) {
      await client.query('COMMIT');
      return res.json({ success: true });
    }

    // Defensive conditional UPDATE: the audit event below must correspond
    // to a real transition. If the row was archived or changed concurrently
    // after the SELECT, rowCount is 0 and no event is created.
    const updateResult = await client.query(
      `UPDATE registrations
       SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND archived_at IS NULL
         AND payment_status = $3`,
      [payment_status, id, before.payment_status]
    );
    if (!updateResult || updateResult.rowCount !== 1) {
      await client.query('ROLLBACK');
      const freshResult = await query(
        `SELECT id, archived_at FROM registrations WHERE id = $1`,
        [id]
      );
      if (freshResult.rows.length === 0) {
        return res.status(404).json({ error: 'Registration not found' });
      }
      if (freshResult.rows[0].archived_at) {
        return res.status(409).json({ error: 'Archived registrations are read-only.' });
      }
      return res.status(409).json({ error: 'Registration changed concurrently. Please reload and retry.' });
    }

    const actorId = req.user && req.user.id !== undefined ? req.user.id : null;
    const actorUsername = (req.user && (req.user.username || req.user.name)) || 'admin';
    await appendAuditEvent(
      (text, params) => client.query(text, params),
      {
        registration_db_id: before.id,
        registration_id: before.registration_id,
        action: 'PAYMENT_STATUS_MANUAL_CHANGE',
        actor_admin_id: actorId,
        actor_username: actorUsername,
        snapshot: {
          source: 'admin_manual',
          before_payment_status: before.payment_status,
          after_payment_status: payment_status,
          cashfree_order_id: before.cashfree_order_id,
          amount: before.amount !== undefined ? Number(before.amount) : null,
          donation_amount: before.donation_amount !== undefined && before.donation_amount !== null
            ? Number(before.donation_amount)
            : 0
        }
      }
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {}
    }
    return next(err);
  } finally {
    if (client && typeof client.release === 'function') {
      try { client.release(); } catch (e) {}
    }
  }
});

router.post('/registrations/:id/sync-cashfree', requireAdminAuth, async (req, res, next) => {
  let client = null;
  try {
    const id = req.params.id;
    const regResult = await query(`SELECT * FROM registrations WHERE id = $1`, [id]);
    if (regResult.rows.length === 0) return res.status(404).json({ error: 'Registration not found' });

    const reg = regResult.rows[0];
    // Archived rows are historical evidence: never mutate them via sync.
    // Refuse BEFORE contacting Cashfree so no state can change downstream.
    if (reg.archived_at) {
      return res.status(409).json({ error: 'Archived registrations are read-only.' });
    }
    if (!reg.cashfree_order_id) {
      return res.status(400).json({ error: 'Registration has no cashfree_order_id' });
    }

    const cfOrder = await getCashfreeOrder(reg.cashfree_order_id);
    const cfStatus = (cfOrder.order_status || '').toUpperCase();
    const { amountsEqual } = require('../config/pricing');
    let newStatus = reg.payment_status;

    if (cfStatus === 'PAID') {
      if (!amountsEqual(cfOrder.order_amount, reg.amount)) {
        console.warn(
          `Sync amount mismatch for order ${reg.cashfree_order_id}: cashfree=${cfOrder.order_amount} db=${reg.amount}. NOT marking paid.`
        );
        return res.status(409).json({
          success: false,
          error: 'Payment amount mismatch. Registration not marked as paid.',
          status: reg.payment_status,
          cashfree_amount: cfOrder.order_amount,
          db_amount: reg.amount
        });
      }
      newStatus = 'paid';
    }
    else if (cfStatus === 'ACTIVE') newStatus = 'pending';
    else if (['TERMINATED', 'EXPIRED', 'FAILED'].includes(cfStatus)) newStatus = 'failed';

    if (newStatus !== reg.payment_status) {
      client = await getClient();
      await client.query('BEGIN');
      // Conditional UPDATE: an archive (or another status change) landing
      // while the Cashfree request was in flight must win over this sync.
      // Only a real transition gets the PAYMENT_CASHFREE_SYNC audit event.
      const updateResult = await client.query(
        `UPDATE registrations
         SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
           AND archived_at IS NULL
           AND payment_status = $3`,
        [newStatus, id, reg.payment_status]
      );
      if (!updateResult || updateResult.rowCount !== 1) {
        await client.query('ROLLBACK');
        // Report the actual current state instead of the stale computation.
        const freshResult = await query(
          `SELECT payment_status, archived_at FROM registrations WHERE id = $1`,
          [id]
        );
        const freshStatus = (freshResult.rows[0] && freshResult.rows[0].payment_status) || reg.payment_status;
        if (freshResult.rows[0] && freshResult.rows[0].archived_at) {
          return res.status(409).json({ error: 'Archived registrations are read-only.' });
        }
        return res.json({ success: true, status: freshStatus });
      }
      const actorId = req.user && req.user.id !== undefined ? req.user.id : null;
      const actorUsername = (req.user && (req.user.username || req.user.name)) || 'admin';
      await appendAuditEvent(
        (text, params) => client.query(text, params),
        {
          registration_db_id: reg.id,
          registration_id: reg.registration_id,
          action: 'PAYMENT_CASHFREE_SYNC',
          actor_admin_id: actorId,
          actor_username: actorUsername,
          snapshot: {
            source: 'admin_cashfree_sync',
            before_payment_status: reg.payment_status,
            after_payment_status: newStatus,
            cashfree_order_id: reg.cashfree_order_id,
            cashfree_order_status: cfStatus,
            cashfree_amount: cfOrder.order_amount,
            db_amount: reg.amount
          }
        }
      );
      await client.query('COMMIT');
    }

    res.json({ success: true, status: newStatus });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {}
    }
    return next(err);
  } finally {
    if (client && typeof client.release === 'function') {
      try { client.release(); } catch (e) {}
    }
  }
});

// CSV Export of Registrations (ACTIVE registrations only; archived rows
// remain queryable in the database and audit history).
// Requires admin authentication: the export contains PII (name, mobile,
// email, address) plus payment details and must never be public.
router.get('/export.csv', requireAdminAuth, async (req, res, next) => {
  try {
    let regResult;
    try {
      regResult = await query(
        `SELECT id, registration_id, name, mobile, email, address,
                rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                amount, donation_amount, created_at
         FROM registrations
         WHERE archived_at IS NULL
         ORDER BY id DESC`
      );
    } catch (colErr) {
      const msg = String((colErr && colErr.message) || '');
      if (/donation_amount|no such column|undefined column/i.test(msg)) {
        regResult = await query(
          `SELECT id, registration_id, name, mobile, email, address,
                  rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                  amount, created_at
           FROM registrations
           WHERE archived_at IS NULL
           ORDER BY id DESC`
        );
      } else {
        throw colErr;
      }
    }

    const rows = [
      [
        'ID',
        'Registration ID',
        'Primary Name',
        'Mobile',
        'Email',
        'Address',
        'Rasi',
        'Natchathiram',
        'Gothram',
        'Payment Status',
        'Registration Fee',
        'Donation',
        'Total Amount',
        'Order ID',
        'Created At',
        'Family Members'
      ]
    ];

    for (const r of regResult.rows) {
      const memResult = await query(
        `SELECT member_number, name, rasi, natchathiram, gothram
         FROM registration_members
         WHERE registration_id = $1
         ORDER BY member_number ASC`,
        [r.id]
      );

      const familyStr = (memResult.rows || [])
        .map(m => `Member ${m.member_number}: ${m.name} (${m.rasi || '-'}/${m.natchathiram || '-'}/${m.gothram || '-'})`)
        .join('; ');

      const donationVal = Number(r.donation_amount || 0);
      const totalVal = Number(r.amount || 0);
      const feeVal = Number((totalVal - donationVal).toFixed(2));
      rows.push([
        r.id,
        r.registration_id,
        r.name,
        r.mobile,
        r.email || '',
        r.address ? r.address.replace(/(\r\n|\n|\r)/gm, ' ') : '',
        r.rasi || '',
        r.natchathiram || '',
        r.gothram || '',
        r.payment_status,
        feeVal,
        donationVal,
        totalVal,
        r.cashfree_order_id || '',
        new Date(r.created_at).toISOString(),
        familyStr
      ]);
    }

    const csvContent = rows
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nava_chandi_yagam_registrations.csv"');
    res.send('\uFEFF' + csvContent); // Byte Order Mark for Excel Tamil text support
  } catch (err) {
    next(err);
  }
});

// Admin Dashboard Summary (ACTIVE registrations only, so archived rows
// never pollute operational totals). Requires admin authentication.
router.get('/admin/summary', requireAdminAuth, async (req, res, next) => {
  try {
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_registrations,
        COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_registrations,
        COUNT(*) FILTER (WHERE payment_status = 'pending' OR payment_status = 'pending_payment') as pending_registrations,
        COUNT(*) FILTER (WHERE payment_status = 'failed') as failed_registrations,
        COALESCE(SUM(amount) FILTER (WHERE payment_status = 'paid'), 0) as total_collected
      FROM registrations
      WHERE archived_at IS NULL
    `);

    res.json({ success: true, stats: statsResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ====================================================================
// 5. MEDIA UPLOADS & MANAGEMENT (PHOTOS & VIDEOS)
// ====================================================================

// Upload Image
router.post('/images', requireAdminAuth, uploadImage.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    const { title_ta, title_en, is_hero } = req.body;
    const img = addImage({
      filename: req.file.filename,
      title_ta,
      title_en,
      is_hero
    });
    res.json({ success: true, image: img });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/images/:id', requireAdminAuth, (req, res) => {
  try {
    const img = updateImage(req.params.id, req.body);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.json({ success: true, image: img });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/images/:id', requireAdminAuth, (req, res) => {
  try {
    const ok = deleteImage(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Image not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload Video
router.post('/videos', requireAdminAuth, uploadVideo.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    const { title_ta, title_en } = req.body;
    const vid = addVideo({
      filename: req.file.filename,
      title_ta,
      title_en
    });
    res.json({ success: true, video: vid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/videos/:id', requireAdminAuth, (req, res) => {
  try {
    const vid = updateVideo(req.params.id, req.body);
    if (!vid) return res.status(404).json({ error: 'Video not found' });
    res.json({ success: true, video: vid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/videos/:id', requireAdminAuth, (req, res) => {
  try {
    const ok = deleteVideo(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Video not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================================
// 6. MOCK PAYMENT SIMULATOR ENDPOINTS (LOCAL TESTING)
// ====================================================================

router.get('/mock/order-info', requireMockMode, async (req, res) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) return res.status(400).json({ error: 'Missing order_id' });

    let result;
    try {
      result = await query(
        'SELECT registration_id, name, mobile, amount, donation_amount, payment_status, cashfree_order_id FROM registrations WHERE cashfree_order_id = $1',
        [orderId]
      );
    } catch (colErr) {
      const msg = String((colErr && colErr.message) || '');
      if (/donation_amount|no such column|undefined column/i.test(msg)) {
        result = await query(
          'SELECT registration_id, name, mobile, amount, payment_status, cashfree_order_id FROM registrations WHERE cashfree_order_id = $1',
          [orderId]
        );
      } else {
        throw colErr;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];
    if (order.donation_amount === undefined || order.donation_amount === null) order.donation_amount = 0;
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mock/pay', requireMockMode, async (req, res) => {
  try {
    const { order_id, status } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

    const targetStatus = (status || 'paid').toLowerCase();
    const cfStatus = targetStatus === 'paid' ? 'PAID' : 'FAILED';
    const dbStatus = targetStatus === 'paid' ? 'paid' : 'failed';

    const { setMockOrderStatus } = require('../config/cashfree');
    setMockOrderStatus(order_id, cfStatus);

    await query(
      'UPDATE registrations SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE cashfree_order_id = $2',
      [dbStatus, order_id]
    );

    res.json({
      success: true,
      status: targetStatus,
      order_id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
