import * as XLSX from 'xlsx';
import { parseHeaders, derivePreviewFields } from './header-parser.js';

/**
 * @typedef {import('./header-parser.js').ColumnSchema} ColumnSchema
 * @typedef {import('./header-parser.js').HeaderParseResult} HeaderParseResult
 */

/**
 * @typedef {Object} ParsedRow
 * @property {number} rowNumber
 * @property {Record<number, string>} values
 * @property {string} previewTitle
 * @property {string} previewAuthor
 */

/**
 * @typedef {Object} ImportResult
 * @property {ColumnSchema[]} columnSchema
 * @property {ParsedRow[]} rows
 * @property {HeaderParseResult['skipped']} skippedColumns
 */

/**
 * @param {ArrayBuffer} buffer
 * @param {string} [filename]
 * @returns {Promise<ImportResult>}
 */
export async function parseFile(buffer, filename = '') {
  const bookType = inferBookType(filename);
  const workbook = XLSX.read(buffer, { type: 'array', ...(bookType ? { bookType } : {}) });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('The file does not contain any sheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });

  if (rows.length < 2) {
    throw new Error('No data rows found. Add records below row 1 in your file.');
  }

  const headerRow = rows[0];
  const { columns, skipped } = parseHeaders(headerRow);

  if (columns.length === 0) {
    throw new Error('No MARC mappings found in row 1 headers. Include MARC notation such as 245//$a or 100/$a.');
  }

  /** @type {ParsedRow[]} */
  const parsedRows = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.every((cell) => String(cell ?? '').trim() === '')) {
      continue;
    }

    /** @type {Record<number, string>} */
    const values = {};

    for (const column of columns) {
      const cellValue = row[column.index];
      if (cellValue == null || String(cellValue).trim() === '') {
        continue;
      }
      values[column.index] = String(cellValue).trim();
    }

    if (Object.keys(values).length === 0) {
      continue;
    }

    const preview = derivePreviewFields(columns, values);

    parsedRows.push({
      rowNumber: rowIndex + 1,
      values,
      previewTitle: preview.previewTitle,
      previewAuthor: preview.previewAuthor,
    });
  }

  if (parsedRows.length === 0) {
    throw new Error('No usable data rows found. Ensure at least one row contains values.');
  }

  return {
    columnSchema: columns,
    rows: parsedRows,
    skippedColumns: skipped,
  };
}

/**
 * @param {string} filename
 * @returns {string|undefined}
 */
function inferBookType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    return 'csv';
  }
  if (lower.endsWith('.xls')) {
    return 'xls';
  }
  if (lower.endsWith('.xlsx')) {
    return 'xlsx';
  }
  return undefined;
}
