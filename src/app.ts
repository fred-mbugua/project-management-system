// ══════════════════════════════════════════════════════════════════════
// PM & ERP SaaS - Express Application Entry Point
// Multi-Tenant Project Management, Invoicing & ERP System
// ══════════════════════════════════════════════════════════════════════

import express from 'express';
import path from 'path';
import fs from 'fs';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import flash from 'connect-flash';
import expressLayouts from 'express-ejs-layouts';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';

import appConfig from './config/app';
import logger from './utils/logger';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import adminRoutes from './routes/admin.routes';
import projectRoutes from './routes/project.routes';
import clientRoutes from './routes/client.routes';
import invoiceRoutes from './routes/invoice.routes';
import quotationRoutes from './routes/quotation.routes';
import expenseRoutes from './routes/expense.routes';
import accountingRoutes from './routes/accounting.routes';
import teamRoutes from './routes/team.routes';
import maintenanceRoutes from './routes/maintenance.routes';
import calendarRoutes from './routes/calendar.routes';
import settingsRoutes from './routes/settings.routes';
import auditRoutes from './routes/audit.routes';
import paymentPortalRoutes from './routes/paymentPortal.routes';
import subscriptionRoutes from './routes/subscription.routes';
import { recurringBillingService } from './services/recurringBilling.service';
import { subscriptionBillingService } from './services/subscriptionBilling.service';

const app = express();
const PgSession = connectPgSimple(session);

// Trust first proxy in production (e.g. Nginx, Cloudflare, Traefik)
app.set('trust proxy', 1);

// ──────────────────────────────────────────────
// View Engine Configuration
// ──────────────────────────────────────────────

const srcViewsDir = path.join(__dirname, '..', 'src', 'views');
const localViewsDir = path.join(__dirname, 'views');
const viewsDir = (fs.existsSync(srcViewsDir) && process.env.NODE_ENV !== 'production')
  ? srcViewsDir
  : (fs.existsSync(localViewsDir) ? localViewsDir : srcViewsDir);

app.set('view engine', 'ejs');
app.set('views', viewsDir);
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ──────────────────────────────────────────────
// Core Middleware Stack
// ──────────────────────────────────────────────

// Security headers
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unicons.iconscout.com', 'https://cdn.jsdelivr.net', 'https://*.paypal.com', 'https://*.paypalobjects.com'],
        styleSrcAttr: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://unicons.iconscout.com'],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://www.paypal.com',
          'https://*.paypal.com',
          'https://*.paypalobjects.com',
          'https://static.cloudflareinsights.com',
          'https://*.cloudflareinsights.com',
        ],
        scriptSrcAttr: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://*.paypalobjects.com', 'https://*.paypal.com'],
        connectSrc: [
          "'self'",
          'https://www.paypal.com',
          'https://*.paypal.com',
          'https://www.sandbox.paypal.com',
          'https://*.paypalobjects.com',
          'https://cloudflareinsights.com',
          'https://*.cloudflareinsights.com',
        ],
        frameSrc: [
          "'self'",
          'https://www.paypal.com',
          'https://*.paypal.com',
          'https://www.sandbox.paypal.com',
          'https://*.paypalobjects.com',
        ],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
      },
    },
  })
);

// CORS
app.use(cors({ origin: appConfig.appUrl, credentials: true }));

// Compression
app.use(compression());

// Request logging
if (appConfig.nodeEnv === 'development') {
  app.use(morgan('dev'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing
app.use(cookieParser(appConfig.sessionSecret));

// Static files (Zero Inline Asset Constraint - all CSS/JS served from /public/)
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));

// ──────────────────────────────────────────────
// Session Configuration (PostgreSQL-backed)
// ──────────────────────────────────────────────

app.use(
  session({
    store: new PgSession({
      conString: appConfig.databaseUrl,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    secret: appConfig.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: appConfig.nodeEnv === 'production',
      httpOnly: true,
      maxAge: appConfig.sessionMaxAge,
      sameSite: 'lax',
    },
    name: 'pmerp.sid',
  })
);

// Flash messages
app.use(flash());

// ──────────────────────────────────────────────
// Global Template Variables
// ──────────────────────────────────────────────

app.use((req, res, next) => {
  // Flash messages available in all templates
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.info = req.flash('info');
  res.locals.warning = req.flash('warning');

  // App metadata
  res.locals.appName = appConfig.appName;
  res.locals.appUrl = appConfig.appUrl;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.currentPath = req.path;

  // Defaults (overridden by auth/tenant middleware)
  res.locals.isAuthenticated = false;
  res.locals.currentUser = null;
  res.locals.tenant = null;
  res.locals.isSuperAdmin = false;

  next();
});

// ──────────────────────────────────────────────
// Route Registration
// ──────────────────────────────────────────────

// Public routes (no auth required)
app.use('/auth', authRoutes);
app.use('/pay', paymentPortalRoutes);

// Protected routes
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/projects', projectRoutes);
app.use('/clients', clientRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/quotations', quotationRoutes);
app.use('/expenses', expenseRoutes);
app.use('/accounting', accountingRoutes);
app.use('/team', teamRoutes);
app.use('/maintenance', maintenanceRoutes);
app.use('/calendar', calendarRoutes);
app.use('/settings', settingsRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/audit-logs', auditRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root redirect
app.get('/', (req, res) => {
  if (req.session?.userId) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/auth/login');
  }
});

// ──────────────────────────────────────────────
// Process-Wide Error Catchers
// ──────────────────────────────────────────────

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal('Uncaught Process Exception', {
    message: err.message,
    stack: err.stack,
  });
});

// ──────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────

app.use(notFoundHandler);
app.use(globalErrorHandler);

// ──────────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────────

const PORT = appConfig.port;

app.listen(PORT, () => {
  logger.info(`🚀 ${appConfig.appName} is running`, {
    port: PORT,
    env: appConfig.nodeEnv,
    url: `http://localhost:${PORT}`,
  });
  recurringBillingService.initCron();
  subscriptionBillingService.startScheduledChecker();
});

export default app;
