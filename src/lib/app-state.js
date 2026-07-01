/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./header-parser.js').ColumnSchema} ColumnSchema */
/** @typedef {import('./file-import.js').ParsedRow} ParsedRow */

/**
 * @typedef {Object} AppState
 * @property {MarcRecord[]} marcRecords
 * @property {ParsedRow[]} parsedRows
 * @property {ColumnSchema[]} columnSchema
 * @property {import('./header-parser.js').HeaderParseResult['skipped']} skippedColumns
 * @property {number} selectedIndex
 * @property {boolean} advancedView
 * @property {'bibliographic'|'authority'|'holdings'} defaultRecordType
 */

/** @type {AppState} */
const state = {
  marcRecords: [],
  parsedRows: [],
  columnSchema: [],
  skippedColumns: [],
  selectedIndex: 0,
  advancedView: false,
  defaultRecordType: 'bibliographic',
};

export function getState() {
  return state;
}

/**
 * @param {Partial<AppState>} patch
 */
export function patchState(patch) {
  Object.assign(state, patch);
}

export function hasRecords() {
  return state.marcRecords.length > 0;
}

export function getSelectedRecord() {
  return state.marcRecords[state.selectedIndex] ?? null;
}
