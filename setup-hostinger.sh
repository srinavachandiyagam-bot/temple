#!/bin/bash
# ====================================================================
# Nava Chandi Yagam - Hostinger Setup & Deployment Helper Script
# ====================================================================

set -e

echo "ðŸª· Starting Nava Chandi Yagam Deployment Setup on Hostinger..."

# ====================================================================
# 0. PERSISTENT STORAGE PRESERVATION (Hostinger 50GB - NEVER DELETE)
# ====================================================================
# These three paths live on Hostinger's persistent 50GB volume and must
# survive every deployment, git pull, or ZIP extraction. This block
# ensures a redeploy NEVER deletes, replaces, or overwrites them.
# - public/uploads/  -> all admin-uploaded temple photos
# - public/videos/   -> all admin-uploaded temple videos
# - data/temple.db   -> persistent SQLite database (registrations)
# Application code, package files, and all other deployable files
# WILL still update normally. No R2 required.
PERSISTENT_PATHS=(
  "data/temple.db"
  "public/uploads"
  "public/videos"
)
APP_DIR="$(pwd)"
# Backup outside the app directory (sibling to public_html / app root) so
# ZIP extraction over APP_DIR cannot touch it. For hPanel: ~/domains/<domain>/.nava-persistent
# For VPS: /var/www/.nava-chandi-persistent
BACKUP_ROOT="$(dirname "$APP_DIR")/.nava-chandi-persistent-backup"
mkdir -p "$BACKUP_ROOT"
echo "ðŸ”’ Preserving persistent storage..."
for P in "${PERSISTENT_PATHS[@]}"; do
  if [ -e "$P" ]; then
    # Use tar to preserve permissions & handle both files and directories
    BACKUP_DEST="$BACKUP_ROOT/$P"
    mkdir -p "$(dirname "$BACKUP_DEST")"
    # Only backup if not already backed up in this run (avoid overwriting backup with empty)
    if [ ! -e "$BACKUP_DEST" ]; then
      cp -a "$P" "$BACKUP_DEST" 2>/dev/null && echo "  ðŸ’¾ Backed up $P -> $BACKUP_DEST" || echo "  âš ï¸ Could not backup $P"
    else
      echo "  âœ… Backup already exists for $P"
    fi
    if [ -f "$P" ]; then
      echo "  ðŸ“Š $P: $(du -h "$P" 2>/dev/null | cut -f1) ($(stat -c%s "$P" 2>/dev/null || stat -f%z "$P" 2>/dev/null || echo "?") bytes)"
    elif [ -d "$P" ]; then
      COUNT=$(find "$P" -type f 2>/dev/null | wc -l | tr -d ' ')
      SIZE=$(du -sh "$P" 2>/dev/null | cut -f1)
      echo "  ðŸ“Š $P: $COUNT files, $SIZE"
    fi
  else
    echo "  â„¹ï¸ $P does not exist yet (first deploy - will be created)"
  fi
done

# 1. Create essential directories (mkdir -p is safe - never deletes existing files)
mkdir -p data
mkdir -p public/uploads
mkdir -p public/videos

# 1b. Restore persistent files if ZIP extraction overwrote them with empty placeholders
# This handles the case where a ZIP containing empty public/uploads/ or data/temple.db was
# extracted OVER the live directory BEFORE this script ran. We restore from the backup
# taken at the start of this script (which captured the pre-extraction state if the script
# was invoked as part of a safe-deploy). For pure File-Manager GUI deploys, the ZIP itself
# must exclude these paths (see HOSTINGER_DEPLOYMENT_GUIDE.md) - this block is a safety net.
for P in "${PERSISTENT_PATHS[@]}"; do
  BACKUP_SRC="$BACKUP_ROOT/$P"
  if [ -e "$BACKUP_SRC" ]; then
    if [ -f "$BACKUP_SRC" ] && [ ! -f "$P" ]; then
      mkdir -p "$(dirname "$P")"
      cp -a "$BACKUP_SRC" "$P" && echo "  â™»ï¸ Restored missing file $P from backup"
    elif [ -d "$BACKUP_SRC" ]; then
      # Restore any files that are in backup but missing in live dir (merge, never delete)
      # Use cp -an (no-clobber) so existing files are never overwritten, missing files are restored
      mkdir -p "$P"
      # Copy each file from backup that does not exist in live
      for SRC_FILE in "$BACKUP_SRC"/*; do
        [ -e "$SRC_FILE" ] || continue
        BASENAME="$(basename "$SRC_FILE")"
        if [ ! -e "$P/$BASENAME" ]; then
          cp -a "$SRC_FILE" "$P/$BASENAME" && echo "  â™»ï¸ Restored $P/$BASENAME from backup"
        fi
      done
      # Also handle count: if live dir is empty but backup has files, we already restored
      LIVE_COUNT=$(find "$P" -type f 2>/dev/null | wc -l | tr -d ' ')
      BACKUP_COUNT=$(find "$BACKUP_SRC" -type f 2>/dev/null | wc -l | tr -d ' ')
      if [ "$LIVE_COUNT" -eq 0 ] && [ "$BACKUP_COUNT" -gt 0 ]; then
        echo "  âš ï¸ $P was empty after extraction - restored $BACKUP_COUNT files from backup"
      fi
    fi
  fi
done

# 2. Check Node.js version
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo "âœ… Node.js detected: $NODE_VER"
    # Require Node 22.5+ for node:sqlite fallback (GLIBC-independent)
    REQ_MAJOR=$(echo "$NODE_VER" | cut -d. -f1 | tr -d 'v')
    REQ_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
    if [ "$REQ_MAJOR" -lt 22 ] || { [ "$REQ_MAJOR" -eq 22 ] && [ "$REQ_MINOR" -lt 5 ]; }; then
        echo "âš ï¸ Node.js $NODE_VER is below 22.5. The project handles Hostinger GLIBC 2.38 via sqlite3@5.1.7, but node:sqlite fallback requires Node 22.5+ (recommended: 22.20.x LTS). Consider upgrading: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    fi
else
    echo "âŒ Node.js is not installed. Please install Node.js 22.x LTS (22.20.x stable, requires 22.5+ for node:sqlite)."
    exit 1
fi

# 3. Install production dependencies
echo "ðŸ“¦ Installing npm dependencies..."
npm install --omit=dev

# 4. Check .env configuration
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "âš ï¸ .env file not found. Copying from .env.example..."
        cp .env.example .env
        echo "ðŸ“ Please edit .env with your domain, ADMIN_PASSWORD, and Cashfree credentials."
    fi
else
    echo "âœ… .env configuration file exists."
fi

# 5. Run database migration (if needed)
echo "ðŸ—„ï¸ Checking database migrations..."
npm run migrate

# 6. Verify persistent storage survived deployment (Hostinger 50GB - never overwritten)
echo "ðŸ” Verifying persistent storage after deployment..."
for P in "${PERSISTENT_PATHS[@]}"; do
  if [ -e "$P" ]; then
    if [ -f "$P" ]; then
      echo "  âœ… $P preserved: $(du -h "$P" 2>/dev/null | cut -f1) ($(wc -c < "$P" 2>/dev/null | tr -d ' ') bytes)"
    else
      CNT=$(find "$P" -type f 2>/dev/null | wc -l | tr -d ' ')
      SZ=$(du -sh "$P" 2>/dev/null | cut -f1)
      echo "  âœ… $P preserved: $CNT files, $SZ"
      if [ "$CNT" -gt 0 ]; then
        echo "     $(ls -1 "$P" 2>/dev/null | head -5 | tr '\n' ' ')"
        if [ "$CNT" -gt 5 ]; then echo "     ... and $((CNT-5)) more"; fi
      fi
    fi
  else
    echo "  â„¹ï¸ $P not present (first deploy or no uploads yet - directory created)"
    mkdir -p "$(dirname "$P" 2>/dev/null || echo ".")"
    if [[ "$P" == *".db" ]]; then
      echo "     Will be created on first migration/startup"
    else
      mkdir -p "$P"
    fi
  fi
done
# Keep backup for disaster recovery - do NOT delete $BACKUP_ROOT
echo "  ðŸ’¾ Persistent backup retained at: $BACKUP_ROOT"
echo "     To rollback: cp -a $BACKUP_ROOT/* ./"

echo "===================================================="
echo "ðŸŽ‰ Deployment setup complete!"
echo "To start the server with PM2 on Hostinger VPS:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "Or start directly with npm:"
echo "   npm start"
echo "===================================================="
