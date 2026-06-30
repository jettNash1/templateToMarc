import * as XLSX from 'xlsx';
import { COLUMN_DEFINITIONS } from './template-mapping.js';

/**
 * @typedef {Object} ParsedRow
 * @property {number} rowNumber
 * @property {Record<number, string>} values
 * @property {string} previewTitle
 * @property {string} previewAuthor
 */

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ParsedRow[]>}
 */
export async function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('The workbook does not contain any sheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
  });

  if (rows.length < 2) {
    throw new Error('No data rows found. Add book data below row 1 in the template.');
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

    for (const column of COLUMN_DEFINITIONS) {
      const cellValue = row[column.index];
      if (cellValue == null || String(cellValue).trim() === '') {
        continue;
      }
      values[column.index] = String(cellValue).trim();
    }

    if (Object.keys(values).length === 0) {
      continue;
    }

    parsedRows.push({
      rowNumber: rowIndex + 1,
      values,
      previewTitle: values[7] ?? '(No title)',
      previewAuthor: values[1] ?? '(No author)',
    });
  }

  if (parsedRows.length === 0) {
    throw new Error('No usable data rows found. Ensure at least one row contains book data.');
  }

  return parsedRows;
}
