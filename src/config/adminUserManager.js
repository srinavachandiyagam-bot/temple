const crypto = require('crypto');
const { query } = require('./db');

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 10000, 64, 'sha512').toString('hex');
}

/**
 * Ensures at least one Super Admin exists in the database
 */
async function ensureSuperAdmin() {
  try {
    const superAdminPassword = process.env.ADMIN_PASSWORD || 'change-this-password';
    const check = await query("SELECT * FROM admin_users WHERE username = 'superadmin' OR role = 'super_admin'");
    if (check.rows.length === 0) {
      const salt = generateSalt();
      const hash = hashPassword(superAdminPassword, salt);
      await query(
        `INSERT INTO admin_users (username, name, password_hash, salt, role)
         VALUES ($1, $2, $3, $4, $5)`,
        ['superadmin', 'Main Temple Admin (முதன்மை நிர்வாகி)', hash, salt, 'super_admin']
      );
      console.log('👑 Initialized default Super Admin (username: superadmin)');
    }
  } catch (err) {
    console.error('⚠️ Could not check/seed super admin:', err.message);
  }
}

/**
 * Authenticates an admin by username and password.
 * Supports legacy single-password login for backwards compatibility.
 */
async function authenticateAdmin(username, password) {
  if (!password) return null;
  await ensureSuperAdmin();

  // 1. Username provided: authenticates specific admin
  if (username && String(username).trim()) {
    const cleanUser = String(username).trim().toLowerCase();
    const res = await query('SELECT * FROM admin_users WHERE LOWER(username) = $1', [cleanUser]);
    if (res.rows.length === 0) return null;

    const user = res.rows[0];
    const testHash = hashPassword(password, user.salt);
    if (testHash === user.password_hash) {
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      };
    }
    return null;
  }

  // 2. Legacy / Password-only: checks against Super Admin or any admin
  const allAdmins = await query('SELECT * FROM admin_users ORDER BY CASE WHEN role = \'super_admin\' THEN 0 ELSE 1 END');
  for (const user of allAdmins.rows) {
    const testHash = hashPassword(password, user.salt);
    if (testHash === user.password_hash) {
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      };
    }
  }

  return null;
}

/**
 * Returns all admin accounts
 */
async function listAdmins() {
  await ensureSuperAdmin();
  const res = await query('SELECT id, username, name, role, created_at FROM admin_users ORDER BY id ASC');
  return res.rows;
}

/**
 * Creates a new admin account (exclusive to Super Admin)
 */
async function createAdmin({ username, name, password, role = 'admin' }) {
  await ensureSuperAdmin();

  if (!username || !String(username).trim()) {
    throw new Error('Username is required (பயனர்பெயர் தேவை)');
  }
  if (!password || String(password).trim().length < 4) {
    throw new Error('Password must be at least 4 characters (கடவுச்சொல் குறைந்தது 4 எழுத்துக்கள் இருக்க வேண்டும்)');
  }
  if (!name || !String(name).trim()) {
    throw new Error('Full name is required (முழுப் பெயர் தேவை)');
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const check = await query('SELECT id FROM admin_users WHERE LOWER(username) = $1', [cleanUsername]);
  if (check.rows.length > 0) {
    throw new Error(`Username "${cleanUsername}" is already taken (பயனர்பெயர் ஏற்கனவே பயன்பாட்டில் உள்ளது)`);
  }

  const validRole = role === 'super_admin' ? 'super_admin' : 'admin';
  const salt = generateSalt();
  const hash = hashPassword(String(password).trim(), salt);

  const insertRes = await query(
    `INSERT INTO admin_users (username, name, password_hash, salt, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, name, role, created_at`,
    [cleanUsername, String(name).trim(), hash, salt, validRole]
  );

  return insertRes.rows[0];
}

/**
 * Deletes an admin account (exclusive to Super Admin)
 * Protects against deleting own account or Super Admin account
 */
async function deleteAdmin(id, currentUserId) {
  await ensureSuperAdmin();
  const numId = Number(id);

  if (currentUserId && numId === Number(currentUserId)) {
    throw new Error('You cannot delete your own admin account (உங்கள் சொந்த கணக்கை நீக்க முடியாது)');
  }

  const check = await query('SELECT * FROM admin_users WHERE id = $1', [numId]);
  if (check.rows.length === 0) {
    throw new Error('Admin account not found (நிர்வாகி கணக்கு கிடைக்கவில்லை)');
  }

  const target = check.rows[0];
  if (target.role === 'super_admin') {
    throw new Error('Cannot delete a Super Admin account (முதன்மை நிர்வாகி கணக்கை நீக்க முடியாது)');
  }

  await query('DELETE FROM admin_users WHERE id = $1', [numId]);
  return true;
}

module.exports = {
  ensureSuperAdmin,
  authenticateAdmin,
  listAdmins,
  createAdmin,
  deleteAdmin,
  hashPassword,
  generateSalt
};
