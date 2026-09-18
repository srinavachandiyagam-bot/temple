const { query } = require('../config/db');
const { getPhonePeOrderStatus, verifyPhonePeWebhook } = require('../config/phonepe');
const { amountsEqual } = require('../config/pricing');

async function findRegistrationByOrderId(orderId) {
  // Try phonepe first, then legacy cashfree, with donation_amount tolerance
  const queries = [
    `SELECT id, registration_id, payment_status, phonepe_merchant_order_id, phonepe_order_id, cashfree_order_id, amount, donation_amount FROM registrations WHERE phonepe_merchant_order_id = $1`,
    `SELECT id, registration_id, payment_status, phonepe_merchant_order_id, phonepe_order_id, cashfree_order_id, amount, donation_amount FROM registrations WHERE cashfree_order_id = $1`,
    `SELECT id, registration_id, payment_status, phonepe_merchant_order_id, phonepe_order_id, cashfree_order_id, amount FROM registrations WHERE phonepe_merchant_order_id = $1`,
    `SELECT id, registration_id, payment_status, phonepe_merchant_order_id, phonepe_order_id, cashfree_order_id, amount FROM registrations WHERE cashfree_order_id = $1`
  ];
  for (const sql of queries) {
    try {
      const r = await query(sql, [orderId]);
      if (r.rows.length > 0) return r;
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/phonepe_merchant_order_id|no such column|undefined column|donation_amount/i.test(msg)) continue;
      throw err;
    }
  }
  // Fallback to cashfree without donation
  try {
    return await query(`SELECT id, registration_id, payment_status, cashfree_order_id, amount FROM registrations WHERE cashfree_order_id = $1`, [orderId]);
  } catch (e) { throw e; }
}

/**
 * Verifies payment status via PhonePe and updates DB
 * GET /api/phonepe/verify?order_id=XXXX
 */
async function verifyPayment(req, res, next) {
  const orderId = req.query.order_id;
  if (!orderId) {
    return res.status(400).json({ error: 'Missing required query parameter: order_id' });
  }
  try {
    const findResult = await findRegistrationByOrderId(orderId);
    if (findResult.rows.length === 0) {
      return res.status(404).json({ error: `No registration found for order_id: ${orderId}` });
    }
    const registration = findResult.rows[0];
    if (registration.payment_status === 'paid') {
      return res.json({ status: 'paid', registrationId: registration.registration_id });
    }

    let ppOrder;
    try {
      // Prefer phonepe merchant id, fallback to cashfree
      const merchantId = registration.phonepe_merchant_order_id || registration.cashfree_order_id || orderId;
      ppOrder = await getPhonePeOrderStatus(merchantId);
    } catch (ppError) {
      console.error(`Error querying PhonePe for order ${orderId}:`, ppError.message);
      return res.status(502).json({
        error: `Unable to verify order with payment gateway: ${ppError.message}`,
        status: 'pending',
        registrationId: registration.registration_id
      });
    }

    const ppState = String(ppOrder.state || ppOrder.status || '').toUpperCase();
    let clientStatus = 'pending';
    let dbStatus = registration.payment_status;

    if (ppState === 'COMPLETED') {
      // PhonePe amount is in paise; registration.amount is in INR
      const ppAmountPaise = ppOrder.amount;
      const ppAmountINR = ppAmountPaise != null ? Number(ppAmountPaise) / 100 : null;
      // Use pricing amountsEqual for paise-safe comparison
      if (ppAmountINR !== null && !amountsEqual(ppAmountINR, registration.amount)) {
        console.warn(`Amount mismatch for order ${orderId}: phonepe=${ppAmountINR} db=${registration.amount}. NOT marking paid.`);
        return res.status(409).json({
          error: 'Payment amount mismatch. Registration not marked as paid.',
          status: 'pending',
          registrationId: registration.registration_id
        });
      }
      clientStatus = 'paid';
      dbStatus = 'paid';
    } else if (ppState === 'PENDING') {
      clientStatus = 'pending';
      dbStatus = 'pending';
    } else if (['FAILED'].includes(ppState)) {
      clientStatus = 'failed';
      dbStatus = 'failed';
    }

    if (dbStatus !== registration.payment_status) {
      await query(`UPDATE registrations SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [dbStatus, registration.id]);
      console.log(`Updated registration ${registration.registration_id} payment_status to ${dbStatus}`);
    }

    return res.json({ status: clientStatus, registrationId: registration.registration_id });

  } catch (error) {
    console.error('Error during payment verification:', error);
    return next(error);
  }
}

/**
 * Handles PhonePe webhook
 * POST /api/phonepe/callback and /api/phonepe/webhook and legacy /api/cashfree/webhook
 */
async function handleWebhook(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-verify'] || '';
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const isValid = verifyPhonePeWebhook(authHeader, rawBody, req.headers);
  if (!isValid) {
    // In mock mode, verification is lenient; otherwise reject
    const isMock = process.env.MOCK_MODE === 'true';
    if (!isMock) {
      console.warn('⚠️ Rejected PhonePe webhook: Invalid signature');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  try {
    const payload = req.body;
    console.log('Received PhonePe webhook:', JSON.stringify(payload).substring(0, 2000));

    // PhonePe webhook structure
    let orderId = payload?.payload?.originalMerchantOrderId || payload?.payload?.merchantOrderId || payload?.payload?.orderId || payload?.originalMerchantOrderId || payload?.merchantOrderId || payload?.order_id;
    let eventType = payload?.event || payload?.type || '';
    let ppState = payload?.payload?.state || payload?.state || '';

    // Legacy base64 handling (if any)
    if (payload.response && typeof payload.response === 'string') {
      try {
        const decoded = Buffer.from(payload.response, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        orderId = parsed.merchantOrderId || parsed.orderId || orderId;
        ppState = parsed.state || ppState;
        eventType = parsed.event || eventType;
      } catch (e) {}
    }

    if (!orderId) {
      orderId = payload?.data?.order?.order_id || payload?.order_id;
      ppState = payload?.data?.payment?.payment_status || ppState;
      if (ppState === 'SUCCESS') ppState = 'COMPLETED';
      if (ppState === 'FAILED') ppState = 'FAILED';
    }

    if (!orderId) {
      console.warn('Webhook payload missing order_id:', payload);
      return res.status(400).json({ error: 'Missing order_id in webhook payload' });
    }

    const isCompleted = String(eventType).includes('completed') || String(ppState).toUpperCase() === 'COMPLETED' || String(ppState).toUpperCase() === 'SUCCESS';
    const isFailed = String(eventType).includes('failed') || String(ppState).toUpperCase() === 'FAILED';

    if (isCompleted) {
      const findResult = await findRegistrationByOrderId(orderId);
      if (findResult.rows.length === 0) {
        console.warn(`Webhook: no registration found for order ${orderId}`);
        return res.status(404).json({ error: 'Registration not found for order' });
      }
      const registration = findResult.rows[0];
      if (registration.payment_status === 'paid') {
        return res.status(200).json({ status: 'ok', received: true });
      }
      let ppOrder;
      try {
        ppOrder = await getPhonePeOrderStatus(registration.phonepe_merchant_order_id || registration.cashfree_order_id || orderId);
      } catch (e) {
        console.error(`Webhook: unable to re-fetch order ${orderId}:`, e.message);
        return res.status(502).json({ error: 'Unable to verify order with payment gateway' });
      }
      const ppState2 = String(ppOrder.state || '').toUpperCase();
      if (ppState2 !== 'COMPLETED') {
        console.log(`Webhook: Order ${orderId} event completed but PhonePe state is ${ppState2}; not marking paid.`);
        return res.status(200).json({ status: 'ok', received: true, verified: false });
      }
      const ppAmountINR = ppOrder.amount != null ? Number(ppOrder.amount)/100 : null;
      if (ppAmountINR !== null && !amountsEqual(ppAmountINR, registration.amount)) {
        console.warn(`Webhook amount mismatch for order ${orderId}: phonepe=${ppAmountINR} db=${registration.amount}. NOT marking paid.`);
        return res.status(200).json({ status: 'ok', received: true, verified: false, reason: 'amount_mismatch' });
      }
      await query(`UPDATE registrations SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE phonepe_merchant_order_id = $1 OR cashfree_order_id = $1`, [orderId]);
      // Also try generic update if phonepe column missing
      try { await query(`UPDATE registrations SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE cashfree_order_id = $1`, [orderId]); } catch(e){}
      console.log(`✅ Webhook: Order ${orderId} marked as PAID`);
    } else if (isFailed) {
      await query(`UPDATE registrations SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE phonepe_merchant_order_id = $1 AND payment_status != 'paid'`, [orderId]);
      try { await query(`UPDATE registrations SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE cashfree_order_id = $1 AND payment_status != 'paid'`, [orderId]); } catch(e){}
      console.log(`❌ Webhook: Order ${orderId} marked as FAILED`);
    }

    return res.status(200).json({ status: 'ok', received: true });

  } catch (error) {
    console.error('Error handling PhonePe webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = {
  verifyPayment,
  handleWebhook
};
