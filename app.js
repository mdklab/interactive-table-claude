'use strict';
// Pure functions (parseCSV, buildData, detectColTypes, filterRows, sortRows,
// buildPageList, getPageSlice, calcTotalPages, escapeCSVField) live in lib.js
// and are available as globals when loaded before this script.

/* ============================================================
   State — single source of truth
   ============================================================ */
const state = {
  headers: [],       // string[]
  data: [],          // string[][]  (all rows, post-parse)
  colTypes: {},      // {col: 'number'|'date'|'string'}
  filtered: [],      // string[][] current filtered + sorted view
  sortCol: -1,       // column index, -1 = none
  sortDir: 'none',   // 'asc'|'desc'|'none'
  globalSearch: '',
  colFilters: [],    // string[] per column
  page: 1,
  pageSize: 50,
  fileName: '',
};

/* ============================================================
   Filtering + sorting (stateful wrapper around pure lib fns)
   ============================================================ */
function applyFiltersAndSort() {
  let result = filterRows(state.data, state.headers, state.globalSearch, state.colFilters);
  result = sortRows(result, state.sortCol, state.sortDir, state.colTypes);
  state.filtered = result;
  state.page = 1;
}

/* ============================================================
   Pagination helpers (stateful wrappers)
   ============================================================ */
function getPageRows() {
  return getPageSlice(state.filtered, state.page, state.pageSize);
}

function totalPages() {
  return calcTotalPages(state.filtered.length, state.pageSize);
}

/* ============================================================
   DOM helpers
   ============================================================ */
const $ = id => document.getElementById(id);

function el(tag, attrs, ...children) {
  attrs = attrs || {};
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return e;
}

/* ============================================================
   Render: header row
   ============================================================ */
function renderHeader() {
  const tr = $('headerRow');
  tr.innerHTML = '';

  state.headers.forEach((h, c) => {
    const dir = state.sortCol === c ? state.sortDir : 'none';
    const ariaSort = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';

    const th = el('th', {
      'data-col': String(c),
      'data-sort': dir,
      'title': `Sort by ${h}`,
      'tabindex': '0',
      'aria-sort': ariaSort,
    });

    const arrowUp   = el('span', { class: 'arrow-up',   'aria-hidden': 'true' }, '▲');
    const arrowDown = el('span', { class: 'arrow-down', 'aria-hidden': 'true' }, '▼');
    const arrows    = el('span', { class: 'sort-arrows' }, arrowUp, arrowDown);
    th.appendChild(el('div', { class: 'th-content' }, h, arrows));

    function activate() {
      if (state.sortCol !== c) {
        state.sortCol = c;
        state.sortDir = 'asc';
      } else if (state.sortDir === 'asc') {
        state.sortDir = 'desc';
      } else {
        state.sortDir = 'none';
        state.sortCol = -1;
      }
      applyFiltersAndSort();
      // Only re-render header (updates sort arrows) + body + pagination.
      // Do NOT call renderFilterRow() — that would destroy filter inputs
      // and lose focus/cursor position.
      renderHeader();
      renderBody();
      renderPagination();
      renderRowInfo();
      // Restore keyboard focus to the same column after DOM rebuild
      const rebuilt = $('headerRow').cells[c];
      if (rebuilt && document.activeElement === document.body) rebuilt.focus();
    }

    th.onclick = activate;
    th.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
        // Re-focus the rebuilt header cell for keyboard users
        const rebuilt = $('headerRow').cells[c];
        if (rebuilt) rebuilt.focus();
      }
    };

    tr.appendChild(th);
  });
}

/* ============================================================
   Render: filter row
   ============================================================ */
function renderFilterRow() {
  const tr = $('filterRow');
  tr.innerHTML = '';

  state.headers.forEach((h, c) => {
    const input = el('input', {
      type: 'text',
      class: 'col-filter',
      placeholder: 'Filter…',
      'aria-label': `Filter by ${h}`,
      value: state.colFilters[c] || '',
    });
    input.oninput = () => {
      state.colFilters[c] = input.value;
      applyFiltersAndSort();
      renderBody();
      renderPagination();
      renderRowInfo();
    };
    const th = el('th');
    th.appendChild(input);
    tr.appendChild(th);
  });
}

/* ============================================================
   Render: table body
   ============================================================ */
function renderBody() {
  const tbody = $('tableBody');
  const rows = getPageRows();
  const frag = document.createDocumentFragment();
  const colCount = state.headers.length;

  if (rows.length === 0) {
    const tr = el('tr', { class: 'empty-row' });
    tr.appendChild(el('td', { colspan: String(Math.max(colCount, 1)) }, 'No matching rows'));
    frag.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (let c = 0; c < colCount; c++) {
        const td = document.createElement('td');
        td.textContent = row[c] == null ? '' : row[c];
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
  }

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

/* ============================================================
   Render: pagination
   ============================================================ */
function renderPagination() {
  const container = $('pagination');
  container.innerHTML = '';
  const total = totalPages();
  if (total <= 1) return; // container stays empty → CSS :empty hides it

  const cur = state.page;
  const frag = document.createDocumentFragment();

  function makeBtn(label, targetPage, disabled, active, ariaLabel) {
    const btn = el('button', {
      class: 'page-btn' + (active ? ' active' : ''),
      'aria-label': ariaLabel || `Page ${targetPage}`,
    }, String(label));
    if (active)    btn.setAttribute('aria-current', 'page');
    if (disabled)  btn.disabled = true;
    if (!disabled && !active) {
      btn.onclick = () => {
        state.page = targetPage;
        renderBody();
        renderPagination();
        renderRowInfo();
      };
    }
    return btn;
  }

  frag.appendChild(makeBtn('‹', cur - 1, cur === 1, false, 'Previous page'));

  for (const p of buildPageList(cur, total)) {
    if (p === '…') {
      frag.appendChild(el('span', { class: 'page-ellipsis', 'aria-hidden': 'true' }, '…'));
    } else {
      frag.appendChild(makeBtn(p, p, false, p === cur));
    }
  }

  frag.appendChild(makeBtn('›', cur + 1, cur === total, false, 'Next page'));
  container.appendChild(frag);
}

/* ============================================================
   Render: row info
   ============================================================ */
function renderRowInfo() {
  const { filtered, data, pageSize, page } = state;
  const matchCount = filtered.length;
  const allCount   = data.length;

  let rangeText;
  if (pageSize === 0 || matchCount === 0) {
    rangeText = String(matchCount);
  } else {
    const start = (page - 1) * pageSize + 1;
    const end   = Math.min(page * pageSize, matchCount);
    rangeText = `${start}–${end}`;
  }

  // When a filter is active, show "X–Y of Z matching (N total)"
  // so users know how many rows are hidden.
  let text = `${rangeText} of ${matchCount}`;
  if (matchCount !== allCount) text += ` (${allCount} total)`;
  text += ' rows';

  $('rowInfo').textContent = text;
}

/* ============================================================
   Render all
   ============================================================ */
function renderAll() {
  renderHeader();
  renderFilterRow();
  renderBody();
  renderPagination();
  renderRowInfo();
}

/* ============================================================
   File type validation helper
   ============================================================ */
function isCSVFile(file) {
  // Accept by extension or MIME type
  return /\.(csv|tsv|txt)$/i.test(file.name) ||
         /^text\//i.test(file.type) ||
         file.type === 'application/vnd.ms-excel'; // Some systems use this for .csv
}

/* ============================================================
   Upload error display
   ============================================================ */
function showUploadError(msg) {
  const err = $('uploadError');
  if (!err) return;
  err.textContent = msg;
  err.hidden = false;
  clearTimeout(showUploadError._timer);
  showUploadError._timer = setTimeout(() => { err.hidden = true; }, 5000);
}

/* ============================================================
   Load file
   ============================================================ */
function loadFile(file) {
  if (!file) return;

  if (!isCSVFile(file)) {
    showUploadError('Please select a CSV or plain-text file (.csv, .tsv, .txt).');
    return;
  }

  state.fileName = file.name;
  const uploadZone = $('uploadZone');
  const titleEl    = uploadZone.querySelector('.upload-title');
  const origTitle  = titleEl.textContent;

  // Show loading state
  uploadZone.classList.add('is-loading');
  titleEl.textContent = 'Reading file…';

  const reader = new FileReader();

  reader.onerror = () => {
    uploadZone.classList.remove('is-loading');
    titleEl.textContent = origTitle;
    showUploadError('Could not read the file. Please try again.');
  };

  reader.onload = e => {
    uploadZone.classList.remove('is-loading');
    titleEl.textContent = origTitle;

    const text = e.target.result;
    const { rows } = parseCSV(text);
    const { headers, data } = buildData(rows);

    if (headers.length === 0) {
      showUploadError('The file appears to be empty or has no recognisable columns.');
      return;
    }

    // Reset state
    state.headers    = headers;
    state.data       = data;
    state.colTypes   = detectColTypes(headers, data);
    state.colFilters = new Array(headers.length).fill('');
    state.globalSearch = '';
    state.sortCol    = -1;
    state.sortDir    = 'none';
    state.page       = 1;

    applyFiltersAndSort();

    // Switch UI
    uploadZone.classList.add('hidden');
    $('appHeader').classList.remove('hidden');
    $('tableArea').classList.remove('hidden');
    $('fileName').textContent = file.name;
    $('globalSearch').value = '';
    $('clearSearch').classList.remove('visible');

    renderAll();
  };

  reader.readAsText(file, 'UTF-8');
}

/* ============================================================
   Export CSV
   ============================================================ */
function exportCSV() {
  const { headers, filtered, fileName } = state;
  const BOM = '\uFEFF';

  const lines = [
    headers.map(escapeCSVField).join(','),
    ...filtered.map(row => headers.map((_, c) => escapeCSVField(row[c])).join(',')),
  ];

  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${fileName.replace(/\.csv$/i, '')}_filtered.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ============================================================
   Reset to upload state
   ============================================================ */
function resetToUpload() {
  state.headers    = [];
  state.data       = [];
  state.filtered   = [];
  $('tableArea').classList.add('hidden');
  $('appHeader').classList.add('hidden');
  $('uploadZone').classList.remove('hidden');
  // Reset file input so the same file can be loaded again
  $('fileInput').value = '';
}

/* ============================================================
   Wire up events
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = $('uploadZone');
  const fileInput  = $('fileInput');

  // Click anywhere on upload zone opens file picker.
  // Skip if the click was on the label (its for= already triggers the picker)
  // or on fileInput itself — otherwise we'd open a second dialog.
  uploadZone.addEventListener('click', e => {
    if (e.target === fileInput || e.target.closest('label[for="fileInput"]')) return;
    fileInput.click();
  });

  // Drag & drop
  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  // Only remove drag-over when the cursor truly leaves the zone,
  // not when it moves over a child element inside the zone.
  uploadZone.addEventListener('dragleave', e => {
    if (!uploadZone.contains(e.relatedTarget)) {
      uploadZone.classList.remove('drag-over');
    }
  });

  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
    // Reset so the same file can be picked again next time
    fileInput.value = '';
  });

  // Global search
  $('globalSearch').addEventListener('input', e => {
    state.globalSearch = e.target.value;
    $('clearSearch').classList.toggle('visible', e.target.value.length > 0);
    applyFiltersAndSort();
    renderBody();
    renderPagination();
    renderRowInfo();
  });

  $('clearSearch').addEventListener('click', () => {
    $('globalSearch').value = '';
    state.globalSearch = '';
    $('clearSearch').classList.remove('visible');
    applyFiltersAndSort();
    renderBody();
    renderPagination();
    renderRowInfo();
    $('globalSearch').focus();
  });

  // Page size
  $('pageSize').addEventListener('change', e => {
    state.pageSize = Number(e.target.value);
    state.page     = 1;
    renderBody();
    renderPagination();
    renderRowInfo();
  });

  $('btnNew').addEventListener('click', resetToUpload);
  $('btnExport').addEventListener('click', exportCSV);
});
