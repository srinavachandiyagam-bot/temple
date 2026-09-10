const db = require('../config/db');
const { createCashfreeOrder, CASHFREE_ENV } = require('../config/cashfree');
const { generateRegistrationId, generateCashfreeOrderId } = require('../utils/idGenerator');
const { calculatePaymentAmounts } = require('../config/pricing');
const { appendAuditEvent } = require('../config/auditLog');

/**
 * Controller to handle devotee registration and Cashfree payment order creation
 * Endpoint: POST /api/register
 */
async function registerDevotee(req, res, next) {
  const { name, mobile, email, address, rasi, natchathiram, gothram, members, donationAmount } = req.sanitizedBody;
  // Server is the authority: registration fee from admin settings, donation validated above.
  // Any client-sent registrationFee/amount/totalAmount is ignored.
  let pricing;
  try {
    pricing = await calculatePaymentAmounts(donationAmount);
  } catch (pricingErr) {
    const status = pricingErr.status || 500;
    return res.status(status).json({ success: false, error: pricingErr.message || 'Invalid payment amounts.' });
  }
  const registrationFee = pricing.registrationFee;
  const donation = pricing.donationAmount;
  const amount = pricing.totalAmount;

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
    client = await db.getClient();
    await client.query('BEGIN');

    // 4. Insert into registrations table with pending_payment status
    // amount = TOTAL charged (fee + donation) for backward compatibility.
    // donation_amount is REQUIRED. There is intentionally NO legacy fallback
    // retry here: once a statement fails inside a PostgreSQL transaction, the
    // transaction is aborted (25P02) and any further INSERT in the same
    // transaction is invalid. If the schema is missing donation_amount,
    // fail safely via ROLLBACK + error instead of silently dropping donations.
    const insertRegQuery = `
      INSERT INTO registrations (
        registration_id, name, mobile, email, address,
        rasi, natchathiram, gothram, payment_status,
        cashfree_order_id, amount, donation_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11)
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
      amount,
      donation
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

    // 6. Append the CREATED audit event inside the same transaction, after
    // the registration, family rows and cashfree_order_id are known but
    // BEFORE COMMIT. If payment-order creation fails below, ROLLBACK removes
    // this event too. No backfill is done for historical rows that predate
    // the audit system; they remain valid without a CREATED event.
    await appendAuditEvent(
      (text, params) => client.query(text, params),
      {
        registration_db_id: createdRegistration.id,
        registration_id: registrationId,
        action: 'CREATED',
        actor_admin_id: null,
        actor_username: 'SYSTEM:PARTICIPANT',
        snapshot: {
          source: 'participant_registration',
          registration_id: registrationId,
          name,
          mobile,
          email,
          address,
          rasi,
          natchathiram,
          gothram,
          family_members: members || [],
          registration_fee: registrationFee,
          donation_amount: donation,
          total_amount: amount,
          cashfree_order_id: cashfreeOrderId,
          initial_payment_status: 'pending'
        }
      }
    );

    // 7. Create payment order with Cashfree Orders API
    let cashfreeOrder;
    try {
      cashfreeOrder = await createCashfreeOrder({
        orderId: cashfreeOrderId,
        orderAmount: amount,
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

    // 8. Commit database transaction
    await client.query('COMMIT');

    // 9. Return payment session and order details to frontend
    // Server response is authoritative if frontend preview differs.
    return res.status(201).json({
      success: true,
      message: 'Registration created successfully. Please proceed with payment.',
      registrationId,
      orderId: cashfreeOrderId,
      paymentSessionId: cashfreeOrder.payment_session_id,
      paymentMode: CASHFREE_ENV,
      registrationFee,
      donationAmount: donation,
      amount,
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

module.exports = {
  registerDevotee
};
