import { importUploadedFile } from '../lib/unified-import.js';
import {
  buildMarcRecords,
  cloneMarcRecord,
  collectFieldGroups,
  createControlField,
  createDataField,
  isProtectedControlTag,
} from '../lib/marc-builder.js';
import { inferFieldGroup } from '../lib/header-parser.js';
import { exportRecords, previewExport } from '../lib/marc-export.js';
import { recordToMarcText } from '../lib/marc-export.js';
import { createBlankRecord, getRecordPreview, recordToParsedRow } from '../lib/marc-model.js';
import {
  buildRecordFromTemplate,
  createTemplateFromRecord,
  findTemplateBySelectValue,
  getCustomTemplatesForRecordType,
  isCustomTemplateSelectValue,
  toTemplateSelectValue,
} from '../lib/record-templates.js';
import { cleanupRecordWithOptions } from '../lib/marc-cleanup.js';
import {
  validateAllRecords,
  validateRecordAtIndex,
  summarizeValidation,
  getRecordIssues,
  hasValidationErrors,
  groupValidationIssues,
} from '../lib/marc-validate.js';
import { batchFindReplace, batchDeleteTag, batchNormalize, batchSetSubfieldValue, batchSetFieldValue, DEFAULT_BATCH_TARGETS } from '../lib/batch-edit.js';
import { diffMarcRecords, summarizeChangeLog } from '../lib/marc-diff.js';
import {
  initRoadmapFeatures,
  getVisibleRecordIndices as composeVisibleIndices,
  createFieldHelpPanel,
  attachDiacriticsButton,
  renderVirtualRecordList,
} from './editor-roadmap.js';
import { initColumnMappingUI } from './column-mapping-ui.js';
import { validateRecordsChunked } from '../lib/chunked-validation.js';
import {
  getState,
  patchState,
  hasRecords,
  getScopedIndices,
  setScopedIndices,
  clearScope,
  setRecordScopeMode,
  toggleScopedRecord,
} from '../lib/app-state.js';
import { formatRecordRanges, parseRecordScope } from '../lib/record-scope.js';
import {
  getActiveValidationIssues,
  getWarningTypeDismissKey,
  isIssueDismissed,
  pruneDismissedWarnings,
} from '../lib/validation-dismiss.js';
import { loadCustomTemplates, loadDismissedWarnings, saveCustomTemplates, saveDismissedWarnings } from '../lib/session-storage.js';
import { buildDefault008, createFixedFieldEditor, getLeaderDefinition, getField008Definition, normalizeControlFieldValue, normalizeMarcRecord, normalizeMarcRecords, padFixedField, shouldUseSegmentedFixedField } from '../lib/marc-fixed-field.js';

/** @typedef {import('../lib/marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('../lib/marc-builder.js').MarcField} MarcField */
/** @typedef {import('../lib/marc-builder.js').MarcDataField} MarcDataField */

const state = getState();

/** @type {'all'|'bibliographic'|'authority'|'holdings'} */
let recordListFilter = 'all';

let recordSearchQuery = '';

/** @type {ReturnType<typeof initRoadmapFeatures>|null} */
let roadmapApi = null;

/**
 * @typedef {{ snapshots: Map<number, MarcRecord>, summaries: import('../lib/marc-diff.js').RecordChangeSummary[] }} UndoState
 */

/** @type {UndoState|null} */
let batchUndoState = null;

/** @type {UndoState|null} */
let cleanupUndoState = null;

/**
 * @typedef {{ addedIndices: number[], previousSelectedIndex: number }} DuplicateUndoState
 */

/** @type {DuplicateUndoState|null} */
let duplicateUndoState = null;

/** @type {import('../lib/marc-validate.js').ValidationIssue[]} */
let allValidationIssues = [];

/** @type {Set<string>} */
let dismissedWarningKeys = new Set();

let showDismissedWarnings = false;

const navTabs = document.querySelectorAll('.nav-tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const uploadStatus = document.getElementById('upload-status');
const mappingSummary = document.getElementById('mapping-summary');
const mappingSummaryText = document.getElementById('mapping-summary-text');
const mappingSkippedList = document.getElementById('mapping-skipped-list');
const editEmpty = document.getElementById('edit-empty');
const workspace = document.getElementById('workspace');
const recordList = document.getElementById('record-list');
const recordCount = document.getElementById('record-count');
const selectedRecordMeta = document.getElementById('selected-record-meta');
const leaderEditor = document.getElementById('leader-editor');
const fieldEditor = document.getElementById('field-editor');
const marcPreview = document.getElementById('marc-preview');
const validationBanner = document.getElementById('validation-banner');
const validationBannerToggle = document.getElementById('validation-banner-toggle');
const validationBannerSummary = document.getElementById('validation-banner-summary');
const validationBannerList = document.getElementById('validation-banner-list');
const validationShowDismissed = document.getElementById('validation-show-dismissed');
const validationBannerControls = document.getElementById('validation-banner-controls');
const exportFormat = document.getElementById('export-format');
const exportPreview = document.getElementById('export-preview');
const blockInvalidExport = document.getElementById('block-invalid-export');
const addFieldModal = document.getElementById('add-field-modal');
const addFieldForm = document.getElementById('add-field-form');
const addFieldTagInput = document.getElementById('add-field-tag');
const addFieldIndicatorsInput = document.getElementById('add-field-indicators');
const addFieldDataOptions = document.getElementById('add-field-data-options');
const addFieldControlOptions = document.getElementById('add-field-control-options');
const addFieldControlValueInput = document.getElementById('add-field-control-value');
const addFieldSubfieldsContainer = document.getElementById('add-field-subfields');
const addFieldError = document.getElementById('add-field-error');
const deleteRecordsModal = document.getElementById('delete-records-modal');
const deleteRecordsMessage = document.getElementById('delete-records-message');

/** @type {number[]|null} */
let pendingDeleteIndices = null;

function switchTab(tabId) {
  navTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
}

navTabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab ?? 'convert'));
});

document.querySelectorAll('.help-toc a').forEach((link) => {
  link.addEventListener('click', () => {
    const targetId = link.getAttribute('href');
    const target = targetId ? document.querySelector(targetId) : null;
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
    }
  });
});

function setStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle('error', isError);
}

function loadImportResult(result, filename) {
  const parsedRows = result.parsedRows ?? result.rows ?? [];
  const records = normalizeMarcRecords(
    (result.records ?? buildMarcRecords(parsedRows, result.columnSchema).map(cloneMarcRecord)),
  );

  patchState({
    columnSchema: result.columnSchema,
    skippedColumns: result.skippedColumns,
    parsedRows,
    marcRecords: records,
    selectedIndex: 0,
  });
  clearScope();
  clearDuplicateUndo();

  renderMappingSummary();
  return refreshEditView().then(() => {
    const { errors, warnings } = summarizeValidation(allValidationIssues);
    const validationNote = errors > 0
      ? ` ${errors} validation error${errors === 1 ? '' : 's'} found.`
      : warnings > 0
        ? ` ${warnings} validation warning${warnings === 1 ? '' : 's'} found.`
        : '';
    setStatus(`Loaded ${state.marcRecords.length} record${state.marcRecords.length === 1 ? '' : 's'} from ${filename}.${validationNote}`);
    switchTab('edit');
  });
}

function renderMappingSummary() {
  if (state.columnSchema.length === 0) {
    mappingSummary.classList.add('hidden');
    return;
  }

  mappingSummary.classList.remove('hidden');
  mappingSummaryText.textContent = `Parsed ${state.columnSchema.length} MARC column${state.columnSchema.length === 1 ? '' : 's'}${
    state.skippedColumns.length > 0 ? `, skipped ${state.skippedColumns.length} without MARC notation` : ''
  }.`;
  mappingSkippedList.innerHTML = '';
  state.skippedColumns.forEach((skipped) => {
    const item = document.createElement('li');
    item.textContent = skipped.label;
    mappingSkippedList.append(item);
  });
}

function refreshEditView() {
  if (!hasRecords()) {
    editEmpty.classList.remove('hidden');
    workspace.classList.add('hidden');
    allValidationIssues = [];
    renderValidationBanner();
    refreshExportPreview();
    return Promise.resolve();
  }

  editEmpty.classList.add('hidden');
  workspace.classList.remove('hidden');
  syncScopeFieldsets();
  populateCompareRecordSelects();
  renderRecordOrderList();

  const finishEditRefresh = () => {
    renderRecordList();
    renderRecordListValidationBadges();
    renderEditor(state.marcRecords[state.selectedIndex]);
    applyValidationHighlights(state.selectedIndex);
    roadmapApi?.scheduleDraftSave?.();
    roadmapApi?.updateLinkCheckButtonLabel?.();
  };

  if (state.marcRecords.length > 50) {
    return validateAllRecordsAsync().then(finishEditRefresh);
  }

  allValidationIssues = validateAllRecords(state.marcRecords, state.validationProfile);
  afterValidationUpdated();
  finishEditRefresh();
  return Promise.resolve();
}

function refreshRecordsAfterBulkEdit() {
  if (!hasRecords()) {
    allValidationIssues = [];
    renderValidationBanner();
    return Promise.resolve();
  }

  syncScopeFieldsets();
  populateCompareRecordSelects();
  renderRecordOrderList();

  const finish = () => {
    renderRecordList();
    if (state.selectedIndex >= 0 && state.selectedIndex < state.marcRecords.length) {
      renderEditor(state.marcRecords[state.selectedIndex]);
    } else {
      renderRecordListValidationBadges();
      applyValidationHighlights(state.selectedIndex);
    }
    refreshExportPreview();
    flashAutosaveStatus();
    roadmapApi?.scheduleDraftSave?.();
    roadmapApi?.updateLinkCheckButtonLabel?.();
  };

  if (state.marcRecords.length > 50) {
    return validateAllRecordsAsync().then(finish);
  }

  allValidationIssues = validateAllRecords(state.marcRecords, state.validationProfile);
  afterValidationUpdated();
  finish();
  return Promise.resolve();
}

async function validateAllRecordsAsync() {
  if (!hasRecords()) {
    allValidationIssues = [];
    renderValidationBanner();
    return;
  }

  validationBannerSummary.textContent = 'Validating records…';
  validationBanner.classList.remove('hidden');

  allValidationIssues = await validateRecordsChunked(
    state.marcRecords,
    (record, index) => Promise.resolve(validateRecordAtIndex(record, index, state.validationProfile)),
    25,
    (done, total) => {
      validationBannerSummary.textContent = `Validating records ${done}/${total}…`;
    },
  ).then((chunkIssues) => chunkIssues.flat());

  afterValidationUpdated();
}

async function refreshExportPreview() {
  if (!exportPreview) {
    return;
  }

  if (!hasRecords()) {
    exportPreview.textContent = 'Load records to preview export output.';
    return;
  }

  try {
    const records = roadmapApi?.getExportRecords?.() ?? state.marcRecords;
    exportPreview.textContent = await previewExport(records, exportFormat.value);
  } catch (error) {
    exportPreview.textContent = error instanceof Error ? error.message : 'Unable to preview export.';
  }
}

function getRecordType(record) {
  return record.recordType ?? 'bibliographic';
}

/**
 * @returns {number[]}
 */
function getFilteredRecordIndices() {
  if (recordListFilter === 'all') {
    return state.marcRecords.map((_, index) => index);
  }

  return state.marcRecords.reduce((indices, record, index) => {
    if (getRecordType(record) === recordListFilter) {
      indices.push(index);
    }
    return indices;
  }, []);
}

/**
 * @returns {number[]}
 */
function getVisibleRecordIndices() {
  return composeVisibleIndices(
    recordSearchQuery,
    state.marcRecords,
    state.parsedRows,
    getFilteredRecordIndices(),
  );
}

/**
 * @returns {import('../lib/marc-validate.js').ValidationIssue[]}
 */
function getVisibleValidationIssuesForDisplay() {
  const visibleIndices = new Set(getVisibleRecordIndices());
  return allValidationIssues.filter((issue) => visibleIndices.has(issue.recordIndex ?? -1));
}

/**
 * Active visible issues (dismissed warnings excluded) for counts, navigation, and highlights.
 * @returns {import('../lib/marc-validate.js').ValidationIssue[]}
 */
function getVisibleValidationIssues() {
  return getActiveValidationIssues(getVisibleValidationIssuesForDisplay(), dismissedWarningKeys);
}

/**
 * @param {number} recordIndex
 * @returns {import('../lib/marc-validate.js').ValidationIssue[]}
 */
function getRecordActiveIssues(recordIndex) {
  return getActiveValidationIssues(getRecordIssues(allValidationIssues, recordIndex), dismissedWarningKeys);
}

async function persistDismissedWarnings() {
  await saveDismissedWarnings([...dismissedWarningKeys]);
}

function syncDismissedWarningsAfterValidation() {
  if (pruneDismissedWarnings(dismissedWarningKeys, allValidationIssues)) {
    persistDismissedWarnings();
  }
}

function afterValidationUpdated() {
  syncDismissedWarningsAfterValidation();
  renderValidationBanner();
}

async function dismissWarningType(warningTypeKey) {
  if (!warningTypeKey) {
    return;
  }
  dismissedWarningKeys.add(warningTypeKey);
  await persistDismissedWarnings();
  renderValidationBanner();
  renderRecordListValidationBadges();
  if (state.selectedIndex >= 0) {
    applyValidationHighlights(state.selectedIndex);
  }
}

async function restoreWarningType(warningTypeKey) {
  if (!warningTypeKey) {
    return;
  }
  dismissedWarningKeys.delete(warningTypeKey);
  await persistDismissedWarnings();
  renderValidationBanner();
  renderRecordListValidationBadges();
  if (state.selectedIndex >= 0) {
    applyValidationHighlights(state.selectedIndex);
  }
}

async function dismissWarning(issue) {
  if (issue.level !== 'warning') {
    return;
  }
  await dismissWarningType(getWarningTypeDismissKey(issue));
}

async function restoreDismissedWarning(issue) {
  await restoreWarningType(getWarningTypeDismissKey(issue));
}

/**
 * @param {import('../lib/marc-validate.js').ValidationIssue} issue
 * @param {{ dismissed?: boolean }} [options]
 * @returns {HTMLDivElement}
 */
function createValidationDismissActions(issue, options = {}) {
  const actions = document.createElement('div');
  actions.className = 'validation-banner-issue-actions';

  if (issue.level !== 'warning') {
    return actions;
  }

  const button = document.createElement('button');
  button.type = 'button';

  if (options.dismissed) {
    button.className = 'secondary validation-banner-restore';
    button.textContent = 'Restore warning';
    button.setAttribute('aria-label', `Restore warning: ${issue.message}`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      restoreDismissedWarning(issue);
    });
  } else {
    button.className = 'secondary validation-banner-dismiss';
    button.textContent = 'Dismiss warning';
    button.setAttribute('aria-label', `Dismiss warning everywhere: ${issue.message}`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      dismissWarning(issue);
    });
  }

  actions.append(button);
  return actions;
}

/**
 * @param {import('../lib/marc-validate.js').ValidationIssue[]} _issues
 * @param {import('../lib/marc-validate.js').GroupedValidationIssue} group
 * @returns {Promise<void>}
 */
async function dismissWarningGroup(group) {
  const warningTypeKey = group.issueKey ?? group.message;
  await dismissWarningType(warningTypeKey);
}

function getRecordListFilterLabel() {
  if (recordListFilter === 'all') {
    return '';
  }

  return recordListFilter.charAt(0).toUpperCase() + recordListFilter.slice(1);
}

/**
 * @returns {string}
 */
function getScopeRecordTypeFilterLabel() {
  if (state.scopeRecordTypeFilter === 'all') {
    return '';
  }

  return state.scopeRecordTypeFilter.charAt(0).toUpperCase() + state.scopeRecordTypeFilter.slice(1);
}

/**
 * @param {number[]} indices
 * @returns {number[]}
 */
function filterIndicesByRecordType(indices) {
  if (state.scopeRecordTypeFilter === 'all') {
    return indices;
  }

  return indices.filter((index) => getRecordType(state.marcRecords[index]) === state.scopeRecordTypeFilter);
}

/**
 * @param {number[]} indices
 * @returns {string}
 */
function formatScopeStatusMessage(indices) {
  const typeLabel = getScopeRecordTypeFilterLabel();
  const rangeLabel = `Records ${formatRecordRanges(indices)}`;
  if (!typeLabel) {
    return rangeLabel;
  }

  return `${rangeLabel} (${typeLabel.toLowerCase()} only)`;
}

/**
 * @returns {string}
 */
function getEmptyScopeMessage() {
  const typeLabel = getScopeRecordTypeFilterLabel();
  if (typeLabel) {
    return `No ${typeLabel.toLowerCase()} records in scope.`;
  }
  return 'No records in scope.';
}

function updateRecordCountBadge() {
  const total = state.marcRecords.length;
  const visible = getVisibleRecordIndices();

  if ((recordListFilter === 'all' && !recordSearchQuery.trim()) || visible.length === total) {
    recordCount.textContent = `${total} record${total === 1 ? '' : 's'}`;
    return;
  }

  recordCount.textContent = `${visible.length} of ${total}`;
}

function buildRecordListItem(index) {
  const record = state.marcRecords[index];
  const row = state.parsedRows[index] ?? recordToParsedRow(record);
  const preview = getRecordPreview(record);
  const item = document.createElement('li');
  item.className = 'record-item';
  item.dataset.recordIndex = String(index);
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(index === state.selectedIndex));
  item.tabIndex = 0;

  const scopeLabel = document.createElement('label');
  scopeLabel.className = 'record-item-scope';
  const scopeCheckbox = document.createElement('input');
  scopeCheckbox.type = 'checkbox';
  scopeCheckbox.className = 'record-scope-checkbox';
  scopeCheckbox.dataset.recordIndex = String(index);
  scopeCheckbox.checked = state.scopedRecordIndices.has(index);
  scopeCheckbox.setAttribute('aria-label', `Include record ${index + 1} in batch scope`);
  scopeLabel.append(scopeCheckbox);

  const content = document.createElement('div');
  content.className = 'record-item-content';
  content.innerHTML = `
    <div class="record-item-title">${escapeHtml(row.previewTitle ?? preview.title)}</div>
    <div class="record-item-author">${escapeHtml(row.previewAuthor ?? preview.author)}</div>
    <div class="record-item-row">Row ${record.sourceRowNumber} · ${record.recordType ?? 'bibliographic'}</div>
  `;

  item.append(scopeLabel, content);

  const recordIssues = getRecordActiveIssues(index);
  const errorCount = recordIssues.filter((issue) => issue.level === 'error').length;
  const warningCount = recordIssues.filter((issue) => issue.level === 'warning').length;
  if (errorCount > 0) {
    item.classList.add('record-item-has-errors');
    const badge = document.createElement('span');
    badge.className = 'record-validation-badge error';
    badge.textContent = String(errorCount);
    badge.setAttribute('aria-label', `${errorCount} validation errors`);
    item.querySelector('.record-item-title')?.append(badge);
  } else if (warningCount > 0) {
    item.classList.add('record-item-has-warnings');
    const badge = document.createElement('span');
    badge.className = 'record-validation-badge warning';
    badge.textContent = String(warningCount);
    badge.setAttribute('aria-label', `${warningCount} validation warnings`);
    item.querySelector('.record-item-title')?.append(badge);
  }

  scopeCheckbox.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  scopeCheckbox.addEventListener('change', (event) => {
    event.stopPropagation();
    toggleScopedRecord(index, event.target.checked);
    syncScopeFieldsets();
  });

  const activate = () => selectRecord(index);
  item.addEventListener('click', activate);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
  return item;
}

function renderRecordList() {
  recordList.innerHTML = '';
  updateRecordCountBadge();
  const filteredIndices = getVisibleRecordIndices();

  if (filteredIndices.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'record-list-empty';
    emptyItem.textContent = recordSearchQuery.trim()
      ? 'No records match this search and filter.'
      : `No ${recordListFilter === 'all' ? '' : `${recordListFilter} `}records match this filter.`;
    recordList.append(emptyItem);
    updateScopeSelectionBadge();
    return;
  }

  if (filteredIndices.length > 30) {
    renderVirtualRecordList(recordList, filteredIndices, buildRecordListItem);
  } else {
    filteredIndices.forEach((index) => {
      recordList.append(buildRecordListItem(index));
    });
  }

  updateScopeSelectionBadge();
}

function selectRecord(index) {
  if (index < 0 || index >= state.marcRecords.length) return;
  patchState({ selectedIndex: index });
  if (state.recordScopeMode === 'current') {
    setRecordScopeMode('current');
    syncScopeFieldsets();
  }
  renderRecordList();
  renderEditor(state.marcRecords[index]);
  refreshValidationUI();
}

/**
 * @param {1|-1} direction
 */
function selectRelativeRecord(direction) {
  const visibleIndices = getVisibleRecordIndices();
  if (visibleIndices.length === 0) {
    return;
  }

  const currentPosition = visibleIndices.indexOf(state.selectedIndex);
  if (currentPosition === -1) {
    selectRecord(direction === 1 ? visibleIndices[0] : visibleIndices[visibleIndices.length - 1]);
    return;
  }

  const nextPosition = currentPosition + direction;
  if (nextPosition >= 0 && nextPosition < visibleIndices.length) {
    selectRecord(visibleIndices[nextPosition]);
  }
}

function handleRecordListFilterChange() {
  const filterSelect = document.getElementById('record-type-filter');
  if (!(filterSelect instanceof HTMLSelectElement)) {
    return;
  }

  recordListFilter = filterSelect.value;
  const visibleIndices = getVisibleRecordIndices();

  if (visibleIndices.length > 0 && !visibleIndices.includes(state.selectedIndex)) {
    selectRecord(visibleIndices[0]);
    renderValidationBanner();
    return;
  }

  renderRecordList();
  renderValidationBanner();
}

function getFieldGroup(field) {
  if (field.type === 'control') return 'Control';
  return field.group ?? inferFieldGroup(field.tag);
}

/**
 * MARC indicators are two single-character positions shown together as "10", "00", etc.
 * @param {string} ind1
 * @param {string} ind2
 * @returns {string}
 */
function formatMarcIndicators(ind1, ind2) {
  return `${(ind1 || ' ').slice(0, 1)}${(ind2 || ' ').slice(0, 1)}`;
}

/**
 * Show blank indicators as an empty field so the input is editable without selecting first.
 * @param {string} ind1
 * @param {string} ind2
 * @returns {string}
 */
function formatMarcIndicatorsForDisplay(ind1, ind2) {
  const pair = formatMarcIndicators(ind1, ind2);
  if (/^\s*$/.test(pair)) {
    return '';
  }
  return pair.trimEnd();
}

/**
 * @param {string} code
 * @returns {string}
 */
function formatSubfieldCodeForDisplay(code) {
  const normalized = String(code ?? '').trim();
  if (!normalized || normalized === ' ') {
    return '';
  }
  return normalized;
}

/**
 * @param {{ code: string }} subfield
 * @param {string} text
 */
function applySubfieldCode(subfield, text) {
  const normalized = String(text ?? '').slice(-1);
  subfield.code = normalized.trim() ? normalized.toLowerCase() : '';
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeSubfieldCode(text) {
  const match = String(text ?? '').match(/[a-z0-9]/i);
  return match ? match[0].toLowerCase() : 'a';
}

/**
 * @param {MarcDataField} field
 * @param {string} text
 */
function applyMarcIndicators(field, text) {
  const normalized = String(text ?? '').padEnd(2, ' ').slice(0, 2);
  field.ind1 = normalized.charAt(0);
  field.ind2 = normalized.charAt(1);
}

/** Persist the current in-memory record, refresh validation, preview, and list badges. */
let commitRecordChangeTimer = null;

/** @type {{ index: number, snapshot: MarcRecord }|null} */
let recordEditBaseline = null;

let recordEditUndoPushed = false;

function resetRecordEditTracking(recordIndex) {
  const record = state.marcRecords[recordIndex];
  if (!record) {
    recordEditBaseline = null;
    recordEditUndoPushed = false;
    return;
  }

  recordEditBaseline = {
    index: recordIndex,
    snapshot: cloneMarcRecord(record),
  };
  recordEditUndoPushed = false;
}

function maybePushRecordEditUndo(recordIndex) {
  if (recordEditUndoPushed || !recordEditBaseline || recordEditBaseline.index !== recordIndex) {
    return;
  }

  const current = state.marcRecords[recordIndex];
  if (!current) {
    return;
  }

  if (recordToMarcText(recordEditBaseline.snapshot) === recordToMarcText(current)) {
    return;
  }

  roadmapApi?.pushUndo?.(
    `Edit record ${recordIndex + 1}`,
    new Map([[recordIndex, cloneMarcRecord(recordEditBaseline.snapshot)]]),
  );
  recordEditUndoPushed = true;
}

/**
 * @param {MarcRecord} record
 * @param {boolean} [immediate]
 */
function commitRecordChange(record, immediate = false) {
  const run = () => {
    normalizeMarcRecord(record);
    maybePushRecordEditUndo(state.selectedIndex);
    state.parsedRows[state.selectedIndex] = recordToParsedRow(record);
    marcPreview.textContent = recordToMarcText(record);
    refreshExportPreview();
    allValidationIssues = validateAllRecords(state.marcRecords, state.validationProfile);
    afterValidationUpdated();
    renderRecordListValidationBadges();
    applyValidationHighlights(state.selectedIndex);
    flashAutosaveStatus();
    roadmapApi?.scheduleDraftSave?.();
  };

  if (immediate) {
    clearTimeout(commitRecordChangeTimer);
    run();
    return;
  }

  clearTimeout(commitRecordChangeTimer);
  commitRecordChangeTimer = setTimeout(run, 250);
}

function getHighestIssueLevel(issues) {
  if (issues.some((issue) => issue.level === 'error')) {
    return 'error';
  }
  if (issues.some((issue) => issue.level === 'warning')) {
    return 'warning';
  }
  return null;
}

function getIssuesForLeader(recordIssues) {
  return recordIssues.filter((issue) => issue.path === 'leader');
}

function updateScopeSelectionBadge() {
  const badge = document.getElementById('scope-selection-badge');
  if (!badge || !hasRecords()) {
    return;
  }

  if (state.recordScopeMode === 'all') {
    badge.textContent = `${state.marcRecords.length} selected for batch`;
    return;
  }

  if (state.recordScopeMode === 'current') {
    badge.textContent = '1 selected for batch';
    return;
  }

  badge.textContent = `${state.scopedRecordIndices.size} selected for batch`;
}

function syncRecordListCheckboxes() {
  const scopedIndices = state.scopedRecordIndices;
  recordList.querySelectorAll('.record-scope-checkbox').forEach((checkbox) => {
    const index = Number(checkbox.dataset.recordIndex);
    checkbox.checked = scopedIndices.has(index);
  });
  updateScopeSelectionBadge();
}

function syncScopeFieldsets() {
  const mode = state.recordScopeMode;
  const scopeText = mode === 'all'
    ? ''
    : formatRecordRanges(getScopedIndices());

  document.querySelectorAll('.record-scope-fieldset').forEach((fieldset) => {
    fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.checked = radio.value === mode;
    });

    const textInput = fieldset.querySelector('.scope-text-input');
    if (textInput instanceof HTMLInputElement) {
      textInput.value = scopeText;
      textInput.disabled = mode !== 'custom';
    }
  });

  document.querySelectorAll('.scope-type-filter').forEach((select) => {
    if (select instanceof HTMLSelectElement) {
      select.value = state.scopeRecordTypeFilter;
    }
  });

  syncRecordListCheckboxes();
}

/**
 * @param {'batch'|'cleanup'} panel
 * @returns {string|null}
 */
function applyScopeFromText(panel) {
  const input = panel === 'cleanup'
    ? document.getElementById('cleanup-scope-text')
    : panel === 'export'
      ? document.getElementById('export-scope-text')
      : document.getElementById('batch-scope-text');

  if (!(input instanceof HTMLInputElement) || !hasRecords()) {
    return 'Load records first.';
  }

  const parsed = parseRecordScope(input.value, state.marcRecords.length);
  if (parsed.error) {
    return parsed.error;
  }

  setScopedIndices(parsed.indices);
  setRecordScopeMode('custom');
  input.value = formatRecordRanges(parsed.indices);
  syncScopeFieldsets();
  return null;
}

/**
 * @returns {number[]}
 */
function getRecordActionIndices() {
  const scoped = getScopedIndices();
  if (scoped.length > 0) {
    return scoped;
  }

  return hasRecords() ? [state.selectedIndex] : [];
}

/**
 * @returns {number[]}
 */
function getRecordsToDelete() {
  if (state.scopedRecordIndices.size > 0) {
    return [...state.scopedRecordIndices].sort((a, b) => a - b);
  }

  return hasRecords() ? [state.selectedIndex] : [];
}

/**
 * @param {number[]} indices
 * @returns {string}
 */
function getDeleteConfirmMessage(indices) {
  if (indices.length === 1) {
    const record = state.marcRecords[indices[0]];
    const row = state.parsedRows[indices[0]] ?? recordToParsedRow(record);
    const preview = getRecordPreview(record);
    const title = row.previewTitle ?? preview.title ?? 'Untitled';
    return `Delete record ${indices[0] + 1} (“${title}”)?`;
  }

  return `Delete ${indices.length} selected records (Records ${formatRecordRanges(indices)})?`;
}

/**
 * @param {number[]} deletedIndices
 * @param {number} previousSelectedIndex
 * @returns {number}
 */
function computeSelectedIndexAfterDelete(deletedIndices, previousSelectedIndex) {
  const remainingCount = state.marcRecords.length;
  if (remainingCount === 0) {
    return 0;
  }

  const deletedSet = new Set(deletedIndices);
  const deletedBefore = deletedIndices.filter((index) => index < previousSelectedIndex).length;

  if (!deletedSet.has(previousSelectedIndex)) {
    return previousSelectedIndex - deletedBefore;
  }

  const candidate = previousSelectedIndex - deletedBefore;
  return Math.max(0, Math.min(candidate, remainingCount - 1));
}

/**
 * @param {number[]} indices
 */
function deleteRecordsAtIndices(indices) {
  const previousSelectedIndex = state.selectedIndex;

  [...indices].sort((a, b) => b - a).forEach((index) => {
    state.marcRecords.splice(index, 1);
    state.parsedRows.splice(index, 1);
  });

  clearScope();
  clearDuplicateUndo();
  batchUndoState = null;
  cleanupUndoState = null;
  document.getElementById('batch-undo-all')?.classList.add('hidden');
  document.getElementById('cleanup-undo-all')?.classList.add('hidden');

  if (state.marcRecords.length === 0) {
    patchState({ selectedIndex: 0 });
    refreshEditView();
    return;
  }

  patchState({
    selectedIndex: computeSelectedIndexAfterDelete(indices, previousSelectedIndex),
  });
  refreshEditView();
}

function openDeleteRecordsModal(indices) {
  if (!deleteRecordsModal || !deleteRecordsMessage) {
    return;
  }

  pendingDeleteIndices = indices;
  deleteRecordsMessage.textContent = getDeleteConfirmMessage(indices);
  deleteRecordsModal.classList.remove('hidden');
  document.getElementById('confirm-delete-records')?.focus();
}

function closeDeleteRecordsModal() {
  pendingDeleteIndices = null;
  deleteRecordsModal?.classList.add('hidden');
}

function requestDeleteRecords() {
  const indices = getRecordsToDelete();
  if (indices.length === 0) {
    return;
  }

  openDeleteRecordsModal(indices);
}

function setDuplicateStatus(message) {
  const row = document.getElementById('duplicate-status');
  const text = document.getElementById('duplicate-status-text');
  if (!row || !text) {
    return;
  }

  if (!message) {
    text.textContent = '';
    row.classList.add('hidden');
    return;
  }

  text.textContent = message;
  row.classList.remove('hidden');
}

function updateDuplicateUndoUI() {
  if (!duplicateUndoState) {
    setDuplicateStatus('');
  }
}

function clearDuplicateUndo() {
  duplicateUndoState = null;
  setDuplicateStatus('');
}

/**
 * @param {number[]} indicesToDuplicate
 * @returns {string}
 */
function getDuplicateConfirmMessage(indicesToDuplicate) {
  const count = indicesToDuplicate.length;
  if (count === 1) {
    return `Duplicate record ${indicesToDuplicate[0] + 1}? A copy will be added at the end of the list.`;
  }

  return `Duplicate ${count} records (Records ${formatRecordRanges(indicesToDuplicate)})? ${count} copies will be added at the end of the list.`;
}

/**
 * @param {number[]} indicesToDuplicate
 * @returns {boolean}
 */
function shouldConfirmDuplicate(indicesToDuplicate) {
  return indicesToDuplicate.length > 1 || state.scopedRecordIndices.size > 0;
}

/**
 * @param {number[]} indicesToDuplicate
 */
function performDuplicate(indicesToDuplicate) {
  const previousSelectedIndex = state.selectedIndex;
  const firstNewIndex = state.marcRecords.length;
  const copies = [];
  const copyRows = [];

  indicesToDuplicate.forEach((index) => {
    const source = state.marcRecords[index];
    if (!source) {
      return;
    }

    const copy = cloneMarcRecord(source);
    copy.sourceRowNumber = state.marcRecords.length + copies.length + 1;
    copies.push(copy);
    copyRows.push(recordToParsedRow(copy));
  });

  if (copies.length === 0) {
    return;
  }

  state.marcRecords.push(...copies);
  state.parsedRows.push(...copyRows);
  duplicateUndoState = {
    addedIndices: copies.map((_, copyIndex) => firstNewIndex + copyIndex),
    previousSelectedIndex,
  };

  patchState({ selectedIndex: firstNewIndex });
  const countLabel = copies.length === 1 ? '1 record' : `${copies.length} records`;
  setDuplicateStatus(`Duplicated ${countLabel}.`);
  refreshEditView();
}

function undoDuplicate() {
  if (!duplicateUndoState) {
    return;
  }

  const { addedIndices, previousSelectedIndex } = duplicateUndoState;
  [...addedIndices].sort((a, b) => b - a).forEach((index) => {
    state.marcRecords.splice(index, 1);
    state.parsedRows.splice(index, 1);
  });

  const nextSelectedIndex = state.marcRecords.length === 0
    ? 0
    : Math.min(previousSelectedIndex, state.marcRecords.length - 1);
  patchState({ selectedIndex: nextSelectedIndex });
  clearDuplicateUndo();
  refreshEditView();
}

/**
 * @param {import('../lib/app-state.js').RecordScopeMode} mode
 */
function handleScopeModeChange(mode) {
  setRecordScopeMode(mode);
  syncScopeFieldsets();
}

/**
 * @param {HTMLElement} statusEl
 * @param {'batch'|'cleanup'} panel
 * @returns {number[]|null}
 */
function getScopeIndicesOrError(statusEl, panel = 'batch') {
  if (!hasRecords()) {
    statusEl.textContent = 'Load records first.';
    return null;
  }

  const scopeInput = panel === 'cleanup'
    ? document.getElementById('cleanup-scope-text')
    : panel === 'export'
      ? document.getElementById('export-scope-text')
      : document.getElementById('batch-scope-text');

  const hasScopeText = scopeInput instanceof HTMLInputElement && scopeInput.value.trim().length > 0;

  if (state.recordScopeMode === 'custom' || hasScopeText) {
    const scopeError = applyScopeFromText(panel);
    if (scopeError) {
      statusEl.textContent = scopeError;
      return null;
    }
  }

  const indices = filterIndicesByRecordType(getScopedIndices());
  if (indices.length === 0) {
    statusEl.textContent = getEmptyScopeMessage();
    return null;
  }

  return indices;
}

/**
 * @param {MarcRecord[]} before
 * @param {MarcRecord[]} after
 * @param {number[]} indices
 * @returns {import('../lib/marc-diff.js').RecordChangeSummary[]}
 */
function diffScopedRecords(before, after, indices) {
  const scopedBefore = indices.map((index) => before[index]);
  const scopedAfter = indices.map((index) => after[index]);
  const scopedRows = indices.map((index) => state.parsedRows[index]);

  return diffMarcRecords(scopedBefore, scopedAfter, scopedRows).map((summary, summaryIndex) => ({
    ...summary,
    recordIndex: indices[summaryIndex],
  }));
}

/**
 * @param {import('../lib/marc-validate.js').GroupedValidationIssue} group
 */
function prefillBatchFromGroupedIssue(group) {
  setScopedIndices(group.recordIndices);
  setRecordScopeMode('custom');
  syncScopeFieldsets();

  document.getElementById('batch-find').value = '';
  document.getElementById('batch-replace').value = '';
  document.getElementById('batch-tag').value = group.tag ?? '';
  document.getElementById('batch-subfield').value = group.subfieldCode ?? '';
  document.getElementById('batch-set-tag').value = group.tag ?? '';
  document.getElementById('batch-set-subfield').value = group.subfieldCode ?? '';
  document.getElementById('batch-set-value').value = '';

  const issueKey = group.issueKey ?? '';
  const useSetValue = issueKey === '245-indicators'
    || issueKey.startsWith('indicator')
    || issueKey.startsWith('empty-control')
    || issueKey.startsWith('008-length')
    || issueKey.startsWith('leader');

  if (useSetValue) {
    setBatchOperationMode('set-value');
    const setPartSelect = document.getElementById('batch-set-part');
    if (issueKey.startsWith('leader')) {
      if (setPartSelect instanceof HTMLSelectElement) {
        setPartSelect.value = 'leader';
      }
      document.getElementById('batch-set-tag').value = '';
    } else if (issueKey.startsWith('empty-control') || issueKey.startsWith('008-length')) {
      if (setPartSelect instanceof HTMLSelectElement) {
        setPartSelect.value = 'control-value';
      }
    } else {
      if (setPartSelect instanceof HTMLSelectElement) {
        setPartSelect.value = 'indicators';
      }
      if (issueKey === '245-indicators' && !group.tag) {
        document.getElementById('batch-set-tag').value = '245';
      }
    }
    syncBatchOperationUI();
  } else {
    setBatchOperationMode('find-replace');
    const targets = { ...DEFAULT_BATCH_TARGETS };

    if (issueKey.startsWith('empty-subfield')) {
      targets.leader = false;
      targets.controlTags = false;
      targets.controlValues = false;
      targets.indicators = false;
      targets.subfieldCodes = false;
      targets.subfieldValues = true;
      const setPartSelect = document.getElementById('batch-set-part');
      setBatchOperationMode('set-value');
      if (setPartSelect instanceof HTMLSelectElement) {
        setPartSelect.value = 'subfield-value';
      }
      syncBatchOperationUI();
    } else if (issueKey.startsWith('invalid-subfield-code')) {
      targets.leader = false;
      targets.controlTags = false;
      targets.controlValues = false;
      targets.indicators = false;
      targets.subfieldCodes = false;
      targets.subfieldValues = false;
      const setPartSelect = document.getElementById('batch-set-part');
      setBatchOperationMode('set-value');
      if (setPartSelect instanceof HTMLSelectElement) {
        setPartSelect.value = 'remove-subfield';
      }
      syncBatchOperationUI();
    } else if (issueKey.startsWith('duplicate-control') || issueKey.startsWith('empty-001')) {
      targets.leader = false;
      targets.controlTags = issueKey.startsWith('duplicate-control');
      targets.controlValues = true;
      targets.indicators = false;
      targets.subfieldCodes = false;
      targets.subfieldValues = false;
    }

    document.getElementById('batch-target-leader').checked = targets.leader;
    document.getElementById('batch-target-control-values').checked = targets.controlValues;
    document.getElementById('batch-target-control-tags').checked = targets.controlTags;
    document.getElementById('batch-target-indicators').checked = targets.indicators;
    document.getElementById('batch-target-subfield-codes').checked = targets.subfieldCodes;
    document.getElementById('batch-target-subfield-values').checked = targets.subfieldValues;
  }

  const statusEl = document.getElementById('batch-status');
  const scopeLabel = formatRecordRanges(group.recordIndices);
  let message = `Batch tab pre-filled for Records ${scopeLabel}`;
  if (group.tag) {
    message += ` — tag ${group.tag}`;
  }
  if (group.subfieldCode) {
    message += `, subfield $${group.subfieldCode}`;
  }
  if (useSetValue || issueKey.startsWith('empty-subfield')) {
    message += '. Choose a value and preview or apply.';
  }
  statusEl.textContent = `${message}.`;

  switchTab('batch');
}

function navigateToIssue(issue) {
  if (issue.recordIndex == null) {
    return;
  }

  selectRecord(issue.recordIndex);
  switchTab('edit');

  window.requestAnimationFrame(() => {
    if (issue.path === 'leader') {
      leaderEditor.querySelector('.leader-input')?.focus();
      leaderEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (issue.fieldIndex != null) {
      const fieldCard = fieldEditor.querySelector(`[data-field-index="${issue.fieldIndex}"]`);
      if (fieldCard) {
        fieldCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (issue.subfieldIndex != null) {
          const subfieldRow = fieldCard.querySelector(`[data-subfield-index="${issue.subfieldIndex}"]`);
          subfieldRow?.querySelector('input')?.focus();
        } else if (issue.path?.includes('indicators')) {
          fieldCard.querySelector('.field-indicators-input')?.focus();
        } else if (issue.path?.includes('tag')) {
          fieldCard.querySelector('.field-tag-input')?.focus();
        } else {
          fieldCard.querySelector('input')?.focus();
        }
      }
    }
  });
}

let validationIssueCursor = 0;

function navigateToNextValidationIssue() {
  const visibleIssues = getVisibleValidationIssues();
  if (visibleIssues.length === 0) {
    return;
  }
  validationIssueCursor = (validationIssueCursor + 1) % visibleIssues.length;
  navigateToIssue(visibleIssues[validationIssueCursor]);
}

/**
 * @param {string} issueKey
 * @returns {string}
 */
function getIssueFixHint(issueKey) {
  if (issueKey.startsWith('indicator') || issueKey === '245-indicators') {
    return 'How to fix: edit the Indicators field on the field card (two characters, e.g. 10 or 00), or use Batch → Set field value with tag 245 and Indicators.';
  }
  if (issueKey.startsWith('leader')) {
    return 'How to fix: edit the Leader segments at the top of the field editor (Edit tab).';
  }
  if (issueKey === 'leader-008-mismatch') {
    return 'How to fix: align Leader position 07 (type of record) with 008 position 00 (type of material), or dismiss if the mismatch is intentional for your cataloguing practice.';
  }
  if (issueKey === '008-length') {
    return 'How to fix: edit the 008 segment inputs on its field card in the field editor.';
  }
  if (issueKey === 'empty-001' || issueKey.startsWith('empty-control')) {
    return 'How to fix: type a value into the control field\u2019s Value input in the field editor.';
  }
  if (issueKey.startsWith('empty-subfield')) {
    return 'How to fix: fill in the empty subfield value on the field card, or remove the subfield with its Remove button.';
  }
  if (issueKey.startsWith('invalid-subfield-code')) {
    return 'How to fix: correct the Code input (single letter or digit) next to the subfield value on the field card, or use Batch → Set field value → Remove subfield.';
  }
  if (issueKey.startsWith('duplicate-control')) {
    return 'How to fix: remove the duplicate field using the Remove button on its field card.';
  }
  if (issueKey.startsWith('no-subfields')) {
    return 'How to fix: select the field card and use "Add subfield" to give the field at least one subfield.';
  }
  if (issueKey.startsWith('invalid-control-tag') || issueKey.startsWith('invalid-data-tag')) {
    return 'How to fix: edit the Tag input on the field card (three digits), or use the Batch tab with the Control tags target.';
  }
  if (issueKey === 'missing:245:a' || issueKey === 'missing:245$a') {
    return 'How to fix: use "Add MARC field" in the field editor to add a 245 data field with a $a (title) subfield.';
  }
  if (issueKey === 'missing:heading') {
    return 'How to fix: use "Add MARC field" to add a heading field (100/110/111/130/150/151) with a $a subfield.';
  }
  if (issueKey === 'missing:852') {
    return 'How to fix: use "Add MARC field" to add an 852 data field with location information.';
  }
  if (issueKey.startsWith('missing:')) {
    return 'How to fix: use "Add MARC field" in the field editor and choose "Control field" to add the missing field.';
  }
  return 'How to fix: open the record in the Edit tab \u2014 click the issue to jump straight to the affected field.';
}

/**
 * @param {import('../lib/marc-validate.js').GroupedValidationIssue[]} groups
 * @param {{ dismissed?: boolean }} [options]
 */
function appendValidationGroupsToBanner(groups, options = {}) {
  groups.forEach((group) => {
    const details = document.createElement('details');
    details.className = 'validation-banner-group';
    if (options.dismissed) {
      details.classList.add('validation-banner-dismissed-item');
    }
    details.dataset.groupKey = `${group.level}|${group.issueKey}${options.dismissed ? '|dismissed' : ''}`;

    const summary = document.createElement('summary');
    summary.className = 'validation-banner-group-summary';
    const levelLabel = group.level === 'error' ? 'Error' : 'Warning';
    summary.textContent = `${group.recordRangeLabel} · ${levelLabel} · ${group.message} (${group.recordIndices.length} records)`;
    details.append(summary);

    const body = document.createElement('div');
    body.className = 'validation-banner-group-body';

    const fixHint = document.createElement('p');
    fixHint.className = 'validation-fix-hint';
    fixHint.textContent = getIssueFixHint(group.issueKey ?? '');
    body.append(fixHint);

    const recordLinks = document.createElement('ul');
    recordLinks.className = 'validation-banner-group-records';

    group.issues.forEach((issue) => {
      const item = document.createElement('li');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'validation-banner-record-link';
      const label = issue.recordLabel ?? `Record ${(issue.recordIndex ?? 0) + 1}`;
      link.textContent = `Record ${(issue.recordIndex ?? 0) + 1}: ${label}`;
      link.setAttribute('aria-label', `Navigate to ${label}`);
      link.addEventListener('click', () => navigateToIssue(issue));
      item.append(link);
      recordLinks.append(item);
    });

    body.append(recordLinks);

    if (group.level === 'warning') {
      const groupActions = document.createElement('div');
      groupActions.className = 'validation-banner-group-actions';
      const dismissAllButton = document.createElement('button');
      dismissAllButton.type = 'button';
      dismissAllButton.className = options.dismissed ? 'secondary validation-banner-restore' : 'secondary validation-banner-dismiss';
      dismissAllButton.textContent = options.dismissed ? 'Restore warning' : 'Dismiss warning';
      dismissAllButton.addEventListener('click', async () => {
        const warningTypeKey = group.issueKey ?? group.message;
        if (options.dismissed) {
          await restoreWarningType(warningTypeKey);
          return;
        }
        await dismissWarningGroup(group);
      });
      groupActions.append(dismissAllButton);
      body.append(groupActions);
    }

    if (group.supportsBatchEdit && !options.dismissed) {
      const batchButton = document.createElement('button');
      batchButton.type = 'button';
      batchButton.className = 'secondary validation-banner-batch-edit';
      batchButton.textContent = 'Batch edit';
      batchButton.setAttribute('aria-label', `Open batch editor for ${group.recordRangeLabel}`);
      batchButton.addEventListener('click', () => prefillBatchFromGroupedIssue(group));
      body.append(batchButton);
    }

    details.append(body);
    validationBannerList.append(details);
  });
}

/**
 * @param {import('../lib/marc-validate.js').ValidationIssue[]} individuals
 * @param {{ dismissed?: boolean }} [options]
 */
function appendValidationIndividualsToBanner(individuals, options = {}) {
  individuals.forEach((issue) => {
    const item = document.createElement('li');
    item.className = 'validation-banner-individual';
    if (options.dismissed) {
      item.classList.add('validation-banner-dismissed-item');
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `validation-banner-issue ${issue.level === 'error' ? 'validation-error' : 'validation-warning'}`;
    const location = issue.fieldIndex != null
      ? issue.subfieldIndex != null
        ? ` [field ${issue.tag ?? issue.fieldIndex}, $${issue.path?.includes('code') ? 'code' : 'value'}]`
        : ` [${issue.tag ? `tag ${issue.tag}` : `field ${issue.fieldIndex + 1}`}]`
      : issue.path === 'leader'
        ? ' [Leader]'
        : issue.path === 'leader-008-mismatch'
          ? ' [tag 008]'
          : issue.tag
            ? ` [tag ${issue.tag}]`
            : '';
    const recordLabel = issue.recordLabel ?? `Record ${(issue.recordIndex ?? 0) + 1}`;
    button.textContent = `${recordLabel} · ${issue.level === 'error' ? 'Error' : 'Warning'}:${location} ${issue.message}`;
    button.addEventListener('click', () => navigateToIssue(issue));
    item.append(button);

    const fixHint = document.createElement('p');
    fixHint.className = 'validation-fix-hint';
    fixHint.textContent = getIssueFixHint(issue.issueKey ?? '');
    item.append(fixHint);

    if (!options.dismissed) {
      const record = issue.recordIndex != null ? state.marcRecords[issue.recordIndex] : null;
      const fixButton = record && roadmapApi?.renderAutoFixButton?.(issue, record, (fixed) => {
        state.marcRecords[issue.recordIndex] = fixed;
        state.parsedRows[issue.recordIndex] = recordToParsedRow(fixed);
        refreshEditView();
        renderEditor(fixed);
      });
      if (fixButton) {
        item.append(fixButton);
      }
    }

    item.append(createValidationDismissActions(issue, { dismissed: options.dismissed }));
    validationBannerList.append(item);
  });
}

function renderValidationBanner() {
  const visibleAllIssues = getVisibleValidationIssuesForDisplay();
  const activeIssues = getActiveValidationIssues(visibleAllIssues, dismissedWarningKeys);
  const dismissedIssues = visibleAllIssues.filter((issue) => isIssueDismissed(issue, dismissedWarningKeys));
  const { errors, warnings, recordsWithErrors } = summarizeValidation(activeIssues);
  const filterLabel = getRecordListFilterLabel();
  const filterSuffix = filterLabel ? ` (${filterLabel} records only)` : '';
  const dismissedCount = dismissedIssues.length;
  const showDismissedSection = showDismissedWarnings && dismissedCount > 0;
  const hasActiveContent = errors > 0 || warnings > 0;
  const showBanner = hasActiveContent || dismissedCount > 0;

  validationBannerControls?.classList.toggle('hidden', dismissedCount === 0);
  if (validationShowDismissed instanceof HTMLInputElement) {
    validationShowDismissed.checked = showDismissedWarnings;
  }

  if (!showBanner) {
    validationBanner.classList.add('hidden');
    validationBannerList.classList.add('hidden');
    validationBannerToggle.setAttribute('aria-expanded', 'false');
    return;
  }

  validationBanner.classList.remove('hidden');
  validationBanner.classList.toggle('validation-banner-warnings-only', errors === 0 && warnings > 0);

  if (errors > 0) {
    validationBannerSummary.textContent = `${errors} validation error${errors === 1 ? '' : 's'} in ${recordsWithErrors} record${recordsWithErrors === 1 ? '' : 's'}${filterSuffix}${warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}${dismissedCount > 0 ? ` · ${dismissedCount} dismissed` : ''} — select to view details`;
  } else if (warnings > 0) {
    validationBannerSummary.textContent = `${warnings} validation warning${warnings === 1 ? '' : 's'}${filterSuffix}${dismissedCount > 0 ? ` · ${dismissedCount} dismissed` : ''} — select to view details`;
  } else {
    validationBannerSummary.textContent = `All visible warnings dismissed (${dismissedCount}${filterSuffix}). Enable "Show dismissed warnings" below to review or restore.`;
  }

  validationBannerList.innerHTML = '';

  if (!hasActiveContent && !showDismissedSection) {
    return;
  }

  const { groups, individuals } = groupValidationIssues(activeIssues);
  appendValidationGroupsToBanner(groups);
  appendValidationIndividualsToBanner(individuals);

  if (showDismissedSection) {
    const heading = document.createElement('li');
    heading.className = 'validation-banner-dismissed-heading';
    heading.textContent = `Dismissed warnings (${dismissedCount})`;
    validationBannerList.append(heading);

    const dismissedGrouped = groupValidationIssues(dismissedIssues);
    appendValidationGroupsToBanner(dismissedGrouped.groups, { dismissed: true });
    appendValidationIndividualsToBanner(dismissedGrouped.individuals, { dismissed: true });
  }
}

function applyValidationHighlights(recordIndex) {
  const recordIssues = getRecordActiveIssues(recordIndex);
  const leaderIssues = getIssuesForLeader(recordIssues);
  const leaderGroup = leaderEditor.querySelector('.field-group');
  const leaderLevel = getHighestIssueLevel(leaderIssues);

  if (leaderGroup) {
    leaderGroup.classList.toggle('validation-highlight-error', leaderLevel === 'error');
    leaderGroup.classList.toggle('validation-highlight-warning', leaderLevel === 'warning');
    const hasLeaderError = leaderIssues.some((issue) => issue.path === 'leader' && issue.level === 'error');
    const hasLeaderWarning = leaderIssues.some((issue) => issue.path === 'leader' && issue.level === 'warning');
    leaderGroup.querySelectorAll('.leader-input').forEach((leaderInput) => {
      leaderInput.classList.toggle('input-invalid', hasLeaderError);
      leaderInput.classList.toggle('input-warning', hasLeaderWarning);
    });
  }

  fieldEditor.querySelectorAll('.field-card').forEach((card) => {
    const fieldIndex = Number(card.dataset.fieldIndex);
    const fieldIssues = recordIssues.filter((issue) => issue.fieldIndex === fieldIndex);
    const level = getHighestIssueLevel(fieldIssues);

    card.classList.toggle('validation-highlight-error', level === 'error');
    card.classList.toggle('validation-highlight-warning', level === 'warning');

    card.querySelectorAll('.subfield-row').forEach((row) => {
      const subfieldIndex = Number(row.dataset.subfieldIndex);
      const subfieldIssues = fieldIssues.filter((issue) => issue.subfieldIndex === subfieldIndex);
      const subLevel = getHighestIssueLevel(subfieldIssues);
      row.classList.toggle('validation-highlight-error', subLevel === 'error');
      row.classList.toggle('validation-highlight-warning', subLevel === 'warning');

      const codeInput = row.querySelector('.subfield-row-code');
      const valueInput = row.querySelector('.subfield-row-value');
      codeInput?.classList.toggle(
        'input-invalid',
        subfieldIssues.some((issue) => issue.level === 'error' && issue.path?.includes('code')),
      );
      valueInput?.classList.toggle(
        'input-warning',
        subfieldIssues.some((issue) => issue.level === 'warning' && issue.path?.includes('value')),
      );
    });

    card.querySelectorAll('input').forEach((input) => {
      if (input.classList.contains('subfield-row-code') || input.classList.contains('subfield-row-value')) {
        return;
      }
      const part = input.dataset.validationPart;
      const partIssues = fieldIssues.filter((issue) => {
        if (!part) {
          return true;
        }
        if (part === 'indicators') {
          return issue.path?.includes('indicators')
            || issue.path?.includes('ind1')
            || issue.path?.includes('ind2')
            || issue.message.includes('indicator');
        }
        return issue.path?.includes(part);
      });
      input.classList.toggle('input-invalid', partIssues.some((issue) => issue.level === 'error'));
      input.classList.toggle('input-warning', partIssues.some((issue) => issue.level === 'warning'));
    });
  });
}

const autosaveStatus = document.getElementById('autosave-status');
let autosaveFlashTimer = null;

function flashAutosaveStatus() {
  if (!autosaveStatus) {
    return;
  }
  autosaveStatus.textContent = 'Changes saved';
  autosaveStatus.classList.add('autosave-status-active');
  clearTimeout(autosaveFlashTimer);
  autosaveFlashTimer = setTimeout(() => {
    autosaveStatus.classList.remove('autosave-status-active');
    autosaveStatus.textContent = 'Edits are saved automatically';
  }, 1500);
}

function refreshValidationUI() {
  if (!hasRecords()) {
    allValidationIssues = [];
    renderValidationBanner();
    return;
  }

  allValidationIssues = validateAllRecords(state.marcRecords, state.validationProfile);
  afterValidationUpdated();
  renderRecordListValidationBadges();
  applyValidationHighlights(state.selectedIndex);
  flashAutosaveStatus();
}

function renderRecordListValidationBadges() {
  recordList.querySelectorAll('.record-item').forEach((item) => {
    const index = Number(item.dataset.recordIndex);
    if (Number.isNaN(index)) {
      return;
    }

    const recordIssues = getRecordActiveIssues(index);
    const errorCount = recordIssues.filter((issue) => issue.level === 'error').length;
    const warningCount = recordIssues.filter((issue) => issue.level === 'warning').length;

    item.classList.toggle('record-item-has-errors', errorCount > 0);
    item.classList.toggle('record-item-has-warnings', errorCount === 0 && warningCount > 0);

    if (errorCount === 0 && warningCount === 0) {
      item.querySelector('.record-validation-badge')?.remove();
      return;
    }

    let badge = item.querySelector('.record-validation-badge');
    if (!badge) {
      badge = document.createElement('span');
      item.querySelector('.record-item-title')?.append(badge);
    }

    if (errorCount > 0) {
      badge.className = 'record-validation-badge error';
      badge.textContent = String(errorCount);
      badge.setAttribute('aria-label', `${errorCount} validation errors`);
    } else {
      badge.className = 'record-validation-badge warning';
      badge.textContent = String(warningCount);
      badge.setAttribute('aria-label', `${warningCount} validation warnings`);
    }
  });
}

function renderEditor(record) {
  selectedRecordMeta.textContent = `Row ${record.sourceRowNumber} · ${record.recordType ?? 'bibliographic'}`;
  const mnemonicPanel = document.getElementById('mnemonic-editor-panel');
  const mnemonicSync = document.getElementById('mnemonic-sync');
  const isMnemonic = state.editorViewMode === 'mnemonic';

  leaderEditor.classList.toggle('hidden', isMnemonic);
  fieldEditor.classList.toggle('hidden', isMnemonic);
  marcPreview.parentElement?.classList.toggle('hidden', isMnemonic);
  mnemonicPanel?.classList.toggle('hidden', !isMnemonic);
  mnemonicSync?.classList.toggle('hidden', !isMnemonic);
  document.querySelector('.preview-panel')?.classList.toggle('hidden', isMnemonic);

  if (isMnemonic && mnemonicPanel && roadmapApi) {
    roadmapApi.renderMnemonicEditor(mnemonicPanel, record);
    marcPreview.textContent = recordToMarcText(record);
    resetRecordEditTracking(state.selectedIndex);
    return;
  }

  renderLeader(record, state.selectedIndex);
  fieldEditor.innerHTML = '';

  collectFieldGroups(record).forEach((groupName) => {
    const fields = record.fields.map((field, index) => ({ field, index })).filter(({ field }) => getFieldGroup(field) === groupName);
    if (fields.length === 0) return;

    const section = document.createElement('section');
    section.className = 'field-group';
    section.innerHTML = `<h3 class="field-group-title">${groupName}</h3>`;
    fields.forEach(({ field, index }) => section.append(renderFieldCard(field, index, record, state.selectedIndex)));
    fieldEditor.append(section);
  });

  marcPreview.textContent = recordToMarcText(record);
  refreshExportPreview();
  applyValidationHighlights(state.selectedIndex);
  resetRecordEditTracking(state.selectedIndex);
}

function createPlainFixedValueInput({
  value,
  maxLength,
  labelText,
  inputClass,
  validationPart,
  valueIssues,
  onChange,
}) {
  const controlLabel = document.createElement('label');
  controlLabel.className = 'control-field-label';
  controlLabel.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = inputClass;
  input.value = value;
  if (maxLength !== undefined) {
    input.maxLength = maxLength;
  }
  input.dataset.validationPart = validationPart;
  input.classList.toggle('input-invalid', valueIssues.some((issue) => issue.level === 'error'));
  input.classList.toggle('input-warning', valueIssues.some((issue) => issue.level === 'warning'));
  input.addEventListener('input', (event) => {
    onChange(event.target.value);
  });
  input.addEventListener('blur', (event) => {
    if (maxLength === undefined) {
      return;
    }
    const padded = padFixedField(event.target.value, maxLength);
    event.target.value = padded;
    onChange(padded);
  });

  controlLabel.append(input);
  return controlLabel;
}

function renderLeader(record, recordIndex) {
  const recordIssues = getRecordActiveIssues(recordIndex);
  const leaderIssues = getIssuesForLeader(recordIssues);
  const leaderLevel = getHighestIssueLevel(leaderIssues);
  const recordType = record.recordType ?? 'bibliographic';

  leaderEditor.innerHTML = '';
  const group = document.createElement('section');
  group.className = 'field-group';
  if (leaderLevel === 'error') {
    group.classList.add('validation-highlight-error');
  } else if (leaderLevel === 'warning') {
    group.classList.add('validation-highlight-warning');
  }
  group.innerHTML = '<h3 class="field-group-title">Leader</h3>';

  const commitLeader = (value) => {
    record.leader = padFixedField(value, 24);
    commitRecordChange(record);
  };

  const definition = getLeaderDefinition(recordType);
  group.append(createFixedFieldEditor({
    definition,
    value: record.leader,
    fieldLabel: 'LDR — 24 character fixed field (positions defined by LoC MARC21)',
    inputClass: 'leader-input',
    isInvalid: leaderLevel === 'error',
    isWarning: leaderLevel === 'warning',
    onChange: commitLeader,
  }));

  leaderEditor.append(group);
}

function createDataFieldControlsRow(field, fieldIndex, fieldIssues, record) {
  const indicatorIssues = fieldIssues.filter(
    (issue) => issue.path?.includes('indicators') || issue.message.includes('indicator'),
  );
  const tagIssues = fieldIssues.filter((issue) => issue.path?.includes('tag'));
  const tagInputId = `field-${fieldIndex}-tag`;
  const indicatorsInputId = `field-${fieldIndex}-indicators`;
  const row = document.createElement('div');
  row.className = 'field-data-controls-row';

  const control = document.createElement('div');
  control.className = 'field-data-controls';

  const tagLabel = document.createElement('label');
  tagLabel.className = 'field-tag-label';
  tagLabel.setAttribute('for', tagInputId);
  tagLabel.textContent = 'Tag';

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.id = tagInputId;
  tagInput.className = 'field-input field-tag-input';
  tagInput.maxLength = 3;
  tagInput.inputMode = 'numeric';
  tagInput.value = field.tag;
  tagInput.dataset.validationPart = 'tag';
  tagInput.setAttribute('aria-label', `Tag for field ${field.tag}`);
  tagInput.classList.toggle('input-invalid', tagIssues.some((issue) => issue.level === 'error'));
  tagInput.classList.toggle('input-warning', tagIssues.some((issue) => issue.level === 'warning'));
  tagInput.addEventListener('input', (event) => {
    field.tag = event.target.value.replace(/\D/g, '').slice(0, 3);
    commitRecordChange(record);
  });
  tagInput.addEventListener('blur', (event) => {
    field.tag = event.target.value.replace(/\D/g, '').padStart(3, '0').slice(-3);
    event.target.value = field.tag;
    commitRecordChange(record);
  });
  tagLabel.append(tagInput);

  const indLabel = document.createElement('label');
  indLabel.className = 'field-indicators-label';
  indLabel.setAttribute('for', indicatorsInputId);
  indLabel.textContent = 'Indicators (2 chars)';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = indicatorsInputId;
  input.className = 'field-input field-indicators-input';
  input.maxLength = 2;
  input.value = formatMarcIndicatorsForDisplay(field.ind1, field.ind2);
  input.dataset.validationPart = 'indicators';
  input.setAttribute('aria-label', `Indicators for field ${field.tag}`);
  input.placeholder = '10';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.classList.toggle('input-invalid', indicatorIssues.some((issue) => issue.level === 'error'));
  input.classList.toggle('input-warning', indicatorIssues.some((issue) => issue.level === 'warning'));

  input.addEventListener('focus', (event) => {
    requestAnimationFrame(() => {
      event.target.select();
    });
  });
  input.addEventListener('input', (event) => {
    applyMarcIndicators(field, event.target.value);
    commitRecordChange(record);
  });
  input.addEventListener('blur', (event) => {
    applyMarcIndicators(field, event.target.value);
    event.target.value = formatMarcIndicatorsForDisplay(field.ind1, field.ind2);
    commitRecordChange(record);
  });
  indLabel.append(input);

  control.addEventListener('mousedown', (event) => {
    if (event.target === tagInput || event.target === input || event.target === tagLabel || event.target === indLabel) {
      return;
    }
    event.preventDefault();
    input.focus();
  });

  control.append(tagLabel, indLabel);
  row.append(control);

  const helpPanel = createFieldHelpPanel(field.tag);
  if (helpPanel) {
    row.append(helpPanel);
  }

  return row;
}

function renderFieldCard(field, fieldIndex, record, recordIndex) {
  const recordIssues = getRecordActiveIssues(recordIndex);
  const fieldIssues = recordIssues.filter((issue) => issue.fieldIndex === fieldIndex);
  const fieldLevel = getHighestIssueLevel(fieldIssues);

  const card = document.createElement('article');
  card.className = 'field-card';
  card.dataset.fieldIndex = String(fieldIndex);
  if (fieldLevel === 'error') {
    card.classList.add('validation-highlight-error');
  } else if (fieldLevel === 'warning') {
    card.classList.add('validation-highlight-warning');
  }

  const header = document.createElement('div');
  header.className = 'field-card-header';
  const label = document.createElement('div');
  label.className = 'field-card-label';
  label.textContent = field.type === 'control' ? `Control field ${field.tag}` : field.sourceLabel ?? `${field.tag} field`;
  header.append(label);

  const actions = document.createElement('div');
  actions.className = 'field-card-actions';

  if (field.type === 'data') {
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'secondary';
    moveUp.textContent = '↑';
    moveUp.setAttribute('aria-label', 'Move field up');
    moveUp.disabled = fieldIndex === 0;
    moveUp.addEventListener('click', () => {
      if (fieldIndex <= 0) return;
      const fields = record.fields;
      [fields[fieldIndex - 1], fields[fieldIndex]] = [fields[fieldIndex], fields[fieldIndex - 1]];
      renderEditor(record);
      commitRecordChange(record, true);
    });

    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'secondary';
    moveDown.textContent = '↓';
    moveDown.setAttribute('aria-label', 'Move field down');
    moveDown.disabled = fieldIndex >= record.fields.length - 1;
    moveDown.addEventListener('click', () => {
      if (fieldIndex >= record.fields.length - 1) return;
      const fields = record.fields;
      [fields[fieldIndex + 1], fields[fieldIndex]] = [fields[fieldIndex], fields[fieldIndex + 1]];
      renderEditor(record);
      commitRecordChange(record, true);
    });

    const duplicateBtn = document.createElement('button');
    duplicateBtn.type = 'button';
    duplicateBtn.className = 'secondary';
    duplicateBtn.textContent = 'Duplicate';
    duplicateBtn.addEventListener('click', () => {
      record.fields.splice(fieldIndex + 1, 0, structuredClone(field));
      renderEditor(record);
      commitRecordChange(record, true);
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      roadmapApi?.setFieldClipboard(field);
    });

    actions.append(moveUp, moveDown, duplicateBtn, copyBtn);
  }

  if (field.type !== 'control' || !isProtectedControlTag(field.tag)) {
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'secondary danger';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      record.fields.splice(fieldIndex, 1);
      refreshValidationUI();
      renderEditor(record);
    });
    actions.append(removeButton);
  }

  header.append(actions);

  card.append(header);

  if (field.type === 'control') {
    const recordType = record.recordType ?? 'bibliographic';
    const valueIssues = fieldIssues.filter((issue) => issue.path?.includes('value'));
    const valueLevel = getHighestIssueLevel(valueIssues);

    if (shouldUseSegmentedFixedField(record, field)) {
      const definition = getField008Definition(recordType);
      card.append(createFixedFieldEditor({
        definition,
        value: field.value,
        fieldLabel: `008 — ${definition.totalLength} character fixed field (LoC MARC21 positions)`,
        inputClass: 'field-input',
        isInvalid: valueLevel === 'error',
        isWarning: valueLevel === 'warning',
        onChange: (value) => {
          field.value = padFixedField(value, definition.totalLength);
          commitRecordChange(record);
        },
      }));
      return card;
    }

    const controlHint = field.tag === '005'
      ? 'Value (yymmddhhmmss.t — date/time of latest transaction)'
      : field.tag === '001'
        ? 'Value (record control number)'
        : 'Value';

    card.append(createPlainFixedValueInput({
      value: field.value,
      labelText: controlHint,
      inputClass: 'field-input',
      validationPart: 'value',
      valueIssues,
      onChange: (value) => {
        field.value = value;
        commitRecordChange(record);
      },
    }));
    return card;
  }

  card.append(createDataFieldControlsRow(field, fieldIndex, fieldIssues, record));

  const subfieldList = document.createElement('div');
  subfieldList.className = 'subfield-list';
  field.subfields.forEach((subfield, subfieldIndex) => {
    subfieldList.append(renderSubfieldRow(field, subfieldIndex, record, fieldIssues));
  });

  const addSubfieldButton = document.createElement('button');
  addSubfieldButton.type = 'button';
  addSubfieldButton.className = 'secondary';
  addSubfieldButton.textContent = 'Add subfield';
  addSubfieldButton.addEventListener('click', () => {
    field.subfields.push({ code: 'a', value: '' });
    refreshValidationUI();
    renderEditor(record);
  });
  card.append(subfieldList, addSubfieldButton);
  return card;
}

function renderSubfieldRow(field, subfieldIndex, record, fieldIssues) {
  const subfield = field.subfields[subfieldIndex];
  const subfieldIssues = fieldIssues.filter((issue) => issue.subfieldIndex === subfieldIndex);
  const subLevel = getHighestIssueLevel(subfieldIssues);

  const row = document.createElement('div');
  row.className = 'subfield-row';
  row.dataset.subfieldIndex = String(subfieldIndex);
  if (subLevel === 'error') {
    row.classList.add('validation-highlight-error');
  } else if (subLevel === 'warning') {
    row.classList.add('validation-highlight-warning');
  }

  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Code';
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.className = 'subfield-row-code field-input';
  codeInput.maxLength = 1;
  codeInput.inputMode = 'text';
  codeInput.value = formatSubfieldCodeForDisplay(subfield.code);
  codeInput.placeholder = 'a';
  codeInput.autocomplete = 'off';
  codeInput.spellcheck = false;
  codeInput.setAttribute('aria-label', `Subfield code for field ${field.tag}`);
  codeInput.classList.toggle(
    'input-invalid',
    subfieldIssues.some((issue) => issue.level === 'error' && issue.path?.includes('code')),
  );
  codeInput.addEventListener('focus', (event) => {
    requestAnimationFrame(() => {
      event.target.select();
    });
  });
  codeInput.addEventListener('input', (event) => {
    applySubfieldCode(subfield, event.target.value);
    commitRecordChange(record);
  });
  codeInput.addEventListener('blur', (event) => {
    subfield.code = normalizeSubfieldCode(event.target.value);
    event.target.value = formatSubfieldCodeForDisplay(subfield.code);
    commitRecordChange(record, true);
  });
  codeLabel.append(codeInput);

  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Value';
  const valueInput = document.createElement('input');
  valueInput.className = 'subfield-row-value field-input';
  valueInput.type = 'text';
  valueInput.value = subfield.value;
  valueInput.classList.toggle(
    'input-warning',
    subfieldIssues.some((issue) => issue.level === 'warning' && issue.path?.includes('value')),
  );
  valueInput.classList.toggle(
    'input-invalid',
    subfieldIssues.some((issue) => issue.level === 'error' && issue.path?.includes('value')),
  );
  valueInput.addEventListener('input', (event) => {
    subfield.value = event.target.value;
    commitRecordChange(record);
  });
  attachDiacriticsButton(valueInput);
  valueLabel.append(valueInput);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'secondary danger';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    field.subfields.splice(subfieldIndex, 1);
    if (field.subfields.length === 0) field.subfields.push({ code: 'a', value: '' });
    refreshValidationUI();
    renderEditor(record);
  });

  row.append(codeLabel, valueLabel, removeButton);
  return row;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getBatchOperationMode() {
  return document.querySelector('input[name="batch-operation"]:checked')?.value ?? 'find-replace';
}

function setBatchOperationMode(mode) {
  const input = document.querySelector(`input[name="batch-operation"][value="${mode}"]`);
  if (input instanceof HTMLInputElement) {
    input.checked = true;
  }
  syncBatchOperationUI();
}

function syncBatchOperationUI() {
  const isSetValue = getBatchOperationMode() === 'set-value';
  const setPartSelect = document.getElementById('batch-set-part');
  const fieldPart = setPartSelect instanceof HTMLSelectElement ? setPartSelect.value : 'indicators';
  const findInput = document.getElementById('batch-find');
  const findEmpty = !(findInput instanceof HTMLInputElement) || !findInput.value.trim();

  document.getElementById('batch-fields-find-replace')?.classList.toggle('hidden', isSetValue);
  document.getElementById('batch-fields-set-value')?.classList.toggle('hidden', !isSetValue);
  document.getElementById('batch-targets-fieldset')?.classList.toggle('hidden', isSetValue);
  document.getElementById('batch-targets-hint')?.classList.toggle('hidden', isSetValue);

  document.getElementById('batch-set-subfield-label')?.classList.toggle(
    'hidden',
    fieldPart !== 'subfield-value' && fieldPart !== 'remove-subfield',
  );
  document.getElementById('batch-set-tag')?.closest('label')?.classList.toggle('hidden', fieldPart === 'leader');
  document.getElementById('batch-set-value-label')?.classList.toggle('hidden', fieldPart === 'remove-subfield');

  document.getElementById('batch-subfield-filter-label')?.classList.toggle('hidden', !findEmpty);

  const hint = document.getElementById('batch-operation-hint');
  if (hint) {
    if (isSetValue) {
      hint.innerHTML = fieldPart === 'remove-subfield'
        ? '<strong>Set field value</strong> — enter the <strong>Tag</strong>, choose <strong>Remove subfield</strong>, and type the <strong>Subfield code</strong> to delete (e.g. <code>a</code>) from every matching field in scope.'
        : fieldPart === 'subfield-value'
        ? '<strong>Set field value</strong> — enter the <strong>Tag</strong>, choose <strong>Subfield value</strong>, type the <strong>Subfield code</strong> (e.g. <code>a</code>), then the new text in <strong>Set to</strong>.'
        : fieldPart === 'leader'
          ? '<strong>Set field value</strong> — enter the full 24-character leader in <strong>Set to</strong>.'
          : fieldPart === 'control-value'
            ? '<strong>Set field value</strong> — enter the control <strong>Tag</strong> (e.g. <code>008</code>) and the new value in <strong>Set to</strong>.'
            : '<strong>Set field value</strong> — enter the <strong>Tag</strong> and two indicator characters in <strong>Set to</strong> (e.g. <code>10</code> or <code>00</code>).';
    } else if (findEmpty) {
      hint.innerHTML = 'Leave <strong>Find</strong> empty, set <strong>Tag filter</strong> and <strong>Subfield filter</strong>, then enter the new subfield text in <strong>Replace</strong>.';
    } else {
      hint.innerHTML = 'Find text is matched literally by default. Patterns like <code>\\d+</code>, <code>[A-Z]+</code>, or <code>/pattern/</code> are treated as regular expressions. Use <strong>Tag filter</strong> and optional <strong>Subfield filter</strong> to narrow matches.';
    }
  }
}

function getBatchReplaceOptions() {
  return {
    mode: 'find-replace',
    find: document.getElementById('batch-find').value,
    replace: document.getElementById('batch-replace').value,
    tagFilter: document.getElementById('batch-tag').value.trim() || undefined,
    subfieldFilter: document.getElementById('batch-subfield').value.trim() || undefined,
    targets: {
      leader: document.getElementById('batch-target-leader').checked,
      controlValues: document.getElementById('batch-target-control-values').checked,
      controlTags: document.getElementById('batch-target-control-tags').checked,
      indicators: document.getElementById('batch-target-indicators').checked,
      subfieldCodes: document.getElementById('batch-target-subfield-codes').checked,
      subfieldValues: document.getElementById('batch-target-subfield-values').checked,
    },
  };
}

function getBatchOperationOptions() {
  if (getBatchOperationMode() === 'set-value') {
    const setPartSelect = document.getElementById('batch-set-part');
    return {
      mode: 'set-value',
      fieldPart: setPartSelect instanceof HTMLSelectElement ? setPartSelect.value : 'indicators',
      tagFilter: document.getElementById('batch-set-tag')?.value.trim() || undefined,
      subfieldFilter: document.getElementById('batch-set-subfield')?.value.trim() || undefined,
      replace: document.getElementById('batch-set-value')?.value ?? '',
    };
  }
  return getBatchReplaceOptions();
}

function getCleanupOptions() {
  return {
    dedupe: document.getElementById('cleanup-dedupe').checked,
    punctuation: document.getElementById('cleanup-punctuation').checked,
    encoding: document.getElementById('cleanup-encoding').checked,
    isbn: document.getElementById('cleanup-isbn').checked,
    dates: document.getElementById('cleanup-dates').checked,
  };
}

/**
 * @param {MarcRecord[]} beforeRecords
 * @param {import('../lib/marc-diff.js').RecordChangeSummary[]} summaries
 * @returns {UndoState}
 */
function createUndoState(beforeRecords, summaries) {
  return {
    snapshots: new Map(
      summaries.map((summary) => [summary.recordIndex, cloneMarcRecord(beforeRecords[summary.recordIndex])]),
    ),
    summaries: summaries.map((summary) => ({
      ...summary,
      changes: summary.changes.map((change) => ({ ...change })),
    })),
  };
}

/**
 * @param {number} recordIndex
 * @param {MarcRecord} snapshot
 */
function restoreRecordAtIndex(recordIndex, snapshot) {
  state.marcRecords[recordIndex] = cloneMarcRecord(snapshot);
  if (state.parsedRows[recordIndex]) {
    state.parsedRows[recordIndex] = recordToParsedRow(state.marcRecords[recordIndex]);
  }
}

/**
 * @param {'batch'|'cleanup'} context
 */
function clearUndoState(context) {
  if (context === 'batch') {
    batchUndoState = null;
    document.getElementById('batch-undo-all')?.classList.add('hidden');
  }
  if (context === 'cleanup') {
    cleanupUndoState = null;
    document.getElementById('cleanup-undo-all')?.classList.add('hidden');
  }
}

/**
 * @param {import('../lib/marc-diff.js').RecordChangeSummary[]} summaries
 * @param {HTMLElement} panel
 * @param {HTMLElement} list
 * @param {'batch'|'cleanup'|null} [undoContext]
 * @returns {string}
 */
function renderChangeLog(summaries, panel, list, undoContext = null) {
  list.innerHTML = '';

  const undoState = undoContext === 'batch'
    ? batchUndoState
    : undoContext === 'cleanup'
      ? cleanupUndoState
      : null;

  const undoAllButton = undoContext === 'batch'
    ? document.getElementById('batch-undo-all')
    : undoContext === 'cleanup'
      ? document.getElementById('cleanup-undo-all')
      : null;

  if (undoAllButton) {
    undoAllButton.classList.toggle('hidden', !undoState || undoState.summaries.length === 0);
  }

  if (summaries.length === 0) {
    panel.classList.add('hidden');
    return 'No changes detected.';
  }

  panel.classList.remove('hidden');

  summaries.forEach((summary) => {
    const recordItem = document.createElement('li');
    recordItem.className = 'changes-record';

    const header = document.createElement('div');
    header.className = 'changes-record-header';

    const title = document.createElement('div');
    title.className = 'changes-record-title';
    title.textContent = `Record ${summary.recordIndex + 1}: ${summary.title}`;
    header.append(title);

    if (undoState?.snapshots.has(summary.recordIndex)) {
      const actions = document.createElement('div');
      actions.className = 'changes-record-actions';
      const undoButton = document.createElement('button');
      undoButton.type = 'button';
      undoButton.className = 'secondary';
      undoButton.textContent = 'Undo record';
      undoButton.setAttribute('aria-label', `Undo changes to record ${summary.recordIndex + 1}`);
      undoButton.addEventListener('click', () => {
        if (undoContext === 'batch') {
          undoBatchRecord(summary.recordIndex);
        } else if (undoContext === 'cleanup') {
          undoCleanupRecord(summary.recordIndex);
        }
      });
      actions.append(undoButton);
      header.append(actions);
    }

    recordItem.append(header);

    const changeList = document.createElement('ul');
    summary.changes.forEach((change) => {
      const changeItem = document.createElement('li');
      if (change.kind === 'added') {
        changeItem.className = 'change-added';
        changeItem.textContent = `${change.label}: (added) "${change.after}"`;
      } else if (change.kind === 'removed') {
        changeItem.className = 'change-removed';
        changeItem.textContent = `${change.label}: (removed) "${change.before}"`;
      } else {
        changeItem.textContent = `${change.label}: "${change.before}" → "${change.after}"`;
      }
      changeList.append(changeItem);
    });

    recordItem.append(changeList);
    list.append(recordItem);
  });

  const { recordsChanged, totalEdits } = summarizeChangeLog(summaries);
  return `${recordsChanged} record${recordsChanged === 1 ? '' : 's'} changed, ${totalEdits} edit${totalEdits === 1 ? '' : 's'}.`;
}

/**
 * @param {UndoState} undoState
 * @param {number} recordIndex
 * @param {HTMLElement} panel
 * @param {HTMLElement} list
 * @param {HTMLElement} statusEl
 * @param {'batch'|'cleanup'} context
 */
function undoSingleRecord(undoState, recordIndex, panel, list, statusEl, context) {
  const snapshot = undoState.snapshots.get(recordIndex);
  if (!snapshot) {
    return;
  }

  restoreRecordAtIndex(recordIndex, snapshot);
  undoState.snapshots.delete(recordIndex);
  undoState.summaries = undoState.summaries.filter((summary) => summary.recordIndex !== recordIndex);

  if (undoState.summaries.length === 0) {
    clearUndoState(context);
    panel.classList.add('hidden');
    list.innerHTML = '';
    statusEl.textContent = 'All changes undone.';
  } else {
    statusEl.textContent = renderChangeLog(undoState.summaries, panel, list, context);
  }

  refreshEditView();
}

/**
 * @param {UndoState} undoState
 * @param {HTMLElement} panel
 * @param {HTMLElement} list
 * @param {HTMLElement} statusEl
 * @param {'batch'|'cleanup'} context
 */
function undoAllRecords(undoState, panel, list, statusEl, context) {
  for (const [recordIndex, snapshot] of undoState.snapshots) {
    restoreRecordAtIndex(recordIndex, snapshot);
  }

  clearUndoState(context);
  panel.classList.add('hidden');
  list.innerHTML = '';
  statusEl.textContent = 'All changes undone.';
  refreshEditView();
}

function undoBatchRecord(recordIndex) {
  if (!batchUndoState) {
    return;
  }

  undoSingleRecord(
    batchUndoState,
    recordIndex,
    document.getElementById('batch-changes'),
    document.getElementById('batch-changes-list'),
    document.getElementById('batch-status'),
    'batch',
  );
}

function undoCleanupRecord(recordIndex) {
  if (!cleanupUndoState) {
    return;
  }

  undoSingleRecord(
    cleanupUndoState,
    recordIndex,
    document.getElementById('cleanup-changes'),
    document.getElementById('cleanup-changes-list'),
    document.getElementById('cleanup-status'),
    'cleanup',
  );
}

/**
 * @param {MarcRecord[]} before
 * @param {MarcRecord[]} after
 * @param {HTMLElement} statusEl
 * @param {HTMLElement} panel
 * @param {HTMLElement} list
 */
function commitBatchChanges(before, after, statusEl, panel, list, indices) {
  state.marcRecords.splice(0, state.marcRecords.length, ...after);
  indices.forEach((index) => {
    normalizeMarcRecord(state.marcRecords[index]);
    state.parsedRows[index] = recordToParsedRow(state.marcRecords[index]);
  });

  const summaries = diffScopedRecords(before, after, indices);

  if (summaries.length === 0) {
    batchUndoState = null;
    document.getElementById('batch-undo-all')?.classList.add('hidden');
    panel.classList.add('hidden');
    list.innerHTML = '';
    statusEl.textContent = 'No changes detected.';
  } else {
    batchUndoState = createUndoState(before, summaries);
    roadmapApi?.pushUndo?.('Batch edit', batchUndoState.snapshots);
    statusEl.textContent = renderChangeLog(summaries, panel, list, 'batch');
  }

  const refreshResult = refreshRecordsAfterBulkEdit();
  if (refreshResult instanceof Promise) {
    refreshResult.catch(() => {});
  }
}

/**
 * @param {Map<number, MarcRecord>} beforeMap
 * @param {HTMLElement} statusEl
 * @param {HTMLElement} panel
 * @param {HTMLElement} list
 */
function commitCleanupChanges(beforeMap, statusEl, panel, list) {
  const indices = [...beforeMap.keys()];
  const beforeRecords = indices.map((index) => beforeMap.get(index));
  const afterRecords = indices.map((index) => state.marcRecords[index]);

  const summaries = diffMarcRecords(
    beforeRecords,
    afterRecords,
    indices.map((index) => state.parsedRows[index]),
  ).map((summary, summaryIndex) => ({
    ...summary,
    recordIndex: indices[summaryIndex],
  }));

  if (summaries.length === 0) {
    cleanupUndoState = null;
    document.getElementById('cleanup-undo-all')?.classList.add('hidden');
    panel.classList.add('hidden');
    list.innerHTML = '';
    statusEl.textContent = 'No changes detected.';
  } else {
    cleanupUndoState = {
      snapshots: new Map(
        summaries.map((summary) => [
          summary.recordIndex,
          cloneMarcRecord(beforeMap.get(summary.recordIndex)),
        ]),
      ),
      summaries: summaries.map((summary) => ({
        ...summary,
        changes: summary.changes.map((change) => ({ ...change })),
      })),
    };
    statusEl.textContent = renderChangeLog(summaries, panel, list, 'cleanup');
  }

  indices.forEach((index) => {
    state.parsedRows[index] = recordToParsedRow(state.marcRecords[index]);
  });

  const refreshResult = refreshRecordsAfterBulkEdit();
  if (refreshResult instanceof Promise) {
    refreshResult.catch(() => {});
  }
}

function remapIndexAfterMove(index, fromIndex, toIndex) {
  if (index === fromIndex) {
    return toIndex;
  }
  if (fromIndex < toIndex) {
    if (index > fromIndex && index <= toIndex) {
      return index - 1;
    }
  } else if (fromIndex > toIndex) {
    if (index >= toIndex && index < fromIndex) {
      return index + 1;
    }
  }
  return index;
}

function renumberSourceRows() {
  state.marcRecords.forEach((record, index) => {
    record.sourceRowNumber = index + 1;
    if (state.parsedRows[index]) {
      state.parsedRows[index].rowNumber = index + 1;
    }
  });
}

/**
 * @param {number} fromIndex
 * @param {number} toIndex
 */
function moveRecordToIndex(fromIndex, toIndex) {
  if (!hasRecords() || fromIndex === toIndex) {
    return;
  }
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.marcRecords.length || toIndex >= state.marcRecords.length) {
    return;
  }

  const [record] = state.marcRecords.splice(fromIndex, 1);
  const [row] = state.parsedRows.splice(fromIndex, 1);
  state.marcRecords.splice(toIndex, 0, record);
  state.parsedRows.splice(toIndex, 0, row);

  patchState({ selectedIndex: remapIndexAfterMove(state.selectedIndex, fromIndex, toIndex) });
  state.scopedRecordIndices = new Set(
    [...state.scopedRecordIndices].map((index) => remapIndexAfterMove(index, fromIndex, toIndex)),
  );

  if (duplicateUndoState) {
    duplicateUndoState = {
      addedIndices: duplicateUndoState.addedIndices.map((index) => remapIndexAfterMove(index, fromIndex, toIndex)),
      previousSelectedIndex: remapIndexAfterMove(duplicateUndoState.previousSelectedIndex, fromIndex, toIndex),
    };
  }

  renumberSourceRows();
  refreshEditView();
  renderRecordOrderList();
  roadmapApi?.scheduleDraftSave?.();
}

/**
 * @param {number} index
 * @param {number} delta
 */
function moveRecordByDelta(index, delta) {
  moveRecordToIndex(index, index + delta);
}

function renderRecordOrderList() {
  const list = document.getElementById('record-order-list');
  const empty = document.getElementById('order-empty');
  if (!list) {
    return;
  }

  list.innerHTML = '';

  if (!hasRecords()) {
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');

  state.marcRecords.forEach((record, index) => {
    const row = state.parsedRows[index];
    const preview = getRecordPreview(record);
    const title = row?.previewTitle ?? preview.title ?? 'Untitled';

    const item = document.createElement('li');
    item.className = 'record-order-item';

    const position = document.createElement('span');
    position.className = 'record-order-position';
    position.textContent = String(index + 1);

    const titleEl = document.createElement('span');
    titleEl.className = 'record-order-title';
    titleEl.textContent = title;
    titleEl.title = title;

    const actions = document.createElement('div');
    actions.className = 'record-order-actions';

    const upButton = document.createElement('button');
    upButton.type = 'button';
    upButton.className = 'secondary';
    upButton.textContent = 'Move up';
    upButton.disabled = index === 0;
    upButton.setAttribute('aria-label', `Move record ${index + 1} up`);
    upButton.addEventListener('click', () => moveRecordByDelta(index, -1));

    const downButton = document.createElement('button');
    downButton.type = 'button';
    downButton.className = 'secondary';
    downButton.textContent = 'Move down';
    downButton.disabled = index === state.marcRecords.length - 1;
    downButton.setAttribute('aria-label', `Move record ${index + 1} down`);
    downButton.addEventListener('click', () => moveRecordByDelta(index, 1));

    const moveForm = document.createElement('form');
    moveForm.className = 'record-order-move-form';
    moveForm.setAttribute('aria-label', `Move record ${index + 1} to position`);
    moveForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = moveForm.querySelector('input');
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const target = Number(input.value);
      if (!Number.isInteger(target) || target < 1 || target > state.marcRecords.length) {
        const statusEl = document.getElementById('order-status');
        if (statusEl) {
          statusEl.textContent = `Enter a position between 1 and ${state.marcRecords.length}.`;
        }
        return;
      }
      moveRecordToIndex(index, target - 1);
      const statusEl = document.getElementById('order-status');
      if (statusEl) {
        statusEl.textContent = `Moved record to position ${target}.`;
      }
    });

    const positionInput = document.createElement('input');
    positionInput.type = 'number';
    positionInput.min = '1';
    positionInput.max = String(state.marcRecords.length);
    positionInput.placeholder = '#';
    positionInput.setAttribute('aria-label', `Target position for record ${index + 1}`);

    const moveButton = document.createElement('button');
    moveButton.type = 'submit';
    moveButton.className = 'secondary';
    moveButton.textContent = 'Move';

    moveForm.append(positionInput, moveButton);
    actions.append(upButton, downButton, moveForm);
    item.append(position, titleEl, actions);
    list.append(item);
  });
}

function getRecordSelectLabel(index) {
  const record = state.marcRecords[index];
  const row = state.parsedRows[index];
  const preview = getRecordPreview(record);
  const title = row?.previewTitle ?? preview.title ?? 'Untitled';
  const truncated = title.length > 80 ? `${title.slice(0, 77)}…` : title;
  return `${index + 1} - ${truncated}`;
}

function populateCompareRecordSelects() {
  const selectA = document.getElementById('compare-record-a');
  const selectB = document.getElementById('compare-record-b');
  if (!(selectA instanceof HTMLSelectElement) || !(selectB instanceof HTMLSelectElement)) {
    return;
  }

  const previousA = selectA.value;
  const previousB = selectB.value;

  selectA.replaceChildren();
  selectB.replaceChildren();

  if (!hasRecords()) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No records loaded';
    selectA.append(emptyOption);
    selectB.append(emptyOption.cloneNode(true));
    return;
  }

  state.marcRecords.forEach((_, index) => {
    const label = getRecordSelectLabel(index);
    for (const select of [selectA, selectB]) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = label;
      select.append(option);
    }
  });

  if (previousA && selectA.querySelector(`option[value="${previousA}"]`)) {
    selectA.value = previousA;
  } else {
    selectA.value = String(state.selectedIndex);
  }

  if (previousB && selectB.querySelector(`option[value="${previousB}"]`)) {
    selectB.value = previousB;
  } else {
    const defaultB = Math.min(state.selectedIndex + 1, state.marcRecords.length - 1);
    selectB.value = String(defaultB);
  }
}

function cloneRecords(records) {
  return records.map((record) => cloneMarcRecord(record));
}

function applyBatchFindReplace(records, options, indices) {
  return batchFindReplace(records, {
    ...options,
    targets: { ...DEFAULT_BATCH_TARGETS, ...options.targets },
    indices,
  });
}

function isBatchSetMode(options) {
  return !options.find.trim() && Boolean(options.tagFilter) && Boolean(options.subfieldFilter);
}

function applyBatchOperation(records, options, indices) {
  if (options.mode === 'set-value') {
    return batchSetFieldValue(records, indices, {
      fieldPart: options.fieldPart,
      tag: options.tagFilter,
      subfieldCode: options.subfieldFilter,
      value: options.replace ?? '',
    });
  }
  if (isBatchSetMode(options)) {
    return batchSetSubfieldValue(records, indices, options.tagFilter, options.subfieldFilter, options.replace);
  }
  return applyBatchFindReplace(records, options, indices);
}

function validateBatchOptions(options, statusEl) {
  if (options.mode === 'set-value') {
    if (options.fieldPart === 'leader') {
      return true;
    }
    if (!options.tagFilter) {
      statusEl.textContent = 'Enter a tag for Set field value (Leader is the only part that does not need a tag).';
      return false;
    }
    if ((options.fieldPart === 'subfield-value' || options.fieldPart === 'remove-subfield') && !options.subfieldFilter) {
      statusEl.textContent = options.fieldPart === 'remove-subfield'
        ? 'Enter a subfield code to remove.'
        : 'Enter a subfield code when setting a subfield value.';
      return false;
    }
    return true;
  }

  if (options.find.trim()) {
    return true;
  }
  if (options.tagFilter && options.subfieldFilter) {
    return true;
  }
  statusEl.textContent = 'Enter text to find, or leave Find empty with Tag and Subfield set to replace a subfield value.';
  return false;
}

async function handleImportFile(file) {
  if (!file) return;
  setStatus(`Loading ${file.name}...`);
  try {
    const result = await importUploadedFile(await file.arrayBuffer(), file.name);
    const parsedRows = result.parsedRows ?? result.rows;
    const hasSpreadsheetData = Array.isArray(parsedRows) && parsedRows.length > 0;
    const hasColumns = (result.columnSchema?.length ?? 0) > 0 || (result.skippedColumns?.length ?? 0) > 0;

    if (hasSpreadsheetData && !result.records && hasColumns) {
      showColumnMappingPanel?.({ ...result, parsedRows, filename: file.name });
      setStatus('Review column mapping and order, then click Apply mapping & import.');
      return;
    }

    loadImportResult(result, file.name);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read file.', true);
  }
}

function wireDropZone(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!(zone instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
    return;
  }

  input.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  zone.addEventListener('click', (event) => {
    if (event.target === input || input.contains(event.target)) {
      return;
    }
    input.click();
  });
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    handler(event.dataTransfer?.files?.[0]);
  });
  input.addEventListener('change', (event) => {
    handler(event.target.files?.[0]);
    event.target.value = '';
  });
}

wireDropZone('drop-zone-import', 'file-input-import', handleImportFile);

/** @type {import('../lib/record-templates.js').RecordTemplate[]} */
let customTemplates = [];

function updateDeleteTemplateButtonState() {
  const templateSelect = document.getElementById('new-record-template');
  const deleteButton = document.getElementById('delete-record-template');
  if (!(templateSelect instanceof HTMLSelectElement) || !(deleteButton instanceof HTMLButtonElement)) {
    return;
  }
  const canDelete = isCustomTemplateSelectValue(templateSelect.value);
  deleteButton.disabled = !canDelete;
}

function syncNewRecordTemplateOptions() {
  const recordTypeSelect = document.getElementById('record-type-select');
  const templateField = document.getElementById('new-record-template-field');
  const templateSelect = document.getElementById('new-record-template');
  const deleteButton = document.getElementById('delete-record-template');
  if (!(recordTypeSelect instanceof HTMLSelectElement) || !(templateSelect instanceof HTMLSelectElement)) {
    return;
  }

  const recordType = recordTypeSelect.value;
  const previousTemplate = templateSelect.value;
  const templatesForType = getCustomTemplatesForRecordType(recordType, customTemplates);
  const hasTemplates = templatesForType.length > 0;

  templateField?.classList.toggle('hidden', !hasTemplates);
  deleteButton?.classList.toggle('hidden', !hasTemplates);

  templateSelect.replaceChildren();
  const blankOption = document.createElement('option');
  blankOption.value = '';
  blankOption.textContent = 'Blank (minimal fields)';
  templateSelect.append(blankOption);

  templatesForType.forEach((template) => {
    const option = document.createElement('option');
    option.value = toTemplateSelectValue(template);
    option.textContent = template.label;
    templateSelect.append(option);
  });

  if (previousTemplate && [...templateSelect.options].some((option) => option.value === previousTemplate)) {
    templateSelect.value = previousTemplate;
  }

  updateDeleteTemplateButtonState();
}

async function persistCustomTemplates() {
  await saveCustomTemplates(customTemplates);
  syncNewRecordTemplateOptions();
}

document.getElementById('record-type-select')?.addEventListener('change', syncNewRecordTemplateOptions);
document.getElementById('new-record-template')?.addEventListener('change', updateDeleteTemplateButtonState);

document.getElementById('new-record').addEventListener('click', () => {
  const recordTypeSelect = document.getElementById('record-type-select');
  const templateSelect = document.getElementById('new-record-template');
  const recordType = recordTypeSelect instanceof HTMLSelectElement ? recordTypeSelect.value : 'bibliographic';
  const templateSelectValue = templateSelect instanceof HTMLSelectElement ? templateSelect.value : '';
  const rowNumber = state.marcRecords.length + 1;

  const record = templateSelectValue
    ? buildRecordFromTemplate(templateSelectValue, rowNumber, customTemplates)
    : createBlankRecord(recordType, rowNumber);

  state.marcRecords.push(record);
  state.parsedRows.push(recordToParsedRow(record));
  patchState({ selectedIndex: state.marcRecords.length - 1 });
  clearDuplicateUndo();
  refreshEditView();
  switchTab('edit');

  if (templateSelectValue) {
    const template = findTemplateBySelectValue(templateSelectValue, customTemplates);
    setStatus(`Added record from template “${template?.label ?? 'saved template'}”.`);
    return;
  }

  setStatus(`Added blank ${recordType} record.`);
});

document.getElementById('save-as-template')?.addEventListener('click', async () => {
  if (!hasRecords() || state.selectedIndex < 0) {
    setStatus('Open a record before saving a template.');
    return;
  }

  const record = state.marcRecords[state.selectedIndex];
  const defaultName = `${record.recordType ?? 'bibliographic'} template`;
  const name = window.prompt('Template name', defaultName);
  if (!name?.trim()) {
    return;
  }

  const template = createTemplateFromRecord(record, name);
  customTemplates.push(template);
  await persistCustomTemplates();

  const recordTypeSelect = document.getElementById('record-type-select');
  if (recordTypeSelect instanceof HTMLSelectElement) {
    recordTypeSelect.value = template.recordType;
  }
  syncNewRecordTemplateOptions();

  const templateSelect = document.getElementById('new-record-template');
  if (templateSelect instanceof HTMLSelectElement) {
    templateSelect.value = toTemplateSelectValue(template);
    updateDeleteTemplateButtonState();
  }

  setStatus(`Saved template “${template.label}”.`);
});

document.getElementById('delete-record-template')?.addEventListener('click', async () => {
  const templateSelect = document.getElementById('new-record-template');
  if (!(templateSelect instanceof HTMLSelectElement) || !isCustomTemplateSelectValue(templateSelect.value)) {
    return;
  }

  const template = findTemplateBySelectValue(templateSelect.value, customTemplates);
  if (!template) {
    return;
  }

  if (!window.confirm(`Delete template “${template.label}”?`)) {
    return;
  }

  customTemplates = customTemplates.filter((item) => item.id !== template.id);
  await persistCustomTemplates();
  setStatus(`Deleted template “${template.label}”.`);
});

loadCustomTemplates().then((templates) => {
  customTemplates = templates;
  syncNewRecordTemplateOptions();
});

loadDismissedWarnings().then((keys) => {
  dismissedWarningKeys = new Set(keys);
  if (hasRecords()) {
    renderValidationBanner();
    renderRecordListValidationBadges();
  }
});

validationShowDismissed?.addEventListener('change', (event) => {
  showDismissedWarnings = event.target.checked;
  renderValidationBanner();
});

document.getElementById('duplicate-record').addEventListener('click', () => {
  const indicesToDuplicate = getRecordActionIndices();
  if (indicesToDuplicate.length === 0) {
    return;
  }

  if (shouldConfirmDuplicate(indicesToDuplicate) && !window.confirm(getDuplicateConfirmMessage(indicesToDuplicate))) {
    return;
  }

  performDuplicate(indicesToDuplicate);
});

document.getElementById('duplicate-undo').addEventListener('click', undoDuplicate);

document.getElementById('delete-records').addEventListener('click', requestDeleteRecords);

document.getElementById('confirm-delete-records')?.addEventListener('click', () => {
  if (!pendingDeleteIndices || pendingDeleteIndices.length === 0) {
    closeDeleteRecordsModal();
    return;
  }

  deleteRecordsAtIndices(pendingDeleteIndices);
  closeDeleteRecordsModal();
});

deleteRecordsModal?.querySelectorAll('[data-close-delete-modal]').forEach((element) => {
  element.addEventListener('click', closeDeleteRecordsModal);
});

document.getElementById('save-record').addEventListener('click', () => {
  if (!hasRecords()) {
    return;
  }
  const record = state.marcRecords[state.selectedIndex];
  if (!record) {
    return;
  }
  fieldEditor.querySelectorAll('.field-indicators-input').forEach((input) => {
    const card = input.closest('.field-card');
    const fieldIndex = Number(card?.dataset.fieldIndex);
    const field = record.fields[fieldIndex];
    if (field?.type === 'data') {
      applyMarcIndicators(field, input.value);
    }
  });
  fieldEditor.querySelectorAll('.field-tag-input').forEach((input) => {
    const card = input.closest('.field-card');
    const fieldIndex = Number(card?.dataset.fieldIndex);
    const field = record.fields[fieldIndex];
    if (field?.type === 'data') {
      field.tag = input.value.replace(/\D/g, '').padStart(3, '0').slice(-3);
    }
  });
  commitRecordChange(record);
  renderEditor(record);
});
document.getElementById('prev-record').addEventListener('click', () => selectRelativeRecord(-1));
document.getElementById('next-record').addEventListener('click', () => selectRelativeRecord(1));

document.getElementById('record-type-filter')?.addEventListener('change', handleRecordListFilterChange);

exportFormat.addEventListener('change', () => {
  refreshExportPreview();
});

document.getElementById('export-records').addEventListener('click', async () => {
  if (!hasRecords()) return;
  if (blockInvalidExport.checked) {
    if (hasValidationErrors(allValidationIssues)) {
      setStatus('Export blocked due to validation errors. Fix errors or disable the block option.', true);
      validationBannerToggle.setAttribute('aria-expanded', 'true');
      validationBannerList.classList.remove('hidden');
      return;
    }
  }
  await exportRecords(roadmapApi?.getExportRecords?.() ?? state.marcRecords, exportFormat.value);
});

validationBannerToggle.addEventListener('click', () => {
  const isExpanded = validationBannerToggle.getAttribute('aria-expanded') === 'true';
  validationBannerToggle.setAttribute('aria-expanded', String(!isExpanded));
  validationBannerList.classList.toggle('hidden', isExpanded);
});

document.querySelectorAll('input[name="batch-operation"]').forEach((input) => {
  input.addEventListener('change', syncBatchOperationUI);
});
document.getElementById('batch-set-part')?.addEventListener('change', syncBatchOperationUI);
document.getElementById('batch-find')?.addEventListener('input', syncBatchOperationUI);
document.addEventListener('batch-operation-sync', syncBatchOperationUI);
syncBatchOperationUI();

document.getElementById('batch-preview-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  const indices = getScopeIndicesOrError(statusEl, 'batch');
  if (!indices) {
    return;
  }

  const options = getBatchOperationOptions();
  if (!validateBatchOptions(options, statusEl)) {
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = applyBatchOperation(before, options, indices);
  const summaries = diffScopedRecords(before, after, indices);
  statusEl.textContent = `Preview: ${renderChangeLog(summaries, panel, list)}`;
});

document.getElementById('batch-apply-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  const indices = getScopeIndicesOrError(statusEl, 'batch');
  if (!indices) {
    return;
  }

  const options = getBatchOperationOptions();
  if (!validateBatchOptions(options, statusEl)) {
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = applyBatchOperation(before, options, indices);
  commitBatchChanges(before, after, statusEl, panel, list, indices);
});

document.getElementById('batch-normalize-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  const indices = getScopeIndicesOrError(statusEl, 'batch');
  if (!indices) {
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = batchNormalize(before, indices);
  commitBatchChanges(before, after, statusEl, panel, list, indices);
});

document.getElementById('batch-delete-tag-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');
  const tag = document.getElementById('batch-tag').value.trim();

  if (!tag) {
    return;
  }

  const indices = getScopeIndicesOrError(statusEl, 'batch');
  if (!indices) {
    return;
  }

  const normalizedTag = tag.padStart(3, '0').slice(-3);
  const before = cloneRecords(state.marcRecords);
  const after = batchDeleteTag(before, normalizedTag, indices);
  commitBatchChanges(before, after, statusEl, panel, list, indices);
});

document.getElementById('batch-undo-all').addEventListener('click', () => {
  if (!batchUndoState) {
    return;
  }

  undoAllRecords(
    batchUndoState,
    document.getElementById('batch-changes'),
    document.getElementById('batch-changes-list'),
    document.getElementById('batch-status'),
    'batch',
  );
});

document.getElementById('preview-cleanup').addEventListener('click', () => {
  const statusEl = document.getElementById('cleanup-status');
  const panel = document.getElementById('cleanup-changes');
  const list = document.getElementById('cleanup-changes-list');

  const indices = getScopeIndicesOrError(statusEl, 'cleanup');
  if (!indices) {
    return;
  }

  const options = getCleanupOptions();
  const before = indices.map((index) => cloneMarcRecord(state.marcRecords[index]));
  const after = indices.map((index) => cleanupRecordWithOptions(state.marcRecords[index], options));
  const summaries = diffScopedRecords(before, after, indices);

  statusEl.textContent = `Preview: ${renderChangeLog(summaries, panel, list)}`;
});

document.getElementById('run-cleanup').addEventListener('click', () => {
  const statusEl = document.getElementById('cleanup-status');
  const panel = document.getElementById('cleanup-changes');
  const list = document.getElementById('cleanup-changes-list');

  const indices = getScopeIndicesOrError(statusEl, 'cleanup');
  if (!indices) {
    return;
  }

  const options = getCleanupOptions();
  const beforeMap = new Map(
    indices.map((index) => [index, cloneMarcRecord(state.marcRecords[index])]),
  );

  indices.forEach((index) => {
    state.marcRecords[index] = cleanupRecordWithOptions(state.marcRecords[index], options);
  });

  commitCleanupChanges(beforeMap, statusEl, panel, list);
});

document.getElementById('cleanup-undo-all').addEventListener('click', () => {
  if (!cleanupUndoState) {
    return;
  }

  undoAllRecords(
    cleanupUndoState,
    document.getElementById('cleanup-changes'),
    document.getElementById('cleanup-changes-list'),
    document.getElementById('cleanup-status'),
    'cleanup',
  );
});

function renderModalSubfields() {
  addFieldSubfieldsContainer.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'subfield-row';
  row.innerHTML = '<label>Code<input class="modal-subfield-code" maxlength="1" value="a" /></label><label>Value<input class="modal-subfield-value" type="text" /></label><div></div>';
  addFieldSubfieldsContainer.append(row);
}

function syncAddFieldModalFieldType() {
  const fieldType = addFieldForm.querySelector('input[name="field-type"]:checked')?.value ?? 'data';
  const isControl = fieldType === 'control';
  addFieldDataOptions.classList.toggle('hidden', isControl);
  addFieldControlOptions.classList.toggle('hidden', !isControl);
}

function openAddFieldModal() {
  addFieldForm.reset();
  addFieldError.classList.add('hidden');
  renderModalSubfields();
  syncAddFieldModalFieldType();
  addFieldModal.classList.remove('hidden');
  addFieldTagInput.focus();
}

function closeAddFieldModal() {
  addFieldModal.classList.add('hidden');
}

document.getElementById('add-field').addEventListener('click', openAddFieldModal);
addFieldForm.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'field-type') {
    syncAddFieldModalFieldType();
  }
});

document.getElementById('add-modal-subfield').addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'subfield-row';
  row.innerHTML = '<label>Code<input class="modal-subfield-code" maxlength="1" value="a" /></label><label>Value<input class="modal-subfield-value" type="text" /></label><div></div>';
  addFieldSubfieldsContainer.append(row);
});

addFieldForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const tag = addFieldTagInput.value.trim();
  if (!/^\d{3}$/.test(tag)) {
    addFieldError.textContent = 'Tag must be a 3-digit number.';
    addFieldError.classList.remove('hidden');
    return;
  }

  const record = state.marcRecords[state.selectedIndex];
  const fieldType = addFieldForm.querySelector('input[name="field-type"]:checked')?.value;

  if (fieldType === 'control') {
    const recordType = record.recordType ?? 'bibliographic';
    let controlValue = addFieldControlValueInput.value;
    if (tag === '008' && !controlValue.trim()) {
      controlValue = buildDefault008(recordType);
    }
    controlValue = normalizeControlFieldValue(tag, controlValue, recordType);
    record.fields.push(createControlField(tag, controlValue, { userAdded: true }));
  } else {
    const subfields = [...addFieldSubfieldsContainer.querySelectorAll('.subfield-row')].map((row) => ({
      code: row.querySelector('.modal-subfield-code')?.value.slice(0, 1) || 'a',
      value: row.querySelector('.modal-subfield-value')?.value ?? '',
    }));
    if (subfields.every((subfield) => !subfield.value.trim())) {
      addFieldError.textContent = 'Add at least one subfield value.';
      addFieldError.classList.remove('hidden');
      return;
    }
    const indicators = String(addFieldIndicatorsInput?.value ?? '').padEnd(2, ' ').slice(0, 2);
    record.fields.push(createDataField(
      tag,
      indicators.charAt(0),
      indicators.charAt(1),
      subfields,
      `${tag} field`,
      { userAdded: true },
    ));
  }

  closeAddFieldModal();
  commitRecordChange(record);
  renderEditor(record);
});

addFieldModal.querySelectorAll('[data-close-modal]').forEach((element) => {
  element.addEventListener('click', closeAddFieldModal);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (!addFieldModal.classList.contains('hidden')) {
    closeAddFieldModal();
    return;
  }

  if (!deleteRecordsModal?.classList.contains('hidden')) {
    closeDeleteRecordsModal();
  }
});

document.getElementById('scope-select-all')?.addEventListener('click', () => {
  if (!hasRecords()) {
    return;
  }

  const indices = getVisibleRecordIndices();
  setScopedIndices(indices);
  setRecordScopeMode(indices.length === state.marcRecords.length ? 'all' : 'custom');
  syncScopeFieldsets();
});

document.getElementById('scope-clear-selection')?.addEventListener('click', () => {
  if (!hasRecords()) {
    return;
  }
  setScopedIndices([]);
  setRecordScopeMode('custom');
  syncScopeFieldsets();
});

['batch-record-scope-mode', 'cleanup-record-scope-mode', 'export-record-scope-mode'].forEach((groupName) => {
  document.querySelectorAll(`input[name="${groupName}"]`).forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        handleScopeModeChange(radio.value);
      }
    });
  });
});

document.querySelector('.nav-tab[data-tab="order"]')?.addEventListener('click', () => {
  renderRecordOrderList();
});

document.getElementById('batch-scope-apply')?.addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const error = applyScopeFromText('batch');
  if (error) {
    statusEl.textContent = error;
    return;
  }
  const indices = filterIndicesByRecordType(getScopedIndices());
  statusEl.textContent = indices.length === 0
    ? getEmptyScopeMessage()
    : `Scope applied: ${formatScopeStatusMessage(indices)}.`;
});

document.getElementById('export-scope-apply')?.addEventListener('click', () => {
  const error = applyScopeFromText('export');
  if (error) {
    setStatus(error, true);
    return;
  }
  const indices = filterIndicesByRecordType(getScopedIndices());
  setStatus(indices.length === 0
    ? 'Export scope applied, but no records match the current filters.'
    : `Export scope applied: ${formatScopeStatusMessage(indices)}.`);
  refreshExportPreview();
  roadmapApi?.updateLinkCheckButtonLabel?.();
});

document.getElementById('cleanup-scope-apply')?.addEventListener('click', () => {
  const statusEl = document.getElementById('cleanup-status');
  const error = applyScopeFromText('cleanup');
  if (error) {
    statusEl.textContent = error;
    return;
  }
  const indices = filterIndicesByRecordType(getScopedIndices());
  statusEl.textContent = indices.length === 0
    ? getEmptyScopeMessage()
    : `Scope applied: ${formatScopeStatusMessage(indices)}.`;
});

document.querySelectorAll('.scope-type-filter').forEach((select) => {
  select.addEventListener('change', () => {
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    patchState({ scopeRecordTypeFilter: select.value });
    syncScopeFieldsets();
  });
});

document.getElementById('batch-scope-text')?.addEventListener('blur', () => {
  if (state.recordScopeMode === 'custom') {
    applyScopeFromText('batch');
    syncScopeFieldsets();
  }
});

document.getElementById('export-scope-text')?.addEventListener('blur', () => {
  if (state.recordScopeMode === 'custom') {
    applyScopeFromText('export');
    syncScopeFieldsets();
    refreshExportPreview();
    roadmapApi?.updateLinkCheckButtonLabel?.();
  }
});

document.getElementById('cleanup-scope-text')?.addEventListener('blur', () => {
  if (state.recordScopeMode === 'custom') {
    applyScopeFromText('cleanup');
    syncScopeFieldsets();
  }
});

document.querySelectorAll('.sample-link').forEach((sampleLink) => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    sampleLink.href = chrome.runtime.getURL('BookDonationTemplate.xlsx');
  }
});

const { showColumnMappingPanel } = initColumnMappingUI({
  loadImportResult,
  setStatus,
  buildMarcRecords,
  normalizeMarcRecords,
  patchState,
});

roadmapApi = initRoadmapFeatures({
  state,
  patchState,
  hasRecords,
  getFilteredRecordIndices,
  getVisibleRecordIndices,
  refreshEditView,
  refreshExportPreview,
  populateCompareRecordSelects,
  switchTab,
  setStatus,
  loadImportResult,
  buildMarcRecords,
  normalizeMarcRecords,
  cloneMarcRecord,
  selectRecord,
  commitRecordChange,
  resetRecordEditTracking,
  renderEditor,
  refreshValidationUI,
  getScopeIndicesOrError,
  filterIndicesByRecordType,
  getScopedIndices,
  createBlankRecord,
  recordToParsedRow,
  allValidationIssuesRef: { get value() { return allValidationIssues; }, set value(v) { allValidationIssues = v; } },
  navigateToNextValidationIssue,
  setRecordSearchQuery: (query) => {
    recordSearchQuery = query;
    renderRecordList();
    renderValidationBanner();
    roadmapApi?.updateLinkCheckButtonLabel?.();
  },
});
