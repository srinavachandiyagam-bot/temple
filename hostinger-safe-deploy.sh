#!/bin/bash
# ====================================================================
# Nava Chandi Yagam - Hostinger Safe Deploy (Preserves 50GB Persistent Storage)
# ====================================================================
# Safely deploys a new ZIP over the live Hostinger app directory WITHOUT
# deleting / overwriting the three persistent paths:
#   - public/uploads/  (temple photos)
#   - public/videos/   (temple videos)
#   - data/temple.db   (SQLite registrations)
# All other application files (src/, db/, public/index.html, package.json, etc.)
# WILL update normally.
#
# Usage:
#   1. Upload your clean ZIP (created per HOSTINGER_DEPLOYMENT_GUIDE.md Step 1) to the app dir
#   2. SSH into Hostinger and run:
#        chmod +x hostinger-safe-deploy.sh
#        ./hostinger-safe-deploy.sh nava-chandi-yagam.zip
#   Or without argument if ZIP is already uploaded as nava-chandi-yagam.zip:
#        ./hostinger-safe-deploy.sh
#
# For VPS:  cd /var/www/nava-chandi-yagam && ./hostinger-safe-deploy.sh /path/to/zip
# For hPanel: cd ~/domains/yourdomain.com/public_html && ./hostinger-safe-deploy.sh nava-chandi-yagam.zip
# No R2, no PhonePe, no SQLite-fix changes. Pure preservation.
# ====================================================================

set -e

ZIP_FILE="${1:-nava-chandi-yagam.zip}"
APP_DIR="$(pwd)"
BACKUP_ROOT="$(dirname "$APP_DIR")/.nava-chandi-persistent-backup"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

PERSISTENT_PATHS=(
  "data/temple.db"
  "public/uploads"
  "public/videos"
)

echo "ðŸª· Nava Chandi Yagam - Safe Deploy"
echo "   App directory: $APP_DIR"
echo "   ZIP file: $ZIP_FILE"
echo "   Backup root: $BACKUP_ROOT"
echo "===================================================="

if [ ! -f "$ZIP_FILE" ]; then
  echo "âŒ ZIP file not found: $ZIP_FILE"
  echo "   Upload your clean ZIP (excluding persistent files per guide) first,"
  echo "   then run: ./hostinger-safe-deploy.sh $ZIP_FILE"
  exit 1
fi

# 1. Backup persistent files BEFORE extraction (outside app dir, so ZIP extraction cannot touch it)
echo "ðŸ”’ Step 1/4: Backing up persistent storage..."
mkdir -p "$BACKUP_ROOT"
# Also create a timestamped snapshot for disaster recovery
SNAPSHOT_DIR="$BACKUP_ROOT/snapshot-$TIMESTAMP"
mkdir -p "$SNAPSHOT_DIR"

for P in "${PERSISTENT_PATHS[@]}"; do
  if [ -e "$P" ]; then
    # Primary backup (sibling dir, always preserved)
    DEST="$BACKUP_ROOT/$P"
    mkdir -p "$(dirname "$DEST")"
    cp -a "$P" "$DEST" 2>/dev/null && echo "  ðŸ’¾ $P -> $DEST" || echo "  âš ï¸ Failed to backup $P"
    # Timestamped snapshot
    SNAP_DEST="$SNAPSHOT_DIR/$P"
    mkdir -p "$(dirname "$SNAP_DEST")"
    cp -a "$P" "$SNAP_DEST" 2>/dev/null || true
    if [ -f "$P" ]; then
      echo "     $(du -h "$P" 2>/dev/null | cut -f1) ($(wc -c < "$P" 2>/dev/null | tr -d ' ') bytes)"
    else
      CNT=$(find "$P" -type f 2>/dev/null | wc -l | tr -d ' ')
      SZ=$(du -sh "$P" 2>/dev/null | cut -f1)
      echo "     $CNT files, $SZ"
    fi
  else
    echo "  â„¹ï¸ $P does not exist yet (first deploy)"
  fi
done
echo "  ðŸ“¸ Snapshot: $SNAPSHOT_DIR"

# 2. Extract ZIP - but NEVER overwrite persistent files (extra safety even if ZIP was dirty)
echo ""
echo "ðŸ“¦ Step 2/4: Extracting $ZIP_FILE over $APP_DIR..."
# List persistent files that might be in the ZIP (warn if dirty ZIP)
if unzip -l "$ZIP_FILE" 2>/dev/null | grep -qE "public/uploads/|public/videos/|data/temple.db"; then
  echo "  âš ï¸ WARNING: ZIP contains persistent files! They will be SKIPPED during extraction."
  echo "  Next time, create ZIP excluding: data/temple.db, public/uploads/*, public/videos/*"
  echo "  See HOSTINGER_DEPLOYMENT_GUIDE.md Step 1 for clean ZIP commands."
  # Extract excluding persistent paths
  unzip -o "$ZIP_FILE" -x "public/uploads/*" "public/videos/*" "data/temple.db" "data/*.db" 2>&1 | tail -20
else
  echo "  âœ… ZIP is clean (no persistent files) - safe to extract"
  unzip -o "$ZIP_FILE" 2>&1 | tail -20
fi

# 3. Restore persistent files (merge - never delete, never overwrite newer if ZIP was dirty)
echo ""
echo "â™»ï¸ Step 3/4: Restoring persistent storage (merge, never delete)..."
for P in "${PERSISTENT_PATHS[@]}"; do
  BACKUP_SRC="$BACKUP_ROOT/$P"
  if [ -e "$BACKUP_SRC" ]; then
    if [ -f "$BACKUP_SRC" ]; then
      # File: restore only if missing (protect against ZIP that contained empty DB)
      if [ ! -f "$P" ]; then
        mkdir -p "$(dirname "$P")"
        cp -a "$BACKUP_SRC" "$P" && echo "  â™»ï¸ Restored $P"
      else
        # Both exist - keep the live file if it's larger/newer (real DB vs empty ZIP DB)
        BACKUP_SIZE=$(wc -c < "$BACKUP_SRC" 2>/dev/null | tr -d ' ')
        LIVE_SIZE=$(wc -c < "$P" 2>/dev/null | tr -d ' ')
        if [ "$BACKUP_SIZE" -gt "$LIVE_SIZE" ] 2>/dev/null; then
          echo "  âš ï¸ Live $P ($LIVE_SIZE bytes) smaller than backup ($BACKUP_SIZE bytes) - keeping backup version"
          cp -a "$BACKUP_SRC" "$P"
        else
          echo "  âœ… $P already present ($LIVE_SIZE bytes) - kept live version"
        fi
      fi
    elif [ -d "$BACKUP_SRC" ]; then
      mkdir -p "$P"
      # Merge: copy any missing files from backup (cp -n = no-clobber, never overwrite existing)
      RESTORED=0
      for SRC_FILE in "$BACKUP_SRC"/*; do
        [ -e "$SRC_FILE" ] || continue
        BASENAME="$(basename "$SRC_FILE")"
        if [ ! -e "$P/$BASENAME" ]; then
          cp -a "$SRC_FILE" "$P/$BASENAME" && RESTORED=$((RESTORED+1))
        fi
      done
      LIVE_CNT=$(find "$P" -type f 2>/dev/null | wc -l | tr -d ' ')
      BACKUP_CNT=$(find "$BACKUP_SRC" -type f 2>/dev/null | wc -l | tr -d ' ')
      if [ "$RESTORED" -gt 0 ]; then
        echo "  â™»ï¸ $P: restored $RESTORED missing files ($LIVE_CNT live, $BACKUP_CNT in backup)"
      else
        echo "  âœ… $P: $LIVE_CNT files preserved (backup had $BACKUP_CNT)"
      fi
    fi
  else
    echo "  â„¹ï¸ No backup for $P (first deploy)"
  fi
done

# 4. Run standard setup (Node check, npm install, migrations, verify)
echo ""
echo "âš™ï¸ Step 4/4: Running setup-hostinger.sh..."
chmod +x setup-hostinger.sh
./setup-hostinger.sh

echo ""
echo "===================================================="
echo "ðŸŽ‰ Safe deploy complete!"
echo "   Persistent files verified:"
for P in "${PERSISTENT_PATHS[@]}"; do
  if [ -e "$P" ]; then
    if [ -f "$P" ]; then
      echo "   âœ… $P ($(du -h "$P" 2>/dev/null | cut -f1))"
    else
      CNT=$(find "$P" -type f 2>/dev/null | wc -l | tr -d ' ')
      echo "   âœ… $P ($CNT files)"
    fi
  else
    echo "   â„¹ï¸ $P (not present - will be created on first upload/registration)"
  fi
done
echo "   Backup retained at: $BACKUP_ROOT"
echo "   Snapshot: $SNAPSHOT_DIR"
echo "   To rollback: cp -a $BACKUP_ROOT/* ./"
echo "===================================================="
echo "   Next: Restart Node app in hPanel or: pm2 restart nava-chandi-yagam"
