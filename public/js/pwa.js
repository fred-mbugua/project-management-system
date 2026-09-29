/**
 * ══════════════════════════════════════════════════════════════════════
 * PM & ERP SaaS - Progressive Web App (PWA) Client Script
 * Handles service worker lifecycle, installation prompts, and updates
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  var deferredPrompt = null;
  var installBanner = null;
  var installDismissed = false;

  // ── 1. Service Worker Registration ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(function (reg) {
          console.log('[PWA] Service Worker registered successfully, scope:', reg.scope);

          // Handle automatic updates
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available');
                showUpdateBanner();
              }
            });
          });
        })
        .catch(function (err) {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  // ── 2. Before Install Prompt Event ──
  window.addEventListener('beforeinstallprompt', function (e) {
    // Prevent the default mini-infobar
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt event captured');

    // Show any manual install buttons in navigation/sidebar
    updateInstallButtons(true);

    // Check cooldown for the automatic bottom banner
    var lastDismissed = localStorage.getItem('pwa-install-dismissed');
    if (lastDismissed) {
      var dismissedAt = parseInt(lastDismissed, 10);
      if (Date.now() - dismissedAt < 86400000) { // 24 hours
        console.log('[PWA] Automatic install banner in cooldown');
        return;
      }
    }

    // Show banner after short delay for optimal user experience
    setTimeout(function () {
      showInstallBanner();
    }, 2500);
  });

  // ── 3. App Installed Event ──
  window.addEventListener('appinstalled', function () {
    console.log('[PWA] Application installed on device');
    hideInstallBanner();
    updateInstallButtons(false);
    deferredPrompt = null;
  });

  // ── 4. Show & Hide Install Banner ──
  function showInstallBanner() {
    installBanner = document.getElementById('pwa-install-banner');
    if (!installBanner || installDismissed) return;

    installBanner.style.display = 'block';
    requestAnimationFrame(function () {
      installBanner.classList.remove('pwa-install-hide');
      installBanner.classList.add('pwa-install-show');
    });

    // Setup Install Button
    var installBtn = document.getElementById('pwa-install-btn');
    if (installBtn && !installBtn.dataset.bound) {
      installBtn.dataset.bound = 'true';
      installBtn.addEventListener('click', function () {
        triggerInstall();
      });
    }

    // Setup Dismiss Button
    var dismissBtn = document.getElementById('pwa-install-dismiss');
    if (dismissBtn && !dismissBtn.dataset.bound) {
      dismissBtn.dataset.bound = 'true';
      dismissBtn.addEventListener('click', function () {
        installDismissed = true;
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
        hideInstallBanner();
      });
    }
  }

  function hideInstallBanner() {
    if (!installBanner) {
      installBanner = document.getElementById('pwa-install-banner');
    }
    if (installBanner) {
      installBanner.classList.remove('pwa-install-show');
      installBanner.classList.add('pwa-install-hide');
      setTimeout(function () {
        if (!installBanner.classList.contains('pwa-install-show')) {
          installBanner.style.display = 'none';
        }
      }, 400);
    }
  }

  // ── 5. Trigger Installation ──
  function triggerInstall() {
    if (!deferredPrompt) {
      console.log('[PWA] No active deferredPrompt available');
      return;
    }

    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      console.log('[PWA] User response to install prompt:', choice.outcome);
      if (choice.outcome === 'accepted') {
        hideInstallBanner();
        updateInstallButtons(false);
      }
      deferredPrompt = null;
    });
  }

  // ── 6. Update Available Banner ──
  function showUpdateBanner() {
    var updateBanner = document.getElementById('pwa-update-banner');
    if (updateBanner) {
      updateBanner.style.display = 'block';
      requestAnimationFrame(function () {
        updateBanner.classList.add('pwa-install-show');
      });
      var updateBtn = document.getElementById('pwa-update-btn');
      if (updateBtn && !updateBtn.dataset.bound) {
        updateBtn.dataset.bound = 'true';
        updateBtn.addEventListener('click', function () {
          window.location.reload();
        });
      }
    }
  }

  // ── 7. Hook up Manual Install Buttons ──
  function updateInstallButtons(available) {
    var buttons = document.querySelectorAll('.btn-install-pwa');
    buttons.forEach(function (btn) {
      if (available) {
        btn.classList.remove('hidden');
        btn.style.removeProperty('display');
        if (!btn.dataset.bound) {
          btn.dataset.bound = 'true';
          btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            triggerInstall();
          });
        }
      } else {
        btn.classList.add('hidden');
        btn.style.display = 'none';
      }
    });
  }

  // Initial check on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function () {
    // If running in standalone mode (already installed as PWA)
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
    if (isStandalone) {
      console.log('[PWA] Running in standalone PWA mode');
      updateInstallButtons(false);
      hideInstallBanner();
    }
  });

  // Expose global trigger for custom buttons
  window.triggerPWAInstall = triggerInstall;
})();
