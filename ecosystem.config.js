// ══════════════════════════════════════════════════════════════════════
// PM2 Ecosystem Configuration File
// Production Process Management for PM & ERP SaaS System
// ══════════════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: 'pm-erp-saas',
      script: './dist/app.js',
      cwd: './',
      instances: 1, // Can be increased or set to 'max' for cluster mode
      exec_mode: 'fork', // Use 'cluster' when scaling across multiple CPU cores
      watch: false,
      max_memory_restart: '1G',
      autorestart: true,
      restart_delay: 4000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,

      // Default / Development environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      // Production environment variables (triggered with: pm2 start ecosystem.config.js --env production)
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        APP_NAME: 'PM & ERP SaaS',
        APP_URL: 'http://localhost:3000', // Set to production domain, e.g. https://erp.yourdomain.com

        // PostgreSQL Database Connection
        DATABASE_URL: 'postgresql://databaseadmin:VSecure2026@Infinity@localhost:5432/pm_erp_saas?schema=public',

        // Session & Security Secrets
        SESSION_SECRET: 'pm-erp-super-secret-session-key-change-in-production-2026',
        SESSION_MAX_AGE: '86400000',
        JWT_SECRET: 'pm-erp-jwt-secret-key-change-in-production-2026',
        JWT_EXPIRES_IN: '24h',
        ENCRYPTION_KEY: 'pm-erp-aes-256-encryption-key-change-me',
        ENCRYPTION_IV: 'pm-erp-iv-16bytes',

        // Platform-Level Safaricom Daraja M-Pesa Integration
        DARAJA_ENVIRONMENT: 'sandbox', // Switch to 'production' for live payments
        DARAJA_CONSUMER_KEY: 'V7AGIgWBGpK5iek1zR2VnIomaRgms3pumOOnfBg3srslLSMk',
        DARAJA_CONSUMER_SECRET: '7pZUelreG8xS1H09WDAnsVxeQrywZs5bxw6fUMV4fnipq4Pt2LeLCYe9JQ9QOivs',
        DARAJA_PASSKEY: 'ee995f018e57d429fe5a82e737aa410528c1347972391ecb0ede2d1a498debd2',
        DARAJA_SHORTCODE: '4814641',
        DARAJA_SHORTCODE_TYPE: 'Bussiness Paybill', // PAYBILL or TILL
        DARAJA_CALLBACK_URL: 'https://projects.freestylecodetechnologies.com/api/mpesa/callback',

        // Email (Nodemailer SMTP)
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'freestylecodetechnologies@gmail.com',
        SMTP_PASS: 'uwem whfv oszc lfmg',
        SMTP_FROM: 'PM & ERP SaaS <freestylecodetechnologies@gmail.com>',

        // SMS (Africa\'s Talking)
        AT_API_KEY: 'your_africastalking_api_key',
        AT_USERNAME: 'sandbox',
        AT_SENDER_ID: 'PMERP',

        // Redis (BullMQ Job Queues)
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        REDIS_PASSWORD: '',

        // Local Uploads & Cloudflare R2 Object Storage
        UPLOAD_DIR: 'public/uploads',
        MAX_FILE_SIZE: '10485760',
        R2_ACCOUNT_ID: 'f7ebd50513e5493d09ae4c10d32e540b',
        R2_ACCESS_KEY_ID: '27d6d09e449edc080dfc6f8ff3e88c87',
        R2_SECRET_ACCESS_KEY: '08a22221fb5a32c88c3448eea0620e1ebc498a461c94bdb0c9f70af520de0c8e',
        R2_BUCKET_NAME: 'pm-erp-storage',
        R2_PUBLIC_URL: 'https://pub-67f6a1e959214e8cba416fe393da3428.r2.dev',

        // Initial Super Admin (Used during npm run db:deploy:init / db:clean)
        SUPER_ADMIN_EMAIL: 'freestylecodetechnologies@gmail.com',
        SUPER_ADMIN_PASSWORD: 'Password123!',
      },
    },
  ],
};
