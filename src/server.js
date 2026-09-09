require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const apiRoutes = require('./routes/api');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

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

const app = express();
const PORT = process.env.PORT || 3000;

// Trust reverse proxy headers (standard for Hostinger hPanel Passenger, LiteSpeed, and Nginx reverse proxies)
app.set('trust proxy', 1);

// 1. Enable Cross-Origin Resource Sharing
app.use(cors());

// 2. Parse JSON bodies and capture raw request body for Cashfree webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

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
    cashfreeEnv: process.env.CASHFREE_ENV || 'sandbox',
    timestamp: new Date().toISOString()
  });
});

// 5. Mount API routes under /api
app.use('/api', apiRoutes);

// 6. Serve index.html for all other frontend routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  res.sendFile(indexPath);
});

// 7. Global Error Handler
app.use(errorHandler);

// Server startup handler (supports fallback port if port is occupied)
function startServer(portToTry = process.env.PORT || 3000) {
  const port = Number(portToTry);
  const server = app.listen(port, () => {
    console.log(`====================================================`);
    console.log(`🪷 Nava Chandi Yagam Event Server is running!`);
    console.log(`   - Port: ${port}`);
    console.log(`   - URL: http://localhost:${port}`);
    console.log(`   - Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`   - Mode: ${process.env.MOCK_MODE === 'true' ? 'Mock Mode (In-memory DB & Simulated Cashfree)' : 'Production / Real DB'}`);
    console.log(`   - Cashfree Mode: ${process.env.CASHFREE_ENV || 'sandbox'}`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} is already in use.`);
      const nextPort = Number(port) + 1;
      console.log(`🔄 Trying alternative port ${nextPort}...`);
      startServer(nextPort);
    } else {
      console.error('❌ Server startup error:', err);
    }
  });

  return server;
}

// Start server if directly executed
if (require.main === module) {
  startServer(Number(PORT));
}

module.exports = app;
module.exports.startServer = startServer;
