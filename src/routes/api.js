const express = require('express');
const router = express.Router();

const validateRegistration = require('../middleware/validateRegistration');
const { registerDevotee } = require('../controllers/registrationController');
const { verifyPayment, handleWebhook } = require('../controllers/paymentController');
const { query } = require('../config/db');
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

// ====================================================================
// 1. PUBLIC DEVOTEE & EVENT ENDPOINTS
// ====================================================================

// Registration & Payment Endpoints
router.post('/register', validateRegistration, registerDevotee);
router.get('/cashfree/verify', verifyPayment);
router.post('/cashfree/webhook', handleWebhook);

// Public website content & settings
router.get('/public', (req, res) => {
  res.json(getPublicData());
});

// Devotee registration lookup by Registration ID
router.get('/registrations/:id', async (req, res, next) => {
  try {
    const regId = req.params.id;
    const regResult = await query(
      `SELECT id, registration_id, name, mobile, email, address,
              rasi, natchathiram, gothram, payment_status, amount, created_at
       FROM registrations
       WHERE registration_id = $1`,
      [regId]
    );

    if (regResult.rows.length === 0) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    const registration = regResult.rows[0];

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

router.post('/settings', requireAdminAuth, (req, res) => {
  try {
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
    const regResult = await query(
      `SELECT id, registration_id, name, mobile, email, address,
              rasi, natchathiram, gothram, payment_status, cashfree_order_id,
              amount, created_at, updated_at
       FROM registrations
       ORDER BY id DESC`
    );

    const registrations = regResult.rows;

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

router.post('/registrations/:id/sync-cashfree', requireAdminAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const regResult = await query(`SELECT * FROM registrations WHERE id = $1`, [id]);
    if (regResult.rows.length === 0) return res.status(404).json({ error: 'Registration not found' });

    const reg = regResult.rows[0];
    if (!reg.cashfree_order_id) {
      return res.status(400).json({ error: 'Registration has no cashfree_order_id' });
    }

    const cfOrder = await getCashfreeOrder(reg.cashfree_order_id);
    const cfStatus = (cfOrder.order_status || '').toUpperCase();
    let newStatus = reg.payment_status;

    if (cfStatus === 'PAID') newStatus = 'paid';
    else if (cfStatus === 'ACTIVE') newStatus = 'pending';
    else if (['TERMINATED', 'EXPIRED', 'FAILED'].includes(cfStatus)) newStatus = 'failed';

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
    const regResult = await query(
      `SELECT id, registration_id, name, mobile, email, address,
              rasi, natchathiram, gothram, payment_status, cashfree_order_id,
              amount, created_at
       FROM registrations
       ORDER BY id DESC`
    );

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
        'Amount',
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
        r.amount,
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

router.get('/mock/order-info', async (req, res) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) return res.status(400).json({ error: 'Missing order_id' });

    const result = await query(
      'SELECT registration_id, name, mobile, amount, payment_status, cashfree_order_id FROM registrations WHERE cashfree_order_id = $1',
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mock/pay', async (req, res) => {
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
