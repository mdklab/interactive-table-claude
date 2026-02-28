'use strict';

/* ============================================================
   CSV Parser — RFC-4180 compliant
   ============================================================ */
function parseCSV(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Auto-detect delimiter by counting occurrences in first line
  const firstLine = text.split(/\r?\n/)[0];
  const delims = [',', ';', '\t', '|'];
  let delim = ',';
  let maxCount = 0;
  for (const d of delims) {
    const count = firstLine.split(d).length - 1;
    if (count > maxCount) { maxCount = count; delim = d; }
  }

  const rows = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const row = [];
    while (i < n) {
      if (text[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        let field = '';
        while (i < n) {
          if (text[i] === '"') {
            if (i + 1 < n && text[i + 1] === '"') {
              field += '"'; // escaped quote
              i += 2;
            } else {
              i++; // closing quote
              break;
            }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
        if (i < n && text[i] === delim) i++;
        else if (i < n && text[i] === '\r') { i++; if (i < n && text[i] === '\n') i++; break; }
        else if (i < n && text[i] === '\n') { i++; break; }
      } else {
        // Unquoted field
        let field = '';
        while (i < n && text[i] !== delim && text[i] !== '\r' && text[i] !== '\n') {
          field += text[i++];
        }
        row.push(field.trim());
        if (i < n && text[i] === delim) i++;
        else if (i < n && text[i] === '\r') { i++; if (i < n && text[i] === '\n') i++; break; }
        else if (i < n && text[i] === '\n') { i++; break; }
        else break; // end of string
      }
    }
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  return { rows, delim };
}

/* ============================================================
   Build structured data from raw rows
   ============================================================ */
function buildData(rows) {
  if (rows.length === 0) return { headers: [], data: [] };
  const headers = rows[0].map((h, i) => h || `Column ${i + 1}`);
  const data = rows.slice(1);
  return { headers, data };
}

/* ============================================================
   Column type detection — scans first 500 rows
   Returns {colIndex: 'number'|'date'|'string'}
   ============================================================ */
function detectColTypes(headers, data) {
  const sample = data.slice(0, 500);
  const types = {};

  for (let c = 0; c < headers.length; c++) {
    let numOk = 0, dateOk = 0, total = 0;

    for (const row of sample) {
      const val = (row[c] == null ? '' : row[c]).trim();
      if (val === '') continue;
      total++;

      if (!isNaN(Number(val.replace(/,/g, '')))) numOk++;
      else if (!isNaN(Date.parse(val))) dateOk++;
    }

    if (total === 0) { types[c] = 'string'; continue; }
    if (numOk / total >= 0.8) types[c] = 'number';
    else if (dateOk / total >= 0.8) types[c] = 'date';
    else types[c] = 'string';
  }

  return types;
}

/* ============================================================
   Pure filter — returns filtered subset, no side effects
   ============================================================ */
function filterRows(data, headers, globalSearch, colFilters) {
  const gLower = (globalSearch || '').toLowerCase();
  const colLowers = (colFilters || []).map(f => (f || '').toLowerCase());
  const colCount = headers ? headers.length : 0;

  return data.filter(row => {
    if (gLower && !row.some(cell => (cell == null ? '' : cell).toLowerCase().includes(gLower))) return false;
    for (let c = 0; c < colCount; c++) {
      const f = colLowers[c];
      if (!f) continue;
      if (!(row[c] == null ? '' : row[c]).toLowerCase().includes(f)) return false;
    }
    return true;
  });
}

/* ============================================================
   Pure sort — returns new sorted array, no side effects
   ============================================================ */
function sortRows(rows, sortCol, sortDir, colTypes) {
  if (sortCol < 0 || sortDir === 'none') return rows;
  const type = (colTypes && colTypes[sortCol]) || 'string';

  return rows.slice().sort((a, b) => {
    const av = (a[sortCol] == null ? '' : a[sortCol]).trim();
    const bv = (b[sortCol] == null ? '' : b[sortCol]).trim();

    let cmp;
    if (type === 'number') {
      const an = parseFloat(av.replace(/,/g, ''));
      const bn = parseFloat(bv.replace(/,/g, ''));
      cmp = (isNaN(an) ? -Infinity : an) - (isNaN(bn) ? -Infinity : bn);
    } else if (type === 'date') {
      const ad = Date.parse(av);
      const bd = Date.parse(bv);
      cmp = (isNaN(ad) ? -Infinity : ad) - (isNaN(bd) ? -Infinity : bd);
    } else {
      cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

/* ============================================================
   Pagination — smart ellipsis page list
   Returns array of page numbers and '…' markers
   ============================================================ */
function buildPageList(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const result = [];
  const addEllipsis = () => { if (result[result.length - 1] !== '…') result.push('…'); };

  result.push(1);
  if (cur > 3) addEllipsis();
  for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) result.push(p);
  if (cur < total - 2) addEllipsis();
  result.push(total);

  return result;
}

/* ============================================================
   Pagination — slice rows for one page
   pageSize === 0 means "show all"
   ============================================================ */
function getPageSlice(filtered, page, pageSize) {
  if (pageSize === 0) return filtered;
  const start = (page - 1) * pageSize;
  return filtered.slice(start, start + pageSize);
}

/* ============================================================
   Pagination — total page count
   ============================================================ */
function calcTotalPages(filteredCount, pageSize) {
  if (pageSize === 0) return 1;
  return Math.max(1, Math.ceil(filteredCount / pageSize));
}

/* ============================================================
   CSV export — escape one field value
   Wraps in quotes if value contains comma, quote, or newline
   ============================================================ */
function escapeCSVField(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Allow loading as a CommonJS module (Node.js) for testing,
// while remaining a plain global script in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCSV, buildData, detectColTypes,
    filterRows, sortRows,
    buildPageList, getPageSlice, calcTotalPages,
    escapeCSVField,
  };
}
