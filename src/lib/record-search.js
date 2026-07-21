import { recordToMarcText } from './marc-export.js';
import { recordToParsedRow } from './marc-model.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./file-import.js').ParsedRow} ParsedRow */

/**
 * @param {MarcRecord[]} records
 * @param {ParsedRow[]} parsedRows
 * @param {string} query
 * @returns {number[]}
 */
export function getSearchFilteredIndices(records, parsedRows, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return records.map((_, index) => index);
  }

  return records.reduce((indices, record, index) => {
    const row = parsedRows[index] ?? recordToParsedRow(record);
    const haystack = [
      row.previewTitle,
      row.previewAuthor,
      recordToMarcText(record),
    ].join(' ').toLowerCase();

    if (haystack.includes(normalized)) {
      indices.push(index);
    }
    return indices;
  }, []);
}

/**
 * @param {number[]} typeFilteredIndices
 * @param {number[]} searchFilteredIndices
 * @returns {number[]}
 */
export function intersectRecordIndices(typeFilteredIndices, searchFilteredIndices) {
  const allowed = new Set(typeFilteredIndices);
  return searchFilteredIndices.filter((index) => allowed.has(index));
}
