/**
 * ══════════════════════════════════════════════════════════════════════
 * PM & ERP SaaS - Edit Maintenance Contract Form Helpers
 * Handles custom cadence toggle, live invoice total preview, and cycle date helper
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  function formatKES(amount) {
    return (
      'KES ' +
      Number(amount || 0).toLocaleString('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function advanceCycleDate(dateObj, frequency, intervalMonths) {
    var next = new Date(dateObj.getTime());
    if (frequency === 'WEEKLY') {
      next.setDate(next.getDate() + 7);
    } else if (frequency === 'BIWEEKLY') {
      next.setDate(next.getDate() + 14);
    } else if (frequency === 'QUARTERLY') {
      next.setMonth(next.getMonth() + 3);
    } else if (frequency === 'BIANNUAL') {
      next.setMonth(next.getMonth() + 6);
    } else if (frequency === 'ANNUAL') {
      next.setFullYear(next.getFullYear() + 1);
    } else {
      var months = Math.max(1, parseInt(intervalMonths, 10) || 1);
      next.setMonth(next.getMonth() + months);
    }
    return next;
  }

  function toYyyyMmDd(dateObj) {
    var y = dateObj.getFullYear();
    var m = String(dateObj.getMonth() + 1).padStart(2, '0');
    var d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('editMaintenanceForm');
    if (!form) return;

    var freqSelect = document.getElementById('frequency');
    var customGroup = document.getElementById('customIntervalGroup');
    var intervalInput = document.getElementById('intervalMonths');
    var chargeInput = document.getElementById('chargeAmount');
    var taxInput = document.getElementById('taxRate');
    var startInput = document.getElementById('startDate');
    var endInput = document.getElementById('endDate');
    var nextDueInput = document.getElementById('nextDueDate');
    var recalcBtn = document.getElementById('btnRecalculateDueDate');

    var subtotalPreview = document.getElementById('editContractSubtotal');
    var taxPreview = document.getElementById('editContractTax');
    var totalPreview = document.getElementById('editContractTotal');

    function syncFrequencyUI(isUserChange) {
      if (!freqSelect || !customGroup || !intervalInput) return;
      var val = freqSelect.value;

      if (val === 'CUSTOM') {
        customGroup.style.display = 'block';
        var currentInt = parseInt(intervalInput.value, 10);
        if (!currentInt || currentInt < 1) {
          intervalInput.value = '2';
        }
      } else {
        customGroup.style.display = 'none';
        if (isUserChange) {
          if (val === 'MONTHLY') intervalInput.value = '1';
          else if (val === 'QUARTERLY') intervalInput.value = '3';
          else if (val === 'BIANNUAL') intervalInput.value = '6';
          else if (val === 'ANNUAL') intervalInput.value = '12';
          else intervalInput.value = '1';
        }
      }
    }

    function updateTotalsPreview() {
      var charge = parseFloat(chargeInput ? chargeInput.value : '0');
      if (!Number.isFinite(charge) || charge < 0) charge = 0;

      var taxRate = parseFloat(taxInput ? taxInput.value : '0');
      if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = 0;

      var tax = charge * (taxRate / 100);
      var total = charge + tax;

      if (subtotalPreview) subtotalPreview.textContent = formatKES(charge);
      if (taxPreview) taxPreview.textContent = formatKES(tax);
      if (totalPreview) totalPreview.textContent = formatKES(total);
    }

    function recalculateNextDueFromStart() {
      if (!startInput || !nextDueInput || !startInput.value) return;

      var startDt = new Date(startInput.value + 'T00:00:00');
      if (Number.isNaN(startDt.getTime())) return;

      var freq = freqSelect ? freqSelect.value : 'MONTHLY';
      var interval = intervalInput ? parseInt(intervalInput.value, 10) || 1 : 1;
      var endDt = endInput && endInput.value ? new Date(endInput.value + 'T23:59:59') : null;

      var now = new Date();
      var todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      var cursor = new Date(startDt.getTime());
      var lastValid = new Date(startDt.getTime());
      var step = 0;

      while (step < 300) {
        if (endDt && !Number.isNaN(endDt.getTime()) && cursor > endDt) {
          break;
        }
        lastValid = new Date(cursor.getTime());
        if (cursor > todayEnd) {
          break;
        }
        cursor = advanceCycleDate(cursor, freq, interval);
        step++;
      }

      var targetStr = toYyyyMmDd(lastValid);
      if (nextDueInput._flatpickr) {
        nextDueInput._flatpickr.setDate(targetStr, false);
      } else {
        nextDueInput.value = targetStr;
      }
    }

    if (freqSelect) {
      freqSelect.addEventListener('change', function () {
        syncFrequencyUI(true);
      });
      syncFrequencyUI(false);
    }

    if (chargeInput) chargeInput.addEventListener('input', updateTotalsPreview);
    if (taxInput) taxInput.addEventListener('input', updateTotalsPreview);
    updateTotalsPreview();

    if (recalcBtn) {
      recalcBtn.addEventListener('click', recalculateNextDueFromStart);
    }
  });
})();
