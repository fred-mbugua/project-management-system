/**
 * ══════════════════════════════════════════════════════════════════════
 * PM & ERP SaaS - Project Detail Interactive Controls
 * Task editing, quick status/completion toggles, and secure in-app file preview
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  function formatBytes(bytes) {
    var num = Number(bytes) || 0;
    if (num >= 1048576) return (num / 1048576).toFixed(1) + ' MB';
    if (num >= 1024) return Math.round(num / 1024) + ' KB';
    return num + ' B';
  }

  function createIcon(iconClass) {
    var i = document.createElement('i');
    i.className = iconClass;
    return i;
  }

  function createNoticeBanner(iconClass, text, variant) {
    var banner = document.createElement('div');
    banner.className = 'doc-preview-notice' + (variant ? ' doc-preview-notice-' + variant : '');
    banner.appendChild(createIcon(iconClass));
    var span = document.createElement('span');
    span.textContent = text;
    banner.appendChild(span);
    return banner;
  }

  // ──────────────────────────────────────────────
  // Task Status & Edit Modal Controller
  // ──────────────────────────────────────────────

  const TaskControls = {
    init: function () {
      // Auto-submit inline status selector forms
      document.querySelectorAll('.task-status-select').forEach(function (selectEl) {
        selectEl.addEventListener('change', function () {
          if (selectEl.form) {
            selectEl.disabled = false;
            selectEl.form.submit();
          }
        });
      });

      var modal = document.getElementById('modalEditTask');
      var form = document.getElementById('editTaskForm');
      if (!modal || !form) return;

      var titleInput = document.getElementById('editTaskTitle');
      var assigneeSelect = document.getElementById('editTaskAssignedToId');
      var statusSelect = document.getElementById('editTaskStatus');
      var prioritySelect = document.getElementById('editTaskPriority');
      var dueDateInput = document.getElementById('editTaskDueDate');
      var estHoursInput = document.getElementById('editTaskEstimatedHours');
      var actHoursInput = document.getElementById('editTaskActualHours');
      var descInput = document.getElementById('editTaskDescription');
      var subtitleEl = document.getElementById('editTaskModalSubtitle');

      function openEditTaskModal(btn) {
        var actionUrl = btn.getAttribute('data-edit-action') || '';
        var taskTitle = btn.getAttribute('data-task-title') || '';
        var taskDesc = btn.getAttribute('data-task-description') || '';
        var assigneeId = btn.getAttribute('data-task-assigned-to-id') || '';
        var priority = btn.getAttribute('data-task-priority') || 'MEDIUM';
        var status = btn.getAttribute('data-task-status') || 'TODO';
        var dueDate = btn.getAttribute('data-task-due-date') || '';
        var estHours = btn.getAttribute('data-task-estimated-hours') || '';
        var actHours = btn.getAttribute('data-task-actual-hours') || '';

        form.setAttribute('action', actionUrl);
        if (titleInput) titleInput.value = taskTitle;
        if (descInput) descInput.value = taskDesc;
        if (assigneeSelect) assigneeSelect.value = assigneeId;
        if (prioritySelect) prioritySelect.value = priority;
        if (statusSelect) statusSelect.value = status;
        if (estHoursInput) estHoursInput.value = estHours;
        if (actHoursInput) actHoursInput.value = actHours;
        if (subtitleEl) subtitleEl.textContent = 'Editing: ' + taskTitle;

        if (dueDateInput) {
          if (dueDateInput._flatpickr) {
            if (dueDate) {
              dueDateInput._flatpickr.setDate(dueDate, false);
            } else {
              dueDateInput._flatpickr.clear();
            }
          } else {
            dueDateInput.value = dueDate;
          }
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        if (titleInput) {
          setTimeout(function () {
            titleInput.focus();
          }, 50);
        }
      }

      function closeEditTaskModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }

      document.querySelectorAll('.btn-edit-task').forEach(function (btn) {
        btn.addEventListener('click', function () {
          openEditTaskModal(btn);
        });
      });

      modal.querySelectorAll('[data-close-modal="modalEditTask"]').forEach(function (btn) {
        btn.addEventListener('click', closeEditTaskModal);
      });

      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          closeEditTaskModal();
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
          closeEditTaskModal();
        }
      });
    },
  };

  // ──────────────────────────────────────────────
  // In-App Project File Preview Controller
  // ──────────────────────────────────────────────

  const DocumentPreviewer = {
    init: function () {
      var modal = document.getElementById('modalPreviewDocument');
      var bodyEl = document.getElementById('docPreviewBody');
      if (!modal || !bodyEl) return;

      var titleEl = document.getElementById('docPreviewTitle');
      var metaEl = document.getElementById('docPreviewMeta');
      var downloadLink = document.getElementById('docPreviewDownloadBtn');
      var openNewTabLink = document.getElementById('docPreviewOpenTabBtn');
      var zoomControls = document.getElementById('docPreviewZoomControls');
      var zoomValueEl = document.getElementById('docPreviewZoomValue');
      var zoomInBtn = document.getElementById('docPreviewZoomIn');
      var zoomOutBtn = document.getElementById('docPreviewZoomOut');
      var zoomResetBtn = document.getElementById('docPreviewZoomReset');
      var copyTextBtn = document.getElementById('docPreviewCopyBtn');
      var prevBtn = document.getElementById('docPreviewPrevBtn');
      var nextBtn = document.getElementById('docPreviewNextBtn');
      var counterEl = document.getElementById('docPreviewCounter');

      var triggers = Array.prototype.slice.call(document.querySelectorAll('.btn-preview-doc'));
      var currentIndex = -1;
      var currentZoom = 1;
      var activeImageEl = null;
      var activeTextContent = '';
      var activeRequestToken = 0;

      function updateNavControls() {
        if (!prevBtn || !nextBtn || !counterEl) return;
        if (triggers.length <= 1) {
          prevBtn.classList.add('hidden');
          nextBtn.classList.add('hidden');
          counterEl.classList.add('hidden');
          return;
        }
        prevBtn.classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        counterEl.classList.remove('hidden');
        prevBtn.disabled = currentIndex <= 0;
        nextBtn.disabled = currentIndex >= triggers.length - 1;
        counterEl.textContent = (currentIndex + 1) + ' / ' + triggers.length;
      }

      function applyImageZoom(zoom) {
        currentZoom = Math.min(3, Math.max(0.25, zoom));
        if (zoomValueEl) {
          zoomValueEl.textContent = Math.round(currentZoom * 100) + '%';
        }
        if (activeImageEl) {
          if (Math.abs(currentZoom - 1) < 0.01) {
            activeImageEl.style.width = '';
            activeImageEl.style.maxWidth = '100%';
            activeImageEl.style.maxHeight = '100%';
          } else {
            var baseWidth = activeImageEl.naturalWidth || activeImageEl.clientWidth || 600;
            activeImageEl.style.maxWidth = 'none';
            activeImageEl.style.maxHeight = 'none';
            activeImageEl.style.width = Math.round(baseWidth * currentZoom) + 'px';
          }
        }
      }

      function showLoadingState() {
        var wrapper = document.createElement('div');
        wrapper.className = 'doc-preview-state';
        var spinner = createIcon('uil uil-spinner-alt spinner doc-preview-state-icon');
        var msg = document.createElement('p');
        msg.className = 'text-sm text-muted';
        msg.textContent = 'Loading file preview...';
        wrapper.appendChild(spinner);
        wrapper.appendChild(msg);
        bodyEl.replaceChildren(wrapper);
      }

      function renderFallbackState(title, message, downloadUrl) {
        var wrapper = document.createElement('div');
        wrapper.className = 'doc-preview-state';

        var iconBox = document.createElement('div');
        iconBox.className = 'doc-preview-fallback-icon';
        iconBox.appendChild(createIcon('uil uil-file-alt'));
        wrapper.appendChild(iconBox);

        var heading = document.createElement('h4');
        heading.className = 'doc-preview-fallback-title';
        heading.textContent = title;
        wrapper.appendChild(heading);

        var msg = document.createElement('p');
        msg.className = 'doc-preview-fallback-msg';
        msg.textContent = message;
        wrapper.appendChild(msg);

        if (downloadUrl) {
          var dlBtn = document.createElement('a');
          dlBtn.href = downloadUrl;
          dlBtn.className = 'btn btn-primary mt-4';
          dlBtn.appendChild(createIcon('uil uil-download-alt'));
          var dlSpan = document.createElement('span');
          dlSpan.textContent = 'Download File';
          dlBtn.appendChild(dlSpan);
          wrapper.appendChild(dlBtn);
        }

        bodyEl.replaceChildren(wrapper);
      }

      function renderImagePreview(payload) {
        if (zoomControls) zoomControls.classList.remove('hidden');
        if (openNewTabLink) {
          openNewTabLink.href = payload.previewUrl;
          openNewTabLink.classList.remove('hidden');
        }

        var stage = document.createElement('div');
        stage.className = 'doc-preview-image-stage';

        var img = document.createElement('img');
        img.className = 'doc-preview-image';
        img.alt = payload.fileName || 'Project file preview';
        img.src = payload.previewUrl;

        img.addEventListener('error', function () {
          if (zoomControls) zoomControls.classList.add('hidden');
          renderFallbackState(
            payload.fileName || 'Image Preview Unavailable',
            'The image could not be rendered inline. Please download the file to view it.',
            payload.downloadUrl
          );
        });

        activeImageEl = img;
        applyImageZoom(1);
        stage.appendChild(img);
        bodyEl.replaceChildren(stage);
      }

      function renderPdfPreview(payload) {
        if (openNewTabLink) {
          openNewTabLink.href = payload.previewUrl;
          openNewTabLink.classList.remove('hidden');
        }

        var container = document.createElement('div');
        container.className = 'doc-preview-pdf-wrapper';

        var iframe = document.createElement('iframe');
        iframe.className = 'doc-preview-iframe';
        iframe.title = payload.fileName || 'PDF Preview';
        iframe.src = payload.previewUrl;
        container.appendChild(iframe);

        var hint = createNoticeBanner(
          'uil uil-info-circle',
          'If the PDF viewer does not appear on your device, click "Open in Tab" or "Download" above.'
        );
        container.appendChild(hint);

        bodyEl.replaceChildren(container);
      }

      function renderTextPreview(payload) {
        activeTextContent = payload.text || '';
        if (copyTextBtn) {
          copyTextBtn.classList.remove('hidden');
        }
        if (openNewTabLink && payload.previewUrl) {
          openNewTabLink.href = payload.previewUrl;
          openNewTabLink.classList.remove('hidden');
        }

        var container = document.createElement('div');
        container.className = 'doc-preview-text-wrapper';

        if (payload.truncated) {
          container.appendChild(
            createNoticeBanner(
              'uil uil-exclamation-triangle',
              'Preview truncated to the first 512 KB. Download the file to view the entire document.',
              'warning'
            )
          );
        }

        var pre = document.createElement('pre');
        pre.className = 'doc-preview-text';
        pre.textContent = activeTextContent;
        container.appendChild(pre);

        bodyEl.replaceChildren(container);
      }

      function renderSpreadsheetPreview(payload) {
        var sheets = Array.isArray(payload.sheets) ? payload.sheets : [];
        if (sheets.length === 0) {
          renderFallbackState(
            payload.fileName || 'Empty Spreadsheet',
            'No worksheet rows were found in this file.',
            payload.downloadUrl
          );
          return;
        }

        var container = document.createElement('div');
        container.className = 'doc-preview-spreadsheet-wrapper';

        var tabsBar = document.createElement('div');
        tabsBar.className = 'doc-preview-sheet-tabs';

        var noticeSlot = document.createElement('div');
        var tableScroll = document.createElement('div');
        tableScroll.className = 'doc-preview-table-scroll';

        function showSheet(sheetIndex) {
          var sheet = sheets[sheetIndex];
          Array.prototype.forEach.call(tabsBar.children, function (tabBtn, idx) {
            tabBtn.classList.toggle('active', idx === sheetIndex);
          });

          noticeSlot.replaceChildren();
          if (sheet.truncated) {
            noticeSlot.appendChild(
              createNoticeBanner(
                'uil uil-info-circle',
                'Showing the first ' + sheet.rows.length + ' rows of "' + sheet.name + '". Download the file for full data.',
                'warning'
              )
            );
          }

          if (!sheet.rows || sheet.rows.length === 0) {
            var emptyP = document.createElement('p');
            emptyP.className = 'text-sm text-muted p-6 text-center';
            emptyP.textContent = 'This worksheet is empty.';
            tableScroll.replaceChildren(emptyP);
            return;
          }

          var table = document.createElement('table');
          table.className = 'table doc-preview-table';

          var maxCols = 0;
          sheet.rows.forEach(function (r) {
            if (r.length > maxCols) maxCols = r.length;
          });

          var thead = document.createElement('thead');
          var headRow = document.createElement('tr');
          var rowNumTh = document.createElement('th');
          rowNumTh.className = 'doc-preview-row-num';
          rowNumTh.textContent = '#';
          headRow.appendChild(rowNumTh);

          var headerCells = sheet.rows[0] || [];
          for (var c = 0; c < maxCols; c++) {
            var th = document.createElement('th');
            th.textContent = headerCells[c] !== undefined && headerCells[c] !== '' ? headerCells[c] : 'Column ' + (c + 1);
            headRow.appendChild(th);
          }
          thead.appendChild(headRow);
          table.appendChild(thead);

          var tbody = document.createElement('tbody');
          for (var r = 1; r < sheet.rows.length; r++) {
            var tr = document.createElement('tr');
            var numTd = document.createElement('td');
            numTd.className = 'doc-preview-row-num';
            numTd.textContent = String(r);
            tr.appendChild(numTd);

            var rowData = sheet.rows[r] || [];
            for (var colIdx = 0; colIdx < maxCols; colIdx++) {
              var td = document.createElement('td');
              td.textContent = rowData[colIdx] != null ? String(rowData[colIdx]) : '';
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }

          table.appendChild(tbody);
          tableScroll.replaceChildren(table);
        }

        sheets.forEach(function (sheet, idx) {
          var tabBtn = document.createElement('button');
          tabBtn.type = 'button';
          tabBtn.className = 'doc-preview-sheet-tab' + (idx === 0 ? ' active' : '');
          tabBtn.textContent = sheet.name || ('Sheet ' + (idx + 1));
          tabBtn.addEventListener('click', function () {
            showSheet(idx);
          });
          tabsBar.appendChild(tabBtn);
        });

        container.appendChild(tabsBar);
        container.appendChild(noticeSlot);
        container.appendChild(tableScroll);
        bodyEl.replaceChildren(container);
        showSheet(0);
      }

      function renderDocxPreview(payload) {
        var paragraphs = Array.isArray(payload.paragraphs) ? payload.paragraphs : [];
        activeTextContent = paragraphs.join('\n\n');
        if (activeTextContent && copyTextBtn) {
          copyTextBtn.classList.remove('hidden');
        }

        var container = document.createElement('div');
        container.className = 'doc-preview-docx-wrapper';

        container.appendChild(
          createNoticeBanner(
            'uil uil-file-alt',
            'Text preview extracted from Word document (.docx). Download the file for full rich layout and embedded graphics.'
          )
        );

        var paper = document.createElement('div');
        paper.className = 'doc-preview-docx-paper';

        if (paragraphs.length === 0) {
          var emptyMsg = document.createElement('p');
          emptyMsg.className = 'text-muted text-sm';
          emptyMsg.textContent = 'No readable paragraph text was found in this document.';
          paper.appendChild(emptyMsg);
        } else {
          paragraphs.forEach(function (text) {
            var p = document.createElement('p');
            p.className = 'doc-preview-docx-paragraph';
            p.textContent = text;
            paper.appendChild(p);
          });
        }

        container.appendChild(paper);
        bodyEl.replaceChildren(container);
      }

      function renderZipPreview(payload) {
        var entries = Array.isArray(payload.entries) ? payload.entries : [];
        if (entries.length === 0) {
          renderFallbackState(
            payload.fileName || 'ZIP Archive',
            'Archive appears empty or its directory header could not be listed.',
            payload.downloadUrl
          );
          return;
        }

        var container = document.createElement('div');
        container.className = 'doc-preview-spreadsheet-wrapper';
        container.appendChild(
          createNoticeBanner(
            'uil uil-archive',
            'Archive contents (' + entries.length + ' entries shown). Download the ZIP file to extract files.'
          )
        );

        var tableScroll = document.createElement('div');
        tableScroll.className = 'doc-preview-table-scroll';
        var table = document.createElement('table');
        table.className = 'table doc-preview-table';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        ['Entry Path', 'Type', 'Compressed', 'Uncompressed'].forEach(function (label) {
          var th = document.createElement('th');
          th.textContent = label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        entries.forEach(function (entry) {
          var tr = document.createElement('tr');

          var nameTd = document.createElement('td');
          nameTd.textContent = entry.name;
          tr.appendChild(nameTd);

          var typeTd = document.createElement('td');
          typeTd.textContent = entry.isDirectory ? 'Folder' : 'File';
          tr.appendChild(typeTd);

          var compTd = document.createElement('td');
          compTd.textContent = entry.isDirectory ? '—' : formatBytes(entry.compressedSize);
          tr.appendChild(compTd);

          var uncompTd = document.createElement('td');
          uncompTd.textContent = entry.isDirectory ? '—' : formatBytes(entry.uncompressedSize);
          tr.appendChild(uncompTd);

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableScroll.appendChild(table);
        container.appendChild(tableScroll);
        bodyEl.replaceChildren(container);
      }

      function loadPreviewAtIndex(idx) {
        if (idx < 0 || idx >= triggers.length) return;
        currentIndex = idx;
        var trigger = triggers[idx];
        var requestToken = ++activeRequestToken;

        var docName = trigger.getAttribute('data-doc-name') || 'Project Document';
        var docType = trigger.getAttribute('data-doc-type') || '';
        var docSize = trigger.getAttribute('data-doc-size') || '';
        var docDate = trigger.getAttribute('data-doc-date') || '';
        var docUploader = trigger.getAttribute('data-doc-uploader') || '';
        var previewDataUrl = trigger.getAttribute('data-preview-data-url') || '';
        var downloadUrl = trigger.getAttribute('data-download-url') || '';

        activeImageEl = null;
        activeTextContent = '';
        currentZoom = 1;
        if (zoomControls) zoomControls.classList.add('hidden');
        if (copyTextBtn) copyTextBtn.classList.add('hidden');
        if (openNewTabLink) openNewTabLink.classList.add('hidden');

        if (titleEl) titleEl.textContent = docName;
        if (metaEl) {
          var metaParts = [];
          if (docType) metaParts.push(docType);
          if (docSize) metaParts.push(docSize);
          if (docUploader) metaParts.push('Uploaded by ' + docUploader);
          if (docDate) metaParts.push(docDate);
          metaEl.textContent = metaParts.join(' • ');
        }
        if (downloadLink) downloadLink.href = downloadUrl;

        updateNavControls();
        showLoadingState();

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        fetch(previewDataUrl, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (requestToken !== activeRequestToken) return;
            if (!result.ok) {
              renderFallbackState(
                docName,
                (result.data && result.data.error) || 'Failed to load file preview.',
                downloadUrl
              );
              return;
            }

            var payload = result.data;
            if (payload.kind === 'image') {
              renderImagePreview(payload);
            } else if (payload.kind === 'pdf') {
              renderPdfPreview(payload);
            } else if (payload.kind === 'text') {
              renderTextPreview(payload);
            } else if (payload.kind === 'spreadsheet') {
              renderSpreadsheetPreview(payload);
            } else if (payload.kind === 'docx') {
              renderDocxPreview(payload);
            } else if (payload.kind === 'zip') {
              renderZipPreview(payload);
            } else {
              renderFallbackState(
                payload.fileName || docName,
                payload.message || 'In-app preview is not available for this file format.',
                payload.downloadUrl || downloadUrl
              );
            }
          })
          .catch(function () {
            if (requestToken !== activeRequestToken) return;
            renderFallbackState(
              docName,
              'Could not load preview due to a network or server error. Try downloading the file instead.',
              downloadUrl
            );
          });
      }

      function closePreviewModal() {
        activeRequestToken++;
        modal.classList.remove('active');
        document.body.style.overflow = '';
        activeImageEl = null;
        activeTextContent = '';
        bodyEl.replaceChildren();
      }

      triggers.forEach(function (btn, idx) {
        btn.addEventListener('click', function () {
          loadPreviewAtIndex(idx);
        });
      });

      // Also allow clicking the document title/name button/link to preview
      document.querySelectorAll('.doc-preview-name-trigger').forEach(function (nameTrigger) {
        nameTrigger.addEventListener('click', function () {
          var targetDocId = nameTrigger.getAttribute('data-doc-id');
          var idx = triggers.findIndex(function (btn) {
            return btn.getAttribute('data-doc-id') === targetDocId;
          });
          if (idx !== -1) {
            loadPreviewAtIndex(idx);
          }
        });
      });

      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (currentIndex > 0) loadPreviewAtIndex(currentIndex - 1);
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (currentIndex < triggers.length - 1) loadPreviewAtIndex(currentIndex + 1);
        });
      }

      if (zoomInBtn) {
        zoomInBtn.addEventListener('click', function () {
          applyImageZoom(currentZoom + 0.25);
        });
      }
      if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', function () {
          applyImageZoom(currentZoom - 0.25);
        });
      }
      if (zoomResetBtn) {
        zoomResetBtn.addEventListener('click', function () {
          applyImageZoom(1);
        });
      }

      if (copyTextBtn) {
        copyTextBtn.addEventListener('click', function () {
          if (!activeTextContent || !navigator.clipboard) return;
          navigator.clipboard.writeText(activeTextContent).then(function () {
            var labelSpan = copyTextBtn.querySelector('span');
            if (labelSpan) {
              var orig = labelSpan.textContent;
              labelSpan.textContent = 'Copied!';
              setTimeout(function () {
                labelSpan.textContent = orig;
              }, 1600);
            }
          });
        });
      }

      modal.querySelectorAll('[data-close-modal="modalPreviewDocument"]').forEach(function (btn) {
        btn.addEventListener('click', closePreviewModal);
      });

      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          closePreviewModal();
        }
      });

      document.addEventListener('keydown', function (e) {
        if (!modal.classList.contains('active')) return;
        if (e.key === 'Escape') {
          closePreviewModal();
        } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
          loadPreviewAtIndex(currentIndex - 1);
        } else if (e.key === 'ArrowRight' && currentIndex < triggers.length - 1) {
          loadPreviewAtIndex(currentIndex + 1);
        }
      });
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    TaskControls.init();
    DocumentPreviewer.init();
  });
})();
