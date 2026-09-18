const assert = require('assert');
const crypto = require('crypto');
const { generateRegistrationId, generatePhonePeOrderId } = require('../src/utils/idGenerator');
const validateRegistration = require('../src/middleware/validateRegistration');
const { verifyPhonePeWebhook } = require('../src/config/phonepe');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ Passed: ${name}`);
  } catch (err) {
    console.error(`  ❌ Failed: ${name}`);
    console.error(`     ${err.message}`);
  }
}

console.log('🧪 Running Nava Chandi Yagam Backend Unit Tests...\n');

// 1. ID Generator Tests
runTest('ID Generator: format matches NCY-XXXXXX', () => {
  for (let i = 0; i < 50; i++) {
    const id = generateRegistrationId();
    assert.match(id, /^NCY-[0-9A-F]{6}$/);
  }
});

runTest('PhonePe Order ID: contains registration ID and prefix', () => {
  const regId = 'NCY-7A8B9C';
  const orderId = generatePhonePeOrderId(regId);
  assert.ok(orderId.startsWith('order_NCY7A8B9C_'));
  assert.ok(orderId.length <= 63);
});

// 2. Validation Middleware Tests
runTest('Validator: Rejects missing name', () => {
  let resStatus = null;
  let resJson = null;
  const req = { body: { mobile: '9876543210' } };
  const res = {
    status: (s) => { resStatus = s; return res; },
    json: (j) => { resJson = j; }
  };
  validateRegistration(req, res, () => {});
  assert.strictEqual(resStatus, 400);
  assert.ok(resJson.error.includes('Primary participant name is required'));
});

runTest('Validator: Rejects invalid mobile (< 10 digits)', () => {
  let resStatus = null;
  let resJson = null;
  const req = { body: { name: 'Murugan', mobile: '98765' } };
  const res = {
    status: (s) => { resStatus = s; return res; },
    json: (j) => { resJson = j; }
  };
  validateRegistration(req, res, () => {});
  assert.strictEqual(resStatus, 400);
  assert.ok(resJson.error.includes('10 digits'));
});

runTest('Validator: Accepts valid primary devotee and optional members', () => {
  let nextCalled = false;
  const req = {
    body: {
      name: '  Karthik Raja  ',
      mobile: '+91 9876543210',
      email: 'karthik@example.com',
      rasi: 'Mesha (Aries)',
      natchathiram: 'Ashwini',
      gothram: 'Shiva',
      address: 'Erode',
      member1: { name: 'Anitha', rasi: 'Simha (Leo)' }
    }
  };
  const res = {
    status: () => res,
    json: () => {}
  };
  validateRegistration(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.sanitizedBody.name, 'Karthik Raja');
  assert.strictEqual(req.sanitizedBody.mobile, '9876543210');
  assert.strictEqual(req.sanitizedBody.members.length, 1);
  assert.strictEqual(req.sanitizedBody.members[0].name, 'Anitha');
});

runTest('Validator: Rejects member with empty name', () => {
  let resStatus = null;
  let resJson = null;
  const req = {
    body: {
      name: 'Karthik',
      mobile: '9876543210',
      member1: { name: '   ', rasi: 'Simha' }
    }
  };
  const res = {
    status: (s) => { resStatus = s; return res; },
    json: (j) => { resJson = j; }
  };
  validateRegistration(req, res, () => {});
  assert.strictEqual(resStatus, 400);
  assert.ok(resJson.error.includes('Family member 1 name is required'));
});

// 3. Webhook Signature Verification Tests
runTest('Webhook: validates PhonePe SHA256(username:password) correctly', () => {
  const username = 'testuser';
  const password = 'testpass123';
  process.env.PHONEPE_CALLBACK_USERNAME = username;
  process.env.PHONEPE_CALLBACK_PASSWORD = password;
  const crypto = require('crypto');
  const expected = crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
  assert.strictEqual(verifyPhonePeWebhook(expected, JSON.stringify({test:1}), {}), true);
  assert.strictEqual(verifyPhonePeWebhook('invalid', JSON.stringify({test:1}), {}), false);
});

console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.`);
if (passedTests !== totalTests) {
  process.exit(1);
}
