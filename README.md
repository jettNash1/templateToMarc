# CSV to MARC

A browser extension that converts **CSV or Excel** spreadsheets into editable **MARC21** bibliographic records. Put MARC field mappings in row 1 headers, plain values in the rows below, then review, edit, and export.

All processing runs locally in your browser. Nothing is uploaded to a server.

## Features

- Upload `.csv`, `.xlsx`, or `.xls` files with **MARC notation in row 1 headers**
- Dynamic column mapping for any spreadsheet layout
- One MARC record per data row (row 2 and below)
- Optional punctuation rules in headers (`Add ,`, `Add .`, `No punc!`, etc.)
- Grouped field editor with optional advanced MARC view
- **Add MARC fields** via dialog (control or data fields)
- Live MARC21 preview
- Export as human-readable `.txt`, MARCXML `.xml`, or binary `.mrc`

## Identifiers and control fields

There are two different kinds of “identifiers” to be aware of:

### Bibliographic identifier fields (from your spreadsheet)

Fields such as **ISBN (`020 $a`)**, **ISSN (`022`)**, or **other standard MARC tags** are mapped like any other column. If row 1 contains something like `020//$a` and the data row has `9781234567890`, that value becomes the `020 $a` subfield in the exported record.

These **do** come from the header row mapping plus the cell value.

### Record control fields (generated automatically)

These are **not** read from spreadsheet columns today:

| Field | Source |
|-------|--------|
| **Leader (LDR)** | Default bibliographic leader (editable after import) |
| **001** | Auto-generated ID (`BD` + date + row number) |
| **005** | Export timestamp |
| **008** | Derived from publication date, place, and language columns where present |

You can change **001**, **005**, **008**, and the leader in the editor before export, or add extra control fields with **Add MARC field**. To use a spreadsheet value as **001**, edit the generated field after import, or add a control field manually.

## Header format

Row 1 defines how each column maps to MARC. Headers can include a label, MARC notation, and optional punctuation rules.

### Simple CSV example

```csv
245//$a,100/$a,020//$a
A book title,Smith, John,9781234567890
```

### Multi-line Excel headers

```
ISBN            | Main author        | Title
020//$a         | 100/$a             | 245//$a
                | Add ,              | Add .
```

An example spreadsheet (`BookDonationTemplate.xlsx`) is included with the extension.

### Supported MARC notation in headers

| Notation | Meaning |
|----------|---------|
| `020//$a` | Tag 020, blank indicators, subfield `$a` |
| `100/$a` | Tag 100, subfield `$a` |
| `1001/$e` | Tag 100, ind1=`1`, subfield `$e` |
| `264/1$a` | Tag 264, ind2=`1`, subfield `$a` |
| `60010$a` | Tag 600, ind1=`1`, ind2=`0`, subfield `$a` |
| `655 7\|a` | Tag 655, ind2=`7`, subfield `$a` |

Columns without recognizable MARC notation in the header are skipped and listed in the mapping summary after import.

Cell values are **plain text** — not full MARC field strings.

### Merge behaviour

- Same tag and indicators, **different subfields** → one merged field (e.g. `264/1$a`, `264/1$b`, `264/1$c`)
- Same tag, indicators, **and subfield** → separate repeatable fields (e.g. two `650/0$a` columns)
- Author fields (`100`, `700`) require a `$a` value before the field is emitted

## Install (Chrome / Edge)

### Build

```bash
npm install
npm run build
```

Output is written to `dist/`.

### Load unpacked

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

Click the extension icon to open the editor.

### Sharing

Zip the **`dist`** folder and share it. Recipients load it via **Load unpacked** — no build step required.

## Using the editor

1. Upload a CSV or Excel file
2. Review the **column mapping summary**
3. Select a record
4. Edit fields, or enable **Advanced MARC view**
5. Use **Add MARC field** for new control or data fields
6. Export via **Download .txt**, **Download .xml**, or **Download .mrc**

## Export formats

### Human-readable `.txt`

```
=LDR  00000nam a2200000 i 4500
=001  BD202506300002
=020    $a9781234567890
=245  00$aA book title.$
```

### MARCXML

LOC MARC21 slim schema, wrapped in a `<collection>` element.

### Binary `.mrc`

ISO 2709 records concatenated for bulk ILS import.
