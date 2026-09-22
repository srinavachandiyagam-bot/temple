const express = require('express');
const router = express.Router();

const validateRegistration = require('../middleware/validateRegistration');
const { registerDevotee } = require('../controllers/registrationController');
const { verifyPayment, handleWebhook } = require('../controllers/paymentController');
const { query } = require('../config/db');
const { getPhonePeOrderStatus } = require('../config/phonepe');
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
router.get('/phonepe/verify', verifyPayment);
router.get('/phonepe/callback', verifyPayment); // legacy alias for return URL compatibility
router.post('/phonepe/callback', handleWebhook);
router.post('/phonepe/webhook', handleWebhook);
// Legacy alias for old Cashfree deployments
router.post('/cashfree/webhook', handleWebhook);
router.get('/cashfree/verify', verifyPayment);

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

// Devotee registration lookup by Registration ID
router.get('/registrations/:id', async (req, res, next) => {
  try {
    const regId = req.params.id;
    let regResult;
    try {
      regResult = await query(
        `SELECT id, registration_id, name, mobile, email, address,
                rasi, natchathiram, gothram, payment_status, amount, donation_amount, created_at
         FROM registrations
         WHERE registration_id = $1`,
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

router.get('/phonepe/status', requireAdminAuth, (req, res) => {
  const configured = !!(process.env.PHONEPE_CLIENT_ID && process.env.PHONEPE_CLIENT_SECRET);
  res.json({
    configured,
    provider: 'phonepe',
    environment: process.env.PHONEPE_ENV || 'sandbox',
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1'
  });
});
// Legacy alias
router.get('/cashfree/status', requireAdminAuth, (req, res) => {
  const configured = !!(process.env.PHONEPE_CLIENT_ID && process.env.PHONEPE_CLIENT_SECRET);
  res.json({ configured, environment: process.env.PHONEPE_ENV || 'sandbox', provider: 'phonepe' });
});

router.get('/registrations', requireAdminAuth, async (req, res, next) => {
  try {
    let regResult;
    try {
      regResult = await query(
        `SELECT id, registration_id, name, mobile, email, address,
                rasi, natchathiram, gothram, payment_status, cashfree_order_id, phonepe_merchant_order_id, phonepe_order_id,
                amount, donation_amount, created_at, updated_at
         FROM registrations
         ORDER BY id DESC`
      );
    } catch (colErr) {
      const msg = String((colErr && colErr.message) || '');
      if (/phonepe_merchant_order_id|donation_amount|no such column|undefined column/i.test(msg)) {
        try {
          regResult = await query(
            `SELECT id, registration_id, name, mobile, email, address,
                    rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                    amount, donation_amount, created_at, updated_at
             FROM registrations
             ORDER BY id DESC`
          );
        } catch (e2) {
          if (/donation_amount|no such column|undefined column/i.test(String(e2.message||''))) {
            regResult = await query(
              `SELECT id, registration_id, name, mobile, email, address,
                      rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                      amount, created_at, updated_at
               FROM registrations
               ORDER BY id DESC`
            );
          } else throw e2;
        }
      } else {
        throw colErr;
      }
    }

    const registrations = regResult.rows;
    for (const reg of registrations) {
      if (reg.donation_amount === undefined || reg.donation_amount === null) reg.donation_amount = 0;
      reg.phonepe_merchant_order_id = reg.phonepe_merchant_order_id || reg.cashfree_order_id;
      reg.order_id = reg.phonepe_merchant_order_id || reg.cashfree_order_id;
      reg.phonepe_order_id = reg.phonepe_order_id || null;
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
      reg.order_id = reg.phonepe_merchant_order_id || reg.cashfree_order_id;
    }

    res.json(registrations);
  } catch (err) {
    next(err);
  }
});

router.patch('/registrations/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const { payment_status } = req.body || {};

    if (payment_status) {
      await query(
        `UPDATE registrations
         SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [payment_status, id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/registrations/:id/sync-phonepe', requireAdminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const regResult = await query(`SELECT * FROM registrations WHERE id = $1`, [id]);
    if (regResult.rows.length === 0) return res.status(404).json({ error: 'Registration not found' });

    const reg = regResult.rows[0];
    const merchantId = reg.phonepe_merchant_order_id || reg.cashfree_order_id;
    if (!merchantId) {
      return res.status(400).json({ error: 'Registration has no phonepe order id' });
    }

    const ppOrder = await getPhonePeOrderStatus(merchantId);
    const cfStatus = String(ppOrder.state || '').toUpperCase();
    const { amountsEqual } = require('../config/pricing');
    let newStatus = reg.payment_status;

    if (cfStatus === 'COMPLETED') {
      const ppAmount = ppOrder.amount != null ? Number(ppOrder.amount)/100 : null;
      if (ppAmount !== null && !amountsEqual(ppAmount, reg.amount)) {
        console.warn(
          `Sync amount mismatch for order ${merchantId}: phonepe=${ppOrder.amount} db=${reg.amount}. NOT marking paid.`
        );
        return res.status(409).json({
          success: false,
          error: 'Payment amount mismatch. Registration not marked as paid.',
          status: reg.payment_status,
          phonepe_amount: ppOrder.amount,
          db_amount: reg.amount
        });
      }
      newStatus = 'paid';
    }
    else if (cfStatus === 'PENDING') newStatus = 'pending';
    else if (['FAILED'].includes(cfStatus)) newStatus = 'failed';

    await query(
      `UPDATE registrations
       SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [newStatus, id]
    );

    res.json({ success: true, status: newStatus });
  } catch (err) {
    next(err);
  }
});

// CSV Export of Registrations
router.get('/export.csv', async (req, res, next) => {
  try {
    let regResult;
    try {
      regResult = await query(
        `SELECT id, registration_id, name, mobile, email, address,
                rasi, natchathiram, gothram, payment_status, cashfree_order_id,
                amount, donation_amount, created_at
         FROM registrations
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

// Admin Dashboard Summary
router.get('/admin/summary', async (req, res, next) => {
  try {
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_registrations,
        COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_registrations,
        COUNT(*) FILTER (WHERE payment_status = 'pending' OR payment_status = 'pending_payment') as pending_registrations,
        COUNT(*) FILTER (WHERE payment_status = 'failed') as failed_registrations,
        COALESCE(SUM(amount) FILTER (WHERE payment_status = 'paid'), 0) as total_collected
      FROM registrations
    `);

    res.json({ success: true, stats: statsResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ====================================================================
// 5. MEDIA UPLOADS & MANAGEMENT (PHOTOS & VIDEOS)
// ====================================================================

// Upload Image - supports R2 persistent storage or local fallback
router.post('/images', requireAdminAuth, uploadImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    const { title_ta, title_en, is_hero } = req.body;
    const path = require('path');
    let filename = req.file.filename;
    let fileUrl = null;

    // R2 path: memoryStorage provides buffer, need to upload to R2
    try {
      const { isR2Enabled, uploadToR2, getPublicUrl } = require('../config/r2');
      if (isR2Enabled() && req.file.buffer) {
        const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        const safeName = 'img_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
        const key = `images/${safeName}`;
        fileUrl = await uploadToR2(req.file.buffer, key, req.file.mimetype);
        filename = safeName; // store key basename, url holds public URL
        // also keep full key for reference
        filename = key; // store full R2 key for deletion
      } else if (isR2Enabled() && req.file.filename) {
        // Rare case: disk storage but R2 enabled - migrate local file to R2 immediately
        const fs = require('fs');
        const fullPath = req.file.path || path.join(__dirname, '../../public/uploads', req.file.filename);
        if (fs.existsSync(fullPath)) {
          const buffer = fs.readFileSync(fullPath);
          const key = `images/${req.file.filename}`;
          fileUrl = await require('../config/r2').uploadToR2(buffer, key, req.file.mimetype);
          filename = key;
          // Optionally keep local file as cache, or delete after R2 upload
        }
      }
    } catch (r2Err) {
      console.error('R2 image upload failed, falling back to local:', r2Err.message);
      // Fallback: if R2 fails, use local filename if available, else generate from buffer
      if (!filename && req.file.buffer) {
        const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        filename = 'img_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
        const fs = require('fs');
        const uploadsDir = path.join(__dirname, '../../public/uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
      }
    }

    const img = addImage({
      filename: filename || req.file.filename,
      title_ta,
      title_en,
      is_hero,
      url: fileUrl
    });
    res.json({ success: true, image: img });
  } catch (err) {
    console.error('Image upload error:', err);
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

// Upload Video - supports R2 persistent storage or local fallback (Hero Video via is_hero)
router.post('/videos', requireAdminAuth, uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    const { title_ta, title_en, is_hero } = req.body;
    const path = require('path');
    let filename = req.file.filename;
    let fileUrl = null;

    try {
      const { isR2Enabled, uploadToR2 } = require('../config/r2');
      if (isR2Enabled() && req.file.buffer) {
        const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
        const safeName = 'vid_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
        const key = `videos/${safeName}`;
        fileUrl = await uploadToR2(req.file.buffer, key, req.file.mimetype);
        filename = key;
      } else if (isR2Enabled() && req.file.filename) {
        const fs = require('fs');
        const fullPath = req.file.path || path.join(__dirname, '../../public/videos', req.file.filename);
        if (fs.existsSync(fullPath)) {
          const buffer = fs.readFileSync(fullPath);
          const key = `videos/${req.file.filename}`;
          fileUrl = await require('../config/r2').uploadToR2(buffer, key, req.file.mimetype);
          filename = key;
        }
      }
    } catch (r2Err) {
      console.error('R2 video upload failed, falling back to local:', r2Err.message);
      if (!filename && req.file.buffer) {
        const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
        filename = 'vid_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
        const fs = require('fs');
        const videosDir = path.join(__dirname, '../../public/videos');
        if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
        fs.writeFileSync(path.join(videosDir, filename), req.file.buffer);
      }
    }

    const vid = addVideo({
      filename: filename || req.file.filename,
      title_ta,
      title_en,
      url: fileUrl,
      is_hero
    });
    res.json({ success: true, video: vid });
  } catch (err) {
    console.error('Video upload error:', err);
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
          'SELECT registration_id, name, mobile, amount, payment_status, phonepe_merchant_order_id, cashfree_order_id FROM registrations WHERE phonepe_merchant_order_id = $1 OR cashfree_order_id = $1',
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
    const ppState = targetStatus === 'paid' ? 'COMPLETED' : 'FAILED';
    const dbStatus = targetStatus === 'paid' ? 'paid' : 'failed';

    const { setMockOrderStatus } = require('../config/phonepe');
    setMockOrderStatus(order_id, ppState);

    await query(
      'UPDATE registrations SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE phonepe_merchant_order_id = $2 OR cashfree_order_id = $2',
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
