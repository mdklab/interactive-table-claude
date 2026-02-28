'use strict';
// lib.js must be loaded before this file.
// All pure functions (parseCSV, buildData, detectColTypes, filterRows,
// sortRows, buildPageList, getPageSlice, calcTotalPages, escapeCSVField)
// are available as globals.

/* ============================================================
   Minimal test runner
   ============================================================ */
const T = (() => {
  const groups = [];
  let current = null;

  function getOrCreateGroup(name) {
    let g = groups.find(x => x.name === name);
    if (!g) { g = { name, tests: [] }; groups.push(g); }
    return g;
  }

  return {
    group(name) { current = getOrCreateGroup(name); },

    run(name, fn) {
      if (!current) current = getOrCreateGroup('__default__');
      try {
        fn();
        current.tests.push({ ok: true, name });
      } catch (e) {
        current.tests.push({ ok: false, name, error: e.message });
      }
    },

    summary() {
      let passed = 0, total = 0;
      groups.forEach(g => g.tests.forEach(t => { total++; if (t.ok) passed++; }));
      return { passed, failed: total - passed, total };
    },

    renderToDOM() {
      const { passed, failed, total } = this.summary();
      const root = document.getElementById('root');

      // Summary banner
      const banner = document.createElement('div');
      banner.className = 'summary ' + (failed === 0 ? 'all-pass' : 'has-fail');
      banner.innerHTML = (failed === 0
        ? `<span>✓ All ${total} tests passed</span>`
        : `<span>✗ ${failed} of ${total} tests failed</span>`)
        + `<span class="detail">${passed} passed · ${failed} failed · ${total} total</span>`;
      root.appendChild(banner);

      // Groups
      for (const g of groups) {
        const gPassed = g.tests.filter(t => t.ok).length;
        const gFailed = g.tests.length - gPassed;
        const allPass = gFailed === 0;

        const section = document.createElement('section');

        const header = document.createElement('div');
        header.className = 'group-header';
        header.innerHTML = `<span>${g.name}</span>
          <span class="group-badge ${allPass ? 'badge-pass' : 'badge-fail'}">${gPassed}/${g.tests.length}</span>`;
        header.onclick = () => section.classList.toggle('collapsed');
        section.appendChild(header);

        // Auto-collapse passing groups when there are failures
        if (allPass && failed > 0) section.classList.add('collapsed');

        const ul = document.createElement('ul');
        for (const t of g.tests) {
          const li = document.createElement('li');
          li.className = t.ok ? 'pass' : 'fail';

          const line = document.createElement('div');
          line.className = 'test-line';
          line.innerHTML = `<span class="icon">${t.ok ? '✓' : '✗'}</span><span class="test-name">${t.name}</span>`;
          li.appendChild(line);

          if (!t.ok && t.error) {
            const pre = document.createElement('pre');
            pre.className = 'error';
            pre.textContent = t.error;
            li.appendChild(pre);
          }
          ul.appendChild(li);
        }
        section.appendChild(ul);
        root.appendChild(section);
      }
    }
  };
})();

/* ============================================================
   Assertion helpers
   ============================================================ */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error((msg ? msg + '\n' : '') + `  expected: ${e}\n  actual:   ${a}`);
  }
}

function assertContains(arr, item, msg) {
  assert(arr.includes(item), (msg || '') + ` — array does not contain ${JSON.stringify(item)}`);
}

/* ============================================================
   parseCSV
   ============================================================ */
T.group('parseCSV');

T.run('comma delimiter — basic 2×3', () => {
  const { rows, delim } = parseCSV('a,b,c\n1,2,3');
  assertEqual(delim, ',');
  assertEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

T.run('semicolon delimiter auto-detected', () => {
  const { rows, delim } = parseCSV('a;b;c\n1;2;3');
  assertEqual(delim, ';');
  assertEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

T.run('tab delimiter auto-detected', () => {
  const { rows, delim } = parseCSV('a\tb\tc\n1\t2\t3');
  assertEqual(delim, '\t');
  assertEqual(rows[0], ['a', 'b', 'c']);
  assertEqual(rows[1], ['1', '2', '3']);
});

T.run('pipe delimiter auto-detected', () => {
  const { rows, delim } = parseCSV('a|b|c\n1|2|3');
  assertEqual(delim, '|');
  assertEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

T.run('quoted fields preserve internal whitespace', () => {
  const { rows } = parseCSV('"hello world","  spaced  "\n"foo","bar"');
  assertEqual(rows[0], ['hello world', '  spaced  ']);
});

T.run('escaped double-quotes inside quoted field', () => {
  const { rows } = parseCSV('"he said ""hi""","ok"\nval,val2');
  assertEqual(rows[0][0], 'he said "hi"');
  assertEqual(rows[0][1], 'ok');
});

T.run('UTF-8 BOM stripped', () => {
  const bom = '\uFEFF';
  const { rows } = parseCSV(bom + 'a,b\n1,2');
  assertEqual(rows[0], ['a', 'b']);
  assertEqual(rows.length, 2);
});

T.run('CRLF line endings', () => {
  const { rows } = parseCSV('a,b,c\r\n1,2,3\r\n4,5,6');
  assertEqual(rows.length, 3);
  assertEqual(rows[2], ['4', '5', '6']);
});

T.run('empty (unquoted) fields produce empty strings', () => {
  const { rows } = parseCSV('a,,c\n1,,3');
  assertEqual(rows[0], ['a', '', 'c']);
  assertEqual(rows[1], ['1', '', '3']);
});

T.run('empty quoted field', () => {
  const { rows } = parseCSV('"","b"\n"","d"');
  assertEqual(rows[0][0], '');
  assertEqual(rows[0][1], 'b');
});

T.run('delimiter inside quoted field is not split', () => {
  const { rows } = parseCSV('"a,b",c\n"1,2",3');
  assertEqual(rows[0], ['a,b', 'c']);
  assertEqual(rows[1], ['1,2', '3']);
});

T.run('newline inside quoted field — treated as single row', () => {
  const { rows } = parseCSV('"line1\nline2",after');
  assertEqual(rows.length, 1);
  assertEqual(rows[0][0], 'line1\nline2');
  assertEqual(rows[0][1], 'after');
});

T.run('trailing newline does not produce empty row', () => {
  const { rows } = parseCSV('a,b\n1,2\n');
  assertEqual(rows.length, 2);
});

T.run('completely empty string returns empty rows', () => {
  const { rows } = parseCSV('');
  assertEqual(rows, []);
});

T.run('single column, multiple rows', () => {
  const { rows } = parseCSV('name\nAlice\nBob');
  assertEqual(rows.length, 3);
  assertEqual(rows[1], ['Alice']);
  assertEqual(rows[2], ['Bob']);
});

T.run('unquoted fields are trimmed', () => {
  const { rows } = parseCSV('  a  ,  b  \n  1  ,  2  ');
  assertEqual(rows[0], ['a', 'b']);
  assertEqual(rows[1], ['1', '2']);
});

/* ============================================================
   buildData
   ============================================================ */
T.group('buildData');

T.run('normal rows → headers + data split', () => {
  const { headers, data } = buildData([['id', 'name'], ['1', 'Alice'], ['2', 'Bob']]);
  assertEqual(headers, ['id', 'name']);
  assertEqual(data.length, 2);
  assertEqual(data[0], ['1', 'Alice']);
});

T.run('empty rows array → empty headers and data', () => {
  const { headers, data } = buildData([]);
  assertEqual(headers, []);
  assertEqual(data, []);
});

T.run('missing header value → auto-named "Column N"', () => {
  const { headers } = buildData([['', 'b', ''], ['1', '2', '3']]);
  assertEqual(headers[0], 'Column 1');
  assertEqual(headers[1], 'b');
  assertEqual(headers[2], 'Column 3');
});

T.run('headers-only (no data rows) → data is empty array', () => {
  const { headers, data } = buildData([['a', 'b', 'c']]);
  assertEqual(headers, ['a', 'b', 'c']);
  assertEqual(data, []);
});

/* ============================================================
   detectColTypes
   ============================================================ */
T.group('detectColTypes');

T.run('all integers → number', () => {
  const types = detectColTypes(['n'], [['1'], ['2'], ['3'], ['42']]);
  assertEqual(types[0], 'number');
});

T.run('all decimals → number', () => {
  const types = detectColTypes(['n'], [['1.5'], ['2.7'], ['-3.14']]);
  assertEqual(types[0], 'number');
});

T.run('all ISO dates → date', () => {
  const types = detectColTypes(['d'], [['2023-01-01'], ['2023-06-15'], ['2024-12-31']]);
  assertEqual(types[0], 'date');
});

T.run('all plain strings → string', () => {
  const types = detectColTypes(['s'], [['hello'], ['world'], ['foo'], ['bar']]);
  assertEqual(types[0], 'string');
});

T.run('≥80% numbers → number (with some empty cells)', () => {
  const data = [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], [''], ['']];
  const types = detectColTypes(['n'], data);
  assertEqual(types[0], 'number');
});

T.run('<80% numbers → string', () => {
  // 3 numbers, 5 strings → 37.5% → string
  const data = [['1'], ['2'], ['3'], ['hello'], ['world'], ['foo'], ['bar'], ['baz']];
  const types = detectColTypes(['n'], data);
  assertEqual(types[0], 'string');
});

T.run('numbers with comma separators → number', () => {
  const types = detectColTypes(['n'], [['1,000'], ['2,500'], ['10,000']]);
  assertEqual(types[0], 'number');
});

T.run('all-empty column → string', () => {
  const types = detectColTypes(['e'], [[''], [''], ['']]);
  assertEqual(types[0], 'string');
});

T.run('multiple columns typed independently', () => {
  const data = [['1', 'hello', '2023-01-01'], ['2', 'world', '2023-06-15']];
  const types = detectColTypes(['num', 'str', 'date'], data);
  assertEqual(types[0], 'number');
  assertEqual(types[1], 'string');
  assertEqual(types[2], 'date');
});

/* ============================================================
   filterRows
   ============================================================ */
T.group('filterRows');

const FDATA = [
  ['Alice', '30', 'Engineer'],
  ['Bob', '25', 'Designer'],
  ['Charlie', '35', 'Engineer'],
  ['Diana', '28', 'Manager'],
];
const FHEADERS = ['name', 'age', 'role'];

T.run('no filters → all rows returned', () => {
  assertEqual(filterRows(FDATA, FHEADERS, '', []).length, 4);
});

T.run('global search — matching rows returned', () => {
  const result = filterRows(FDATA, FHEADERS, 'alice', []);
  assertEqual(result.length, 1);
  assertEqual(result[0][0], 'Alice');
});

T.run('global search — no match → empty', () => {
  const result = filterRows(FDATA, FHEADERS, 'zzz', []);
  assertEqual(result.length, 0);
});

T.run('global search is case-insensitive', () => {
  const result = filterRows(FDATA, FHEADERS, 'ENGINEER', []);
  assertEqual(result.length, 2);
});

T.run('global search matches partial cell value', () => {
  const result = filterRows(FDATA, FHEADERS, 'ob', []);
  assertEqual(result.length, 1);
  assertEqual(result[0][0], 'Bob');
});

T.run('per-column filter — match on name column', () => {
  const result = filterRows(FDATA, FHEADERS, '', ['ali', '', '']);
  assertEqual(result.length, 1);
  assertEqual(result[0][0], 'Alice');
});

T.run('per-column filter — no match → empty', () => {
  const result = filterRows(FDATA, FHEADERS, '', ['xyz', '', '']);
  assertEqual(result.length, 0);
});

T.run('multiple per-column filters — AND logic', () => {
  const result = filterRows(FDATA, FHEADERS, '', ['', '', 'engineer']);
  assertEqual(result.length, 2);
  result.forEach(r => assert(r[2] === 'Engineer'));
});

T.run('global search + column filter combined', () => {
  // global: "engineer", col[0]: "ali" → Alice Engineer only
  const result = filterRows(FDATA, FHEADERS, 'engineer', ['ali', '', '']);
  assertEqual(result.length, 1);
  assertEqual(result[0][0], 'Alice');
});

T.run('null/undefined cells treated as empty string', () => {
  const data = [[null, 'visible'], [undefined, 'also']];
  const result = filterRows(data, ['a', 'b'], 'visible', []);
  assertEqual(result.length, 1);
});

/* ============================================================
   sortRows
   ============================================================ */
T.group('sortRows');

const SDATA = [
  ['Charlie', '35', '2020-03-01'],
  ['Alice',   '10', '2022-01-15'],
  ['Bob',     '200','2019-07-04'],
  ['Diana',   '1',  '2023-12-31'],
];

T.run('sortDir "none" → original order unchanged', () => {
  const result = sortRows(SDATA, 0, 'none', {});
  assertEqual(result[0][0], 'Charlie');
  assertEqual(result[3][0], 'Diana');
});

T.run('sortCol -1 → original order unchanged', () => {
  const result = sortRows(SDATA, -1, 'asc', {});
  assertEqual(result[0][0], 'Charlie');
});

T.run('string column ascending (locale-aware)', () => {
  const result = sortRows(SDATA, 0, 'asc', { 0: 'string' });
  assertEqual(result[0][0], 'Alice');
  assertEqual(result[1][0], 'Bob');
  assertEqual(result[2][0], 'Charlie');
  assertEqual(result[3][0], 'Diana');
});

T.run('string column descending', () => {
  const result = sortRows(SDATA, 0, 'desc', { 0: 'string' });
  assertEqual(result[0][0], 'Diana');
  assertEqual(result[3][0], 'Alice');
});

T.run('number column ascending (numeric order not lexicographic)', () => {
  const result = sortRows(SDATA, 1, 'asc', { 1: 'number' });
  assertEqual(result[0][1], '1');
  assertEqual(result[1][1], '10');
  assertEqual(result[2][1], '35');
  assertEqual(result[3][1], '200');
});

T.run('number column descending', () => {
  const result = sortRows(SDATA, 1, 'desc', { 1: 'number' });
  assertEqual(result[0][1], '200');
  assertEqual(result[3][1], '1');
});

T.run('date column ascending', () => {
  const result = sortRows(SDATA, 2, 'asc', { 2: 'date' });
  assertEqual(result[0][2], '2019-07-04');
  assertEqual(result[3][2], '2023-12-31');
});

T.run('date column descending', () => {
  const result = sortRows(SDATA, 2, 'desc', { 2: 'date' });
  assertEqual(result[0][2], '2023-12-31');
  assertEqual(result[3][2], '2019-07-04');
});

T.run('empty values sort to start on number asc', () => {
  const data = [['5'], [''], ['3'], ['']];
  const result = sortRows(data, 0, 'asc', { 0: 'number' });
  assertEqual(result[0][0], '');
  assertEqual(result[1][0], '');
  assertEqual(result[2][0], '3');
  assertEqual(result[3][0], '5');
});

T.run('numeric string sort: "10" > "9" (locale numeric)', () => {
  const data = [['10'], ['9'], ['2'], ['100']];
  const result = sortRows(data, 0, 'asc', { 0: 'string' });
  assertEqual(result[0][0], '2');
  assertEqual(result[1][0], '9');
  assertEqual(result[2][0], '10');
  assertEqual(result[3][0], '100');
});

T.run('does not mutate input array', () => {
  const orig = [['b'], ['a'], ['c']];
  const origFirst = orig[0];
  sortRows(orig, 0, 'asc', { 0: 'string' });
  assertEqual(orig[0], origFirst, 'original array was mutated');
});

/* ============================================================
   buildPageList
   ============================================================ */
T.group('buildPageList');

T.run('total ≤ 7 → plain list without ellipsis', () => {
  assertEqual(buildPageList(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  assertEqual(buildPageList(4, 5), [1, 2, 3, 4, 5]);
  assertEqual(buildPageList(1, 1), [1]);
});

T.run('total = 8, cur = 1 → ellipsis before last', () => {
  assertEqual(buildPageList(1, 8), [1, 2, '…', 8]);
});

T.run('total = 20, cur = 1', () => {
  assertEqual(buildPageList(1, 20), [1, 2, '…', 20]);
});

T.run('total = 20, cur = 10 (middle) → both ellipses', () => {
  assertEqual(buildPageList(10, 20), [1, '…', 9, 10, 11, '…', 20]);
});

T.run('total = 20, cur = 3 → no left ellipsis', () => {
  assertEqual(buildPageList(3, 20), [1, 2, 3, 4, '…', 20]);
});

T.run('total = 20, cur = 18 → no right ellipsis', () => {
  assertEqual(buildPageList(18, 20), [1, '…', 17, 18, 19, 20]);
});

T.run('total = 20, cur = 20 (last)', () => {
  assertEqual(buildPageList(20, 20), [1, '…', 19, 20]);
});

T.run('no duplicate ellipsis markers', () => {
  const list = buildPageList(4, 20);
  for (let i = 1; i < list.length; i++) {
    assert(!(list[i] === '…' && list[i - 1] === '…'), 'consecutive ellipsis found');
  }
});

/* ============================================================
   getPageSlice
   ============================================================ */
T.group('getPageSlice');

const PDATA = [['a'], ['b'], ['c'], ['d'], ['e']];

T.run('pageSize = 0 → returns all rows', () => {
  assertEqual(getPageSlice(PDATA, 1, 0).length, 5);
});

T.run('page 1, size 2 → first two rows', () => {
  assertEqual(getPageSlice(PDATA, 1, 2), [['a'], ['b']]);
});

T.run('page 2, size 2 → rows 3–4', () => {
  assertEqual(getPageSlice(PDATA, 2, 2), [['c'], ['d']]);
});

T.run('last page (partial) → remaining rows', () => {
  assertEqual(getPageSlice(PDATA, 3, 2), [['e']]);
});

T.run('page beyond data → empty array', () => {
  assertEqual(getPageSlice(PDATA, 99, 2), []);
});

/* ============================================================
   calcTotalPages
   ============================================================ */
T.group('calcTotalPages');

T.run('0 rows → always 1 page', () => {
  assertEqual(calcTotalPages(0, 25), 1);
});

T.run('pageSize = 0 → always 1 page', () => {
  assertEqual(calcTotalPages(10000, 0), 1);
});

T.run('exact multiple → no extra page', () => {
  assertEqual(calcTotalPages(50, 25), 2);
});

T.run('one over a multiple → extra page', () => {
  assertEqual(calcTotalPages(51, 25), 3);
});

T.run('100 rows / 25 per page = 4 pages', () => {
  assertEqual(calcTotalPages(100, 25), 4);
});

T.run('1 row, any page size ≥ 1 → 1 page', () => {
  assertEqual(calcTotalPages(1, 50), 1);
});

/* ============================================================
   escapeCSVField
   ============================================================ */
T.group('escapeCSVField');

T.run('plain value passes through unchanged', () => {
  assertEqual(escapeCSVField('hello'), 'hello');
});

T.run('value with comma is double-quoted', () => {
  assertEqual(escapeCSVField('a,b'), '"a,b"');
});

T.run('value with double-quote → escaped and quoted', () => {
  assertEqual(escapeCSVField('say "hi"'), '"say ""hi"""');
});

T.run('value with LF → quoted', () => {
  assertEqual(escapeCSVField('line1\nline2'), '"line1\nline2"');
});

T.run('value with CR → quoted', () => {
  assertEqual(escapeCSVField('line1\rline2'), '"line1\rline2"');
});

T.run('null → empty string (no crash)', () => {
  assertEqual(escapeCSVField(null), '');
});

T.run('undefined → empty string (no crash)', () => {
  assertEqual(escapeCSVField(undefined), '');
});

T.run('empty string → empty string', () => {
  assertEqual(escapeCSVField(''), '');
});

T.run('number value coerced to string', () => {
  assertEqual(escapeCSVField(42), '42');
});

/* ============================================================
   Integration tests
   ============================================================ */
T.group('Integration');

T.run('full pipeline: parse → build → filter → sort → paginate', () => {
  const csv = 'name,score\nAlice,85\nBob,72\nCharlie,91\nDiana,68\nEve,85';
  const { rows } = parseCSV(csv);
  const { headers, data } = buildData(rows);
  const colTypes = detectColTypes(headers, data);

  // colTypes[1] should be number
  assertEqual(colTypes[1], 'number');

  // filter: score >= ... search for "8" → Alice(85), Charlie(91 no), Eve(85)
  let filtered = filterRows(data, headers, '8', []);
  // "8" appears in Alice(85) Eve(85) and Bob(72? no) → Alice, Bob(no 8? 72 has no 8), Eve, Charlie(91 no)
  // Actually: Alice=85 (has 8), Bob=72 (no 8), Charlie=91 (no 8 but name Charlie has no 8),
  // Diana=68 (has 8), Eve=85 (has 8)
  // So matches: Alice(85), Diana(68), Eve(85)
  assertEqual(filtered.length, 3);

  // sort by score descending
  filtered = sortRows(filtered, 1, 'desc', colTypes);
  assertEqual(filtered[0][0], 'Alice'); // 85 (or Eve, also 85 – stable? no guarantee)
  assert(['Alice', 'Eve'].includes(filtered[0][0]));
  assertEqual(filtered[filtered.length - 1][1], '68');

  // paginate: size 2, page 1 → 2 rows
  const page1 = getPageSlice(filtered, 1, 2);
  assertEqual(page1.length, 2);

  // total pages
  assertEqual(calcTotalPages(filtered.length, 2), 2);
});

T.run('export round-trip: escapeCSVField correctly quoted CSV can be re-parsed', () => {
  const headers = ['name', 'note'];
  const data = [['Alice', 'loves "quotes", and commas'], ['Bob', 'line1\nline2']];

  const lines = [
    headers.map(escapeCSVField).join(','),
    ...data.map(row => row.map(escapeCSVField).join(','))
  ];
  const csvOut = lines.join('\r\n');
  const { rows } = parseCSV(csvOut);
  const rebuilt = buildData(rows);

  assertEqual(rebuilt.headers, headers);
  assertEqual(rebuilt.data[0][1], 'loves "quotes", and commas');
  assertEqual(rebuilt.data[1][1], 'line1\nline2');
});

T.run('detectColTypes handles mixed data gracefully', () => {
  // Column with 8 numbers and 2 strings → 80% threshold: exactly at boundary
  const data = Array.from({ length: 10 }, (_, i) => [i < 8 ? String(i) : 'text']);
  const types = detectColTypes(['c'], data);
  assertEqual(types[0], 'number'); // 8/10 = 80% ≥ 0.8
});

T.run('sortRows + filterRows together: filter then sort is independent of order', () => {
  const data = [
    ['Alice', '50'],
    ['Bob', '10'],
    ['Albert', '30'],
    ['Dave', '20'],
  ];
  const headers = ['name', 'score'];
  const colTypes = { 1: 'number' };

  // Filter names starting with 'al' (Alice, Albert)
  const filtered = filterRows(data, headers, '', ['al', '']);
  assertEqual(filtered.length, 2);

  // Sort by score ascending
  const sorted = sortRows(filtered, 1, 'asc', colTypes);
  assertEqual(sorted[0][0], 'Albert'); // 30
  assertEqual(sorted[1][0], 'Alice');  // 50
});

T.run('parseCSV + buildData: semicolon file with BOM', () => {
  const bom = '\uFEFF';
  const csv = bom + 'id;name;value\r\n1;Alice;100\r\n2;Bob;200';
  const { rows } = parseCSV(csv);
  const { headers, data } = buildData(rows);

  assertEqual(headers, ['id', 'name', 'value']);
  assertEqual(data.length, 2);
  assertEqual(data[1], ['2', 'Bob', '200']);
});

/* ============================================================
   Render results when DOM is ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => T.renderToDOM());
