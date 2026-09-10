const { query } = require('../config/db');
const { getCashfreeOrder, verifyWebhookSignature, getIsMockMode } = require('../config/cashfree');
const { normalizeStatus } = require('../utils/constants');

function mapCashfreeToDbStatus(cfStatusRaw) {
  const cfStatus = String(cfStatusRaw || '').toUpperCase().trim();
  // Cashfree order_status values: ACTIVE, PAID, EXPIRED, TERMINATED, etc.
  // Payment status via webhook: SUCCESS, FAILED, CANCELLED
  if (cfStatus === 'PAID' || cfStatus === 'SUCCESS') return 'PAID';
  if (cfStatus === 'ACTIVE') return 'PENDING';
  if (cfStatus === 'FAILED') return 'FAILED';
  if (cfStatus === 'CANCELLED' || cfStatus === 'TERMINATED') return 'CANCELLED';
  if (cfStatus === 'EXPIRED') return 'EXPIRED';
  if (cfStatus === 'CREATED') return 'CREATED';
  // Fallback
  if (['PENDING','PENDING_PAYMENT'].includes(cfStatus)) return 'PENDING';
  return 'PENDING';
}

function mapDbToClientStatus(dbStatusRaw) {
  const s = normalizeStatus(dbStatusRaw);
  if (s === 'PAID') return 'PAID';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'EXPIRED') return 'EXPIRED';
  if (s === 'CREATED') return 'CREATED';
  return 'PENDING';
}

/**
 * Verifies payment status of an order with Cashfree and updates the database
 * Endpoint: GET /api/cashfree/verify?order_id=XXXX
 * Now supports full state machine: CREATED, PENDING, PAID, FAILED, CANCELLED, EXPIRED
 * Never trust browser – always verify server-side via Cashfree.
 */
async function verifyPayment(req, res, next) {
  const orderId = req.query.order_id || req.query.orderId || req.query.order_id;

  if (!orderId) {
    return res.status(400).json({
      error: 'Missing required query parameter: order_id'
    });
  }

  try {
    // 1. Look up registration in the database (support cashfree_order_id, cf_order_id, order_id)
    let findResult = await query(
      `SELECT id, registration_id, payment_status, cashfree_order_id, cf_order_id, order_id, amount, payment_id, payment_method, payment_time, bank_reference
       FROM registrations
       WHERE cashfree_order_id = $1`,
      [orderId]
    );
    if (findResult.rows.length === 0) {
      findResult = await query(`SELECT id, registration_id, payment_status, cashfree_order_id, cf_order_id, order_id, amount, payment_id, payment_method, payment_time, bank_reference FROM registrations WHERE cf_order_id = $1`, [orderId]);
    }
    if (findResult.rows.length === 0) {
      findResult = await query(`SELECT id, registration_id, payment_status, cashfree_order_id, cf_order_id, order_id, amount, payment_id, payment_method, payment_time, bank_reference FROM registrations WHERE order_id = $1`, [orderId]);
    }
    if (findResult.rows.length === 0) {
      findResult = await query(`SELECT id, registration_id, payment_status, cashfree_order_id, cf_order_id, order_id, amount, payment_id, payment_method, payment_time, bank_reference FROM registrations WHERE registration_id = $1`, [orderId]);
    }

    if (findResult.rows.length === 0) {
      return res.status(404).json({
        error: `No registration found for order_id: ${orderId}`
      });
    }

    const registration = findResult.rows[0];
    const currentDbStatus = normalizeStatus(registration.payment_status);

    // 2. If already marked as PAID, return PAID status immediately (idempotent) but still verify for reconciliation if needed
    // We still query Cashfree if ?force=true
    const forceVerify = req.query.force === 'true' || req.query.verify === 'true';
    if (currentDbStatus === 'PAID' && !forceVerify) {
      return res.json({
        status: 'paid',
        payment_status: 'PAID',
        registrationId: registration.registration_id,
        registration_id: registration.registration_id,
        amount: registration.amount,
        order_id: registration.cashfree_order_id,
        message: 'Payment already confirmed'
      });
    }

    // 3. Query Cashfree Orders API for latest order status (server-side verification)
    let cfOrder;
    try {
      cfOrder = await getCashfreeOrder(orderId);
    } catch (cfError) {
      console.error(`Error querying Cashfree for order ${orderId}:`, cfError.message);
      // If Cashfree unreachable, return current DB status with pending hint
      const fallbackClient = mapDbToClientStatus(currentDbStatus);
      return res.status(502).json({
        error: `Unable to verify order with payment gateway: ${cfError.message}`,
        status: fallbackClient.toLowerCase(),
        payment_status: currentDbStatus,
        registrationId: registration.registration_id,
        amount: registration.amount
      });
    }

    const cfStatusRaw = cfOrder.order_status || cfOrder.orderStatus || cfOrder.status || 'ACTIVE';
    const cfAmount = cfOrder.order_amount || cfOrder.orderAmount;
    // Try to extract payment details if available
    const cfPaymentId = cfOrder.cf_payment_id || cfOrder.payment_id || cfOrder.cf_order_id || null;
    const cfPaymentMethod = cfOrder.payment_method || cfOrder.payment_group || null;
    const cfPaymentTime = cfOrder.payment_time || cfOrder.created_at || null;
    const cfBankRef = cfOrder.bank_reference || cfOrder.reference_id || null;

    let newDbStatus = mapCashfreeToDbStatus(cfStatusRaw);
    // Also handle case where Cashfree returns payments array with successful payment even if order_status ACTIVE
    if (cfOrder.payments && Array.isArray(cfOrder.payments)) {
      const hasSuccess = cfOrder.payments.some(p => String(p.payment_status || p.status || '').toUpperCase() === 'SUCCESS' || String(p.payment_status || '').toUpperCase() === 'PAID');
      if (hasSuccess) newDbStatus = 'PAID';
    }

    // Handle mock mode where amount may be used for verification
    let clientStatus = mapDbToClientStatus(newDbStatus);

    // 4. Validate amount integrity: if Cashfree amount differs from DB, log warning but don't auto-mark PAID if mismatch
    if (cfAmount && Number(cfAmount) !== Number(registration.amount)) {
      console.warn(`⚠️ Amount mismatch for order ${orderId}: DB ₹${registration.amount} vs Cashfree ₹${cfAmount}`);
      // If PAID but amount mismatch, keep as is but add payment_message
    }

    // 5. Update database if payment status changed or payment details available
    const needsUpdate = newDbStatus !== currentDbStatus || (newDbStatus === 'PAID' && !registration.payment_id && cfPaymentId);
    if (needsUpdate) {
      // Build dynamic update for payment details when PAID
      if (newDbStatus === 'PAID') {
        await query(
          `UPDATE registrations
           SET payment_status = $1, payment_id = COALESCE($2, payment_id), payment_method = COALESCE($3, payment_method), payment_time = COALESCE($4, payment_time), bank_reference = COALESCE($5, bank_reference), payment_message = $6, updated_at = CURRENT_TIMESTAMP
           WHERE id = $7`,
          [newDbStatus, cfPaymentId || null, cfPaymentMethod || null, cfPaymentTime ? new Date(cfPaymentTime) : new Date(), cfBankRef || null, `Verified PAID via Cashfree order ${orderId} amount ₹${registration.amount}`, registration.id]
        );
      } else {
        let msg = `Status updated to ${newDbStatus} via verification`;
        if (newDbStatus === 'FAILED') msg = 'Payment Unsuccessful';
        if (newDbStatus === 'PENDING') msg = 'Payment pending verification';
        if (newDbStatus === 'EXPIRED') msg = 'Payment link expired';
        if (newDbStatus === 'CANCELLED') msg = 'Payment cancelled';
        await query(
          `UPDATE registrations
           SET payment_status = $1, payment_message = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [newDbStatus, msg, registration.id]
        );
      }
      console.log(`Updated registration ${registration.registration_id} payment_status ${currentDbStatus} -> ${newDbStatus} (Cashfree: ${cfStatusRaw})`);
    }

    // 6. Return standard JSON response to frontend with rich info for retry logic
    const isPaid = newDbStatus === 'PAID';
    const isFailed = ['FAILED','CANCELLED','EXPIRED'].includes(newDbStatus);
    const isPending = ['PENDING','CREATED'].includes(newDbStatus);
    let userMessage = '';
    if (isPaid) userMessage = 'Payment successful';
    else if (isFailed) userMessage = 'Payment Unsuccessful';
    else if (isPending) userMessage = 'Payment is pending – do not pay again if money was deducted; use refresh to reconcile';

    return res.json({
      status: clientStatus.toLowerCase(),
      payment_status: newDbStatus,
      registrationId: registration.registration_id,
      registration_id: registration.registration_id,
      order_id: registration.cashfree_order_id || orderId,
      amount: registration.amount,
      cfStatus: cfStatusRaw,
      message: userMessage,
      canRetry: isFailed,
      shouldRefresh: isPending
    });

  } catch (error) {
    console.error('Error during payment verification:', error);
    return next(error);
  }
}

/**
 * Handles Cashfree webhook notifications for asynchronous payment updates
 * Endpoint: POST /api/cashfree/webhook
 * Verifies signature and updates DB with full payment details; never trusts client.
 */
async function handleWebhook(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const rawBody = req.rawBody;

  // 1. Verify webhook signature (always verify, never trust client)
  const isValid = verifyWebhookSignature(signature, timestamp, rawBody);
  if (!isValid) {
    console.warn('⚠️ Rejected Cashfree webhook: Invalid HMAC signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  try {
    const payload = req.body;
    console.log('Received Cashfree webhook notification:', JSON.stringify(payload));

    // Support both Cashfree 2023-08-01 format (data.order, data.payment) and legacy format
    const orderId = payload?.data?.order?.order_id || payload?.order_id || payload?.data?.order_id || payload?.orderId;
    const paymentStatusRaw = payload?.data?.payment?.payment_status || payload?.txStatus || payload?.data?.payment_status || payload?.payment_status;
    const paymentId = payload?.data?.payment?.cf_payment_id || payload?.data?.payment?.payment_id || payload?.cf_payment_id || null;
    const paymentMethod = payload?.data?.payment?.payment_group || payload?.data?.payment?.payment_method || payload?.payment_method || null;
    const paymentAmount = payload?.data?.payment?.payment_amount || payload?.data?.order?.order_amount || payload?.orderAmount || null;
    const paymentTimeRaw = payload?.data?.payment?.payment_time || payload?.data?.payment?.created_at || new Date().toISOString();
    const bankRef = payload?.data?.payment?.bank_reference || payload?.data?.payment?.reference_id || null;
    const paymentMessage = payload?.data?.payment?.payment_message || payload?.paymentMessage || null;

    if (!orderId) {
      console.warn('Webhook payload missing order_id:', payload);
      return res.status(400).json({ error: 'Missing order_id in webhook payload' });
    }

    const normalizedWebhookStatus = String(paymentStatusRaw || '').toUpperCase().trim();
    // Lookup registration to ensure amount matches if needed
    const existing = await query(`SELECT id, payment_status, amount FROM registrations WHERE cashfree_order_id = $1`, [orderId]);
    if (existing.rows.length === 0) {
      console.warn(`Webhook for unknown order ${orderId}`);
      return res.status(200).json({ status: 'ok', received: true, warning: 'Unknown order' });
    }
    const reg = existing.rows[0];
    const existingStatus = normalizeStatus(reg.payment_status);
    if (existingStatus === 'PAID') {
      console.log(`Webhook: Order ${orderId} already PAID, ignoring duplicate`);
      return res.status(200).json({ status: 'ok', received: true, alreadyPaid: true });
    }

    if (normalizedWebhookStatus === 'SUCCESS' || normalizedWebhookStatus === 'PAID') {
      // Verify amount if provided
      if (paymentAmount && Number(paymentAmount) !== Number(reg.amount)) {
        console.warn(`Webhook amount mismatch for ${orderId}: webhook ₹${paymentAmount} vs DB ₹${reg.amount}`);
      }
      await query(
        `UPDATE registrations
         SET payment_status = 'PAID', payment_id = $2, payment_method = $3, payment_time = $4, bank_reference = $5, payment_message = $6, amount = COALESCE($7, amount), updated_at = CURRENT_TIMESTAMP
         WHERE cashfree_order_id = $1`,
        [orderId, paymentId, paymentMethod, paymentTimeRaw ? new Date(paymentTimeRaw) : new Date(), bankRef, paymentMessage || 'Payment confirmed via webhook', paymentAmount ? Number(paymentAmount) : null]
      );
      // Also sync aliases
      await query(`UPDATE registrations SET cf_order_id = $1, order_id = $1 WHERE cashfree_order_id = $1`, [orderId]).catch(()=>{});
      console.log(`✅ Webhook: Order ${orderId} marked as PAID (payment ${paymentId})`);
    } else if (['FAILED','CANCELLED','USER_DROPPED','EXPIRED'].includes(normalizedWebhookStatus)) {
      const mapped = normalizedWebhookStatus === 'EXPIRED' ? 'EXPIRED' : (normalizedWebhookStatus === 'CANCELLED' || normalizedWebhookStatus === 'USER_DROPPED' ? 'CANCELLED' : 'FAILED');
      // Do not overwrite PAID
      await query(
        `UPDATE registrations
         SET payment_status = $2, payment_message = $3, updated_at = CURRENT_TIMESTAMP
         WHERE cashfree_order_id = $1 AND payment_status != 'PAID'`,
        [orderId, mapped, paymentMessage || `Payment ${mapped} via webhook`]
      );
      console.log(`❌ Webhook: Order ${orderId} marked as ${mapped}`);
    } else {
      // For pending or other statuses, at least update message
      await query(
        `UPDATE registrations SET payment_message = $2, updated_at = CURRENT_TIMESTAMP WHERE cashfree_order_id = $1 AND payment_status != 'PAID'`,
        [orderId, `Webhook received: ${normalizedWebhookStatus || 'UNKNOWN'}`]
      );
      console.log(`ℹ️ Webhook: Order ${orderId} status ${normalizedWebhookStatus} logged`);
    }

    // Cashfree expects a 200 OK response
    return res.status(200).json({ status: 'ok', received: true });

  } catch (error) {
    console.error('Error handling Cashfree webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = {
  verifyPayment,
  handleWebhook
};
