/**
 * Validation middleware for devotee registration requests
 */
const { normalizeDonationAmount } = require('../config/pricing');

function validateRegistration(req, res, next) {
  const { name, mobile, email, address, rasi, natchathiram, gothram } = req.body || {};
  const errors = [];

  // 1. Primary Devotee Name (Required)
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Primary participant name is required (முதன்மை நபர் பெயர் தேவை).');
  } else if (name.trim().length < 2 || name.trim().length > 100) {
    errors.push('Participant name must be between 2 and 100 characters.');
  }

  // 2. Mobile Number (Required - 10 digits)
  if (!mobile || typeof mobile !== 'string') {
    errors.push('Mobile number is required (மொபைல் எண் தேவை).');
  } else {
    const digitsOnly = mobile.replace(/\D/g, '');
    const cleanedMobile = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
    if (cleanedMobile.length !== 10) {
      errors.push('Mobile number must be exactly 10 digits (சரியான 10 இலக்க மொபைல் எண் தேவை).');
    }
  }

  // 3. Email (Optional, but must be valid if provided)
  if (email && typeof email === 'string' && email.trim().length > 0) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push('Invalid email address format (மின்னஞ்சல் வடிவம் தவறானது).');
    }
  }

  // 4. Address (Optional)
  if (address && typeof address === 'string' && address.length > 500) {
    errors.push('Address must not exceed 500 characters.');
  }

  // 5. Family Members (Optional, up to 4 members)
  for (let i = 1; i <= 4; i++) {
    const memberKey = `member${i}`;
    const member = req.body[memberKey];

    if (member) {
      if (typeof member !== 'object' || Array.isArray(member)) {
        errors.push(`Family ${memberKey} must be an object with details.`);
      } else if (!member.name || typeof member.name !== 'string' || member.name.trim().length === 0) {
        errors.push(`Family member ${i} name is required if member is added.`);
      } else if (member.name.trim().length > 100) {
        errors.push(`Family member ${i} name must not exceed 100 characters.`);
      }
    }
  }

  // NOTE: Only `donationAmount` is participant-controlled money.
  // registrationFee / registrationAmount / amount / totalAmount / order_amount
  // sent by the client are NEVER trusted and are ignored (server is authority).
  const donation = normalizeDonationAmount(req.body ? req.body.donationAmount : undefined);
  if (!donation.valid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid donation amount. Please enter 0 or a positive INR amount with up to 2 decimals.',
      errors: ['Invalid donation amount. Please enter 0 or a positive INR amount with up to 2 decimals.']
    });
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: errors[0],
      errors: errors
    });
  }

  // Sanitize fields and continue
  req.sanitizedBody = {
    name: name.trim(),
    mobile: mobile.replace(/\D/g, '').slice(-10),
    email: email && typeof email === 'string' ? email.trim() : null,
    address: address && typeof address === 'string' ? address.trim() : null,
    rasi: rasi && typeof rasi === 'string' ? rasi.trim() : null,
    natchathiram: natchathiram && typeof natchathiram === 'string' ? natchathiram.trim() : null,
    gothram: gothram && typeof gothram === 'string' ? gothram.trim() : null,
    donationAmount: donation.value,
    members: []
  };

  for (let i = 1; i <= 4; i++) {
    const m = req.body[`member${i}`];
    if (m && m.name && m.name.trim()) {
      req.sanitizedBody.members.push({
        memberNumber: i,
        name: m.name.trim(),
        rasi: m.rasi ? String(m.rasi).trim() : null,
        natchathiram: m.natchathiram ? String(m.natchathiram).trim() : null,
        gothram: m.gothram ? String(m.gothram).trim() : null
      });
    }
  }

  next();
}

module.exports = validateRegistration;
