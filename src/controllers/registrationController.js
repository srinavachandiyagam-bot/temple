const db = require('../config/db');
const { createPhonePeOrder, PHONEPE_ENV } = require('../config/phonepe');
const { generateRegistrationId, generatePhonePeOrderId } = require('../utils/idGenerator');
const { calculatePaymentAmounts } = require('../config/pricing');

/**
 * Controller to handle devotee registration and PhonePe payment order creation
 * Endpoint: POST /api/register
 * FIXED: Participation amount is ₹999 only, no donation. Server is authoritative via pricing.js.
 */
async function registerDevotee(req, res, next) {
  const { name, mobile, email, address, rasi, natchathiram, gothram, members } = req.sanitizedBody;
  let pricing;
  try {
    pricing = await calculatePaymentAmounts(0);
  } catch (pricingErr) {
    const status = pricingErr.status || 500;
    return res.status(status).json({ success: false, error: pricingErr.message || 'Invalid payment amounts.' });
  }
  const amount = pricing.totalAmount; // should be 999
  const amountPaise = Math.round(amount * 100); // 99900

  const registrationId = generateRegistrationId();
  const phonepeMerchantOrderId = generatePhonePeOrderId(registrationId);

  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.CLIENT_URL || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
  const clientUrl = process.env.CLIENT_URL || baseUrl;
  const serverUrl = process.env.SERVER_URL || baseUrl;
  const redirectUrl = `${clientUrl}/?order_id=${encodeURIComponent(phonepeMerchantOrderId)}`;

  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');

    // Single authoritative INSERT – donation_amount is required and always 0.
    // No legacy retry: if the column is missing, the DB migration (dbReady) must have failed
    // and the transaction will safely rollback via the outer catch (never 25P02).
    const insertRegQuery = `
      INSERT INTO registrations (
        registration_id, name, mobile, email, address,
        rasi, natchathiram, gothram, payment_status,
        cashfree_order_id, phonepe_merchant_order_id, phonepe_order_id, amount, donation_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $9, $9, $10, $11)
      RETURNING id, registration_id, name, mobile, payment_status, created_at;
    `;

    const regResult = await client.query(insertRegQuery, [
      registrationId, name, mobile, email, address, rasi, natchathiram, gothram,
      phonepeMerchantOrderId, amount, 0
    ]);

    const createdRegistration = regResult.rows[0];

    if (members && members.length > 0) {
      const insertMemberQuery = `
        INSERT INTO registration_members (
          registration_id, member_number, name, rasi, natchathiram, gothram
        ) VALUES ($1, $2, $3, $4, $5, $6);
      `;
      for (const m of members) {
        await client.query(insertMemberQuery, [
          createdRegistration.id, m.memberNumber, m.name, m.rasi, m.natchathiram, m.gothram
        ]);
      }
    }

    let phonepeOrder;
    try {
      phonepeOrder = await createPhonePeOrder({
        merchantOrderId: phonepeMerchantOrderId,
        amountPaise: amountPaise,
        redirectUrl: redirectUrl,
        message: `Nava Chandi Yagam - ${registrationId}`,
        metaInfo: { udf1: registrationId, udf2: name, udf3: mobile }
      });
      // Persist PhonePe internal orderId if available
      if (phonepeOrder.orderId) {
        try {
          await client.query(`UPDATE registrations SET phonepe_order_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [phonepeOrder.orderId, createdRegistration.id]);
        } catch (e) {
          // Column may not exist yet – ignore, already have merchant id
        }
      }
    } catch (ppError) {
      await client.query('ROLLBACK');
      console.error('PhonePe Order creation failed:', ppError.message, ppError.details || '');
      return res.status(502).json({
        success: false,
        error: `Payment gateway error: ${ppError.message}`,
        details: ppError.details
      });
    }

    await client.query('COMMIT');

    const isMock = phonepeOrder.redirectUrl && phonepeOrder.redirectUrl.includes('/mock-checkout');
    const checkoutUrl = phonepeOrder.redirectUrl || null;

    return res.status(201).json({
      success: true,
      message: 'Registration created successfully. Please proceed with payment.',
      registrationId,
      orderId: phonepeMerchantOrderId,
      merchantOrderId: phonepeMerchantOrderId,
      phonepeOrderId: phonepeOrder.orderId || null,
      redirectUrl: checkoutUrl,
      checkoutUrl: checkoutUrl,
      paymentMode: PHONEPE_ENV,
      registrationFee: amount,
      donationAmount: 0,
      amount,
      amountPaise,
      mockCheckoutUrl: isMock ? checkoutUrl : null
    });

  } catch (dbError) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { console.error('Rollback error:', e); }
    }
    console.error('Registration database error:', dbError);
    return next(dbError);
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  registerDevotee
};
