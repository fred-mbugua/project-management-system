/**
 * ══════════════════════════════════════════════════════════════════════
 * PM & ERP SaaS - Core Client-Side JavaScript
 * Sidebar toggle, theme switcher, dropdown menus, alert dismissal
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Theme Manager
  // ──────────────────────────────────────────────

  const ThemeManager = {
    STORAGE_KEY: 'pmerp-theme',

    init: function () {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = saved || (prefersDark ? 'dark' : 'light');
      this.apply(theme);

      const toggleBtn = document.getElementById('themeToggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          const current = document.documentElement.getAttribute('data-theme');
          const next = current === 'dark' ? 'light' : 'dark';
          ThemeManager.apply(next);
          localStorage.setItem(ThemeManager.STORAGE_KEY, next);
        });
      }
    },

    apply: function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    },
  };

  // ──────────────────────────────────────────────
  // Sidebar Manager
  // ──────────────────────────────────────────────

  const SidebarManager = {
    init: function () {
      var sidebar = document.getElementById('sidebar');
      var overlay = document.getElementById('sidebarOverlay');
      var toggleBtn = document.getElementById('sidebarToggleBtn');
      var closeBtn = document.getElementById('sidebarCloseBtn');

      if (!sidebar) return;

      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          SidebarManager.toggle(sidebar, overlay);
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          SidebarManager.close(sidebar, overlay);
        });
      }

      if (overlay) {
        overlay.addEventListener('click', function () {
          SidebarManager.close(sidebar, overlay);
        });
      }

      // Close sidebar on Escape key
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
          SidebarManager.close(sidebar, overlay);
        }
      });

      // Auto-close sidebar on mobile when any link is clicked
      var navLinks = sidebar.querySelectorAll('.sidebar-link');
      navLinks.forEach(function (link) {
        link.addEventListener('click', function () {
          if (window.innerWidth <= 1024) {
            SidebarManager.close(sidebar, overlay);
          }
        });
      });
    },

    toggle: function (sidebar, overlay) {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('active');
      document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
    },

    close: function (sidebar, overlay) {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
      document.body.style.overflow = '';
    },
  };

  // ──────────────────────────────────────────────
  // Dropdown Manager
  // ──────────────────────────────────────────────

  const DropdownManager = {
    init: function () {
      var userMenuBtn = document.getElementById('userMenuBtn');
      var userDropdown = document.getElementById('userDropdown');

      if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          userDropdown.classList.toggle('active');
        });
      }

      // Close dropdowns on outside click
      document.addEventListener('click', function (e) {
        var dropdowns = document.querySelectorAll('.user-dropdown.active, .dropdown-menu.active');
        dropdowns.forEach(function (dropdown) {
          if (!dropdown.contains(e.target) && !dropdown.previousElementSibling?.contains(e.target)) {
            dropdown.classList.remove('active');
          }
        });
      });
    },
  };

  // ──────────────────────────────────────────────
  // Alert Manager
  // ──────────────────────────────────────────────

  const AlertManager = {
    AUTO_DISMISS_MS: 6000,

    init: function () {
      // Close buttons
      var closeButtons = document.querySelectorAll('.alert-close');
      closeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          AlertManager.dismiss(btn.closest('.alert'));
        });
      });

      // Auto-dismiss after delay
      var alerts = document.querySelectorAll('.alert');
      alerts.forEach(function (alert) {
        setTimeout(function () {
          AlertManager.dismiss(alert);
        }, AlertManager.AUTO_DISMISS_MS);
      });
    },

    dismiss: function (alertEl) {
      if (!alertEl) return;
      alertEl.style.opacity = '0';
      alertEl.style.transform = 'translateX(100%)';
      alertEl.style.transition = 'all 300ms ease';
      setTimeout(function () {
        alertEl.remove();
      }, 300);
    },
  };

  // ──────────────────────────────────────────────
  // Password Toggle
  // ──────────────────────────────────────────────

  const PasswordToggle = {
    init: function () {
      var toggleButtons = document.querySelectorAll('.input-toggle-password');
      toggleButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var targetId = btn.getAttribute('data-target');
          var input = document.getElementById(targetId);
          if (!input) return;

          var isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';

          var eyeOpen = btn.querySelector('.eye-open');
          var eyeClosed = btn.querySelector('.eye-closed');
          if (eyeOpen && eyeClosed) {
            eyeOpen.style.display = isPassword ? 'none' : 'block';
            eyeClosed.style.display = isPassword ? 'block' : 'none';
          }
        });
      });
    },
  };

  // ──────────────────────────────────────────────
  // Form Submission Guard (prevent double-submit)
  // ──────────────────────────────────────────────

  const FormGuard = {
    init: function () {
      var forms = document.querySelectorAll('form');
      forms.forEach(function (form) {
        form.addEventListener('submit', function () {
          var submitBtn = form.querySelector('[type="submit"]');
          if (!submitBtn) return;

          var btnText = submitBtn.querySelector('.btn-text');
          var btnLoader = submitBtn.querySelector('.btn-loader');

          if (btnText) btnText.style.display = 'none';
          if (btnLoader) btnLoader.style.display = 'inline-flex';
          submitBtn.disabled = true;

          // Re-enable after 8 seconds (safety net)
          setTimeout(function () {
            if (btnText) btnText.style.display = '';
            if (btnLoader) btnLoader.style.display = 'none';
            submitBtn.disabled = false;
          }, 8000);
        });
      });
    },
  };

  // ──────────────────────────────────────────────
  // Dynamic Invoice & Quotation Line Items Calculator
  // ──────────────────────────────────────────────

  const CalculationManager = {
    init: function () {
      this.initInvoiceCalculator();
      this.initQuotationCalculator();
    },

    formatKES: function (amount) {
      return 'KES ' + Number(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    initInvoiceCalculator: function () {
      var container = document.getElementById('line-items-container');
      var addBtn = document.getElementById('btn-add-line-item');
      if (!container) return;

      function updateInvoiceTotals() {
        var rows = container.querySelectorAll('.line-item-row');
        var subtotal = 0;

        rows.forEach(function (row) {
          var qtyInput = row.querySelector('input[name="itemQuantities"]');
          var priceInput = row.querySelector('input[name="itemUnitPrices"]');
          var qty = parseFloat(qtyInput ? qtyInput.value : 0) || 0;
          var price = parseFloat(priceInput ? priceInput.value : 0) || 0;
          subtotal += (qty * price);
        });

        var vat = subtotal * 0.16;
        var grandTotal = subtotal + vat;

        var subtotalEl = document.getElementById('live-subtotal');
        var vatEl = document.getElementById('live-vat');
        var grandTotalEl = document.getElementById('live-grand-total');

        if (subtotalEl) subtotalEl.textContent = CalculationManager.formatKES(subtotal);
        if (vatEl) vatEl.textContent = CalculationManager.formatKES(vat);
        if (grandTotalEl) grandTotalEl.textContent = CalculationManager.formatKES(grandTotal);
      }

      container.addEventListener('input', function (e) {
        if (e.target.name === 'itemQuantities' || e.target.name === 'itemUnitPrices') {
          updateInvoiceTotals();
        }
      });

      if (addBtn) {
        addBtn.addEventListener('click', function () {
          var newRow = document.createElement('div');
          newRow.className = 'line-item-row';
          newRow.innerHTML = [
            '<div class="line-item-grid">',
            '  <div class="form-group">',
            '    <label class="form-label">Item / Description *</label>',
            '    <input type="text" class="form-input" name="itemDescriptions" required placeholder="Service or equipment description">',
            '  </div>',
            '  <div class="form-group">',
            '    <label class="form-label">Quantity *</label>',
            '    <input type="number" step="1" min="1" class="form-input" name="itemQuantities" value="1" required>',
            '  </div>',
            '  <div class="form-group">',
            '    <label class="form-label">Unit Price (KES) *</label>',
            '    <input type="number" step="0.01" min="0" class="form-input" name="itemUnitPrices" required placeholder="0.00">',
            '  </div>',
            '  <div class="line-item-remove-wrapper">',
            '    <button type="button" class="btn btn-sm btn-ghost btn-remove-item" aria-label="Remove item" title="Remove item">',
            '      <i class="uil uil-trash-alt"></i>',
            '    </button>',
            '  </div>',

            '</div>'
          ].join('\n');
          container.appendChild(newRow);

          var removeBtn = newRow.querySelector('.btn-remove-item');
          if (removeBtn) {
            removeBtn.addEventListener('click', function () {
              newRow.remove();
              updateInvoiceTotals();
            });
          }

          updateInvoiceTotals();
        });
      }

      // Handle existing remove buttons
      container.addEventListener('click', function (e) {
        var removeBtn = e.target.closest('.btn-remove-item');
        if (removeBtn) {
          var row = removeBtn.closest('.line-item-row');
          var allRows = container.querySelectorAll('.line-item-row');
          if (allRows.length > 1) {
            row.remove();
            updateInvoiceTotals();
          } else {
            alert('At least one line item is required.');
          }
        }
      });

      // Run on initial load
      updateInvoiceTotals();
    },

    initQuotationCalculator: function () {
      var qtyInput = document.getElementById('itemQty');
      var priceInput = document.getElementById('itemPrice');
      var previewTotal = document.getElementById('quote-preview-total');
      if (!qtyInput || !priceInput || !previewTotal) return;

      function updateQuoteTotal() {
        var qty = parseFloat(qtyInput.value) || 0;
        var price = parseFloat(priceInput.value) || 0;
        var subtotal = qty * price;
        var vat = subtotal * 0.16;
        var total = subtotal + vat;
        previewTotal.textContent = CalculationManager.formatKES(total);
      }

      qtyInput.addEventListener('input', updateQuoteTotal);
      priceInput.addEventListener('input', updateQuoteTotal);
      updateQuoteTotal();
    }
  };

  // ──────────────────────────────────────────────
  // Document Styler & Template Engine
  // ──────────────────────────────────────────────

  const DocumentStyler = {
    init: function () {
      var customizer = document.querySelector('.doc-customizer-bar');
      var sheet = document.querySelector('.document-sheet, .invoice-sheet, .quotation-sheet');
      if (!customizer || !sheet) return;

      var templateBtns = customizer.querySelectorAll('.template-btn');
      var swatches = customizer.querySelectorAll('.color-swatch');
      var colorInput = customizer.querySelector('.color-picker-input');

      function applyTemplate(tplName) {
        sheet.classList.remove('template-modern', 'template-corporate', 'template-classic', 'template-creative');
        sheet.classList.add('template-' + tplName);

        templateBtns.forEach(function (btn) {
          if (btn.getAttribute('data-template') === tplName) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });

        localStorage.setItem('pm_doc_template', tplName);
      }

      function applyColor(hexColor) {
        if (!hexColor) return;
        sheet.style.setProperty('--doc-accent', hexColor);

        swatches.forEach(function (s) {
          if (s.getAttribute('data-color') && s.getAttribute('data-color').toLowerCase() === hexColor.toLowerCase()) {
            s.classList.add('active');
          } else {
            s.classList.remove('active');
          }
        });

        if (colorInput) {
          colorInput.value = hexColor;
        }

        localStorage.setItem('pm_doc_color', hexColor);
      }

      templateBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tpl = btn.getAttribute('data-template');
          applyTemplate(tpl);
        });
      });

      swatches.forEach(function (swatch) {
        swatch.addEventListener('click', function () {
          var color = swatch.getAttribute('data-color');
          applyColor(color);
        });
      });

      if (colorInput) {
        colorInput.addEventListener('input', function (e) {
          applyColor(e.target.value);
        });
      }

      var savedTpl = localStorage.getItem('pm_doc_template') || sheet.getAttribute('data-default-template') || 'modern';
      var savedColor = localStorage.getItem('pm_doc_color') || sheet.getAttribute('data-default-color') || '#4F46E5';

      applyTemplate(savedTpl);
      applyColor(savedColor);
    }
  };

  // ──────────────────────────────────────────────
  // Generic Action Handlers (Print, Payment, etc.)
  // ──────────────────────────────────────────────

  const ActionHandlers = {
    init: function () {
      document.querySelectorAll('[data-action="print"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          window.print();
        });
      });

      document.querySelectorAll('[data-action="mpesa-pay"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var amount = btn.getAttribute('data-amount') || '';
          alert('M-Pesa STK Push initiated for KES ' + amount);
        });
      });

      var primaryColorInput = document.getElementById('primaryColor');
      var primaryColorLabel = document.getElementById('primaryColorLabel');
      if (primaryColorInput && primaryColorLabel) {
        primaryColorInput.addEventListener('input', function (e) {
          primaryColorLabel.textContent = e.target.value;
        });
      }
    }
  };

  // ──────────────────────────────────────────────
  // Initialize on DOM Ready
  // ──────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    ThemeManager.init();
    SidebarManager.init();
    DropdownManager.init();
    AlertManager.init();
    PasswordToggle.init();
    FormGuard.init();
    CalculationManager.init();
    DocumentStyler.init();
    ActionHandlers.init();
  });
})();


