/**
 * Migrate existing local media (public/uploads, public/videos) to R2 persistent storage
 * Runs once on startup if R2 is enabled.
 * - Uploads any local files referenced in settings.json that exist on disk to R2
 * - Updates settings.json records with R2 URLs
 * - Reports files that are referenced but missing on disk (need re-upload)
 */

const fs = require('fs');
const path = require('path');

async function migrateLocalMediaToR2() {
  const { isR2Enabled, uploadToR2, getPublicUrl } = require('./r2');
  if (!isR2Enabled()) {
    console.log('📁 R2 not enabled - skipping media migration (local storage)');
    return { migrated: 0, missing: [] };
  }

  const { getPublicData } = require('./settingsManager');
  const data = getPublicData();
  let migrated = 0;
  const missing = [];
  let needSave = false;

  const uploadsDir = path.join(__dirname, '../../public/uploads');
  const videosDir = path.join(__dirname, '../../public/videos');

  // Helper to migrate a single record
  async function migrateRecord(record, type) {
    if (!record || !record.filename) return;
    // Already has R2 URL? skip
    if (record.url && record.url.startsWith('http') && record.url.includes(process.env.R2_PUBLIC_URL || 'r2.dev')) {
      return;
    }
    // Check if filename is already a URL (maybe previously migrated)
    if (String(record.filename).startsWith('http')) {
      // Convert to url field
      if (!record.url) {
        record.url = record.filename;
        record.filename = record.filename.split('/').pop();
        needSave = true;
      }
      return;
    }
    // Try to find local file
    const baseName = path.basename(record.filename);
    const possiblePaths = [
      path.join(type === 'image' ? uploadsDir : videosDir, record.filename),
      path.join(type === 'image' ? uploadsDir : videosDir, baseName),
      path.join(uploadsDir, record.filename),
      path.join(uploadsDir, baseName),
      path.join(videosDir, record.filename),
      path.join(videosDir, baseName),
    ];
    let foundPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }
    if (!foundPath) {
      missing.push({ id: record.id, filename: record.filename, type });
      console.warn(`⚠️ Missing local file for ${type} ${record.id}: ${record.filename} - needs re-upload via admin`);
      return;
    }
    try {
      const buffer = fs.readFileSync(foundPath);
      const ext = path.extname(record.filename).toLowerCase();
      const key = `${type === 'image' ? 'images' : 'videos'}/${baseName}`;
      const contentType = type === 'image'
        ? (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg')
        : (ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : ext === '.mkv' ? 'video/x-matroska' : 'video/mp4');
      const url = await uploadToR2(buffer, key, contentType);
      record.url = url;
      // Normalize filename to key for future deletion (store key)
      record.filename = key;
      migrated++;
      needSave = true;
      console.log(`✅ Migrated ${type} ${record.id}: ${baseName} -> ${url}`);
    } catch (e) {
      console.error(`❌ Failed to migrate ${type} ${record.id}:`, e.message);
      missing.push({ id: record.id, filename: record.filename, type, error: e.message });
    }
  }

  if (data.images && data.images.length) {
    for (const img of data.images) {
      await migrateRecord(img, 'image');
    }
  }
  if (data.videos && data.videos.length) {
    for (const vid of data.videos) {
      await migrateRecord(vid, 'video');
    }
  }

  if (needSave) {
    const settingsFile = path.join(__dirname, '../../data/settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8');
    console.log(`💾 Updated settings.json with ${migrated} R2 URLs`);
  }

  if (migrated > 0) {
    console.log(`🎉 Media migration complete: ${migrated} files migrated to R2`);
  } else if (missing.length === 0) {
    console.log('✅ No local media to migrate - all records already on R2 or no media');
  }
  if (missing.length > 0) {
    console.warn(`⚠️ ${missing.length} files referenced in DB but missing on disk - admin must re-upload:`, missing.map(m => m.filename).join(', '));
  }

  return { migrated, missing };
}

module.exports = { migrateLocalMediaToR2 };
