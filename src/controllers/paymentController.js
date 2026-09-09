const { query } = require('../config/db');
const { getCashfreeOrder, verifyWebhookSignature } = require('../config/cashfree');

/**
 * Verifies payment status of an order with Cashfree and updates the database
 * Endpoint: GET /api/cashfree/verify?order_id=XXXX
 * Expected response format:
 * { "status": "paid" | "failed" | "pending", "registrationId": "NCY-XXXXXX" }
 */
async function verifyPayment(req, res, next) {
  const orderId = req.query.order_id;

  if (!orderId) {
    return res.status(400).json({
      error: 'Missing required query parameter: order_id'
    });
  }

  try {
    // 1. Look up registration in the database
    const findResult = await query(
      `SELECT id, registration_id, payment_status, cashfree_order_id, amount
       FROM registrations
       WHERE cashfree_order_id = $1`,
      [orderId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({
        error: `No registration found for order_id: ${orderId}`
      });
    }

    const registration = findResult.rows[0];

    // 2. If already marked as paid, return paid status immediately
    if (registration.payment_status === 'paid') {
      return res.json({
        status: 'paid',
        registrationId: registration.registration_id
      });
    }

    // 3. Query Cashfree Orders API for latest order status
    let cfOrder;
    try {
      cfOrder = await getCashfreeOrder(orderId);
    } catch (cfError) {
      console.error(`Error querying Cashfree for order ${orderId}:`, cfError.message);
      return res.status(502).json({
        error: `Unable to verify order with payment gateway: ${cfError.message}`,
        status: 'pending',
        registrationId: registration.registration_id
      });
    }

    const cfStatus = (cfOrder.order_status || '').toUpperCase();
    let clientStatus = 'pending';
    let dbStatus = registration.payment_status;

    // 4. Map Cashfree order_status to client status
    if (cfStatus === 'PAID') {
      clientStatus = 'paid';
      dbStatus = 'paid';
    } else if (cfStatus === 'ACTIVE') {
      clientStatus = 'pending';
      dbStatus = 'pending';
    } else if (['TERMINATED', 'EXPIRED', 'FAILED'].includes(cfStatus)) {
      clientStatus = 'failed';
      dbStatus = 'failed';
    }

    // 5. Update database if payment status changed
    if (dbStatus !== registration.payment_status) {
      await query(
        `UPDATE registrations
         SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [dbStatus, registration.id]
      );
      console.log(`Updated registration ${registration.registration_id} payment_status to ${dbStatus}`);
    }

    // 6. Return standard JSON response to frontend
    return res.json({
      status: clientStatus,
      registrationId: registration.registration_id
    });

  } catch (error) {
    console.error('Error during payment verification:', error);
    return next(error);
  }
}

/**
 * Handles Cashfree webhook notifications for asynchronous payment updates
 * Endpoint: POST /api/cashfree/webhook
 */
async function handleWebhook(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const rawBody = req.rawBody;

  // 1. Verify webhook signature
  const isValid = verifyWebhookSignature(signature, timestamp, rawBody);
  if (!isValid) {
    console.warn('⚠️ Rejected Cashfree webhook: Invalid HMAC signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  try {
    const payload = req.body;
    console.log('Received Cashfree webhook notification:', JSON.stringify(payload));

    // Support both Cashfree 2023-08-01 format (data.order, data.payment) and legacy format
    const orderId = payload?.data?.order?.order_id || payload?.order_id || payload?.data?.order_id;
    const paymentStatus = payload?.data?.payment?.payment_status || payload?.txStatus || payload?.data?.payment_status;

    if (!orderId) {
      console.warn('Webhook payload missing order_id:', payload);
      return res.status(400).json({ error: 'Missing order_id in webhook payload' });
    }

    if (paymentStatus === 'SUCCESS') {
      await query(
        `UPDATE registrations
         SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP
         WHERE cashfree_order_id = $1`,
        [orderId]
      );
      console.log(`✅ Webhook: Order ${orderId} marked as PAID`);
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED') {
      await query(
        `UPDATE registrations
         SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE cashfree_order_id = $1 AND payment_status != 'paid'`,
        [orderId]
      );
      console.log(`❌ Webhook: Order ${orderId} marked as FAILED`);
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
