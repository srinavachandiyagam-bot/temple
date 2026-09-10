const { getClient } = require('../config/db');
const { createCashfreeOrder, CASHFREE_ENV } = require('../config/cashfree');
const { generateRegistrationId, generateCashfreeOrderId } = require('../utils/idGenerator');
const { calculatePaymentAmounts } = require('../config/pricing');

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
    pricing = calculatePaymentAmounts(donationAmount);
  } catch (pricingErr) {
    return res.status(400).json({ success: false, error: pricingErr.message || 'Invalid payment amounts.' });
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
    client = await getClient();
    await client.query('BEGIN');

    // 4. Insert into registrations table with pending_payment status
    // amount = TOTAL charged (fee + donation) for backward compatibility.
    const insertRegQuery = `
      INSERT INTO registrations (
        registration_id, name, mobile, email, address,
        rasi, natchathiram, gothram, payment_status,
        cashfree_order_id, amount, donation_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11)
      RETURNING id, registration_id, name, mobile, payment_status, created_at;
    `;

    const regResult = await (async () => {
      try {
        return await client.query(insertRegQuery, [
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
      } catch (insertErr) {
        // Backward-compatible fallback for databases not yet migrated
        // (missing donation_amount column): store total in amount only.
        const msg = String((insertErr && insertErr.message) || '');
        if (/donation_amount|no such column|undefined column/i.test(msg)) {
          console.warn('donation_amount column missing, falling back to legacy insert (total in amount only).');
          const legacyQuery = `
            INSERT INTO registrations (
              registration_id, name, mobile, email, address,
              rasi, natchathiram, gothram, payment_status,
              cashfree_order_id, amount
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
            RETURNING id, registration_id, name, mobile, payment_status, created_at;
          `;
          return client.query(legacyQuery, [
            registrationId,
            name,
            mobile,
            email,
            address,
            rasi,
            natchathiram,
            gothram,
            cashfreeOrderId,
            amount
          ]);
        }
        throw insertErr;
      }
    })();

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

    // 6. Create payment order with Cashfree Orders API
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

    // 7. Commit database transaction
    await client.query('COMMIT');

    // 8. Return payment session and order details to frontend
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
