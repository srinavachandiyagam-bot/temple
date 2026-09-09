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
