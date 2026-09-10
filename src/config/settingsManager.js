const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const settingsFile = path.join(dataDir, 'settings.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DEFAULT_SETTINGS = {
  payment_mode: 'fixed',
  default_amount: '1000',
  minimum_custom_amount: '100',
  amount: '1000',
  currency: 'INR',
  payment_provider: 'cashfree',
  payment_environment: 'sandbox',
  max_family: '4',
  hero_opacity: '0.68'
};

function ensureDefaults(settings) {
  let changed = false;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings[k] === undefined || settings[k] === null || String(settings[k]).trim() === '') {
      settings[k] = v;
      changed = true;
    }
  }
  // Alias legacy amount to default_amount if needed
  if (settings.default_amount === DEFAULT_SETTINGS.default_amount && settings.amount && String(settings.amount).trim() !== '') {
    // keep amount as is but ensure default_amount reflects it if not explicitly set
    if (!settings._migrated_amount) {
      // don't override default_amount if user already customized payment_mode
    }
  }
  // Ensure payment_mode is valid
  if (!['fixed','custom'].includes(String(settings.payment_mode))) {
    settings.payment_mode = 'fixed';
    changed = true;
  }
  // Ensure currency
  if (!settings.currency) settings.currency = 'INR';
  return changed;
}

function loadData() {
  if (fs.existsSync(settingsFile)) {
    try {
      const raw = fs.readFileSync(settingsFile, 'utf8');
      const data = JSON.parse(raw);
      if (!data.settings) data.settings = {};
      if (!data.images) data.images = [];
      if (!data.videos) data.videos = [];
      if (ensureDefaults(data.settings)) {
        // Persist defaults migration silently
        try { fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8'); } catch(e){}
      }
      return data;
    } catch (e) {
      console.error('Error reading settings.json:', e);
    }
  }
  return { settings: { ...DEFAULT_SETTINGS }, images: [], videos: [] };
}

function saveData(data) {
  if (data.settings) ensureDefaults(data.settings);
  fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8');
}

function getPublicData() {
  const data = loadData();
  // Ensure public data always has payment fields sanitized for frontend (no secrets)
  if (ensureDefaults(data.settings)) {
    try { fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8'); } catch(e){}
  }
  // Include centralized Rasi / Nakshatra lists for frontend (single source of truth via constants.js)
  try {
    const { RASI_LIST, NAKSHATRA_LIST } = require('../utils/constants');
    if (!data.rasi) data.rasi = RASI_LIST;
    if (!data.nakshatra) data.nakshatra = NAKSHATRA_LIST;
    // Also provide aliases for older frontend keys
    if (!data.rasi_list) data.rasi_list = RASI_LIST;
  } catch(e) {}
  return data;
}

function updateSettings(newSettings) {
  const data = loadData();
  // Whitelist allowed keys and normalize payment fields
  const normalized = { ...newSettings };
  if (normalized.payment_mode !== undefined) {
    const pm = String(normalized.payment_mode).toLowerCase();
    normalized.payment_mode = pm === 'custom' ? 'custom' : 'fixed';
  }
  if (normalized.default_amount !== undefined) {
    const da = Number(normalized.default_amount);
    if (!Number.isFinite(da) || da <= 0) throw new Error('default_amount must be a positive number');
    normalized.default_amount = String(Math.round(da));
  }
  if (normalized.minimum_custom_amount !== undefined) {
    const ma = Number(normalized.minimum_custom_amount);
    if (!Number.isFinite(ma) || ma <= 0) throw new Error('minimum_custom_amount must be a positive number');
    normalized.minimum_custom_amount = String(Math.round(ma));
  }
  if (normalized.amount !== undefined) {
    const am = Number(normalized.amount);
    if (!Number.isFinite(am) || am <= 0) throw new Error('amount must be a positive number');
    normalized.amount = String(Math.round(am));
    // Keep default_amount in sync when in fixed mode and admin edits legacy amount field
    if (!normalized.default_amount && data.settings.payment_mode !== 'custom') {
      normalized.default_amount = normalized.amount;
    }
  }
  // Also handle legacy amount fallback
  data.settings = Object.assign({}, data.settings, normalized);
  // Sync amount and default_amount for consistency
  if (data.settings.default_amount && !data.settings.amount) data.settings.amount = data.settings.default_amount;
  if (data.settings.amount && !data.settings.default_amount) data.settings.default_amount = data.settings.amount;
  ensureDefaults(data.settings);
  saveData(data);
  return data.settings;
}

function addImage({ filename, title_ta, title_en, is_hero }) {
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

  // Attempt to remove file from public/uploads
  if (removed && removed.filename) {
    const filePath = path.join(__dirname, '../../public/uploads', removed.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { console.error('Error deleting image file:', e); }
    }
  }

  return true;
}

function addVideo({ filename, title_ta, title_en }) {
  const data = loadData();
  const id = Date.now();
  const vidObj = {
    id,
    filename,
    title_ta: title_ta || '',
    title_en: title_en || ''
  };

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

  // Attempt to remove file from public/videos
  if (removed && removed.filename) {
    const filePath = path.join(__dirname, '../../public/videos', removed.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { console.error('Error deleting video file:', e); }
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
