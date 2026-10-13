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

        var vatCheckbox = document.getElementById('includeVat');
        var applyVat = vatCheckbox ? vatCheckbox.checked : true;
        var vat = applyVat ? (subtotal * 0.16) : 0;
        var grandTotal = subtotal + vat;

        var subtotalEl = document.getElementById('live-subtotal');
        var vatEl = document.getElementById('live-vat');
        var grandTotalEl = document.getElementById('live-grand-total');
        var vatBadgeEl = document.getElementById('vat-mode-badge');
        var vatLabelEl = document.getElementById('live-vat-label');

        if (subtotalEl) subtotalEl.textContent = CalculationManager.formatKES(subtotal);
        if (vatEl) {
          vatEl.textContent = applyVat ? CalculationManager.formatKES(vat) : 'KES 0.00 (Exempt / 0%)';
        }
        if (vatLabelEl) {
          vatLabelEl.textContent = applyVat ? 'VAT (16% Standard):' : 'VAT (0% Exempt / Zero-Rated):';
        }
        if (grandTotalEl) grandTotalEl.textContent = CalculationManager.formatKES(grandTotal);
        if (vatBadgeEl) {
          vatBadgeEl.innerHTML = applyVat
            ? '<span class="badge badge-success" style="font-weight: 700; font-size: 0.8rem; padding: 4px 10px;"><i class="uil uil-check-circle mr-1"></i> VAT Included (16%)</span>'
            : '<span class="badge badge-subtle" style="font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #e2e8f0; color: #475569;"><i class="uil uil-ban mr-1"></i> No VAT (0% Exempt)</span>';
        }
      }

      var vatCheckbox = document.getElementById('includeVat');
      if (vatCheckbox) {
        vatCheckbox.addEventListener('change', updateInvoiceTotals);
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

      var currentTpl = 'modern';
      var currentColor = '#4F46E5';

      function syncDownloadPdfLinks() {
        var pdfButtons = [
          document.getElementById('btn-download-pdf'),
          document.getElementById('btn-download-quote-pdf')
        ];

        pdfButtons.forEach(function (btn) {
          if (!btn) return;
          var baseHref = btn.getAttribute('data-base-href');
          if (!baseHref) {
            baseHref = btn.getAttribute('href').split('?')[0];
            btn.setAttribute('data-base-href', baseHref);
          }
          btn.setAttribute('href', baseHref + '?template=' + encodeURIComponent(currentTpl) + '&color=' + encodeURIComponent(currentColor));
        });
      }

      function applyTemplate(tplName) {
        var allTemplates = [
          'template-modern', 'template-corporate', 'template-classic', 'template-creative',
          'template-executive', 'template-compact', 'template-minimal', 'template-bold'
        ];
        allTemplates.forEach(function (t) {
          sheet.classList.remove(t);
        });
        sheet.classList.add('template-' + tplName);

        templateBtns.forEach(function (btn) {
          if (btn.getAttribute('data-template') === tplName) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });

        currentTpl = tplName;
        localStorage.setItem('pm_doc_template', tplName);
        syncDownloadPdfLinks();
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

        currentColor = hexColor;
        localStorage.setItem('pm_doc_color', hexColor);
        syncDownloadPdfLinks();
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

      // Settings brand color pickers sync
      ['primaryColor', 'secondaryColor', 'accentColor'].forEach(function (name) {
        var picker = document.getElementById(name);
        var text = document.getElementById(name + 'Text');
        if (picker && text) {
          picker.addEventListener('input', function (e) {
            text.value = e.target.value;
          });
          text.addEventListener('input', function (e) {
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
              picker.value = e.target.value;
            }
          });
        }
      });
    }
  };

  // ──────────────────────────────────────────────
  // Logo Uploader & Document Live Preview Manager
  // ──────────────────────────────────────────────

  const LogoUploader = {
    init: function () {
      var dropzone = document.getElementById('logoDropzone');
      var fileInput = document.getElementById('logo');
      var statusDot = document.getElementById('statusIndicatorDot');
      var statusTitle = document.getElementById('statusTitle');
      var statusSubtitle = document.getElementById('statusSubtitle');
      var btnBrowse = document.getElementById('btnBrowseLogo');
      var btnClear = document.getElementById('btnClearSelectedLogo');
      var previewImg = document.getElementById('mockupLogoImg');
      var placeholder = document.getElementById('mockupLogoPlaceholder');
      var previewBadge = document.getElementById('previewBadge');
      var removeCheckbox = document.getElementById('removeLogoCheckbox');

      if (!dropzone || !fileInput) return;

      var initialLogoSrc = previewImg ? previewImg.getAttribute('src') : '';
      var hasInitialLogo = Boolean(initialLogoSrc && initialLogoSrc.trim() !== '');

      function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      }

      function handleFile(file) {
        if (!file) return;

        // Validation: Must be image
        if (!file.type.match(/^image\//)) {
          alert('Please select a valid image file (PNG, JPG, SVG, or WebP).');
          fileInput.value = '';
          return;
        }

        // Validation: Max 5MB
        if (file.size > 5 * 1024 * 1024) {
          alert('The selected image is larger than 5MB. Please choose an image under 5MB.');
          fileInput.value = '';
          return;
        }

        // If remove checkbox is checked, uncheck it
        if (removeCheckbox && removeCheckbox.checked) {
          removeCheckbox.checked = false;
        }

        // Instant preview using URL.createObjectURL
        var objectUrl = URL.createObjectURL(file);
        if (previewImg) {
          previewImg.src = objectUrl;
          previewImg.classList.remove('hidden');
          previewImg.style.opacity = '1';
        }
        if (placeholder) {
          placeholder.classList.add('hidden');
        }

        // Dynamic status bar styling
        if (statusDot) {
          statusDot.className = 'status-indicator-dot status-selected';
          statusDot.style.background = '';
        }

        if (statusTitle) {
          statusTitle.textContent = file.name;
        }

        if (statusSubtitle) {
          statusSubtitle.textContent = formatBytes(file.size) + ' • Ready to save on update';
        }

        if (previewBadge) {
          previewBadge.textContent = 'Preview';
        }

        if (btnClear) {
          btnClear.classList.remove('hidden');
        }
      }

      function resetSelection() {
        fileInput.value = '';

        if (hasInitialLogo) {
          if (previewImg) {
            previewImg.src = initialLogoSrc;
            previewImg.classList.remove('hidden');
            previewImg.style.opacity = '1';
          }
          if (placeholder) {
            placeholder.classList.add('hidden');
          }
          if (statusDot) {
            statusDot.className = 'status-indicator-dot status-active';
            statusDot.style.background = '';
          }
          if (statusTitle) {
            statusTitle.textContent = 'Logo Active';
          }
          if (statusSubtitle) {
            statusSubtitle.textContent = 'Active on all issued invoices, quotations, and headers';
          }
          if (previewBadge) {
            previewBadge.textContent = 'Active Logo';
          }
        } else {
          if (previewImg) {
            previewImg.src = '';
            previewImg.classList.add('hidden');
          }
          if (placeholder) {
            placeholder.classList.remove('hidden');
          }
          if (statusDot) {
            statusDot.className = 'status-indicator-dot status-ready';
            statusDot.style.background = '';
          }
          if (statusTitle) {
            statusTitle.textContent = 'Ready to Upload';
          }
          if (statusSubtitle) {
            statusSubtitle.textContent = 'Choose a PNG, JPG, or SVG image to preview';
          }
          if (previewBadge) {
            previewBadge.textContent = 'Mockup';
          }
        }

        if (btnClear) {
          btnClear.classList.add('hidden');
        }
      }

      // Input change event
      fileInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) {
          handleFile(file);
        } else {
          resetSelection();
        }
      });

      // Status Bar Browse button
      if (btnBrowse) {
        btnBrowse.addEventListener('click', function (e) {
          e.stopPropagation();
          fileInput.click();
        });
      }

      // Status Bar Cancel / Clear button
      if (btnClear) {
        btnClear.addEventListener('click', function (e) {
          e.stopPropagation();
          resetSelection();
        });
      }

      // Drag and drop events
      ['dragenter', 'dragover'].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('drag-over');
        });
      });

      ['dragleave', 'dragend'].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('drag-over');
        });
      });

      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-over');

        var dt = e.dataTransfer;
        var files = dt && dt.files;
        if (files && files.length > 0) {
          try {
            fileInput.files = files;
          } catch (err) {
            // Some browsers don't allow reassigning fileInput.files directly; DataTransfer fallback
            var container = new DataTransfer();
            container.items.add(files[0]);
            fileInput.files = container.files;
          }
          handleFile(files[0]);
        }
      });

      // Remove logo checkbox behavior
      if (removeCheckbox) {
        removeCheckbox.addEventListener('change', function () {
          if (removeCheckbox.checked) {
            if (previewImg) {
              previewImg.style.opacity = '0.25';
            }
            if (statusDot) {
              statusDot.className = 'status-indicator-dot';
              statusDot.style.background = '#EF4444';
              statusDot.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.25)';
            }
            if (statusTitle) {
              statusTitle.textContent = 'Marked for Removal';
            }
            if (statusSubtitle) {
              statusSubtitle.textContent = 'Logo will be deleted upon clicking Save All Settings';
            }
            if (previewBadge) {
              previewBadge.textContent = 'To be Removed';
            }
          } else {
            if (statusDot) {
              statusDot.style.background = '';
              statusDot.style.boxShadow = '';
            }
            if (fileInput.files && fileInput.files.length > 0) {
              handleFile(fileInput.files[0]);
            } else {
              resetSelection();
            }
          }
        });
      }
    }
  };

  // ──────────────────────────────────────────────
  // DateFilterManager (Flatpickr Integration & Quick Presets)
  // ──────────────────────────────────────────────

  const DateFilterManager = {
    init: function () {
      if (typeof flatpickr === 'undefined') return;

      // 1. Compute dynamic exemplary dates for placeholders
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.toLocaleString('en-US', { month: 'short' });
      const currentDay = now.getDate();
      const lastDayOfMonth = new Date(currentYear, now.getMonth() + 1, 0).getDate();
      const nextMonthName = new Date(currentYear, now.getMonth() + 1, 1).toLocaleString('en-US', { month: 'short' });

      const defaultTodayPlaceholder = `e.g. ${currentMonth} ${currentDay}, ${currentYear}`;
      const defaultStartPlaceholder = `e.g. ${currentMonth} 1, ${currentYear}`;
      const defaultEndPlaceholder = `e.g. ${currentMonth} ${lastDayOfMonth}, ${currentYear}`;
      const defaultDuePlaceholder = `e.g. ${nextMonthName} 15, ${currentYear}`;

      // Initialize Flatpickr on date inputs
      const dateInputs = document.querySelectorAll(
        'input[type="date"], input.flatpickr-date, .date-filter-item input'
      );

      dateInputs.forEach(function (input) {
        if (input._flatpickr) return;

        const nameOrId = (input.name || input.id || '').toLowerCase();
        let placeholder = input.getAttribute('placeholder');

        if (!placeholder || placeholder.includes('YYYY-MM-DD') || placeholder.startsWith('e.g. 202')) {
          if (nameOrId.includes('start') || nameOrId.includes('from')) {
            placeholder = defaultStartPlaceholder;
          } else if (nameOrId.includes('end') || nameOrId.includes('to')) {
            placeholder = defaultEndPlaceholder;
          } else if (nameOrId.includes('due') || nameOrId.includes('valid')) {
            placeholder = defaultDuePlaceholder;
          } else {
            placeholder = defaultTodayPlaceholder;
          }
        }

        input.type = 'text'; // Prevent browser native picker clash
        input.setAttribute('placeholder', placeholder);

        const fp = flatpickr(input, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'M j, Y',
          allowInput: true,
          disableMobile: false,
        });

        // Ensure the generated altInput displays the placeholder date
        if (fp && fp.altInput) {
          fp.altInput.placeholder = placeholder;
          fp.altInput.setAttribute('aria-label', placeholder);
        }
      });

      // 2. Inject Quick Date Presets into .date-filter-group
      const filterGroups = document.querySelectorAll('.date-filter-group');
      filterGroups.forEach(function (group) {
        if (group.querySelector('.date-filter-presets')) return;

        const startInput = group.querySelector('input[name="startDate"]');
        const endInput = group.querySelector('input[name="endDate"]');
        if (!startInput || !endInput) return;

        const presetsContainer = document.createElement('div');
        presetsContainer.className = 'date-filter-presets';

        const presets = [
          { label: 'Today', key: 'today' },
          { label: '7D', key: '7d' },
          { label: '30D', key: '30d' },
          { label: 'This Month', key: 'month' },
          { label: 'Quarter', key: 'quarter' },
          { label: 'This Year', key: 'year' },
          { label: 'All', key: 'all' },
        ];

        presets.forEach(function (p) {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'preset-pill';
          pill.textContent = p.label;
          pill.setAttribute('data-preset', p.key);

          pill.addEventListener('click', function (e) {
            e.preventDefault();
            DateFilterManager.applyPreset(p.key, startInput, endInput, group);
          });

          presetsContainer.appendChild(pill);
        });

        group.appendChild(presetsContainer);
      });
    },

    formatDate: function (date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    },

    applyPreset: function (preset, startInput, endInput, group) {
      const today = new Date();
      let start = null;
      let end = null;

      if (preset === 'today') {
        start = new Date(today);
        end = new Date(today);
      } else if (preset === '7d') {
        start = new Date(today);
        start.setDate(today.getDate() - 7);
        end = new Date(today);
      } else if (preset === '30d') {
        start = new Date(today);
        start.setDate(today.getDate() - 30);
        end = new Date(today);
      } else if (preset === 'month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      } else if (preset === 'quarter') {
        const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
        start = new Date(today.getFullYear(), quarterMonth, 1);
        end = new Date(today.getFullYear(), quarterMonth + 3, 0);
      } else if (preset === 'year') {
        start = new Date(today.getFullYear(), 0, 1);
        end = new Date(today.getFullYear(), 11, 31);
      } else if (preset === 'all') {
        start = null;
        end = null;
      }

      if (start && end) {
        const startStr = this.formatDate(start);
        const endStr = this.formatDate(end);

        if (startInput._flatpickr) {
          startInput._flatpickr.setDate(startStr, true);
        } else {
          startInput.value = startStr;
        }

        if (endInput._flatpickr) {
          endInput._flatpickr.setDate(endStr, true);
        } else {
          endInput.value = endStr;
        }
      } else {
        if (startInput._flatpickr) startInput._flatpickr.clear();
        else startInput.value = '';

        if (endInput._flatpickr) endInput._flatpickr.clear();
        else endInput.value = '';
      }

      // Update active state on pills
      group.querySelectorAll('.preset-pill').forEach(function (pill) {
        pill.classList.toggle('active', pill.getAttribute('data-preset') === preset && preset !== 'all');
      });

      // Automatically submit form if inside filter-form
      const form = group.closest('form');
      if (form) {
        form.submit();
      }
    },
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
    LogoUploader.init();
    DateFilterManager.init();
  });
})();


