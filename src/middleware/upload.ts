// ══════════════════════════════════════════════════════════════════════
// Multer Upload Middleware (Memory Storage for Direct R2 Upload)
// ══════════════════════════════════════════════════════════════════════

import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import appConfig from '../config/app';

// Memory storage keeps file buffers in RAM so they can be dispatched to Cloudflare R2
const storage = multer.memoryStorage();

// Allowed image mime types for tenant logos and avatars
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/svg+xml',
];

// Allowed document types for project files and attachments
const ALLOWED_DOC_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
];

const imageFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (!file.originalname || file.originalname.trim() === '') {
    return cb(null, false);
  }
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image format. Allowed formats: PNG, JPG, JPEG, WebP, SVG.'));
  }
};

const documentFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (!file.originalname || file.originalname.trim() === '') {
    return cb(null, false);
  }
  if (ALLOWED_DOC_TYPES.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed formats: PDF, Word, Excel, CSV, Text, Zip, and Images.'));
  }
};

export const uploadLogo = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max for logos
  fileFilter: imageFilter,
});

export const uploadDocument = multer({
  storage,
  limits: { fileSize: appConfig.maxFileSize || 15 * 1024 * 1024 }, // 15 MB
  fileFilter: documentFilter,
});

export default {
  uploadLogo,
  uploadDocument,
};
