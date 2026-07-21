import { allRecordIndices } from './record-scope.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./header-parser.js').ColumnSchema} ColumnSchema */
/** @typedef {import('./file-import.js').ParsedRow} ParsedRow */

/**
 * @typedef {'all'|'custom'|'current'} RecordScopeMode
 */

/**
 * @typedef {'all'|'bibliographic'|'authority'|'holdings'} ScopeRecordTypeFilter
 */

/**
 * @typedef {Object} AppState
 * @property {MarcRecord[]} marcRecords
 * @property {ParsedRow[]} parsedRows
 * @property {ColumnSchema[]} columnSchema
 * @property {import('./header-parser.js').HeaderParseResult['skipped']} skippedColumns
 * @property {number} selectedIndex
 * @property {'bibliographic'|'authority'|'holdings'} defaultRecordType
 * @property {RecordScopeMode} recordScopeMode
 * @property {Set<number>} scopedRecordIndices
 * @property {ScopeRecordTypeFilter} scopeRecordTypeFilter
 * @property {'cataloguing'|'strict'|'spreadsheet-import'} validationProfile
 * @property {'all'|'scope'|'visible'} exportScopeMode
 * @property {'form'|'mnemonic'} editorViewMode
 * @property {Record<string, string>} columnMappingOverrides
 */

/** @type {AppState} */
const state = {
  marcRecords: [],
  parsedRows: [],
  columnSchema: [],
  skippedColumns: [],
  selectedIndex: 0,
  defaultRecordType: 'bibliographic',
  recordScopeMode: 'custom',
  scopedRecordIndices: new Set(),
  scopeRecordTypeFilter: 'all',
  validationProfile: 'cataloguing',
  exportScopeMode: 'all',
  editorViewMode: 'form',
  columnMappingOverrides: {},
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

/**
 * @returns {number[]}
 */
export function getScopedIndices() {
  if (!hasRecords()) {
    return [];
  }

  if (state.recordScopeMode === 'all') {
    return allRecordIndices(state.marcRecords.length);
  }

  if (state.recordScopeMode === 'current') {
    return [state.selectedIndex];
  }

  return [...state.scopedRecordIndices].sort((a, b) => a - b);
}

/**
 * @param {number[]} indices
 */
export function setScopedIndices(indices) {
  state.scopedRecordIndices = new Set(indices);
  if (indices.length === state.marcRecords.length) {
    state.recordScopeMode = 'all';
  } else {
    state.recordScopeMode = 'custom';
  }
}

export function clearScope() {
  state.scopedRecordIndices = new Set();
  state.recordScopeMode = 'custom';
}

/**
 * @param {RecordScopeMode} mode
 */
export function setRecordScopeMode(mode) {
  state.recordScopeMode = mode;
  if (mode === 'all') {
    state.scopedRecordIndices = new Set(allRecordIndices(state.marcRecords.length));
  } else if (mode === 'current') {
    state.scopedRecordIndices = new Set([state.selectedIndex]);
  }
}

/**
 * @param {number} index
 * @param {boolean} selected
 */
export function toggleScopedRecord(index, selected) {
  const next = new Set(state.scopedRecordIndices);
  if (selected) {
    next.add(index);
  } else {
    next.delete(index);
  }
  state.scopedRecordIndices = next;
  state.recordScopeMode = next.size > 0 && next.size === state.marcRecords.length ? 'all' : 'custom';
}
