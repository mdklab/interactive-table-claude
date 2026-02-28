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
    const th = el('th', {
      'data-col': String(c),
      'data-sort': dir,
      title: `Sort by ${h}`,
    });

    const arrowUp = el('span', { class: 'arrow-up' }, '▲');
    const arrowDown = el('span', { class: 'arrow-down' }, '▼');
    const arrows = el('span', { class: 'sort-arrows' }, arrowUp, arrowDown);
    th.appendChild(el('div', { class: 'th-content' }, h, arrows));

    th.onclick = () => {
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
      renderAll();
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
      'aria-label': `Filter ${h}`,
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

  if (rows.length === 0) {
    const tr = el('tr', { class: 'empty-row' });
    tr.appendChild(el('td', { colspan: String(state.headers.length) }, 'No matching rows'));
    frag.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (let c = 0; c < state.headers.length; c++) {
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
  if (total <= 1) return;

  const cur = state.page;
  const frag = document.createDocumentFragment();

  function makeBtn(label, page, disabled, active) {
    const btn = el('button', { class: 'page-btn' + (active ? ' active' : ''), title: `Page ${page}` }, String(label));
    if (disabled) btn.disabled = true;
    if (!disabled && !active) btn.onclick = () => { state.page = page; renderBody(); renderPagination(); renderRowInfo(); };
    return btn;
  }

  frag.appendChild(makeBtn('‹', cur - 1, cur === 1, false));

  for (const p of buildPageList(cur, total)) {
    if (p === '…') {
      frag.appendChild(el('span', { class: 'page-ellipsis' }, '…'));
    } else {
      frag.appendChild(makeBtn(p, p, false, p === cur));
    }
  }

  frag.appendChild(makeBtn('›', cur + 1, cur === total, false));
  container.appendChild(frag);
}

/* ============================================================
   Render: row info
   ============================================================ */
function renderRowInfo() {
  const { filtered, data, pageSize, page } = state;
  const total = filtered.length;

  let showing;
  if (pageSize === 0 || total === 0) {
    showing = total;
  } else {
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    showing = `${start}–${end}`;
  }

  $('rowInfo').textContent = `${showing} of ${data.length} rows`;
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
  updateStickyTop();
}

/* ============================================================
   Sticky offset sync
   ============================================================ */
function updateStickyTop() {
  const controlsBar = document.querySelector('.controls-bar');
  if (!controlsBar) return;
  const h = ($('appHeader') || {}).offsetHeight || 0;
  const c = controlsBar.offsetHeight;
  document.documentElement.style.setProperty('--header-height', h + 'px');
  document.documentElement.style.setProperty('--controls-height', c + 'px');
}

/* ============================================================
   Load file
   ============================================================ */
function loadFile(file) {
  if (!file) return;
  state.fileName = file.name;

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const { rows } = parseCSV(text);
    const { headers, data } = buildData(rows);

    if (headers.length === 0) {
      alert('The CSV file appears to be empty or unreadable.');
      return;
    }

    state.headers = headers;
    state.data = data;
    state.colTypes = detectColTypes(headers, data);
    state.colFilters = new Array(headers.length).fill('');
    state.globalSearch = '';
    state.sortCol = -1;
    state.sortDir = 'none';
    state.page = 1;

    applyFiltersAndSort();

    $('uploadZone').classList.add('hidden');
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
    ...filtered.map(row => headers.map((_, c) => escapeCSVField(row[c])).join(','))
  ];

  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
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
  state.headers = [];
  state.data = [];
  state.filtered = [];
  $('tableArea').classList.add('hidden');
  $('appHeader').classList.add('hidden');
  $('uploadZone').classList.remove('hidden');
  $('fileInput').value = '';
}

/* ============================================================
   Wire up events
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = $('uploadZone');
  const fileInput = $('fileInput');

  uploadZone.addEventListener('click', e => {
    if (e.target !== fileInput) fileInput.click();
  });

  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

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

  $('pageSize').addEventListener('change', e => {
    state.pageSize = Number(e.target.value);
    state.page = 1;
    renderBody();
    renderPagination();
    renderRowInfo();
  });

  $('btnNew').addEventListener('click', resetToUpload);
  $('btnExport').addEventListener('click', exportCSV);

  window.addEventListener('resize', updateStickyTop);
});
