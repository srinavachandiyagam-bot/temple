const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../../public/uploads');
const videosDir = path.join(__dirname, '../../public/videos');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// Check R2 at load time - if enabled, use memory storage so we can upload to R2
let isR2 = false;
try {
  const { isR2Enabled } = require('./r2');
  isR2 = isR2Enabled();
  if (isR2) console.log('📦 R2 persistent storage ENABLED - uploads will go to', process.env.R2_BUCKET);
  else console.log('📁 R2 not configured - using local disk storage (ephemeral)');
} catch (e) {
  isR2 = false;
}

function generateSafeName(prefix, originalname) {
  const ext = path.extname(originalname).toLowerCase() || '';
  return prefix + '_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
}

// Image storage - memory if R2, disk otherwise
const imageStorage = isR2
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const safeName = generateSafeName('img', file.originalname);
        cb(null, safeName);
      }
    });

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Allowed: JPG, PNG, WEBP, GIF.'));
    }
  }
});

// Video storage - memory if R2, disk otherwise
const videoStorage = isR2
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, videosDir),
      filename: (req, file, cb) => {
        const safeName = generateSafeName('vid', file.originalname);
        cb(null, safeName);
      }
    });

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid video type. Allowed: MP4, WebM, MOV, MKV.'));
    }
  }
});

module.exports = {
  uploadImage,
  uploadVideo
};
