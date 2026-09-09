const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../../public/uploads');
const videosDir = path.join(__dirname, '../../public/videos');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// Image storage
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = 'img_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
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

// Video storage
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, videosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = 'vid_' + Date.now() + '_' + Math.round(Math.random() * 1e4) + ext;
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
