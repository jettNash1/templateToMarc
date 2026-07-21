const SESSION_VERSION = 1;
const DRAFT_STORAGE_KEY = 'marcliteDraft';
const PRESETS_STORAGE_KEY = 'marcliteBatchPresets';
const CUSTOM_TEMPLATES_STORAGE_KEY = 'marcliteCustomTemplates';

/**
 * @typedef {Object} SessionPayload
 * @property {number} version
 * @property {string} savedAt
 * @property {import('./marc-builder.js').MarcRecord[]} marcRecords
 * @property {import('./file-import.js').ParsedRow[]} parsedRows
 * @property {import('./header-parser.js').ColumnSchema[]} columnSchema
 * @property {number[]} scopedIndices
 * @property {string} recordScopeMode
 * @property {string} scopeRecordTypeFilter
 * @property {number} selectedIndex
 * @property {string} validationProfile
 * @property {Record<string, string>} [columnMappingOverrides]
 */

/**
 * @param {Partial<SessionPayload>} data
 * @returns {SessionPayload}
 */
export function buildSessionPayload(data) {
  return {
    version: SESSION_VERSION,
    savedAt: new Date().toISOString(),
    marcRecords: data.marcRecords ?? [],
    parsedRows: data.parsedRows ?? [],
    columnSchema: data.columnSchema ?? [],
    scopedIndices: data.scopedIndices ?? [],
    recordScopeMode: data.recordScopeMode ?? 'all',
    scopeRecordTypeFilter: data.scopeRecordTypeFilter ?? 'all',
    selectedIndex: data.selectedIndex ?? 0,
    validationProfile: data.validationProfile ?? 'cataloguing',
    columnMappingOverrides: data.columnMappingOverrides ?? {},
  };
}

/**
 * @param {SessionPayload} payload
 * @returns {string}
 */
export function serializeSession(payload) {
  return JSON.stringify(payload, null, 2);
}

/**
 * @param {string} text
 * @returns {SessionPayload}
 */
export function parseSessionFile(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.marcRecords)) {
    throw new Error('Invalid MARCLite session file.');
  }
  return {
    ...buildSessionPayload({}),
    ...parsed,
    version: parsed.version ?? SESSION_VERSION,
  };
}

/**
 * @param {SessionPayload} payload
 * @param {string} [filename]
 */
export function downloadSessionFile(payload, filename = 'session.marclite.json') {
  const blob = new Blob([serializeSession(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {SessionPayload} payload
 * @returns {Promise<void>}
 */
export async function saveDraftToStorage(payload) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: payload });
}

/**
 * @returns {Promise<SessionPayload|null>}
 */
export async function loadDraftFromStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  const result = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  const draft = result[DRAFT_STORAGE_KEY];
  if (!draft || !Array.isArray(draft.marcRecords)) {
    return null;
  }
  return draft;
}

/**
 * @returns {Promise<void>}
 */
export async function clearDraftFromStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.remove(DRAFT_STORAGE_KEY);
}

/**
 * @param {import('./marc-builder.js').MarcRecord} record
 * @returns {string}
 */
export function getRecordIdentityKey(record) {
  const control001 = record.fields?.find((field) => field.type === 'control' && field.tag === '001');
  if (control001?.value) {
    return `001:${control001.value}`;
  }
  return `row:${record.sourceRowNumber ?? 0}:${record.recordType ?? 'bibliographic'}`;
}

/**
 * @param {SessionPayload} draft
 * @param {import('./marc-builder.js').MarcRecord[]} marcRecords
 * @param {(record: import('./marc-builder.js').MarcRecord) => string} recordToText
 * @returns {boolean}
 */
export function draftDiffersFromSession(draft, marcRecords, recordToText) {
  if (marcRecords.length !== draft.marcRecords.length) {
    return true;
  }

  for (let index = 0; index < marcRecords.length; index += 1) {
    if (recordToText(marcRecords[index]) !== recordToText(draft.marcRecords[index])) {
      return true;
    }
  }

  return false;
}

/**
 * @typedef {Object} BatchPreset
 * @property {string} name
 * @property {string} find
 * @property {string} replace
 * @property {string} tagFilter
 * @property {string} subfieldFilter
 * @property {string} targets
 * @property {string} scopeMode
 * @property {string} scopeText
 * @property {string} recordTypeFilter
 */

/**
 * @returns {Promise<BatchPreset[]>}
 */
export async function loadBatchPresets() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return [];
  }
  const result = await chrome.storage.local.get(PRESETS_STORAGE_KEY);
  return Array.isArray(result[PRESETS_STORAGE_KEY]) ? result[PRESETS_STORAGE_KEY] : [];
}

/**
 * @param {BatchPreset[]} presets
 * @returns {Promise<void>}
 */
export async function saveBatchPresets(presets) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [PRESETS_STORAGE_KEY]: presets });
}

/**
 * @typedef {import('./record-templates.js').RecordTemplate} RecordTemplate
 */

/**
 * @returns {Promise<RecordTemplate[]>}
 */
export async function loadCustomTemplates() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return [];
  }
  const result = await chrome.storage.local.get(CUSTOM_TEMPLATES_STORAGE_KEY);
  return Array.isArray(result[CUSTOM_TEMPLATES_STORAGE_KEY]) ? result[CUSTOM_TEMPLATES_STORAGE_KEY] : [];
}

/**
 * @param {RecordTemplate[]} templates
 * @returns {Promise<void>}
 */
export async function saveCustomTemplates(templates) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [CUSTOM_TEMPLATES_STORAGE_KEY]: templates });
}
