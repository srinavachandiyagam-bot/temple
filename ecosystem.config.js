/**
 * ====================================================================
 * PM2 Process Manager Configuration for Hostinger VPS
 * ====================================================================
 * Usage commands:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 *   pm2 logs nava-chandi-yagam
 *   pm2 restart nava-chandi-yagam
 */

module.exports = {
  apps: [
    {
      name: 'nava-chandi-yagam',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
