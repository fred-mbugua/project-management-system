// ══════════════════════════════════════════════════════════════════════
// File Upload Middleware - Multer Configuration
// Handles tenant logos, receipt images, and document attachments
// ══════════════════════════════════════════════════════════════════════

import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import appConfig from '../config/app';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const ALLOWED_DOCUMENT_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

/**
 * Storage engine that organizes uploads by tenant and type.
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, appConfig.uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

/**
 * File filter for image uploads (logos, avatars, receipts).
 */
function imageFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed.'));
  }
}

/**
 * File filter for document uploads (images + PDFs + spreadsheets).
 */
function documentFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  if (ALLOWED_DOCUMENT_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images, PDFs, and spreadsheet files are allowed.'));
  }
}

/** Upload a single logo image (max 2MB) */
export const uploadLogo = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
}).single('logo');

/** Upload a single receipt/document (max 10MB) */
export const uploadReceipt = multer({
  storage,
  fileFilter: documentFilter,
  limits: { fileSize: appConfig.maxFileSize },
}).single('receipt');

/** Upload multiple attachments (max 5 files, 10MB each) */
export const uploadAttachments = multer({
  storage,
  fileFilter: documentFilter,
  limits: { fileSize: appConfig.maxFileSize },
}).array('attachments', 5);

/** Upload CSV/Excel import file */
export const uploadImportFile = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed for import.'));
    }
  },
  limits: { fileSize: appConfig.maxFileSize },
}).single('importFile');
