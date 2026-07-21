import { parseFile } from './file-import.js';
import { importMarcFile } from './marc-import.js';

const SPREADSHEET_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MARC_EXTENSIONS = ['.mrc', '.mrk', '.xml', '.txt'];

/**
 * @typedef {import('./file-import.js').ImportResult} SpreadsheetImportResult
 * @typedef {Awaited<ReturnType<typeof importMarcFile>>} MarcImportResult
 */

/**
 * @returns {string}
 */
export function getImportAcceptAttribute() {
  return [...SPREADSHEET_EXTENSIONS, ...MARC_EXTENSIONS].join(',');
}

/**
 * @param {string} filename
 * @returns {'spreadsheet'|'marc'|null}
 */
export function inferImportType(filename) {
  const lower = filename.toLowerCase();

  if (MARC_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'marc';
  }

  if (SPREADSHEET_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return 'spreadsheet';
  }

  return null;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @returns {Promise<SpreadsheetImportResult | MarcImportResult>}
 */
export async function importUploadedFile(buffer, filename) {
  const importType = inferImportType(filename);

  if (importType === 'marc') {
    return importMarcFile(buffer, filename);
  }

  if (importType === 'spreadsheet') {
    const result = await parseFile(buffer, filename);
    return {
      columnSchema: result.columnSchema,
      skippedColumns: result.skippedColumns,
      parsedRows: result.parsedRows,
    };
  }

  throw new Error(
    'Unsupported file type. Upload a spreadsheet (.csv, .xlsx, .xls) or MARC file (.mrc, .mrk, .xml, .txt).',
  );
}
