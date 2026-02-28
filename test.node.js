'use strict';
// Node.js test runner for pure functions in lib.js
// Usage: node test.node.js

const fs = require('fs');
eval(fs.readFileSync(__dirname + '/lib.js', 'utf8'));

/* ===== Minimal runner ===== */
let passed = 0, failed = 0;

function t(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('  \u2713 ' + name + '\n');
  } catch (e) {
    failed++;
    process.stdout.write('  \u2717 ' + name + '\n    ' + e.message.replace(/\n/g, '\n    ') + '\n');
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + '\n' : '') + 'expected: ' + e + '\nactual:   ' + a);
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

/* ===== parseCSV ===== */
console.log('\nparseCSV');

t('comma delimiter — basic 2x3', () => {
  const { rows, delim } = parseCSV('a,b,c\n1,2,3');
  eq(delim, ',');
  eq(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

t('semicolon delimiter auto-detected', () => {
  const { rows, delim } = parseCSV('a;b;c\n1;2;3');
  eq(delim, ';');
  eq(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

t('tab delimiter auto-detected', () => {
  const { rows, delim } = parseCSV('a\tb\tc\n1\t2\t3');
  eq(delim, '\t');
  eq(rows[0], ['a', 'b', 'c']);
  eq(rows[1], ['1', '2', '3']);
});

t('pipe delimiter auto-detected', () => {
  const { delim } = parseCSV('a|b|c\n1|2|3');
  eq(delim, '|');
});

t('quoted fields preserve internal whitespace', () => {
  const { rows } = parseCSV('"hello world","  spaced  "\nfoo,bar');
  eq(rows[0], ['hello world', '  spaced  ']);
});

t('escaped double-quotes inside quoted field', () => {
  const { rows } = parseCSV('"he said ""hi""","ok"\nval,val2');
  eq(rows[0][0], 'he said "hi"');
  eq(rows[0][1], 'ok');
});

t('UTF-8 BOM stripped', () => {
  const { rows } = parseCSV('\uFEFFa,b\n1,2');
  eq(rows[0], ['a', 'b']);
  eq(rows.length, 2);
});

t('CRLF line endings', () => {
  const { rows } = parseCSV('a,b,c\r\n1,2,3\r\n4,5,6');
  eq(rows.length, 3);
  eq(rows[2], ['4', '5', '6']);
});

t('empty (unquoted) fields produce empty strings', () => {
  const { rows } = parseCSV('a,,c\n1,,3');
  eq(rows[0], ['a', '', 'c']);
  eq(rows[1], ['1', '', '3']);
});

t('empty quoted field', () => {
  const { rows } = parseCSV('"","b"\n"","d"');
  eq(rows[0][0], '');
  eq(rows[0][1], 'b');
});

t('delimiter inside quoted field is not split', () => {
  const { rows } = parseCSV('"a,b",c\n"1,2",3');
  eq(rows[0], ['a,b', 'c']);
  eq(rows[1], ['1,2', '3']);
});

t('newline inside quoted field — treated as single row', () => {
  const { rows } = parseCSV('"line1\nline2",after');
  eq(rows.length, 1);
  eq(rows[0][0], 'line1\nline2');
  eq(rows[0][1], 'after');
});

t('trailing newline does not produce empty row', () => {
  const { rows } = parseCSV('a,b\n1,2\n');
  eq(rows.length, 2);
});

t('completely empty string returns empty rows', () => {
  eq(parseCSV('').rows, []);
});

t('single column, multiple rows', () => {
  const { rows } = parseCSV('name\nAlice\nBob');
  eq(rows.length, 3);
  eq(rows[1], ['Alice']);
});

t('unquoted fields are trimmed', () => {
  const { rows } = parseCSV('  a  ,  b  \n  1  ,  2  ');
  eq(rows[0], ['a', 'b']);
  eq(rows[1], ['1', '2']);
});

/* ===== buildData ===== */
console.log('\nbuildData');

t('normal rows → headers + data split', () => {
  const { headers, data } = buildData([['id', 'name'], ['1', 'Alice'], ['2', 'Bob']]);
  eq(headers, ['id', 'name']);
  eq(data.length, 2);
  eq(data[0], ['1', 'Alice']);
});

t('empty rows array → empty headers and data', () => {
  const { headers, data } = buildData([]);
  eq(headers, []);
  eq(data, []);
});

t('missing header value → auto-named "Column N"', () => {
  const { headers } = buildData([['', 'b', ''], ['1', '2', '3']]);
  eq(headers[0], 'Column 1');
  eq(headers[1], 'b');
  eq(headers[2], 'Column 3');
});

t('headers-only (no data rows) → data is empty array', () => {
  const { headers, data } = buildData([['a', 'b', 'c']]);
  eq(headers, ['a', 'b', 'c']);
  eq(data, []);
});

/* ===== detectColTypes ===== */
console.log('\ndetectColTypes');

t('all integers → number', () => {
  eq(detectColTypes(['n'], [['1'], ['2'], ['3'], ['42']])[0], 'number');
});

t('all decimals → number', () => {
  eq(detectColTypes(['n'], [['1.5'], ['2.7'], ['-3.14']])[0], 'number');
});

t('all ISO dates → date', () => {
  eq(detectColTypes(['d'], [['2023-01-01'], ['2023-06-15'], ['2024-12-31']])[0], 'date');
});

t('all plain strings → string', () => {
  eq(detectColTypes(['s'], [['hello'], ['world'], ['foo'], ['bar']])[0], 'string');
});

t('>=80% numbers (with empty cells) → number', () => {
  const data = [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], [''], ['']];
  eq(detectColTypes(['n'], data)[0], 'number');
});

t('<80% numbers → string', () => {
  const data = [['1'], ['2'], ['3'], ['x'], ['y'], ['z'], ['a'], ['b']]; // 3/8 = 37.5%
  eq(detectColTypes(['n'], data)[0], 'string');
});

t('numbers with comma separators → number', () => {
  eq(detectColTypes(['n'], [['1,000'], ['2,500'], ['10,000']])[0], 'number');
});

t('all-empty column → string', () => {
  eq(detectColTypes(['e'], [[''], [''], ['']])[0], 'string');
});

t('multiple columns typed independently', () => {
  const data = [['1', 'hello', '2023-01-01'], ['2', 'world', '2023-06-15']];
  const types = detectColTypes(['num', 'str', 'date'], data);
  eq(types[0], 'number');
  eq(types[1], 'string');
  eq(types[2], 'date');
});

/* ===== filterRows ===== */
console.log('\nfilterRows');

const FDATA = [
  ['Alice', '30', 'Engineer'],
  ['Bob', '25', 'Designer'],
  ['Charlie', '35', 'Engineer'],
  ['Diana', '28', 'Manager'],
];
const FHEADERS = ['name', 'age', 'role'];

t('no filters → all rows returned', () => {
  eq(filterRows(FDATA, FHEADERS, '', []).length, 4);
});

t('global search — matching rows returned', () => {
  const result = filterRows(FDATA, FHEADERS, 'alice', []);
  eq(result.length, 1);
  eq(result[0][0], 'Alice');
});

t('global search — no match → empty', () => {
  eq(filterRows(FDATA, FHEADERS, 'zzz', []).length, 0);
});

t('global search is case-insensitive', () => {
  eq(filterRows(FDATA, FHEADERS, 'ENGINEER', []).length, 2);
});

t('global search matches partial cell value', () => {
  const result = filterRows(FDATA, FHEADERS, 'ob', []);
  eq(result.length, 1);
  eq(result[0][0], 'Bob');
});

t('per-column filter — match on name column', () => {
  const result = filterRows(FDATA, FHEADERS, '', ['ali', '', '']);
  eq(result.length, 1);
  eq(result[0][0], 'Alice');
});

t('per-column filter — no match → empty', () => {
  eq(filterRows(FDATA, FHEADERS, '', ['xyz', '', '']).length, 0);
});

t('multiple per-column filters — AND logic', () => {
  const result = filterRows(FDATA, FHEADERS, '', ['', '', 'engineer']);
  eq(result.length, 2);
  result.forEach(r => ok(r[2] === 'Engineer'));
});

t('global search + column filter combined', () => {
  eq(filterRows(FDATA, FHEADERS, 'engineer', ['ali', '', '']).length, 1);
});

t('null/undefined cells treated as empty string', () => {
  const data = [[null, 'visible'], [undefined, 'also']];
  const result = filterRows(data, ['a', 'b'], 'visible', []);
  eq(result.length, 1);
});

t('null colFilters treated as empty', () => {
  eq(filterRows(FDATA, FHEADERS, '', null).length, 4);
});

/* ===== sortRows ===== */
console.log('\nsortRows');

const SDATA = [
  ['Charlie', '35', '2020-03-01'],
  ['Alice',   '10', '2022-01-15'],
  ['Bob',     '200', '2019-07-04'],
  ['Diana',   '1',  '2023-12-31'],
];

t('sortDir "none" → original order unchanged', () => {
  const result = sortRows(SDATA, 0, 'none', {});
  eq(result[0][0], 'Charlie');
  eq(result[3][0], 'Diana');
});

t('sortCol -1 → original order unchanged', () => {
  const result = sortRows(SDATA, -1, 'asc', {});
  eq(result[0][0], 'Charlie');
});

t('string column ascending (locale-aware)', () => {
  const result = sortRows(SDATA, 0, 'asc', { 0: 'string' });
  eq(result[0][0], 'Alice');
  eq(result[3][0], 'Diana');
});

t('string column descending', () => {
  const result = sortRows(SDATA, 0, 'desc', { 0: 'string' });
  eq(result[0][0], 'Diana');
  eq(result[3][0], 'Alice');
});

t('number column ascending (numeric, not lexicographic)', () => {
  const result = sortRows(SDATA, 1, 'asc', { 1: 'number' });
  eq(result[0][1], '1');
  eq(result[1][1], '10');
  eq(result[2][1], '35');
  eq(result[3][1], '200');
});

t('number column descending', () => {
  const result = sortRows(SDATA, 1, 'desc', { 1: 'number' });
  eq(result[0][1], '200');
  eq(result[3][1], '1');
});

t('date column ascending', () => {
  const result = sortRows(SDATA, 2, 'asc', { 2: 'date' });
  eq(result[0][2], '2019-07-04');
  eq(result[3][2], '2023-12-31');
});

t('date column descending', () => {
  const result = sortRows(SDATA, 2, 'desc', { 2: 'date' });
  eq(result[0][2], '2023-12-31');
  eq(result[3][2], '2019-07-04');
});

t('empty values sort to start on number asc (−Infinity)', () => {
  const data = [['5'], [''], ['3'], ['']];
  const result = sortRows(data, 0, 'asc', { 0: 'number' });
  eq(result[0][0], '');
  eq(result[1][0], '');
  eq(result[2][0], '3');
  eq(result[3][0], '5');
});

t('numeric string sort: "10" > "9" (locale numeric)', () => {
  const data = [['10'], ['9'], ['2'], ['100']];
  const result = sortRows(data, 0, 'asc', { 0: 'string' });
  eq(result[0][0], '2');
  eq(result[1][0], '9');
  eq(result[2][0], '10');
  eq(result[3][0], '100');
});

t('does not mutate input array', () => {
  const orig = [['b'], ['a'], ['c']];
  const firstRow = orig[0];
  sortRows(orig, 0, 'asc', { 0: 'string' });
  ok(orig[0] === firstRow, 'original array was mutated');
});

/* ===== buildPageList ===== */
console.log('\nbuildPageList');

t('total <= 7 → plain list without ellipsis', () => {
  eq(buildPageList(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  eq(buildPageList(4, 5), [1, 2, 3, 4, 5]);
  eq(buildPageList(1, 1), [1]);
});

t('total = 8, cur = 1 → ellipsis before last', () => {
  eq(buildPageList(1, 8), [1, 2, '…', 8]);
});

t('total = 20, cur = 1', () => {
  eq(buildPageList(1, 20), [1, 2, '…', 20]);
});

t('total = 20, cur = 10 (middle) → both ellipses', () => {
  eq(buildPageList(10, 20), [1, '…', 9, 10, 11, '…', 20]);
});

t('total = 20, cur = 3 → no left ellipsis', () => {
  eq(buildPageList(3, 20), [1, 2, 3, 4, '…', 20]);
});

t('total = 20, cur = 18 → no right ellipsis', () => {
  eq(buildPageList(18, 20), [1, '…', 17, 18, 19, 20]);
});

t('total = 20, cur = 20 (last page)', () => {
  eq(buildPageList(20, 20), [1, '…', 19, 20]);
});

t('no consecutive ellipsis markers', () => {
  for (let cur = 1; cur <= 20; cur++) {
    const list = buildPageList(cur, 20);
    for (let i = 1; i < list.length; i++) {
      ok(!(list[i] === '…' && list[i - 1] === '…'), `consecutive ellipsis at cur=${cur}`);
    }
  }
});

/* ===== getPageSlice ===== */
console.log('\ngetPageSlice');

const PDATA = [['a'], ['b'], ['c'], ['d'], ['e']];

t('pageSize = 0 → returns all rows', () => {
  eq(getPageSlice(PDATA, 1, 0).length, 5);
});

t('page 1, size 2 → first two rows', () => {
  eq(getPageSlice(PDATA, 1, 2), [['a'], ['b']]);
});

t('page 2, size 2 → rows 3-4', () => {
  eq(getPageSlice(PDATA, 2, 2), [['c'], ['d']]);
});

t('last page (partial) → remaining rows', () => {
  eq(getPageSlice(PDATA, 3, 2), [['e']]);
});

t('page beyond data → empty array', () => {
  eq(getPageSlice(PDATA, 99, 2), []);
});

/* ===== calcTotalPages ===== */
console.log('\ncalcTotalPages');

t('0 rows → 1 page', () => {
  eq(calcTotalPages(0, 25), 1);
});

t('pageSize = 0 → 1 page', () => {
  eq(calcTotalPages(10000, 0), 1);
});

t('exact multiple → no extra page', () => {
  eq(calcTotalPages(50, 25), 2);
});

t('one over a multiple → extra page', () => {
  eq(calcTotalPages(51, 25), 3);
});

t('100 rows / 25 per page = 4 pages', () => {
  eq(calcTotalPages(100, 25), 4);
});

t('1 row, size 50 → 1 page', () => {
  eq(calcTotalPages(1, 50), 1);
});

/* ===== escapeCSVField ===== */
console.log('\nescapeCSVField');

t('plain value passes through unchanged', () => {
  eq(escapeCSVField('hello'), 'hello');
});

t('value with comma is double-quoted', () => {
  eq(escapeCSVField('a,b'), '"a,b"');
});

t('value with double-quote → escaped and wrapped', () => {
  eq(escapeCSVField('say "hi"'), '"say ""hi"""');
});

t('value with LF → quoted', () => {
  eq(escapeCSVField('line1\nline2'), '"line1\nline2"');
});

t('value with CR → quoted', () => {
  eq(escapeCSVField('line1\rline2'), '"line1\rline2"');
});

t('null → empty string', () => {
  eq(escapeCSVField(null), '');
});

t('undefined → empty string', () => {
  eq(escapeCSVField(undefined), '');
});

t('empty string passthrough', () => {
  eq(escapeCSVField(''), '');
});

t('number coerced to string', () => {
  eq(escapeCSVField(42), '42');
});

/* ===== Integration ===== */
console.log('\nIntegration');

t('full pipeline: parse → build → filter → sort → paginate', () => {
  const { rows } = parseCSV('name,score\nAlice,85\nBob,72\nCharlie,91\nDiana,68\nEve,85');
  const { headers, data } = buildData(rows);
  const ct = detectColTypes(headers, data);
  eq(ct[1], 'number');

  // "8" appears in: Alice(85)=yes, Bob(72)=no, Charlie(91)=no, Diana(68)=yes, Eve(85)=yes
  let filtered = filterRows(data, headers, '8', []);
  eq(filtered.length, 3);

  filtered = sortRows(filtered, 1, 'desc', ct);
  eq(filtered[filtered.length - 1][1], '68'); // Diana last (lowest)

  eq(getPageSlice(filtered, 1, 2).length, 2);
  eq(calcTotalPages(filtered.length, 2), 2);
});

t('export round-trip: escape → re-parse produces identical data', () => {
  const headers = ['name', 'note'];
  const data = [
    ['Alice', 'loves "quotes", and commas'],
    ['Bob', 'line1\nline2'],
  ];
  const lines = [
    headers.map(escapeCSVField).join(','),
    ...data.map(row => row.map(escapeCSVField).join(',')),
  ];
  const { rows } = parseCSV(lines.join('\r\n'));
  const rebuilt = buildData(rows);
  eq(rebuilt.headers, headers);
  eq(rebuilt.data[0][1], 'loves "quotes", and commas');
  eq(rebuilt.data[1][1], 'line1\nline2');
});

t('semicolon + BOM file end-to-end', () => {
  const csv = '\uFEFFid;name;value\r\n1;Alice;100\r\n2;Bob;200';
  const { rows } = parseCSV(csv);
  const { headers, data } = buildData(rows);
  eq(headers, ['id', 'name', 'value']);
  eq(data.length, 2);
  eq(data[1], ['2', 'Bob', '200']);
});

t('filter + sort independence', () => {
  const data = [['Alice', '50'], ['Bob', '10'], ['Albert', '30'], ['Dave', '20']];
  const headers = ['name', 'score'];
  const ct = { 1: 'number' };
  const filtered = filterRows(data, headers, '', ['al', '']);
  eq(filtered.length, 2);
  const sorted = sortRows(filtered, 1, 'asc', ct);
  eq(sorted[0][0], 'Albert'); // 30
  eq(sorted[1][0], 'Alice');  // 50
});

t('exactly 80% threshold → number', () => {
  // 8 numbers + 2 empty → 8/8 non-empty = 100% number
  // 8 numbers + 2 strings → 8/10 = 80% → number
  const data = Array.from({ length: 10 }, (_, i) => [i < 8 ? String(i) : 'text']);
  const types = detectColTypes(['c'], data);
  eq(types[0], 'number'); // 8/10 = 80% meets threshold
});

/* ===== Summary ===== */
console.log('\n' + '─'.repeat(44));
const total = passed + failed;
if (failed === 0) {
  console.log(`\u2713 All ${total} tests passed`);
} else {
  console.log(`\u2717 ${failed} failed, ${passed} passed (${total} total)`);
  process.exitCode = 1;
}
