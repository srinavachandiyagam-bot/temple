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

// Boot the application
startServer(PORT);
