const { getClient, query } = require('../config/db');
const { createCashfreeOrder, CASHFREE_ENV } = require('../config/cashfree');
const { generateRegistrationId, generateCashfreeOrderId } = require('../utils/idGenerator');
const { getPublicData } = require('../config/settingsManager');
const { normalizeStatus } = require('../utils/constants');

function resolveValidatedAmount(clientAmount, settings) {
  const paymentMode = (settings.payment_mode || 'fixed').toLowerCase();
  const defaultAmount = Number(settings.default_amount || settings.amount || 1000);
  const minimumCustom = Number(settings.minimum_custom_amount || 100);

  if (!Number.isFinite(defaultAmount) || defaultAmount <= 0) {
    throw new Error('Server payment configuration error: invalid default amount');
  }
  if (paymentMode === 'fixed') {
    // Fixed mode: ignore any client-supplied amount
    return Math.round(defaultAmount);
  }
  // Custom / donation mode
  let amt;
  if (clientAmount === undefined || clientAmount === null || String(clientAmount).trim() === '') {
    amt = defaultAmount;
  } else {
    const raw = String(clientAmount).trim().replace(/,/g, '');
    // Strict numeric check: allow digits and at most one dot
    if (!/^-?\d+(\.\d+)?$/.test(raw)) {
      throw new Error('Amount must be numeric');
    }
    amt = Number(raw);
    if (!Number.isFinite(amt)) throw new Error('Amount must be numeric');
  }
  if (amt <= 0) throw new Error('Amount must be positive');
  if (!Number.isFinite(amt)) throw new Error('Amount must be numeric');
  if (amt < minimumCustom) throw new Error(`Amount must be at least ₹${minimumCustom}`);
  // Round to nearest integer rupee (Cashfree expects numeric, we support paise but keep integer for UI)
  // Keep 2 decimal precision but validate
  if (amt > 1000000) throw new Error('Amount exceeds maximum allowed (₹10,00,000)');
  return Math.round(amt);
}

/**
 * Controller to handle devotee registration and Cashfree payment order creation
 * Endpoint: POST /api/register
 */
async function registerDevotee(req, res, next) {
  const { name, mobile, email, address, rasi, natchathiram, gothram, members } = req.sanitizedBody;
  // Amount supplied by client (never trust browser) - will be server-validated
  const clientAmount = req.body.amount !== undefined ? req.body.amount : req.body.custom_amount;
  let validatedAmount;
  try {
    const settings = getPublicData().settings || {};
    validatedAmount = resolveValidatedAmount(clientAmount, settings);
  } catch (amtErr) {
    return res.status(400).json({ success: false, error: amtErr.message });
  }

  // 1. Generate unique identifiers
  const registrationId = generateRegistrationId();
  const cashfreeOrderId = generateCashfreeOrderId(registrationId);

  // 2. Prepare URLs for payment redirection and webhook
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.CLIENT_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
  const clientUrl = process.env.CLIENT_URL || baseUrl;
  const serverUrl = process.env.SERVER_URL || baseUrl;
  const returnUrl = `${clientUrl}/?order_id={order_id}`;
  const notifyUrl = `${serverUrl}/api/cashfree/webhook`;

  let client;
  try {
    // 3. Connect to Database and start transaction
    client = await getClient();
    await client.query('BEGIN');

    // 4. Insert into registrations table with PENDING status (state machine: CREATED -> PENDING)
    const insertRegQuery = `
      INSERT INTO registrations (
        registration_id, name, mobile, email, address,
        rasi, natchathiram, gothram, payment_status,
        cashfree_order_id, cf_order_id, order_id, amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $9, $9, $10)
      RETURNING id, registration_id, name, mobile, payment_status, created_at;
    `;

    const regResult = await client.query(insertRegQuery, [
      registrationId,
      name,
      mobile,
      email,
      address,
      rasi,
      natchathiram,
      gothram,
      cashfreeOrderId,
      validatedAmount
    ]);

    const createdRegistration = regResult.rows[0];

    // 5. Insert family members if provided
    if (members && members.length > 0) {
      const insertMemberQuery = `
        INSERT INTO registration_members (
          registration_id, member_number, name, rasi, natchathiram, gothram
        ) VALUES ($1, $2, $3, $4, $5, $6);
      `;

      for (const m of members) {
        await client.query(insertMemberQuery, [
          createdRegistration.id,
          m.memberNumber,
          m.name,
          m.rasi,
          m.natchathiram,
          m.gothram
        ]);
      }
    }

    // 6. Create payment order with Cashfree Orders API (uses server-validated amount)
    let cashfreeOrder;
    try {
      cashfreeOrder = await createCashfreeOrder({
        orderId: cashfreeOrderId,
        orderAmount: validatedAmount,
        customerName: name,
        customerPhone: mobile,
        customerEmail: email,
        returnUrl,
        notifyUrl,
        orderNote: `Nava Chandi Yagam - ${registrationId}`
      });
    } catch (cfError) {
      // Rollback database transaction if payment gateway order creation fails
      await client.query('ROLLBACK');
      console.error('Cashfree Order creation failed:', cfError.message, cfError.details || '');
      return res.status(502).json({
        success: false,
        error: `Payment gateway error: ${cfError.message}`,
        details: cfError.details
      });
    }

    // 7. Commit database transaction
    await client.query('COMMIT');

    // 8. Return payment session and order details to frontend (all amounts are server-validated)
    return res.status(201).json({
      success: true,
      message: 'Registration created successfully. Please proceed with payment.',
      registrationId,
      orderId: cashfreeOrderId,
      paymentSessionId: cashfreeOrder.payment_session_id,
      paymentMode: CASHFREE_ENV,
      amount: validatedAmount,
      payment_status: 'PENDING',
      mockCheckoutUrl: cashfreeOrder.mock_checkout_url || (cashfreeOrder.payment_session_id && cashfreeOrder.payment_session_id.startsWith('session_mock_') ? `/mock-checkout?order_id=${encodeURIComponent(cashfreeOrderId)}` : null)
    });

  } catch (dbError) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Error during rollback:', rollbackErr);
      }
    }

    console.error('Registration database error:', dbError);
    return next(dbError);
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Retry payment for an existing registration without re-entering form
 * Generates a new Cashfree order for the same registration using current validated amount
 * Endpoints: POST /api/registrations/:id/retry  or  POST /api/cashfree/retry
 */
async function retryPayment(req, res, next) {
  try {
    const identifier = req.params.id || req.body.registration_id || req.body.registrationId || req.body.order_id || req.query.order_id || req.query.registration_id;
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Registration identifier required (registration_id or order_id)' });
    }
    const clientAmount = req.body.amount !== undefined ? req.body.amount : req.body.custom_amount;
    const settings = getPublicData().settings || {};

    // Lookup registration by id, registration_id, or cashfree_order_id
    let regResult;
    // Try by registration_id first
    regResult = await query(`SELECT * FROM registrations WHERE registration_id = $1`, [String(identifier).trim()]);
    if (regResult.rows.length === 0) {
      regResult = await query(`SELECT * FROM registrations WHERE cashfree_order_id = $1`, [String(identifier).trim()]);
    }
    if (regResult.rows.length === 0) {
      // Try by numeric id
      if (/^\d+$/.test(String(identifier).trim())) {
        regResult = await query(`SELECT * FROM registrations WHERE id = $1`, [Number(identifier)]);
      }
    }
    if (regResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Registration not found' });
    }
    const reg = regResult.rows[0];
    const currentStatus = normalizeStatus(reg.payment_status);
    if (currentStatus === 'PAID') {
      return res.status(400).json({ success: false, error: 'Payment already completed (PAID) – no retry needed', registrationId: reg.registration_id });
    }

    // Determine validated amount for retry
    let validatedAmount;
    const paymentMode = (settings.payment_mode || 'fixed').toLowerCase();
    if (paymentMode === 'custom' && clientAmount !== undefined && String(clientAmount).trim() !== '') {
      // User supplied a new custom amount for retry
      try {
        validatedAmount = resolveValidatedAmount(clientAmount, settings);
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
    } else if (paymentMode === 'custom') {
      // No new amount supplied – try to reuse stored amount if still valid, otherwise use default
      try {
        validatedAmount = resolveValidatedAmount(reg.amount, settings);
      } catch (e) {
        // Stored amount no longer meets minimum – fallback to default
        validatedAmount = resolveValidatedAmount(undefined, settings);
      }
    } else {
      // Fixed mode – always use current default
      validatedAmount = resolveValidatedAmount(undefined, settings);
    }

    const newOrderId = generateCashfreeOrderId(reg.registration_id);
    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.CLIENT_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
    const clientUrl = process.env.CLIENT_URL || baseUrl;
    const serverUrl = process.env.SERVER_URL || baseUrl;
    const returnUrl = `${clientUrl}/?order_id={order_id}`;
    const notifyUrl = `${serverUrl}/api/cashfree/webhook`;

    let cashfreeOrder;
    try {
      cashfreeOrder = await createCashfreeOrder({
        orderId: newOrderId,
        orderAmount: validatedAmount,
        customerName: reg.name,
        customerPhone: reg.mobile,
        customerEmail: reg.email,
        returnUrl,
        notifyUrl,
        orderNote: `Nava Chandi Yagam Retry - ${reg.registration_id}`
      });
    } catch (cfError) {
      console.error('Retry Cashfree order failed:', cfError.message);
      return res.status(502).json({ success: false, error: `Payment gateway error: ${cfError.message}`, details: cfError.details });
    }

    // Update registration with new order and validated amount, reset status to PENDING
    await query(
      `UPDATE registrations SET cashfree_order_id = $1, cf_order_id = $1, order_id = $1, amount = $2, payment_status = 'PENDING', payment_message = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [newOrderId, validatedAmount, 'Retry payment initiated', reg.id]
    );

    return res.json({
      success: true,
      message: 'New payment order created for retry',
      registrationId: reg.registration_id,
      orderId: newOrderId,
      amount: validatedAmount,
      payment_status: 'PENDING',
      paymentSessionId: cashfreeOrder.payment_session_id,
      paymentMode: CASHFREE_ENV,
      mockCheckoutUrl: cashfreeOrder.mock_checkout_url || (cashfreeOrder.payment_session_id && cashfreeOrder.payment_session_id.startsWith('session_mock_') ? `/mock-checkout?order_id=${encodeURIComponent(newOrderId)}` : null)
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  registerDevotee,
  retryPayment,
  resolveValidatedAmount
};
