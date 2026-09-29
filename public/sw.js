/**
 * ══════════════════════════════════════════════════════════════════════
 * PM & ERP SaaS - Service Worker
 * Caching strategy: Network-first for API/pages, Cache-first for assets
 * ══════════════════════════════════════════════════════════════════════
 */

const CACHE_NAME = 'pm-erp-v1';
const STATIC_CACHE = 'pm-erp-static-v1';
const DYNAMIC_CACHE = 'pm-erp-dynamic-v1';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/css/app.css',
  '/css/components.css',
  '/css/dashboard.css',
  '/js/app.js',
  '/favicon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
];

// ────────────────────────────────────────────────
// Install Event - Pre-cache essential assets
// ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Pre-cache failed for some assets:', err);
        return self.skipWaiting();
      })
  );
});

// ────────────────────────────────────────────────
// Activate Event - Clean up old caches
// ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ────────────────────────────────────────────────
// Fetch Event - Smart caching strategies
// ────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (CDN fonts, external APIs, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API and auth routes (always network-only)
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/login') ||
      url.pathname.startsWith('/logout') ||
      url.pathname.startsWith('/register')) {
    return;
  }

  // Static assets: Cache-first strategy
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Pages/HTML: Network-first strategy (with fallback)
  event.respondWith(networkFirst(request));
});

// ────────────────────────────────────────────────
// Caching Strategies
// ────────────────────────────────────────────────

/**
 * Cache-first: Return cached version, falling back to network
 * Best for static assets that rarely change (CSS, JS, images, fonts)
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Cache-first fetch failed:', request.url);
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Network-first: Try network, fall back to cache
 * Best for dynamic pages that should be fresh but can use stale data offline
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline fallback page
    return caches.match('/offline.html').then((offlineResponse) => {
      return offlineResponse || new Response(getOfflineFallbackHTML(), {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      });
    });
  }
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function isStaticAsset(pathname) {
  const staticExtensions = [
    '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.ico', '.woff', '.woff2', '.ttf', '.eot', '.webp', '.webm',
    '.json',
  ];
  // Exclude manifest.json from static cache to always get fresh version
  if (pathname === '/manifest.json') return true;
  return staticExtensions.some((ext) => pathname.endsWith(ext));
}

function getOfflineFallbackHTML() {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline | PM & ERP SaaS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #0F172A;
      color: #E2E8F0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .offline-container {
      text-align: center;
      max-width: 440px;
    }
    .offline-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: rgba(232, 101, 10, 0.15);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .offline-icon svg {
      width: 40px;
      height: 40px;
      color: #e8650a;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 12px;
      color: #F1F5F9;
    }
    p {
      font-size: 0.95rem;
      color: #94A3B8;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .retry-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      background: #e8650a;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      text-decoration: none;
    }
    .retry-btn:hover { background: #d45a09; }
  </style>
</head>
<body>
  <div class="offline-container">
    <div class="offline-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M12 12v.01M8.172 8.172a5 5 0 017.656 0M15.828 15.828a5 5 0 01-7.656 0"/>
        <line x1="4" y1="4" x2="20" y2="20" stroke-linecap="round"/>
      </svg>
    </div>
    <h1>You're Offline</h1>
    <p>It looks like you've lost your internet connection. Please check your network and try again.</p>
    <a href="/" class="retry-btn" onclick="window.location.reload(); return false;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115.85-5.85L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15.85 5.85L3 16"/></svg>
      Try Again
    </a>
  </div>
</body>
</html>`;
}

// ────────────────────────────────────────────────
// Background Sync (future enhancement placeholder)
// ────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
