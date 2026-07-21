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
import { cleanupRecordWithOptions } from '../lib/marc-cleanup.js';
import {
  validateAllRecords,
  summarizeValidation,
  getRecordIssues,
  hasValidationErrors,
  groupValidationIssues,
} from '../lib/marc-validate.js';
import { batchFindReplace, batchDeleteTag, batchNormalize, DEFAULT_BATCH_TARGETS } from '../lib/batch-edit.js';
import { diffMarcRecords, summarizeChangeLog } from '../lib/marc-diff.js';
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
import { buildDefault008, createFixedFieldEditor, getLeaderDefinition, getField008Definition, normalizeControlFieldValue, normalizeMarcRecord, normalizeMarcRecords, padFixedField, shouldUseSegmentedFixedField } from '../lib/marc-fixed-field.js';

/** @typedef {import('../lib/marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('../lib/marc-builder.js').MarcField} MarcField */
/** @typedef {import('../lib/marc-builder.js').MarcDataField} MarcDataField */

const state = getState();

/** @type {'all'|'bibliographic'|'authority'|'holdings'} */
let recordListFilter = 'all';

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
  refreshEditView();
  const { errors, warnings } = summarizeValidation(allValidationIssues);
  const validationNote = errors > 0
    ? ` ${errors} validation error${errors === 1 ? '' : 's'} found.`
    : warnings > 0
      ? ` ${warnings} validation warning${warnings === 1 ? '' : 's'} found.`
      : '';
  setStatus(`Loaded ${state.marcRecords.length} record${state.marcRecords.length === 1 ? '' : 's'} from ${filename}.${validationNote}`);
  switchTab('edit');
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
    return;
  }

  editEmpty.classList.add('hidden');
  workspace.classList.remove('hidden');
  allValidationIssues = validateAllRecords(state.marcRecords);
  renderRecordList();
  renderEditor(state.marcRecords[state.selectedIndex]);
  renderValidationBanner();
  renderRecordListValidationBadges();
  syncScopeFieldsets();
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
    exportPreview.textContent = await previewExport(state.marcRecords, exportFormat.value);
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
 * @returns {import('../lib/marc-validate.js').ValidationIssue[]}
 */
function getVisibleValidationIssues() {
  if (recordListFilter === 'all') {
    return allValidationIssues;
  }

  const visibleIndices = new Set(getFilteredRecordIndices());
  return allValidationIssues.filter((issue) => visibleIndices.has(issue.recordIndex ?? -1));
}

function getRecordListFilterLabel() {
  if (recordListFilter === 'all') {
    return '';
  }

  return recordListFilter.charAt(0).toUpperCase() + recordListFilter.slice(1);
}

function updateRecordCountBadge() {
  const total = state.marcRecords.length;
  const visible = getFilteredRecordIndices();

  if (recordListFilter === 'all' || visible.length === total) {
    recordCount.textContent = `${total} record${total === 1 ? '' : 's'}`;
    return;
  }

  recordCount.textContent = `${visible.length} of ${total}`;
}

function renderRecordList() {
  recordList.innerHTML = '';
  updateRecordCountBadge();
  const scopedIndices = state.scopedRecordIndices;
  const filteredIndices = getFilteredRecordIndices();

  if (filteredIndices.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'record-list-empty';
    const typeLabel = recordListFilter === 'all' ? '' : ` ${recordListFilter}`;
    emptyItem.textContent = `No${typeLabel} records match this filter.`;
    recordList.append(emptyItem);
    updateScopeSelectionBadge();
    return;
  }

  filteredIndices.forEach((index) => {
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
    scopeCheckbox.checked = scopedIndices.has(index);
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

    const recordIssues = getRecordIssues(allValidationIssues, index);
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
    recordList.append(item);
  });

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
  const visibleIndices = getFilteredRecordIndices();
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
  const visibleIndices = getFilteredRecordIndices();

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
 * @param {MarcDataField} field
 * @param {string} text
 */
function applyMarcIndicators(field, text) {
  const normalized = String(text ?? '').padEnd(2, ' ').slice(0, 2);
  field.ind1 = normalized.charAt(0);
  field.ind2 = normalized.charAt(1);
}

/**
 * Persist the current in-memory record, refresh validation, preview, and list badges.
 * @param {MarcRecord} record
 */
function commitRecordChange(record) {
  normalizeMarcRecord(record);
  marcPreview.textContent = recordToMarcText(record);
  refreshExportPreview();
  refreshValidationUI();
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

  syncRecordListCheckboxes();
}

/**
 * @param {'batch'|'cleanup'} panel
 * @returns {string|null}
 */
function applyScopeFromText(panel) {
  const input = panel === 'cleanup'
    ? document.getElementById('cleanup-scope-text')
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
  const statusEl = document.getElementById('duplicate-status');
  const undoButton = document.getElementById('duplicate-undo');
  if (!statusEl) {
    return;
  }

  if (!message) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    undoButton?.classList.add('hidden');
    return;
  }

  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
}

function updateDuplicateUndoUI() {
  const undoButton = document.getElementById('duplicate-undo');
  if (!undoButton) {
    return;
  }

  undoButton.classList.toggle('hidden', !duplicateUndoState);
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
  setDuplicateStatus(`Duplicated ${countLabel}. Click Undo duplicate to remove the copies.`);
  updateDuplicateUndoUI();
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
  if (mode === 'current') {
    setScopedIndices([state.selectedIndex]);
  } else if (mode === 'all') {
    patchState({ scopedRecordIndices: new Set(allRecordIndices(state.marcRecords.length)) });
  }
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

  if (state.recordScopeMode === 'custom') {
    const scopeError = applyScopeFromText(panel);
    if (scopeError) {
      statusEl.textContent = scopeError;
      return null;
    }
  }

  const indices = getScopedIndices();
  if (indices.length === 0) {
    statusEl.textContent = 'No records in scope.';
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

  const targets = { ...DEFAULT_BATCH_TARGETS };
  const issueKey = group.issueKey ?? '';

  if (issueKey.startsWith('leader')) {
    Object.keys(targets).forEach((key) => {
      targets[key] = key === 'leader';
    });
  } else if (issueKey.startsWith('empty-subfield') || issueKey.startsWith('invalid-subfield-code')) {
    targets.leader = false;
    targets.controlTags = false;
    targets.controlValues = false;
    targets.indicators = false;
    targets.subfieldCodes = false;
    targets.subfieldValues = true;
  } else if (issueKey.startsWith('duplicate-control') || issueKey.startsWith('empty-control') || issueKey.startsWith('008-length') || issueKey.startsWith('empty-001')) {
    targets.leader = false;
    targets.controlTags = issueKey.startsWith('duplicate-control');
    targets.controlValues = true;
    targets.indicators = false;
    targets.subfieldCodes = false;
    targets.subfieldValues = false;
  } else if (issueKey.startsWith('indicator')) {
    targets.leader = false;
    targets.controlTags = false;
    targets.controlValues = false;
    targets.indicators = true;
    targets.subfieldCodes = false;
    targets.subfieldValues = false;
  }

  document.getElementById('batch-target-leader').checked = targets.leader;
  document.getElementById('batch-target-control-values').checked = targets.controlValues;
  document.getElementById('batch-target-control-tags').checked = targets.controlTags;
  document.getElementById('batch-target-indicators').checked = targets.indicators;
  document.getElementById('batch-target-subfield-codes').checked = targets.subfieldCodes;
  document.getElementById('batch-target-subfield-values').checked = targets.subfieldValues;

  const statusEl = document.getElementById('batch-status');
  const scopeLabel = formatRecordRanges(group.recordIndices);
  let message = `Batch tab pre-filled for Records ${scopeLabel}`;
  if (group.tag) {
    message += ` — tag ${group.tag}`;
  }
  if (group.subfieldCode) {
    message += `, subfield $${group.subfieldCode}`;
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

/**
 * @param {string} issueKey
 * @returns {string}
 */
function getIssueFixHint(issueKey) {
  if (issueKey.startsWith('indicator') || issueKey === '245-indicators') {
    return 'How to fix: edit the Indicators field on the field card (two characters, e.g. 10 or 00), or use the Batch tab with the Indicators target.';
  }
  if (issueKey.startsWith('leader')) {
    return 'How to fix: edit the Leader segments at the top of the field editor (Edit tab).';
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
    return 'How to fix: correct the Code input (single letter or digit) next to the subfield value on the field card.';
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

function renderValidationBanner() {
  const visibleIssues = getVisibleValidationIssues();
  const { errors, warnings, recordsWithErrors } = summarizeValidation(visibleIssues);
  const filterLabel = getRecordListFilterLabel();
  const filterSuffix = filterLabel ? ` (${filterLabel} records only)` : '';

  if (errors === 0 && warnings === 0) {
    validationBanner.classList.add('hidden');
    validationBannerList.classList.add('hidden');
    validationBannerToggle.setAttribute('aria-expanded', 'false');
    return;
  }

  validationBanner.classList.remove('hidden');
  validationBanner.classList.toggle('validation-banner-warnings-only', errors === 0);

  if (errors > 0) {
    validationBannerSummary.textContent = `${errors} validation error${errors === 1 ? '' : 's'} in ${recordsWithErrors} record${recordsWithErrors === 1 ? '' : 's'}${filterSuffix}${warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''} — select to view details`;
  } else {
    validationBannerSummary.textContent = `${warnings} validation warning${warnings === 1 ? '' : 's'}${filterSuffix} — select to view details`;
  }

  const openGroupKeys = new Set(
    [...validationBannerList.querySelectorAll('.validation-banner-group[open]')].map(
      (element) => element.dataset.groupKey,
    ),
  );

  validationBannerList.innerHTML = '';

  const { groups, individuals } = groupValidationIssues(visibleIssues);

  groups.forEach((group) => {
    const details = document.createElement('details');
    details.className = 'validation-banner-group';
    details.dataset.groupKey = `${group.level}|${group.issueKey}`;
    details.open = openGroupKeys.has(details.dataset.groupKey);

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

    if (group.supportsBatchEdit) {
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

  individuals.forEach((issue) => {
    const item = document.createElement('li');
    item.className = 'validation-banner-individual';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `validation-banner-issue ${issue.level === 'error' ? 'validation-error' : 'validation-warning'}`;
    const location = issue.fieldIndex != null
      ? issue.subfieldIndex != null
        ? ` [field ${issue.tag ?? issue.fieldIndex}, $${issue.path?.includes('code') ? 'code' : 'value'}]`
        : ` [${issue.tag ? `tag ${issue.tag}` : `field ${issue.fieldIndex + 1}`}]`
      : issue.path === 'leader'
        ? ' [Leader]'
        : '';
    const recordLabel = issue.recordLabel ?? `Record ${(issue.recordIndex ?? 0) + 1}`;
    button.textContent = `${recordLabel} · ${issue.level === 'error' ? 'Error' : 'Warning'}:${location} ${issue.message}`;
    button.addEventListener('click', () => navigateToIssue(issue));
    item.append(button);

    const fixHint = document.createElement('p');
    fixHint.className = 'validation-fix-hint';
    fixHint.textContent = getIssueFixHint(issue.issueKey ?? '');
    item.append(fixHint);

    validationBannerList.append(item);
  });
}

function applyValidationHighlights(recordIndex) {
  const recordIssues = getRecordIssues(allValidationIssues, recordIndex);
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

  allValidationIssues = validateAllRecords(state.marcRecords);
  renderValidationBanner();
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

    const recordIssues = getRecordIssues(allValidationIssues, index);
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
  const recordIssues = getRecordIssues(allValidationIssues, recordIndex);
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
  return row;
}

function renderFieldCard(field, fieldIndex, record, recordIndex) {
  const recordIssues = getRecordIssues(allValidationIssues, recordIndex);
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
    header.append(removeButton);
  }

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
  codeInput.className = 'subfield-row-code field-input';
  codeInput.maxLength = 1;
  codeInput.value = subfield.code;
  codeInput.classList.toggle(
    'input-invalid',
    subfieldIssues.some((issue) => issue.level === 'error' && issue.path?.includes('code')),
  );
  codeInput.addEventListener('input', (event) => {
    subfield.code = event.target.value.slice(0, 1) || 'a';
    commitRecordChange(record);
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

function getBatchReplaceOptions() {
  return {
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
  const summaries = diffScopedRecords(before, after, indices);

  if (summaries.length === 0) {
    batchUndoState = null;
    document.getElementById('batch-undo-all')?.classList.add('hidden');
    panel.classList.add('hidden');
    list.innerHTML = '';
    statusEl.textContent = 'No changes detected.';
  } else {
    batchUndoState = createUndoState(before, summaries);
    statusEl.textContent = renderChangeLog(summaries, panel, list, 'batch');
  }

  refreshEditView();
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

  refreshEditView();
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

async function handleImportFile(file) {
  if (!file) return;
  setStatus(`Loading ${file.name}...`);
  try {
    const result = await importUploadedFile(await file.arrayBuffer(), file.name);
    loadImportResult(result, file.name);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read file.', true);
  }
}

function wireDropZone(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', () => input.click());
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

document.getElementById('new-record').addEventListener('click', () => {
  const recordType = document.getElementById('record-type-select').value;
  const record = createBlankRecord(recordType, state.marcRecords.length + 1);
  state.marcRecords.push(record);
  state.parsedRows.push(recordToParsedRow(record));
  patchState({ selectedIndex: state.marcRecords.length - 1 });
  clearDuplicateUndo();
  refreshEditView();
  switchTab('edit');
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
  await exportRecords(state.marcRecords, exportFormat.value);
});

validationBannerToggle.addEventListener('click', () => {
  const isExpanded = validationBannerToggle.getAttribute('aria-expanded') === 'true';
  validationBannerToggle.setAttribute('aria-expanded', String(!isExpanded));
  validationBannerList.classList.toggle('hidden', isExpanded);
});

document.getElementById('batch-preview-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  const indices = getScopeIndicesOrError(statusEl, 'batch');
  if (!indices) {
    return;
  }

  const options = getBatchReplaceOptions();
  if (!options.find) {
    statusEl.textContent = 'Enter text to find.';
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = applyBatchFindReplace(before, options, indices);
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

  const options = getBatchReplaceOptions();
  if (!options.find) {
    statusEl.textContent = 'Enter text to find.';
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = applyBatchFindReplace(state.marcRecords, options, indices);
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
  const after = batchNormalize(state.marcRecords, indices);
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
  const after = batchDeleteTag(state.marcRecords, normalizedTag, indices);
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

  const indices = getFilteredRecordIndices();
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

['batch-record-scope-mode', 'cleanup-record-scope-mode'].forEach((groupName) => {
  document.querySelectorAll(`input[name="${groupName}"]`).forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        handleScopeModeChange(radio.value);
      }
    });
  });
});

document.getElementById('batch-scope-apply')?.addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const error = applyScopeFromText('batch');
  statusEl.textContent = error ?? `Scope applied: Records ${formatRecordRanges(getScopedIndices())}.`;
});

document.getElementById('cleanup-scope-apply')?.addEventListener('click', () => {
  const statusEl = document.getElementById('cleanup-status');
  const error = applyScopeFromText('cleanup');
  statusEl.textContent = error ?? `Scope applied: Records ${formatRecordRanges(getScopedIndices())}.`;
});

document.getElementById('batch-scope-text')?.addEventListener('blur', () => {
  if (state.recordScopeMode === 'custom') {
    applyScopeFromText('batch');
    syncScopeFieldsets();
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
