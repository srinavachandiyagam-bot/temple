#!/bin/bash
# ====================================================================
# Nava Chandi Yagam - Hostinger Setup & Deployment Helper Script
# ====================================================================

set -e

echo "🪷 Starting Nava Chandi Yagam Deployment Setup on Hostinger..."

# 1. Create essential directories
mkdir -p data
mkdir -p public/uploads
mkdir -p public/videos

# 2. Check Node.js version
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo "✅ Node.js detected: $NODE_VER"
    # Require Node 22.5+ for node:sqlite fallback (GLIBC-independent)
    REQ_MAJOR=$(echo "$NODE_VER" | cut -d. -f1 | tr -d 'v')
    REQ_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
    if [ "$REQ_MAJOR" -lt 22 ] || { [ "$REQ_MAJOR" -eq 22 ] && [ "$REQ_MINOR" -lt 5 ]; }; then
        echo "⚠️ Node.js $NODE_VER is below 22.5. The project handles Hostinger GLIBC 2.38 via sqlite3@5.1.7, but node:sqlite fallback requires Node 22.5+ (recommended: 22.20.x LTS). Consider upgrading: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    fi
else
    echo "❌ Node.js is not installed. Please install Node.js 22.x LTS (22.20.x stable, requires 22.5+ for node:sqlite)."
    exit 1
fi

# 3. Install production dependencies
echo "📦 Installing npm dependencies..."
npm install --omit=dev

# 4. Check .env configuration
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "⚠️ .env file not found. Copying from .env.example..."
        cp .env.example .env
        echo "📝 Please edit .env with your domain, ADMIN_PASSWORD, and Cashfree credentials."
    fi
else
    echo "✅ .env configuration file exists."
fi

# 5. Run database migration (if needed)
echo "🗄️ Checking database migrations..."
npm run migrate

echo "===================================================="
echo "🎉 Deployment setup complete!"
echo "To start the server with PM2 on Hostinger VPS:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "Or start directly with npm:"
echo "   npm start"
echo "===================================================="
