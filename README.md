# MARCLite

**Lightweight MARC21 editing in your browser.** Import spreadsheets or MARC files, edit records, validate structure, clean up metadata, batch-edit collections, and export to multiple formats — all locally, with no server.

## Features

### Convert
- Import **CSV/Excel** with MARC notation in row 1 headers
- Import **MARC binary (.mrc)**, **mnemonic (.mrk)**, and **MARCXML (.xml)**
- Example spreadsheet included

### Edit
- Grouped field editor with advanced MARC view
- Create **blank bibliographic, authority, or holdings** records
- **Duplicate** records
- Add control or data fields via dialog
- Live MARC21 preview
- **Validation** panel (structure, indicators, required fields)
- **Export preview** — live sample of the selected export format before download

### Cleanup
- Remove duplicate fields
- Standardize punctuation
- Fix encoding issues
- Normalize ISBNs and dates
- Apply to selected record or all records
- **Preview cleanup** before applying
- **Change log** listing each affected record and field-level before/after edits
- **Undo all** or **Undo record** to revert the last applied cleanup

### Batch
- Find/replace across **all parts of a record**:
  - Leader
  - Control field values and tags
  - Data field indicators
  - Subfield codes and values
- Optional regex, tag filter, and subfield filter
- Choose which targets to update via checkboxes
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
