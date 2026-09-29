// ══════════════════════════════════════════════════════════════════════
// Cloudflare R2 Object Storage Service
// S3-Compatible Storage for Logos, Attachments & Project Management
// ══════════════════════════════════════════════════════════════════════

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import appConfig from '../config/app';
import logger from '../utils/logger';
import { query } from '../config/database';

const storageLogger = logger.child('StorageService');

export interface UploadResult {
  url: string;
  key: string;
  storageType: 'r2' | 'local';
}

export interface TenantStorageMetrics {
  tenantId: string;
  usedBytes: number;
  usedMb: number;
  allocatedMb: number;
  remainingMb: number;
  percentUsed: number;
  isOverQuota: boolean;
  isExempt: boolean;
  fileCount: number;
  documentCount: number;
  folderPath: string;
  storageType: 'r2' | 'local' | 'hybrid';
}

class StorageService {
  private s3Client: S3Client | null = null;
  private isR2Configured: boolean = false;

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const { accountId, accessKeyId, secretAccessKey } = appConfig.r2;

    if (accountId && accessKeyId && secretAccessKey) {
      try {
        this.s3Client = new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        });
        this.isR2Configured = true;
        storageLogger.info('✅ Cloudflare R2 Object Storage client initialized');
      } catch (error) {
        storageLogger.warn('Failed to initialize Cloudflare R2 client, falling back to local disk storage', { error: String(error) });
        this.s3Client = null;
        this.isR2Configured = false;
      }
    } else {
      storageLogger.info('Cloudflare R2 credentials not fully provided; using local storage with R2-ready interface.');
      this.isR2Configured = false;
    }
  }

  /**
   * Upload a Multer file or memory buffer to Cloudflare R2 (or local fallback)
   */
  async uploadFile(file: Express.Multer.File, folder: string = 'uploads'): Promise<UploadResult> {
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueKey = `${folder}/${Date.now()}-${uuidv4().slice(0, 8)}-${sanitizedBase}${ext}`;

    const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
    if (!buffer) {
      throw new Error('File buffer is empty or missing');
    }

    return this.uploadBuffer(buffer, uniqueKey, file.mimetype || 'application/octet-stream');
  }

  /**
   * Upload buffer directly with a custom key and mimetype
   */
  async uploadBuffer(buffer: Buffer, key: string, mimetype: string): Promise<UploadResult> {
    // If Cloudflare R2 is configured and client exists, upload to R2
    if (this.isR2Configured && this.s3Client) {
      try {
        const command = new PutObjectCommand({
          Bucket: appConfig.r2.bucketName,
          Key: key,
          Body: buffer,
          ContentType: mimetype,
        });

        await this.s3Client.send(command);

        // Determine public URL
        const publicUrl = appConfig.r2.publicUrl
          ? `${appConfig.r2.publicUrl.replace(/\/$/, '')}/${key}`
          : `https://${appConfig.r2.bucketName}.${appConfig.r2.accountId}.r2.cloudflarestorage.com/${key}`;

        storageLogger.info('File successfully uploaded to Cloudflare R2', { key, url: publicUrl });

        return {
          url: publicUrl,
          key,
          storageType: 'r2',
        };
      } catch (error) {
        storageLogger.error('Cloudflare R2 upload error, attempting local fallback', { key, error: String(error) });
      }
    }

    // Local Disk Fallback (public/uploads/...)
    try {
      const publicUploadsDir = path.join(process.cwd(), 'public', 'uploads');
      const targetPath = path.join(publicUploadsDir, key);
      const targetDir = path.dirname(targetPath);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(targetPath, buffer);

      const localUrl = `/uploads/${key}`;
      storageLogger.info('File stored in local directory', { path: targetPath, url: localUrl });

      return {
        url: localUrl,
        key,
        storageType: 'local',
      };
    } catch (localError: any) {
      storageLogger.error('Failed to store file locally', { error: localError.message });
      throw new Error(`File upload failed: ${localError.message}`);
    }
  }

  /**
   * Extract the relative storage key from a full URL, relative path, or raw key.
   * Handles:
   * - Cloudflare R2 Public URLs: https://pub-xxx.r2.dev/logos/abc.png -> logos/abc.png
   * - S3/R2 direct URLs: https://bucket.acc.r2.cloudflarestorage.com/logos/abc.png -> logos/abc.png
   * - S3 path-style URLs: https://.../bucket-name/logos/abc.png -> logos/abc.png
   * - Full localhost / server URLs: http://localhost:3000/uploads/logos/abc.png -> logos/abc.png
   * - Local paths: /uploads/logos/abc.png or uploads/logos/abc.png -> logos/abc.png
   * - Raw keys: logos/abc.png -> logos/abc.png
   */
  extractKeyFromUrl(urlOrKey: string): string {
    if (!urlOrKey || typeof urlOrKey !== 'string') return '';
    const trimmed = urlOrKey.trim();
    if (!trimmed || trimmed.startsWith('data:')) return '';

    let pathname = trimmed;
    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const parsed = new URL(trimmed);
        pathname = parsed.pathname;
      }
    } catch {
      // Fallback to path string parsing
    }

    // Decode URI encoding (spaces, %20, etc.)
    let clean = decodeURIComponent(pathname);

    // Strip leading slashes
    clean = clean.replace(/^\/+/, '');

    // Strip bucket name if in pathname (e.g. S3 path-style https://.../pm-erp-storage/logos/...)
    if (appConfig.r2.bucketName && clean.startsWith(`${appConfig.r2.bucketName}/`)) {
      clean = clean.slice(appConfig.r2.bucketName.length + 1);
    }

    // Strip leading /uploads/ or uploads/ or public/uploads/
    clean = clean.replace(/^(public\/)?uploads\//, '');

    // Strip leading slashes again just in case
    clean = clean.replace(/^\/+/, '');

    return clean;
  }

  /**
   * Delete file from storage (both Cloudflare R2 and local server disk fallback)
   */
  async deleteFile(urlOrKey: string): Promise<boolean> {
    if (!urlOrKey) return false;
    const key = this.extractKeyFromUrl(urlOrKey);
    if (!key) return false;

    let deleted = false;

    // 1. Delete from Cloudflare R2 if configured
    if (this.isR2Configured && this.s3Client) {
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: appConfig.r2.bucketName,
            Key: key,
          })
        );
        storageLogger.info('File successfully deleted from Cloudflare R2', { key, originalUrl: urlOrKey });
        deleted = true;
      } catch (error) {
        storageLogger.warn('Failed to delete file from Cloudflare R2', { key, error: String(error) });
      }
    }

    // 2. Also check and delete from local disk (for fallback or local uploads)
    try {
      const publicUploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
      const candidatePaths = [
        path.resolve(publicUploadsDir, key),
        path.resolve(process.cwd(), 'public', key),
      ];

      for (const filePath of candidatePaths) {
        // Enforce path traversal protection (must reside under /public/)
        if (filePath.startsWith(path.resolve(process.cwd(), 'public')) && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          storageLogger.info('Local file successfully deleted from server disk', { filePath, key });
          deleted = true;
          break;
        }
      }
    } catch (err) {
      storageLogger.warn('Failed to delete local file', { key, error: String(err) });
    }

    return deleted;
  }

  /**
   * Ensure tenant isolated folder structure exists on local server
   */
  ensureTenantStorageFolder(tenantId: string): string {
    const tenantDir = path.join(process.cwd(), 'public', 'uploads', 'tenants', tenantId);
    const subfolders = ['projects', 'branding', 'payment-proofs', 'documents'];
    try {
      if (!fs.existsSync(tenantDir)) {
        fs.mkdirSync(tenantDir, { recursive: true });
      }
      for (const sub of subfolders) {
        const subPath = path.join(tenantDir, sub);
        if (!fs.existsSync(subPath)) {
          fs.mkdirSync(subPath, { recursive: true });
        }
      }
    } catch (e: any) {
      storageLogger.warn('Failed to ensure tenant directory structure', { tenantId, error: e.message });
    }
    return tenantDir;
  }

  /**
   * Helper to recursively calculate disk size and file count of a directory
   */
  private getDiskDirectorySizeBytes(dirPath: string): { totalBytes: number; fileCount: number } {
    let totalBytes = 0;
    let fileCount = 0;
    try {
      if (!fs.existsSync(dirPath)) return { totalBytes: 0, fileCount: 0 };
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const sub = this.getDiskDirectorySizeBytes(fullPath);
          totalBytes += sub.totalBytes;
          fileCount += sub.fileCount;
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          totalBytes += stats.size;
          fileCount += 1;
        }
      }
    } catch (e) {
      // Ignore directory access error
    }
    return { totalBytes, fileCount };
  }

  /**
   * Fetch comprehensive tenant storage usage metrics against subscription allocation
   */
  async getTenantStorageUsage(tenantId: string): Promise<TenantStorageMetrics> {
    try {
      // 1. Ensure directory exists
      this.ensureTenantStorageFolder(tenantId);

      // 2. Query project_documents sum and count
      const docsRes = await query(
        `SELECT COALESCE(SUM(file_size), 0)::bigint as total_bytes, COUNT(*)::int as count 
         FROM project_documents WHERE tenant_id = $1`,
        [tenantId]
      );
      const dbBytes = parseInt(docsRes.rows[0]?.total_bytes || '0', 10);
      const dbCount = parseInt(docsRes.rows[0]?.count || '0', 10);

      // 3. Inspect local disk directory
      const localTenantDir = path.join(process.cwd(), 'public', 'uploads', 'tenants', tenantId);
      const diskMetrics = this.getDiskDirectorySizeBytes(localTenantDir);

      const usedBytes = Math.max(dbBytes, diskMetrics.totalBytes);
      const fileCount = Math.max(dbCount, diskMetrics.fileCount);
      const usedMb = Number((usedBytes / (1024 * 1024)).toFixed(2));

      // 4. Fetch subscription allocation and exemption
      const subRes = await query(
        `SELECT 
           t.subscription_exempt,
           COALESCE(sp.max_storage_mb, 1000)::int as max_storage_mb
         FROM tenants t
         LEFT JOIN tenant_subscriptions ts ON t.id = ts.tenant_id
         LEFT JOIN subscription_plans sp ON ts.plan_id = sp.id
         WHERE t.id = $1
         LIMIT 1`,
        [tenantId]
      );

      const isExempt = Boolean(subRes.rows[0]?.subscription_exempt);
      const allocatedMb = subRes.rows[0]?.max_storage_mb || 1000;
      const remainingMb = Math.max(0, Number((allocatedMb - usedMb).toFixed(2)));
      const percentUsed = Math.min(100, Math.round((usedMb / allocatedMb) * 100));
      const isOverQuota = !isExempt && (usedBytes >= allocatedMb * 1024 * 1024);

      return {
        tenantId,
        usedBytes,
        usedMb,
        allocatedMb,
        remainingMb,
        percentUsed,
        isOverQuota,
        isExempt,
        fileCount,
        documentCount: fileCount,
        folderPath: `tenants/${tenantId}`,
        storageType: this.isR2Configured ? 'r2' : 'local',
      };
    } catch (err: any) {
      storageLogger.error('Failed to get tenant storage usage', { tenantId, error: err.message });
      return {
        tenantId,
        usedBytes: 0,
        usedMb: 0,
        allocatedMb: 1000,
        remainingMb: 1000,
        percentUsed: 0,
        isOverQuota: false,
        isExempt: false,
        fileCount: 0,
        documentCount: 0,
        folderPath: `tenants/${tenantId}`,
        storageType: 'local',
      };
    }
  }

  /**
   * Upload a file strictly partitioned under tenant isolated folder structure
   * on Cloudflare R2 and server filesystem: tenants/{tenantId}/{subfolder}
   * Enforces storage quota check against tenant subscription allocation.
   */
  async uploadTenantFile(tenantId: string, file: Express.Multer.File, subfolder: string = 'documents'): Promise<UploadResult> {
    if (!tenantId) {
      throw new Error('Tenant context required for tenant-scoped file upload');
    }

    // Check storage limits
    const usage = await this.getTenantStorageUsage(tenantId);
    if (!usage.isExempt && (usage.usedBytes + file.size > usage.allocatedMb * 1024 * 1024)) {
      throw new Error(
        `Storage limit reached (${usage.usedMb} MB used of ${usage.allocatedMb} MB allocated). Please upgrade your subscription plan or delete unused files to upload new files.`
      );
    }

    // Ensure tenant directory exists on server
    this.ensureTenantStorageFolder(tenantId);

    // Target folder structure: tenants/{tenantId}/{subfolder}
    const tenantFolder = `tenants/${tenantId}/${subfolder}`;
    return this.uploadFile(file, tenantFolder);
  }
}

export const storageService = new StorageService();
export default storageService;
