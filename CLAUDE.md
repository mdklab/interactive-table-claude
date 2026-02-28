# CLAUDE.md

## Project: CSV → Interactive Table

A zero-dependency, no-build static web app. Drop a CSV file, explore it interactively, export filtered results. Deployable directly to GitHub Pages from the repo root.

## Files
| File | Purpose |
|------|---------|
| `index.html` | App shell — upload zone + table UI |
| `style.css` | All styles (CSS custom properties, responsive) |
| `app.js` | All logic — parser, state, rendering |

## Architecture

Single `state` object is the source of truth. All render functions read from it.

```
state {}               single source of truth
parseCSV()             RFC-4180 parser; auto-detects delimiter; strips BOM
buildData()            rows[] → {headers[], data[]}
detectColTypes()       scans first 500 rows → 'number'|'date'|'string'
applyFiltersAndSort()  populates state.filtered
getPageRows()          slices state.filtered for current page
renderHeader()         <tr id=headerRow> with sort handlers
renderFilterRow()      <tr id=filterRow> with per-column inputs
renderBody()           <tbody> via DocumentFragment
renderPagination()     smart ellipsis page buttons
renderRowInfo()        "N–M of X rows" text
renderAll()            calls all renders + updateStickyTop()
updateStickyTop()      syncs --header-height and --controls-height CSS vars
loadFile()             FileReader → parse → state reset → renderAll()
exportCSV()            Blob download of state.filtered (UTF-8 BOM)
resetToUpload()        clears state, shows upload zone
```

## Features
- Drag & drop or click-to-browse file upload
- RFC-4180 CSV parser with auto-delimiter detection (`, ; \t |`)
- Column type detection (number / date / string) for correct sort order
- Click-to-sort with asc → desc → reset cycle
- Global search across all columns
- Per-column filter inputs (sticky below header)
- Pagination: 25 / 50 / 100 / 250 / All with smart ellipsis
- Export filtered+sorted data as CSV (UTF-8 BOM for Excel)
- "Load new file" button resets all state

## Deployment
Push to `main` → GitHub Settings → Pages → Deploy from branch → main → / (root).
No build step, no CI/CD needed.
