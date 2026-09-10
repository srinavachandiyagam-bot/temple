const { query, getClient } = require('../config/db');
const { getCashfreeOrder, verifyWebhookSignature } = require('../config/cashfree');
const { amountsEqual } = require('../config/pricing');
const { appendAuditEvent } = require('../config/auditLog');

/**
 * Records a Cashfree-driven payment status change together with its audit
 * event inside one transaction. The UPDATE is conditional on the row still
 * being unarchived AND still carrying the previously observed status, so a
 * concurrent archive (or concurrent status change) between the earlier read
 * and this write cannot be silently overwritten.
 *
 * Returns true only when exactly one row transitioned (and the audit event
 * was appended). On rowCount === 0 nothing is mutated and no audit event is
 * created; the transaction is rolled back as a no-op and false is returned.
 */
async function applyCashfreeStatusChange({ registration, newStatus, action, actorUsername, cashfreeDetails }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE registrations
       SET payment_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND archived_at IS NULL
         AND payment_status = $3`,
      [newStatus, registration.id, registration.payment_status]
    );
    if (!updateResult || updateResult.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    await appendAuditEvent(
      (text, params) => client.query(text, params),
      {
        registration_db_id: registration.id,
        registration_id: registration.registration_id,
        action,
        actor_admin_id: null,
        actor_username: actorUsername,
        snapshot: Object.assign(
          {
            source: 'cashfree',
            before_payment_status: registration.payment_status,
            after_payment_status: newStatus,
            cashfree_order_id: registration.cashfree_order_id,
            amount: registration.amount !== undefined ? Number(registration.amount) : null,
            donation_amount: registration.donation_amount !== undefined && registration.donation_amount !== null
              ? Number(registration.donation_amount)
              : 0
          },
          cashfreeDetails || {}
        )
      }
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {}
    throw err;
  } finally {
    if (client && typeof client.release === 'function') {
      try { client.release(); } catch (e) {}
    }
  }
}

/**
 * Looks up a registration by Cashfree order id.
 * Tolerates databases not yet migrated (missing donation_amount column).
 */
async function findRegistrationByOrderId(orderId) {
  try {
    const r = await query(
      `SELECT id, registration_id, payment_status, cashfree_order_id, amount, donation_amount, archived_at
       FROM registrations
       WHERE cashfree_order_id = $1`,
      [orderId]
    );
    return r;
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (/donation_amount|archived_at|no such column|undefined column/i.test(msg)) {
      return query(
        `SELECT id, registration_id, payment_status, cashfree_order_id, amount
         FROM registrations
         WHERE cashfree_order_id = $1`,
        [orderId]
      );
    }
    throw err;
  }
}

/**
 * Archived rows are historical evidence: Cashfree-driven flows must never
 * mutate them either. Report current state without changes or audit events.
 */
function archivedStatusResponse(registration) {
  const dbStatus = registration.payment_status;
  const clientStatus = dbStatus === 'paid' ? 'paid' : dbStatus === 'failed' ? 'failed' : 'pending';
  return { status: clientStatus, registrationId: registration.registration_id };
}

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
    const findResult = await findRegistrationByOrderId(orderId);

    if (findResult.rows.length === 0) {
      return res.status(404).json({
        error: `No registration found for order_id: ${orderId}`
      });
    }

    const registration = findResult.rows[0];

    // Archived rows are read-only history: report state, change nothing.
    if (registration.archived_at) {
      return res.json(archivedStatusResponse(registration));
    }

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

    // 4. Map Cashfree order_status to client status (PAID requires amount match)
    if (cfStatus === 'PAID') {
      if (!amountsEqual(cfOrder.order_amount, registration.amount)) {
        console.warn(
          `Amount mismatch for order ${orderId}: cashfree=${cfOrder.order_amount} db=${registration.amount}. NOT marking paid.`
        );
        return res.status(409).json({
          error: 'Payment amount mismatch. Registration not marked as paid.',
          status: 'pending',
          registrationId: registration.registration_id
        });
      }
      clientStatus = 'paid';
      dbStatus = 'paid';
    } else if (cfStatus === 'ACTIVE') {
      clientStatus = 'pending';
      dbStatus = 'pending';
    } else if (['TERMINATED', 'EXPIRED', 'FAILED'].includes(cfStatus)) {
      clientStatus = 'failed';
      dbStatus = 'failed';
    }

    // 5. Update database if payment status changed (audited; silent if same
    // or if the row was concurrently archived/changed: then rowCount is 0
    // and no audit event is created).
    if (dbStatus !== registration.payment_status) {
      const updated = await applyCashfreeStatusChange({
        registration,
        newStatus: dbStatus,
        action: 'PAYMENT_VERIFIED',
        actorUsername: 'SYSTEM:CASHFREE_VERIFY',
        cashfreeDetails: { cashfree_order_status: cfStatus, cashfree_amount: cfOrder.order_amount }
      });
      if (updated) {
        console.log(`Updated registration ${registration.registration_id} payment_status to ${dbStatus}`);
      }
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
      // Harden: locate registration + re-fetch authoritative Cashfree order
      // and verify amounts match before marking paid. Do not trust SUCCESS alone.
      const findResult = await findRegistrationByOrderId(orderId);
      if (findResult.rows.length === 0) {
        console.warn(`Webhook: no registration found for order ${orderId}`);
        return res.status(404).json({ error: 'Registration not found for order' });
      }
      const registration = findResult.rows[0];
      if (registration.archived_at) {
        return res.status(200).json({ status: 'ok', received: true });
      }
      if (registration.payment_status === 'paid') {
        return res.status(200).json({ status: 'ok', received: true });
      }
      let cfOrder;
      try {
        cfOrder = await getCashfreeOrder(orderId);
      } catch (cfError) {
        console.error(`Webhook: unable to re-fetch order ${orderId}:`, cfError.message);
        return res.status(502).json({ error: 'Unable to verify order with payment gateway' });
      }
      const cfStatus = String(cfOrder.order_status || '').toUpperCase();
      if (cfStatus !== 'PAID') {
        console.log(`Webhook: Order ${orderId} SUCCESS received but Cashfree status is ${cfStatus}; not marking paid.`);
        return res.status(200).json({ status: 'ok', received: true, verified: false });
      }
      if (!amountsEqual(cfOrder.order_amount, registration.amount)) {
        console.warn(
          `Webhook amount mismatch for order ${orderId}: cashfree=${cfOrder.order_amount} db=${registration.amount}. NOT marking paid.`
        );
        return res.status(200).json({ status: 'ok', received: true, verified: false, reason: 'amount_mismatch' });
      }
      const updated = await applyCashfreeStatusChange({
        registration,
        newStatus: 'paid',
        action: 'PAYMENT_WEBHOOK_UPDATE',
        actorUsername: 'SYSTEM:CASHFREE_WEBHOOK',
        cashfreeDetails: { webhook_payment_status: paymentStatus, cashfree_order_status: cfStatus, cashfree_amount: cfOrder.order_amount, verified: true }
      });
      if (updated) {
        console.log(`✅ Webhook: Order ${orderId} marked as PAID`);
      }
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED') {
      // No raw fallback UPDATE may run here: every outcome below either
      // leaves the row untouched or goes through the audited path.
      // - missing registration: acknowledge, mutate nothing
      // - archived registration: acknowledge, mutate nothing, no event
      // - already paid: never downgrade
      // - already failed: no-op, no duplicate event
      // - otherwise: audited PAYMENT_WEBHOOK_UPDATE transition
      const failedLookup = await findRegistrationByOrderId(orderId);
      const failedReg = failedLookup.rows[0];
      if (!failedReg) {
        console.log(`Webhook: no registration found for order ${orderId}; acknowledged without changes.`);
      } else if (failedReg.archived_at) {
        console.log(`Webhook: Order ${orderId} targets archived registration ${failedReg.registration_id}; acknowledged without changes.`);
      } else if (failedReg.payment_status === 'paid') {
        console.log(`Webhook: Order ${orderId} already paid; not downgrading.`);
      } else if (failedReg.payment_status === 'failed') {
        console.log(`Webhook: Order ${orderId} already failed; no duplicate event.`);
      } else {
        const updated = await applyCashfreeStatusChange({
          registration: failedReg,
          newStatus: 'failed',
          action: 'PAYMENT_WEBHOOK_UPDATE',
          actorUsername: 'SYSTEM:CASHFREE_WEBHOOK',
          cashfreeDetails: { webhook_payment_status: paymentStatus }
        });
        if (updated) {
          console.log(`❌ Webhook: Order ${orderId} marked as FAILED`);
        }
      }
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
  handleWebhook,
  applyCashfreeStatusChange
};
