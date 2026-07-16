# MARCLite

**Lightweight MARC21 editing in your browser.** Import spreadsheets or MARC files, edit records, validate structure, clean up metadata, batch-edit collections, and export to multiple formats — all locally, with no server.

## Features

### Convert
- **Single upload** — drop or browse one file; format is detected automatically
- **Spreadsheets**: CSV, Excel (`.csv`, `.xlsx`, `.xls`) with MARC notation in row 1 headers
- **MARC files**: binary (`.mrc`), mnemonic (`.mrk`, `.txt`), and MARCXML (`.xml`)
- Example spreadsheet included

### Edit
- Grouped field editor with advanced MARC view
- Create **blank bibliographic, authority, or holdings** records
- **Duplicate** records — duplicates scoped/selected records when checkboxes are set; otherwise duplicates the open record. Multiple or explicitly selected duplicates ask for confirmation; **Undo duplicate** removes the last copy operation.
- Add control or data fields via dialog
- Live MARC21 preview
- **Continuous validation** across all loaded records (import, create, and edit)
- **Validation banner** at the top — shows error count; expand to see grouped and individual issues
- **Record list checkboxes** — select records for batch/cleanup scope (Select all / Clear selection)
- **Field highlighting** — invalid leader, fields, and subfields outlined in red (warnings in amber)
- Click any issue in the banner to jump to that record and field
- Record list badges show error/warning counts per record
- **Export preview** — live sample of the selected export format before download

### Cleanup
- Remove duplicate fields
- Standardize punctuation
- Fix encoding issues
- Normalize ISBNs and dates
- **Record scope** — all records, custom range/list (`1-75`, `1, 6, 17`), or current record only
- **Preview cleanup** before applying
- **Change log** listing each affected record and field-level before/after edits
- **Undo all** or **Undo record** to revert the last applied cleanup

### Batch
- Find/replace across **all parts of a record**:
  - Leader
  - Control field values and tags
  - Data field indicators
  - Subfield codes and values
- Find/replace with automatic literal or regex detection (e.g. `\d+`, `[A-Z]+`, `/pattern/`), plus optional tag and subfield filters
- Choose which targets to update via checkboxes
- **Record scope** — all records, custom range/list (`1-75`, `1, 6, 17`), checkboxes in the Edit tab record list, or current record only
- **Preview changes** before applying
- **Change log** with per-record diffs after apply
- **Undo all** or **Undo record** to revert the last batch operation
- Normalize all records
- Delete a tag from all records

### Export
Single dropdown with formats:
- MARC mnemonic (.mrk)
- MARC binary (.mrc)
- MARCXML (.xml)
- Delimited CSV
- JSON
- Dublin Core (XML subset)
- MODS (XML subset)
- BIBFRAME (JSON subset)

The **Export preview** panel shows a truncated sample of the file content for text-based formats. Binary `.mrc` exports show a size summary instead.

Optional: block export when validation errors exist.

## Validation

MARCLite validates records **continuously** — on file import, blank record creation, and every edit.

### What is checked

| Area | Errors | Warnings |
|------|--------|----------|
| Leader | Must be 24 characters | Unusual characters |
| Control fields (001–009) | Invalid tag, duplicate tag, empty 001 | Empty value, 008 length |
| Data fields (010–999) | Invalid tag, bad indicators, no subfields, invalid subfield code | Unusual indicators, empty subfields, 245 indicator conventions |
| Record type | Missing 001/008 (bibliographic) | Missing 245 $a, authority heading, holdings 852 |

### How issues are shown

1. **Top banner** (all tabs) — e.g. `3 validation errors in 2 records — select to view details`. Click to expand the full list.
2. **Grouped issues** — identical warnings across multiple records collapse into one expandable section (e.g. `Records 1–19 · Warning · Empty subfield $0 in field 020`). Expand to see per-record navigation links and an optional **Batch edit** button that pre-fills scope and filters on the Batch tab.
3. **Individual issues** — unique to one record; click navigates directly to that field.
4. **Record list** — red or amber badge with issue count; coloured left border on affected records; checkboxes for batch/cleanup scope.
5. **Field editor** — red outline on invalid leader, field cards, and subfield rows; red/amber input outlines on specific inputs.
6. **Import status** — upload confirmation notes how many errors or warnings were found.

Click any individual issue, or a per-record link inside an expanded group, to open that record in the Edit tab and scroll to the relevant field.

### Record scope syntax

Use **1-based** record numbers in Batch and Cleanup scope fields:

| Input | Meaning |
|-------|---------|
| *(empty, All records mode)* | Every loaded record |
| `1-75` | Records 1 through 75 |
| `1, 6, 17, 43` | Specific records |
| `1-10, 15, 20-22` | Ranges and lists combined |

Checkboxes in the Edit tab record list stay in sync with scope text. Nothing is selected by default — use checkboxes, **Select all**, or a validation **Batch edit** action to choose records. **Select all** / **Clear selection** update both Batch and Cleanup scope fields.

## Undo after batch and cleanup

After you **Apply** a batch edit or cleanup (not after preview only), MARCLite stores a snapshot of each changed record:

| Action | What it does |
|--------|----------------|
| **Undo all** | Restores every record from the last applied operation |
| **Undo record** | Restores a single record listed in the change log |

Undo is available until all changes from that operation have been reverted or a new batch/cleanup apply replaces the snapshot. Manual edits after apply are preserved for records you do not undo.

## Install

```bash
npm install
npm run build
```

Load the `dist/` folder via **Load unpacked** in `chrome://extensions`.

Share the **`dist`** folder (zipped) with colleagues — no build step required on their end.

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

## Roadmap (completed phases)

- Phase 1: MARCLite rebrand and tab navigation
- Phase 2: MARC import, export dropdown, blank/duplicate records
- Phase 3: Data cleanup tools
- Phase 4: Metadata validation
- Phase 5: Batch editing with full-record find/replace, preview, change log, and undo
- Phase 6: Authority/holdings record types; Dublin Core, MODS, BIBFRAME export subsets

## Limits

MARCLite is a browser-based tool — not a replacement for Alma, Koha, or MarcEdit. Very large batches (thousands of records) may require patience; non-MARC conversions are pragmatic subsets, not full spec round-trips. Undo stores one level of history per tab (the most recent apply only).
