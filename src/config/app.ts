// ══════════════════════════════════════════════════════════════════════
// Application Configuration Constants
// ══════════════════════════════════════════════════════════════════════

import dotenv from 'dotenv';
dotenv.config();

export const appConfig = {
  // Application
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appName: process.env.APP_NAME || 'PM & ERP SaaS',
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  // Session
  sessionSecret: process.env.SESSION_SECRET || 'default-session-secret-change-me',
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000', 10),

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // Daraja (Platform-Level)
  daraja: {
    environment: process.env.DARAJA_ENVIRONMENT || 'sandbox',
    consumerKey: process.env.DARAJA_CONSUMER_KEY || '',
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET || '',
    passkey: process.env.DARAJA_PASSKEY || '',
    shortcode: process.env.DARAJA_SHORTCODE || '174379',
    shortcodeType: process.env.DARAJA_SHORTCODE_TYPE || 'PAYBILL',
    callbackUrl: process.env.DARAJA_CALLBACK_URL || 'http://localhost:3000/api/mpesa/callback',
    get baseUrl(): string {
      return this.environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
    },
  },

  // PayPal (Platform-Level)
  paypal: {
    enabled: process.env.PAYPAL_ENABLED === 'true',
    environment: (process.env.PAYPAL_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    businessEmail: process.env.PAYPAL_BUSINESS_EMAIL || '',
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    currency: process.env.PAYPAL_CURRENCY || 'USD',
    exchangeRate: parseFloat(process.env.PAYPAL_EXCHANGE_RATE || '130.00'),
  },

  // Email (SMTP)
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'PM & ERP SaaS <noreply@pmerp.local>',
  },

  // SMS (Africa's Talking)
  sms: {
    apiKey: process.env.AT_API_KEY || '',
    username: process.env.AT_USERNAME || 'sandbox',
    senderId: process.env.AT_SENDER_ID || 'PMERP',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // Uploads
  uploadDir: process.env.UPLOAD_DIR || 'public/uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),

  // Cloudflare R2 Object Storage
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'pm-erp-storage',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },

  // Encryption (for tenant Daraja credentials)
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'default-encryption-key-change-me!!',
    iv: process.env.ENCRYPTION_IV || 'default-iv-16byte',
  },
} as const;

export default appConfig;
