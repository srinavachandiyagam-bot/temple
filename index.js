/**
 * ====================================================================
 * Nava Chandi Yagam - Root Application Entry Point
 * ====================================================================
 * Primary startup file recognized automatically by Hostinger hPanel,
 * CloudLinux NodeJS Selector, PM2, and Docker environments.
 */

require('dotenv').config();
const { startServer } = require('./src/server');

const PORT = process.env.PORT || 3000;

// Boot the application.
// Database readiness (including the critical donation_amount migration) is
// awaited inside startServer before app.listen(). On migration failure we log
// and exit non-zero WITHOUT serving traffic, so Render marks deploy failed.
startServer(PORT).catch((err) => {
  console.error('❌ Fatal: database initialization failed. Refusing to serve traffic with half-migrated DB.');
  if (err && err.message) console.error('⛔ Startup error:', err.message);
  process.exit(1);
});
