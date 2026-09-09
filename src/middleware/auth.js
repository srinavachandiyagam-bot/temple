const crypto = require('crypto');
const { authenticateAdmin } = require('../config/adminUserManager');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const activeSessions = new Map(); // token -> { id, username, name, role }

/**
 * Creates a session token for an authenticated user
 */
function createSession(user) {
  const token = 'adm_' + crypto.randomBytes(24).toString('hex');
  activeSessions.set(token, user);
  return token;
}

/**
 * Validates admin password (legacy single-password login)
 */
async function loginAdmin(password) {
  const user = await authenticateAdmin(null, password);
  if (!user) return null;
  return createSession(user);
}

/**
 * Validates username and password login
 */
async function loginWithCredentials(username, password) {
  const user = await authenticateAdmin(username, password);
  if (!user) return null;
  const token = createSession(user);
  return { token, user };
}

/**
 * Middleware to protect admin routes (any authenticated admin)
 */
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.slice(7).trim();
  const session = activeSessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
  }

  req.user = session;
  req.token = token;
  next();
}

/**
 * Middleware to protect super-admin-only routes (such as creating/deleting admins)
 */
function requireSuperAdminAuth(req, res, next) {
  requireAdminAuth(req, res, () => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        error: 'Access denied: Only the Main Super Admin can perform this action (முதன்மை நிர்வாகிக்கு மட்டுமே அனுமதி உண்டு)'
      });
    }
    next();
  });
}

/**
 * Logout admin
 */
function logoutAdmin(token) {
  if (token) {
    activeSessions.delete(token);
  }
}

module.exports = {
  createSession,
  loginAdmin,
  loginWithCredentials,
  requireAdminAuth,
  requireSuperAdminAuth,
  logoutAdmin,
  ADMIN_PASSWORD
};
