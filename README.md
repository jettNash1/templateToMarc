# MARCLite

**Lightweight MARC21 editing in your browser.** MARCLite is a Chrome extension for importing spreadsheets or MARC files, editing records, validating structure, cleaning up metadata, batch-editing collections, and exporting to multiple formats — all locally, with no server.

Click the **MARCLite** toolbar icon to open the editor in a new tab. On `chrome://extensions`, the background **service worker (inactive)** label is normal — Chrome sleeps the worker until you click the icon; you do not need to wait for it.

## Navigation

| Tab | Purpose |
|-----|---------|
| **Convert** | Import files, column mapping, session save/load, draft restore |
| **Edit** | Record list, field editor, templates, validation |
| **Order** | Reorder loaded records (numbers used in scope/export/compare follow this order) |
| **Batch** | Saved presets, find/replace, normalize, delete tag |
| **Cleanup** | Dedupe, punctuation, encoding, ISBN/date normalization |
| **Export** | Scoped export, format choice, preview, URL link check |
| **Compare** | Side-by-side MARC mnemonic comparison of two records |
| **Help** | In-app tutorial, keyboard shortcuts, live statistics |

---

## Convert

- **Single upload** — drop or browse one file; format is detected from the extension
- **Spreadsheets**: CSV, Excel (`.csv`, `.xlsx`, `.xls`) with MARC notation in row 1 headers
- **MARC files**: binary (`.mrc`), mnemonic (`.mrk`, `.txt`), and MARCXML (`.xml`)
- **Column mapping** — review and edit spreadsheet column → MARC notation mappings before import; reorder columns and apply custom notation (e.g. `245//$a`, `650/0$a`)
- Example spreadsheet included (`BookDonationTemplate.xlsx`)

### Sessions & drafts

| Action | What it does |
|--------|----------------|
| **Save session** | Download a portable `.marclite.json` file (records, scope, validation profile, column mapping) |
| **Load session** | Restore from a saved session file |
| **Restore draft** | Reload the auto-saved browser draft. If the current session differs, choose delete new / merge / overwrite / cancel |
| **Clear draft** | Remove the auto-saved draft from browser storage |

MARCLite auto-saves a draft to `chrome.storage.local` as you work (~every 1.5 seconds). Use **Save session** for backups you control.

---

## Edit

### Creating records

- Choose **Record type** (bibliographic, authority, or holdings) and click **New record** for a minimal blank record
- **Save as template** (field editor toolbar) saves the open record’s leader and field layout (001/005 cleared) as a reusable template
- Saved templates appear in the **Template** dropdown for that record type (hidden until you have at least one). Pick a template or leave blank, then **New record**
- **Delete template** removes the selected saved template
- Custom templates persist in browser storage across sessions (same as batch presets); they are not included in `.marclite.json` session files

### Record list

- **Filter** by record type; **Search** by title, author, or tag text
- **Validation profile** — `Cataloguing`, `Strict`, or `Spreadsheet import` (changes which rules apply)
- **Duplicate** — copies scoped/selected records when checkboxes are set; otherwise duplicates the open record. Confirmation for multiple or explicitly selected records; **Undo duplicate** appears after copying
- **Delete** — removes selected records or the open record; confirmation modal
- Checkboxes with **Select all** / **Clear selection** define scope for Batch, Cleanup, and Export
- Virtualized list for large collections; validation badges and coloured borders on affected records

### Field editor

- **Form** view — grouped field cards with tag and indicator controls; inline **field help** per tag
- **Mnemonic** view — raw MARC text editor with **Sync mnemonic** to apply back to the form
- **Segmented Leader and 008 editors** — fixed positions labelled per [LoC MARC21](https://www.loc.gov/marc/) with auto-padding and placeholder codes (`#`, `|`, `u`)
- Field actions: reorder, duplicate, copy, paste, remove; **Add subfield** on data fields
- **Diacritics** button on text inputs — insert common Latin characters and subfield markers
- **Undo** — reverts the last field edit, batch apply, or cleanup apply (up to 10 steps)
- **Save record** — normalizes and re-validates the open record
- Live **MARC21 preview** below the editor
- Edits save automatically to the in-memory session and browser draft

### Validation (Edit tab)

- Continuous validation on import, create, and edit
- **Validation banner** (all tabs) — error count; expand for grouped and individual issues
- One-click **Fix** on supported issues in the banner
- Click any issue to jump to that record and field
- Field highlighting — red for errors, amber for warnings
- Chunked validation for large sets (50+ records) so the list stays responsive on first load

---

## Order

Change the sequence of loaded records after import:

- **Move up** / **Move down**
- **Move to position** — enter a target number and move

Record numbers in batch scope, export, compare, and the record list follow this order.

---

## Batch

### Batch presets

Save and reuse common find/replace setups. Presets store find/replace text, tag/subfield filters, and scope settings. Presets persist in browser storage across sessions.

| Action | What it does |
|--------|----------------|
| **Save preset** | Name and store the current batch form |
| **Load** | Apply a saved preset to the form |
| **Delete** | Remove a saved preset |

### Batch editing

Find/replace across **all parts of a record**:

- Leader
- Control field values and tags
- Data field indicators
- Subfield codes and values

Find text is matched literally by default. Patterns like `\d+`, `[A-Z]+`, or `/pattern/` are treated as regular expressions. Leave **Find** empty with **Tag** and **Subfield** set to replace the entire subfield value in scoped records (**Replace** = new value).

- **Record scope** — all records, custom range/list (`1-75`, `1, 6, 17`), checkboxes in the Edit list, or current record only
- **Record type filter** on scope
- Choose update targets via checkboxes
- **Preview changes** before applying
- **Change log** with per-record diffs; **Undo all** or **Undo record** after apply
- **Normalize all records** and **Delete tag from all** (scoped)

---

## Cleanup

- Remove duplicate fields
- Standardize punctuation
- Fix encoding issues
- Normalize ISBNs and dates
- **Record scope** — all records, custom range/list, or current record only
- **Preview cleanup** before applying
- **Change log** with field-level before/after; **Undo all** or **Undo record**

---

## Export

Dedicated **Export** tab with scoped output:

### Record scope

Same syntax as Batch/Cleanup — all records, custom range/list, or current record only, plus record type filter.

### Export range

| Option | Meaning |
|--------|---------|
| **All records** | Every loaded record |
| **Scoped records above** | Records matching the scope fieldset |
| **Visible in list** | Records matching Edit tab filter + search |

### Formats

- MARC mnemonic (`.mrk`)
- MARC binary (`.mrc`)
- MARCXML (`.xml`)
- Delimited CSV
- JSON
- Dublin Core (XML subset)
- MODS (XML subset)
- BIBFRAME (JSON subset)

**Export preview** shows a truncated sample for text formats; binary `.mrc` shows a size summary.

Optional: **Block export on validation errors**.

**Check URL links** — tests `http(s)` URLs in field 856 `$u` within the export range.

---

## Compare

View two records side by side as MARC mnemonic text:

- Pick **Record A** and **Record B** from dropdowns (`number — title`)
- **Compare** renders both panes
- **Use current record as A** starts from the record open in Edit

---

## Validation

MARCLite validates records **continuously** — on file import, blank record creation, and every edit.

### Profiles

| Profile | Use case |
|---------|----------|
| **Cataloguing** | Balanced rules for day-to-day editing |
| **Strict** | Stricter checks |
| **Spreadsheet import** | Lighter rules suited to spreadsheet-derived records |

### What is checked

| Area | Errors | Warnings |
|------|--------|----------|
| Leader | Must be 24 characters | Unusual characters |
| Control fields (001–009) | Invalid tag, duplicate tag, empty 001 | Empty value, 008 length |
| Data fields (010–999) | Invalid tag, bad indicators, no subfields, invalid subfield code | Unusual indicators, empty subfields, 245 indicator conventions |
| Record type | Missing 001/008 (bibliographic) | Missing 245 `$a`, authority heading, holdings 852 |

### How issues are shown

1. **Top banner** (all tabs) — e.g. `3 validation errors in 2 records — select to view details`
2. **Grouped issues** — identical warnings collapse (e.g. `Records 1–19 · Warning · Empty subfield $0 in field 020`); expand for per-record links and optional **Batch edit** pre-fill
3. **Individual issues** — click navigates to the field
4. **Record list** — badges and coloured borders; checkboxes for scope
5. **Field editor** — red/amber outlines on leader, fields, and subfields
6. **Fix** button on auto-fixable issues in the banner

---

## Record scope syntax

Use **1-based** record numbers in Batch, Cleanup, and Export scope fields:

| Input | Meaning |
|-------|---------|
| *(empty, All records mode)* | Every loaded record |
| `1-75` | Records 1 through 75 |
| `1, 6, 17, 43` | Specific records |
| `1-10, 15, 20-22` | Ranges and lists combined |

Checkboxes in the Edit record list stay in sync with scope text. **Select all** / **Clear selection** update Batch and Cleanup scope fields.

---

## Undo

MARCLite has several undo mechanisms:

| Context | Action | What it does |
|---------|--------|----------------|
| Field editor | **Undo** | Reverts the last edit, batch apply, or cleanup apply (stack of up to 10) |
| Batch / Cleanup | **Undo all** / **Undo record** | Restores snapshots from the last applied operation |
| Duplicate | **Undo duplicate** | Removes records from the last duplicate operation |

Batch/cleanup undo is available until reverted or replaced by a new apply. Manual edits after apply are preserved for records you do not undo.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+S | Save current record |
| Ctrl/Cmd+↑ or Alt+↑ | Previous record in filtered list |
| Ctrl/Cmd+↓ or Alt+↓ | Next record in filtered list |
| Ctrl/Cmd+Enter | Jump to next validation issue in filtered set |
| Escape | Close open modal |

---

## Install

```bash
npm install
npm run build
```

Load the `dist/` folder via **Load unpacked** in `chrome://extensions`.

Share the **`dist`** folder (zipped) with colleagues — no build step required on their end.

### Troubleshooting

- **Service worker (inactive)** on `chrome://extensions` is normal — click the MARCLite icon to wake it and open the editor
- If the icon does nothing: **Reload** the extension on `chrome://extensions`, confirm it is enabled, and that **Load unpacked** points at the `dist/` folder (after `npm run build`)

---

## Spreadsheet headers

Row 1 defines MARC mappings; data rows contain plain values.

```csv
245//$a,100/$a,020//$a
My book title,Smith John,9781234567890
```

Supported notation: `020//$a`, `100/$a`, `1001/$e`, `264/1$a`, `60010$a`, `655 7|a`, etc.

## Control fields vs bibliographic identifiers

| Source | Fields |
|--------|--------|
| Spreadsheet columns | Data fields (020 ISBN, 245 title, 650 subjects, etc.) |
| Auto-generated | 001, 005, 008, leader (editable after import) |

---

## Browser storage

MARCLite stores the following in `chrome.storage.local` (persists across browser restarts):

| Key | Contents |
|-----|----------|
| Auto-save draft | Current records and session settings |
| Batch presets | Saved find/replace setups |
| Custom record templates | User-saved leader/field layouts |

Cleared only when you delete them, clear extension data, or uninstall the extension. **Save session** (`.marclite.json`) is the portable backup for records and settings; custom templates are not yet included in session files.

---

## Limits

MARCLite is a browser-based tool — not a replacement for Alma, Koha, or MarcEdit. Very large batches (thousands of records) may require patience; non-MARC conversions are pragmatic subsets, not full spec round-trips. The Help tab **Statistics** section shows tag frequency and completeness summaries for loaded records.
