# Book Donation to MARC

Convert filled **Book Donation** Excel templates into editable **MARC21** bibliographic records. Upload a workbook, review and adjust fields in the browser, then export as human-readable text, MARCXML, or binary `.mrc`.

All processing happens locally in your browser. No data is sent to a server.

## Features

- Upload `.xlsx` / `.xls` workbooks based on the Book Donation template
- One MARC record per data row (row 2 and below)
- Automatic field mapping for ISBN, authors, title, publication, subjects, series, and notes
- Template punctuation rules applied (commas, periods, colons, semicolons)
- Grouped field editor with optional advanced MARC view
- Live MARC21 preview
- Export all records as:
  - `.txt` — human-readable MARC21
  - `.xml` — MARCXML collection
  - `.mrc` — ISO 2709 binary for bulk ILS import

## Template usage

1. Download the sample template from the extension editor page, or use your organisation’s copy of `BookDonationTemplate.xlsx`.
2. **Do not change row 1** — it defines the column layout and MARC mappings.
3. Enter one book per row starting at **row 2**.
4. Save the workbook and upload it in the extension.

### Column mapping (summary)

| Column | MARC |
|--------|------|
| ISBN | 020 $a |
| Primary Author / Role | 100 $a / $e |
| Secondary Authors / Roles | 700 $a / $e |
| Title | 245 $a |
| Place / Publisher / Date | 264 $a / $b / $c |
| Pages / Height | 300 $a / $c |
| Languages | 546 $a (+ leader language) |
| Series / Series No | 830 $a / $v |
| Subjects | 600, 650, 651 |
| Genre | 655 |
| Note (format) | 500 $a |

Control fields **001**, **005**, **008**, and the **leader** are generated automatically and can be edited before export.

## Install (Chrome / Edge)

### Build

```bash
npm install
npm run build
```

This generates icons, bundles the editor, and outputs a loadable extension in `dist/`.

### Load unpacked

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

Click the extension icon to open the MARC editor in a new tab.

## Development

```bash
npm run dev
```

Rebuilds the extension on file changes. Reload the extension in `chrome://extensions` after each build.

## Project structure

```
templateToMarc/
  manifest.json          # MV3 extension manifest
  src/
    background.js        # Opens editor tab on icon click
    editor/              # Main UI
    lib/                 # XLSX import, MARC builder, export
  public/
    BookDonationTemplate.xlsx
  dist/                  # Build output (load this in the browser)
```

## Export formats

### Human-readable `.txt`

```
=LDR  00000nam a2200000 i 4500
=001  BD202506300001
=245  00$aBook title.$
```

### MARCXML

Standard LOC MARC21 slim schema, wrapped in a `<collection>` element.

### Binary `.mrc`

ISO 2709 encoded records concatenated for batch import into systems that accept `.mrc` files.

## Notes

- The **Note (format)** column (e.g. VHS, CD-ROM) maps to `500 $a` as a general note.
- Language values are mapped to MARC language codes where possible; override in the editor if needed.
- Empty cells are skipped — no MARC field is created for blank template columns.
