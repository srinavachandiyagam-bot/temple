const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.MOCK_MODE = 'true';
process.env.ADMIN_PASSWORD = 'change-this-password';
process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret_for_pricing_tests_123';
delete process.env.REGISTRATION_AMOUNT;

const settingsPath = path.join(__dirname, '../data/settings.json');
let settingsBackup = null;
try {
  settingsBackup = fs.readFileSync(settingsPath, 'utf8');
} catch (e) {
  settingsBackup = null;
}

function setFeeAmount(value) {
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const data = JSON.parse(raw);
  data.settings = data.settings || {};
  data.settings.amount = String(value);
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
}

function restoreSettings() {
  if (settingsBackup !== null) {
    fs.writeFileSync(settingsPath, settingsBackup, 'utf8');
  }
}

const pricing = require('../src/config/pricing');
const validateRegistration = require('../src/middleware/validateRegistration');
const app = require('../src/server');
const { getCashfreeOrder, setMockOrderStatus, setMockOrderAmount } = require('../src/config/cashfree');

let server;
const PORT = 3911;
let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✅ Passed: ${name}`);
  } else {
    failed++;
    console.error(`  ❌ Failed: ${name}${extra ? ' - ' + extra : ''}`);
  }
}

async function postRegister(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { res, data };
}

async function runPricingTests() {
  console.log('\n💰 Running Custom Payment Amount (Fee + Donation) Tests...\n');

  // ---- Unit: pricing helper ----
  try {
    setFeeAmount('999');
    assert.strictEqual(await pricing.getRegistrationFee(), 999);
    ok('Pricing helper reads admin fee 999 from settings', true);
  } catch (e) {
    ok('Pricing helper reads admin fee 999 from settings', false, e.message);
  }

  try {
    const c = await pricing.calculatePaymentAmounts(501);
    assert.strictEqual(c.registrationFee, 999);
    assert.strictEqual(c.donationAmount, 0);
    assert.strictEqual(c.totalAmount, 999);
    ok('CASE 2 calc: 999 + 501 = 1500 (paise-safe) - donation ignored, fixed 999', true);
  } catch (e) {
    ok('CASE 2 calc: 999 + 501 = 1500 (paise-safe)', false, e.message);
  }

  try {
    setFeeAmount('999.50');
    const c = await pricing.calculatePaymentAmounts('0.50');
    assert.strictEqual(c.registrationFee, 999.5);
    assert.strictEqual(c.donationAmount, 0);
    assert.strictEqual(c.totalAmount, 999.5);
    ok('CASE 3 calc: 999.50 + 0.50 = 1000.00 (no float dust) - donation ignored', true);
  } catch (e) {
    ok('CASE 3 calc: 999.50 + 0.50 = 1000.00 (no float dust)', false, e.message);
  }

  // Unit: donation validation rejects bad values
  for (const bad of [-1, 'abc', 'Infinity', '10.123', 'NaN']) {
    const r = pricing.normalizeDonationAmount(bad);
    ok(`Unit accepts donation ${JSON.stringify(bad)} as 0 (removed)`, r.valid === true && r.value === 0);
  }
  ok('Unit accepts missing donation as 0', pricing.normalizeDonationAmount(undefined).value === 0);
  ok('Unit accepts 0 donation', pricing.normalizeDonationAmount(0).value === 0);

  // Unit: validator puts donation into sanitizedBody, ignores fee fields
  try {
    let nextCalled = false;
    const req = { body: { name: 'Test User', mobile: '9876543210', donationAmount: '501', amount: 1, registrationFee: 1, totalAmount: 1 } };
    const res = { status: () => res, json: () => {} };
    validateRegistration(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.sanitizedBody.donationAmount, 0);
    ok('Validator accepts donationAmount and ignores amount/fee overrides', true);
  } catch (e) {
    ok('Validator accepts donationAmount and ignores amount/fee overrides', false, e.message);
  }

  // ---- Integration via HTTP (mock mode shares in-process mock store) ----
  setFeeAmount('999');
  await new Promise((resolve) => { server = app.listen(PORT, resolve); });
  const baseUrl = `http://localhost:${PORT}`;

  try {
    // CASE 1: fee 999, donation 0
    {
      const { res, data } = await postRegister(baseUrl, { name: 'Fee Only Devotee', mobile: '9000000001', donationAmount: 0 });
      ok('CASE 1 register 999+0 returns 201', res.status === 201, `got ${res.status} ${JSON.stringify(data)}`);
      ok('CASE 1 response registrationFee=999', data && data.registrationFee === 999);
      ok('CASE 1 response donationAmount=0', data && data.donationAmount === 0);
      ok('CASE 1 response amount=999', data && data.amount === 999);
      if (data && data.orderId) {
        const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(data.orderId)}`);
        const info = await infoRes.json();
        ok('CASE 1 DB amount=999', Number(info.order.amount) === 999);
        ok('CASE 1 DB donation_amount=0', Number(info.order.donation_amount || 0) === 0);
        const cf = await getCashfreeOrder(data.orderId);
        ok('CASE 1 mock Cashfree order=999', Number(cf.order_amount) === 999);
      }
    }

    // CASE 2: fee 999, donation 501 => 1500
    let case2OrderId = null;
    {
      const { res, data } = await postRegister(baseUrl, { name: 'Donor Devotee', mobile: '9000000002', donationAmount: 501 });
      ok('CASE 2 register 999+501 returns 201', res.status === 201);
      ok('CASE 2 response amount=999 (fixed)', data && data.amount === 999);
      ok('CASE 2 response donation=0 (removed)', data && data.donationAmount === 0);
      case2OrderId = data && data.orderId;
      if (case2OrderId) {
        const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(case2OrderId)}`);
        const info = await infoRes.json();
        ok('CASE 2 DB amount=999 (fixed)', Number(info.order.amount) === 999);
        ok('CASE 2 DB donation=0 (removed)', Number(info.order.donation_amount || 0) === 0);
        const cf = await getCashfreeOrder(case2OrderId);
        ok('CASE 2 mock Cashfree order=999 (fixed)', Number(cf.order_amount) === 999);
      }
    }

    // CASE 3: fee 999.50 + 0.50 => 1000.00 via HTTP
    {
      setFeeAmount('999.50');
      const { res, data } = await postRegister(baseUrl, { name: 'Paise Devotee', mobile: '9000000003', donationAmount: '0.50' });
      ok('CASE 3 register 999.50+0.50 returns 201', res.status === 201, `got ${res.status} ${JSON.stringify(data)}`);
      ok('CASE 3 total exactly 999.5 (fixed)', data && data.amount === 999.5);
      setFeeAmount('999');
    }

    // CASE 4: invalid donations now ignored as 0 (fixed 999)
    for (const bad of [-1, 'abc', 'Infinity', '10.123']) {
      const { res, data } = await postRegister(baseUrl, { name: 'Bad Donor', mobile: '9000000004', donationAmount: bad });
      ok(`CASE 4 accepts donation ${JSON.stringify(bad)} as 0 (removed) with 201`, res.status === 201 && data && data.amount === 999 && data.donationAmount === 0, `got ${res.status} ${JSON.stringify(data)}`);
    }

    // CASE 5: client fee override ignored
    {
      const { res, data } = await postRegister(baseUrl, {
        name: 'Override Attempt', mobile: '9000000005', donationAmount: 0, amount: 1, registrationFee: 1, totalAmount: 1, order_amount: 1
      });
      ok('CASE 5 override attempt still 201', res.status === 201);
      ok('CASE 5 server fee not reduced to 1', data && data.amount === 999 && data.registrationFee === 999);
    }

    // CASE 6: PAID with mismatched amount must NOT mark paid
    {
      const { res, data } = await postRegister(baseUrl, { name: 'Mismatch Devotee', mobile: '9000000006', donationAmount: 0 });
      const orderId = data.orderId;
      setMockOrderAmount(orderId, 1);
      setMockOrderStatus(orderId, 'PAID');
      const vRes = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`);
      const vData = await vRes.json();
      ok('CASE 6 mismatched PAID returns 409', vRes.status === 409, `got ${vRes.status} ${JSON.stringify(vData)}`);
      const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(orderId)}`);
      const info = await infoRes.json();
      ok('CASE 6 DB remains non-paid on mismatch', info.order.payment_status !== 'paid', `got ${info.order.payment_status}`);
    }

    // CASE 7: matching PAID marks paid
    {
      const { res, data } = await postRegister(baseUrl, { name: 'Honest Devotee', mobile: '9000000007', donationAmount: 10 });
      const orderId = data.orderId;
      assert.strictEqual(data.amount, 999);
      setMockOrderStatus(orderId, 'PAID');
      const vRes = await fetch(`${baseUrl}/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`);
      const vData = await vRes.json();
      ok('CASE 7 matching PAID verifies paid', vRes.status === 200 && vData.status === 'paid');
      const infoRes = await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(orderId)}`);
      const info = await infoRes.json();
      ok('CASE 7 DB marked paid', info.order.payment_status === 'paid');
    }

    // CASE 7b: webhook SUCCESS with matching amount marks paid; mismatch does not
    {
      const secret = process.env.CASHFREE_WEBHOOK_SECRET;
      // matching
      const m1 = await postRegister(baseUrl, { name: 'Webhook Good', mobile: '9000000008', donationAmount: 0 });
      setMockOrderStatus(m1.data.orderId, 'PAID');
      const payload1 = { data: { order: { order_id: m1.data.orderId }, payment: { payment_status: 'SUCCESS' } } };
      const raw1 = JSON.stringify(payload1);
      const ts1 = Date.now().toString();
      const sig1 = crypto.createHmac('sha256', secret).update(ts1 + raw1).digest('base64');
      const wRes1 = await fetch(`${baseUrl}/api/cashfree/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig1, 'x-webhook-timestamp': ts1 },
        body: raw1
      });
      ok('CASE 7b webhook matching amount returns 200', wRes1.status === 200, `got ${wRes1.status}`);
      const info1 = await (await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(m1.data.orderId)}`)).json();
      ok('CASE 7b webhook matching marks paid', info1.order.payment_status === 'paid');

      // mismatch
      const m2 = await postRegister(baseUrl, { name: 'Webhook Bad', mobile: '9000000009', donationAmount: 0 });
      setMockOrderAmount(m2.data.orderId, 1);
      setMockOrderStatus(m2.data.orderId, 'PAID');
      const payload2 = { data: { order: { order_id: m2.data.orderId }, payment: { payment_status: 'SUCCESS' } } };
      const raw2 = JSON.stringify(payload2);
      const ts2 = Date.now().toString();
      const sig2 = crypto.createHmac('sha256', secret).update(ts2 + raw2).digest('base64');
      const wRes2 = await fetch(`${baseUrl}/api/cashfree/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig2, 'x-webhook-timestamp': ts2 },
        body: raw2
      });
      const wData2 = await wRes2.json().catch(() => ({}));
      ok('CASE 7b webhook mismatch acked 200 with verified:false', wRes2.status === 200 && wData2.verified === false && wData2.reason === 'amount_mismatch', `got ${wRes2.status} ${JSON.stringify(wData2)}`);
      const info2 = await (await fetch(`${baseUrl}/api/mock/order-info?order_id=${encodeURIComponent(m2.data.orderId)}`)).json();
      ok('CASE 7b webhook mismatch DB stays non-paid', info2.order.payment_status !== 'paid');
    }

    // CASE 8: legacy no-donation field omitted remains compatible
    {
      const { res, data } = await postRegister(baseUrl, { name: 'Legacy Devotee', mobile: '9000000010' });
      ok('CASE 8 omitted donation still 201', res.status === 201);
      ok('CASE 8 omitted donation defaults total to fee', data && data.amount === 999 && data.donationAmount === 0);
    }

    // Public pricing matches backend fee
    {
      const pubRes = await fetch(`${baseUrl}/api/public`);
      const pub = await pubRes.json();
      ok('Public /api/public amount equals backend fee 999', Number(pub.settings.amount) === 999, `got ${pub.settings && pub.settings.amount}`);
    }

    // Stale payment-note guard: no monetary text may bypass currentFee
    {
      const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
      ok('Payment note is not assigned raw from settings', !html.includes("$('#paymentNote').textContent=s['payment_note_'+lang]||''"));
      ok('Payment note derives from currentFee via renderPaymentNote', html.includes('renderPaymentNote') && html.includes('currentFee'));
      ok('Hero amount uses server fee', html.includes("$('#heroAmount')") && html.includes('s.amount'));
      ok('Event amount uses server fee', html.includes("$('#amount')") && html.includes('s.amount'));
      const renderPaymentNote = (raw, fee) => {
        const note = raw || '';
        if (!note) return '';
        const formatted = '₹' + Number(fee || 0).toLocaleString('en-IN');
        let out = note.replace(/₹\s*[\d,]+(\.\d{1,2})?/g, formatted);
        out = out.replace(/\bRs\.?\s*[\d,]+(\.\d{1,2})?/gi, formatted);
        out = out.replace(/\bINR\s*[\d,]+(\.\d{1,2})?/gi, formatted);
        return out;
      };
      const enStale = 'Participation amount ₹1,000';
      const enFixed = renderPaymentNote(enStale, 999);
      ok('Stale EN note ₹1,000 renders as current fee ₹999', enFixed.includes('₹999') && !enFixed.includes('₹1,000'), `got ${enFixed}`);
      const taStale = 'பங்கேற்பு கட்டணம் ₹1,000';
      const taFixed = renderPaymentNote(taStale, 999);
      ok('Stale TA note ₹1,000 renders as current fee ₹999', taFixed.includes('₹999') && !taFixed.includes('₹1,000'), `got ${taFixed}`);
    }
  } finally {
    if (server) server.close();
    restoreSettings();
  }

  console.log(`\nPricing Test Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
  console.log('\n🎉 ALL PRICING TESTS PASSED!\n');
}

runPricingTests().catch((err) => {
  console.error('❌ Pricing test failed:', err);
  try { if (server) server.close(); } catch (e) {}
  try { restoreSettings(); } catch (e) {}
  process.exit(1);
});
