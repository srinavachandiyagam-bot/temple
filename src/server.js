require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const apiRoutes = require('./routes/api');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const requireMockMode = require('./middleware/requireMockMode');

// Ensure essential persistence directories exist on startup (especially for fresh Hostinger deployments)
const requiredDirs = [
  path.join(__dirname, '../data'),
  path.join(__dirname, '../public/uploads'),
  path.join(__dirname, '../public/videos')
];
for (const dir of requiredDirs) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.warn(`Could not create directory ${dir}:`, e.message);
    }
  }
}

// Ensure DB-backed registration fee is seeded early (non-mock only).
// Pricing lookups ALSO lazily ensure seeding, so the first registration after
// startup can never charge a different fee even if this async init is still
// in flight. Existing DB rows are never overwritten.
// Background warm-up waits for dbReady first so it never races schema init.
if (process.env.MOCK_MODE !== 'true') {
  try {
    const dbForWarmup = require('./config/db');
    const { ensureRegistrationFeeSeeded } = require('./config/registrationFeeStore');
    dbForWarmup.dbReady
      .then(() => ensureRegistrationFeeSeeded())
      .then((fee) => {
        if (fee !== null && fee !== undefined) {
          console.log(`💰 Canonical registration fee ready: ₹${fee}`);
        }
      })
      .catch((e) => {
        console.warn('⚠️ Registration fee bootstrap failed (will retry lazily on pricing reads):', e.message);
      });
  } catch (e) {
    console.warn('⚠️ Could not bootstrap registration fee:', e.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust reverse proxy headers (standard for Hostinger hPanel Passenger, LiteSpeed, and Nginx reverse proxies)
app.set('trust proxy', 1);

// 1. Enable Cross-Origin Resource Sharing
app.use(cors());

// 2. Parse JSON bodies and capture raw request body for PhonePe webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

// 3a. Mock checkout page (mock mode only).
// Must be BEFORE static (so /mock-checkout.html is also guarded) and BEFORE
// the frontend catch-all (so /mock-checkout?order_id=ABC serves
// mock-checkout.html with its query string intact, not index.html).
// requireMockMode uses the same getIsMockMode() determination as
// createPhonePeOrder(). Non-mock requests get 404.
app.get(['/mock-checkout', '/mock-checkout.html'], requireMockMode, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/mock-checkout.html'));
});

// 3. Serve frontend static assets from public/ directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.use('/videos', express.static(path.join(__dirname, '../public/videos')));

// Admin panel direct route
app.get(['/admin', '/admin.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 4. Healthcheck endpoints
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    service: 'Nava Chandi Yagam Registration API',
    environment: process.env.NODE_ENV || 'development',
    phonepeEnv: process.env.PHONEPE_ENV || 'sandbox',
    timestamp: new Date().toISOString()
  });
});

// 5. Mount API routes under /api
app.use('/api', apiRoutes);

// 6. Serve index.html for all other frontend routes
// 5b. Policy pages for PhonePe / payment gateway compliance (public, no auth)
const policyPages = {
  '/terms-and-conditions': 'terms-and-conditions.html',
  '/privacy-policy': 'privacy-policy.html',
  '/refund-policy': 'refund-policy.html',
  '/shipping-policy': 'shipping-policy.html'
};
for (const [route, file] of Object.entries(policyPages)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, '../public', file));
  });
  app.get(route + '.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', file));
  });
}

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  res.sendFile(indexPath);
});

// 7. Global Error Handler
app.use(errorHandler);

// Startup readiness: database schema/migrations (including the critical
// donation_amount ALTER) must complete BEFORE the server accepts traffic.
// app_settings fee seeding is also awaited so pricing is authoritative from
// the first request. Existing fee rows are never overwritten (bootstrap-only).
// Also migrates existing local media to R2 persistent storage if configured.
async function waitForStartupReadiness() {
  const db = require('./config/db');
  await db.waitForDatabaseReady();
  if (process.env.MOCK_MODE !== 'true') {
    const { ensureRegistrationFeeSeeded } = require('./config/registrationFeeStore');
    await ensureRegistrationFeeSeeded();
  }
  // Migrate local uploads to R2 if R2 is configured (non-blocking, but awaited for correctness)
  try {
    const { migrateLocalMediaToR2 } = require('./config/migrateMedia');
    await migrateLocalMediaToR2();
  } catch (e) {
    console.warn('⚠️ Media migration check failed (non-fatal):', e.message);
  }
}

// Server startup handler (supports fallback port if port is occupied).
// Awaits database readiness before listening. On migration failure, logs a
// clear error and rejects WITHOUT listening, so the process can exit
// non-zero and Render marks the deploy failed. Never exposes DB credentials.
async function startServer(portToTry = process.env.PORT || 3000) {
  const port = Number(portToTry);

  try {
    await waitForStartupReadiness();
  } catch (err) {
    console.error('❌ Database initialization failed. Server will NOT start with a half-migrated DB.');
    console.error('⛔ Refusing to accept registration/public pricing traffic:', (err && err.message) || err);
    throw err;
  }

  const server = app.listen(port, () => {
    console.log(`====================================================`);
    console.log(`🪷 Nava Chandi Yagam Event Server is running!`);
    console.log(`   - Port: ${port}`);
    console.log(`   - URL: http://localhost:${port}`);
    console.log(`   - Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`   - Mode: ${process.env.MOCK_MODE === 'true' ? 'Mock Mode (In-memory DB & Simulated PhonePe)' : 'Production / Real DB'}`);
    console.log(`   - PhonePe Mode: ${process.env.PHONEPE_ENV || 'sandbox'}`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} is already in use.`);
      const nextPort = Number(port) + 1;
      console.log(`🔄 Trying alternative port ${nextPort}...`);
      startServer(nextPort).catch((e) => {
        console.error('❌ Server startup error on fallback port:', (e && e.message) || e);
      });
    } else {
      console.error('❌ Server startup error:', err);
    }
  });

  return server;
}

// Start server if directly executed
if (require.main === module) {
  startServer(Number(PORT)).catch((err) => {
    console.error('❌ Fatal: server failed to start:', (err && err.message) || err);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.waitForStartupReadiness = waitForStartupReadiness;
