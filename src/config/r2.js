/**
 * Cloudflare R2 Persistent Storage - S3 Compatible
 * Required env vars when enabled:
 * - R2_ENDPOINT (e.g. https://<accountId>.r2.cloudflarestorage.com)
 * - R2_ACCESS_KEY_ID
 * - R2_SECRET_ACCESS_KEY
 * - R2_BUCKET
 * - R2_PUBLIC_URL (e.g. https://pub-xxxx.r2.dev or https://media.yourdomain.com)
 * Optional:
 * - R2_REGION (default auto)
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

function isR2Enabled() {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

let s3Client = null;
function getS3Client() {
  if (!isR2Enabled()) return null;
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
  });
  return s3Client;
}

function getPublicUrl(key) {
  if (!isR2Enabled()) return null;
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/${key.replace(/^\//, '')}`;
}

async function uploadToR2(buffer, key, contentType) {
  const client = getS3Client();
  if (!client) throw new Error('R2 not configured');
  const bucket = process.env.R2_BUCKET;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await client.send(command);
  return getPublicUrl(key);
}

async function deleteFromR2(key) {
  const client = getS3Client();
  if (!client) return false;
  const bucket = process.env.R2_BUCKET;
  try {
    const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await client.send(cmd);
    return true;
  } catch (e) {
    console.warn('R2 delete failed for', key, e.message);
    return false;
  }
}

async function existsInR2(key) {
  const client = getS3Client();
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isR2Enabled,
  getS3Client,
  getPublicUrl,
  uploadToR2,
  deleteFromR2,
  existsInR2,
};
