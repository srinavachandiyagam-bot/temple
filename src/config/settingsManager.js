const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const settingsFile = path.join(dataDir, 'settings.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function loadData() {
  if (fs.existsSync(settingsFile)) {
    try {
      const raw = fs.readFileSync(settingsFile, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading settings.json:', e);
    }
  }
  return { settings: {}, images: [], videos: [] };
}

function saveData(data) {
  fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8');
}

function getPublicData() {
  return loadData();
}

function updateSettings(newSettings) {
  const data = loadData();
  data.settings = Object.assign({}, data.settings, newSettings);
  saveData(data);
  return data.settings;
}

function addImage({ filename, title_ta, title_en, is_hero, url }) {
  const data = loadData();
  const id = Date.now();
  const isHeroNum = is_hero === '1' || is_hero === 1 ? 1 : 0;

  if (isHeroNum === 1) {
    data.images.forEach(img => { img.is_hero = 0; });
  }

  const imgObj = {
    id,
    filename,
    title_ta: title_ta || '',
    title_en: title_en || '',
    is_hero: isHeroNum
  };
  // R2 persistent URL if provided
  if (url) imgObj.url = url;
  // Also support storing key as filename and public URL separately
  // For backward compat, filename may be a full URL if caller passed R2 URL as filename
  if (filename && filename.startsWith('http')) {
    imgObj.url = filename;
    imgObj.filename = filename.split('/').pop();
  }

  data.images.push(imgObj);
  saveData(data);
  return imgObj;
}

function updateImage(id, { title_ta, title_en, is_hero }) {
  const data = loadData();
  const numId = Number(id);
  const img = data.images.find(x => x.id === numId);
  if (!img) return null;

  if (title_ta !== undefined) img.title_ta = title_ta;
  if (title_en !== undefined) img.title_en = title_en;
  if (is_hero !== undefined) {
    const heroNum = is_hero === '1' || is_hero === 1 ? 1 : 0;
    if (heroNum === 1) {
      data.images.forEach(x => { x.is_hero = 0; });
    }
    img.is_hero = heroNum;
  }

  saveData(data);
  return img;
}

function deleteImage(id) {
  const data = loadData();
  const numId = Number(id);
  const idx = data.images.findIndex(x => x.id === numId);
  if (idx === -1) return false;

  const [removed] = data.images.splice(idx, 1);
  saveData(data);

  // Attempt to remove persistent storage first (R2), then local fallback
  let deleted = false;
  if (removed) {
    try {
      const { isR2Enabled, deleteFromR2, getPublicUrl } = require('./r2');
      if (isR2Enabled() && (removed.url || removed.filename)) {
        // Derive R2 key: if url exists, extract key after bucket host; else use filename with prefix
        let key = removed.filename;
        if (removed.url && removed.url.startsWith('http')) {
          try {
            const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
            if (base && removed.url.startsWith(base)) {
              key = removed.url.slice(base.length + 1);
            } else {
              // Fallback: try to extract after last /
              const urlObj = new URL(removed.url);
              key = urlObj.pathname.replace(/^\//, '');
            }
          } catch {}
          // If key doesn't contain prefix, try images/ prefix
          if (!key.includes('/')) key = `images/${key}`;
        } else if (key && !key.includes('/')) {
          key = `images/${key}`;
        }
        // Fire and forget R2 delete (don't block)
        deleteFromR2(key).catch(() => {});
        // Also try without prefix as fallback
        if (key.startsWith('images/')) {
          deleteFromR2(removed.filename).catch(() => {});
        }
        deleted = true;
      }
    } catch (e) {
      // ignore R2 errors, fall through to local
    }
    // Local fallback (only if not R2 or also try local for legacy)
    if (removed.filename) {
      const filePath = path.join(__dirname, '../../public/uploads', removed.filename);
      // Also try with basename if filename was a key with prefix
      const baseName = path.basename(removed.filename);
      const altPath = path.join(__dirname, '../../public/uploads', baseName);
      for (const p of [filePath, altPath]) {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (e) { console.error('Error deleting image file:', e); }
        }
      }
    }
  }

  return true;
}

function addVideo({ filename, title_ta, title_en, url }) {
  const data = loadData();
  const id = Date.now();
  const vidObj = {
    id,
    filename,
    title_ta: title_ta || '',
    title_en: title_en || ''
  };
  if (url) vidObj.url = url;
  if (filename && filename.startsWith('http')) {
    vidObj.url = filename;
    vidObj.filename = filename.split('/').pop();
  }

  data.videos.push(vidObj);
  saveData(data);
  return vidObj;
}

function updateVideo(id, { title_ta, title_en }) {
  const data = loadData();
  const numId = Number(id);
  const vid = data.videos.find(x => x.id === numId);
  if (!vid) return null;

  if (title_ta !== undefined) vid.title_ta = title_ta;
  if (title_en !== undefined) vid.title_en = title_en;

  saveData(data);
  return vid;
}

function deleteVideo(id) {
  const data = loadData();
  const numId = Number(id);
  const idx = data.videos.findIndex(x => x.id === numId);
  if (idx === -1) return false;

  const [removed] = data.videos.splice(idx, 1);
  saveData(data);

  if (removed) {
    try {
      const { isR2Enabled, deleteFromR2 } = require('./r2');
      if (isR2Enabled() && (removed.url || removed.filename)) {
        let key = removed.filename;
        if (removed.url && removed.url.startsWith('http')) {
          try {
            const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
            if (base && removed.url.startsWith(base)) {
              key = removed.url.slice(base.length + 1);
            } else {
              const urlObj = new URL(removed.url);
              key = urlObj.pathname.replace(/^\//, '');
            }
          } catch {}
          if (!key.includes('/')) key = `videos/${key}`;
        } else if (key && !key.includes('/')) {
          key = `videos/${key}`;
        }
        deleteFromR2(key).catch(() => {});
        if (key.startsWith('videos/')) deleteFromR2(removed.filename).catch(() => {});
      }
    } catch {}
    if (removed.filename) {
      const filePath = path.join(__dirname, '../../public/videos', removed.filename);
      const baseName = path.basename(removed.filename);
      const altPath = path.join(__dirname, '../../public/videos', baseName);
      for (const p of [filePath, altPath]) {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (e) { console.error('Error deleting video file:', e); }
        }
      }
    }
  }

  return true;
}

module.exports = {
  getPublicData,
  updateSettings,
  addImage,
  updateImage,
  deleteImage,
  addVideo,
  updateVideo,
  deleteVideo
};
