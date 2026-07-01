import { parseFile } from '../lib/file-import.js';
import { importMarcFile } from '../lib/marc-import.js';
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
import { validateRecord, hasValidationErrors } from '../lib/marc-validate.js';
import { batchFindReplace, batchDeleteTag, batchNormalize, DEFAULT_BATCH_TARGETS } from '../lib/batch-edit.js';
import { diffMarcRecords, summarizeChangeLog } from '../lib/marc-diff.js';
import { getState, patchState, hasRecords } from '../lib/app-state.js';

/** @typedef {import('../lib/marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('../lib/marc-builder.js').MarcField} MarcField */
/** @typedef {import('../lib/marc-builder.js').MarcDataField} MarcDataField */

const state = getState();
let advancedView = false;

/**
 * @typedef {{ snapshots: Map<number, MarcRecord>, summaries: import('../lib/marc-diff.js').RecordChangeSummary[] }} UndoState
 */

/** @type {UndoState|null} */
let batchUndoState = null;

/** @type {UndoState|null} */
let cleanupUndoState = null;

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
const validationPanel = document.getElementById('validation-panel');
const validationList = document.getElementById('validation-list');
const advancedToggle = document.getElementById('advanced-toggle');
const exportFormat = document.getElementById('export-format');
const exportPreview = document.getElementById('export-preview');
const blockInvalidExport = document.getElementById('block-invalid-export');
const addFieldModal = document.getElementById('add-field-modal');
const addFieldForm = document.getElementById('add-field-form');
const addFieldTagInput = document.getElementById('add-field-tag');
const addFieldInd1Input = document.getElementById('add-field-ind1');
const addFieldInd2Input = document.getElementById('add-field-ind2');
const addFieldDataOptions = document.getElementById('add-field-data-options');
const addFieldControlValueWrap = document.getElementById('add-field-control-value-wrap');
const addFieldControlValueInput = document.getElementById('add-field-control-value');
const addFieldSubfieldsContainer = document.getElementById('add-field-subfields');
const addFieldError = document.getElementById('add-field-error');

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

function setStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle('error', isError);
}

function loadImportResult(result, filename) {
  const parsedRows = result.parsedRows ?? [];
  const records = result.records ?? buildMarcRecords(parsedRows, result.columnSchema).map(cloneMarcRecord);

  patchState({
    columnSchema: result.columnSchema,
    skippedColumns: result.skippedColumns,
    parsedRows,
    marcRecords: records,
    selectedIndex: 0,
  });

  renderMappingSummary();
  refreshEditView();
  setStatus(`Loaded ${state.marcRecords.length} record${state.marcRecords.length === 1 ? '' : 's'} from ${filename}.`);
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
    refreshExportPreview();
    return;
  }

  editEmpty.classList.add('hidden');
  workspace.classList.remove('hidden');
  renderRecordList();
  renderEditor(state.marcRecords[state.selectedIndex]);
  refreshExportPreview();
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

function renderRecordList() {
  recordList.innerHTML = '';
  recordCount.textContent = `${state.marcRecords.length} record${state.marcRecords.length === 1 ? '' : 's'}`;

  state.marcRecords.forEach((record, index) => {
    const row = state.parsedRows[index] ?? recordToParsedRow(record);
    const preview = getRecordPreview(record);
    const item = document.createElement('li');
    item.className = 'record-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === state.selectedIndex));
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="record-item-title">${escapeHtml(row.previewTitle ?? preview.title)}</div>
      <div class="record-item-author">${escapeHtml(row.previewAuthor ?? preview.author)}</div>
      <div class="record-item-row">Row ${record.sourceRowNumber} · ${record.recordType ?? 'bibliographic'}</div>
    `;
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
}

function selectRecord(index) {
  if (index < 0 || index >= state.marcRecords.length) return;
  patchState({ selectedIndex: index });
  renderRecordList();
  renderEditor(state.marcRecords[index]);
}

function getFieldGroup(field) {
  if (field.type === 'control') return 'Control';
  return field.group ?? inferFieldGroup(field.tag);
}

function renderValidation(record) {
  const issues = validateRecord(record);
  validationPanel.classList.toggle('hidden', issues.length === 0);
  validationList.innerHTML = '';
  issues.forEach((issue) => {
    const item = document.createElement('li');
    item.className = issue.level === 'error' ? 'validation-error' : 'validation-warning';
    item.textContent = issue.message;
    validationList.append(item);
  });
}

function renderEditor(record) {
  selectedRecordMeta.textContent = `Row ${record.sourceRowNumber} · ${record.recordType ?? 'bibliographic'}`;
  renderValidation(record);
  renderLeader(record);
  fieldEditor.innerHTML = '';

  collectFieldGroups(record).forEach((groupName) => {
    const fields = record.fields.map((field, index) => ({ field, index })).filter(({ field }) => getFieldGroup(field) === groupName);
    if (fields.length === 0) return;

    const section = document.createElement('section');
    section.className = 'field-group';
    section.innerHTML = `<h3 class="field-group-title">${groupName}</h3>`;
    fields.forEach(({ field, index }) => section.append(renderFieldCard(field, index, record)));
    fieldEditor.append(section);
  });

  marcPreview.textContent = recordToMarcText(record);
  refreshExportPreview();
}

function renderLeader(record) {
  leaderEditor.innerHTML = '';
  const group = document.createElement('section');
  group.className = 'field-group';
  group.innerHTML = '<h3 class="field-group-title">Leader</h3>';
  const label = document.createElement('label');
  label.textContent = 'LDR';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'leader-input';
  input.value = record.leader;
  input.maxLength = 24;
  input.addEventListener('input', (event) => {
    record.leader = event.target.value.padEnd(24, ' ').slice(0, 24);
    marcPreview.textContent = recordToMarcText(record);
    refreshExportPreview();
  });
  label.append(input);
  group.append(label);
  leaderEditor.append(group);
}

function renderFieldCard(field, fieldIndex, record) {
  const card = document.createElement('article');
  card.className = 'field-card';
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
      renderEditor(record);
    });
    header.append(removeButton);
  }

  card.append(header);

  if (field.type === 'control') {
    const controlLabel = document.createElement('label');
    controlLabel.textContent = `Tag ${field.tag}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value;
    input.addEventListener('input', (event) => {
      field.value = event.target.value;
      marcPreview.textContent = recordToMarcText(record);
      refreshExportPreview();
      renderValidation(record);
    });
    controlLabel.append(input);
    card.append(controlLabel);
    return card;
  }

  if (advancedView) {
    const grid = document.createElement('div');
    grid.className = 'field-grid';
    grid.append(
      createInputField('Tag', field.tag, (value) => { field.tag = value.padStart(3, '0').slice(-3); marcPreview.textContent = recordToMarcText(record); refreshExportPreview(); }),
      createInputField('Ind1', field.ind1, (value) => { field.ind1 = value.slice(0, 1) || ' '; marcPreview.textContent = recordToMarcText(record); refreshExportPreview(); }),
      createInputField('Ind2', field.ind2, (value) => { field.ind2 = value.slice(0, 1) || ' '; marcPreview.textContent = recordToMarcText(record); refreshExportPreview(); }),
    );
    card.append(grid);
  }

  const subfieldList = document.createElement('div');
  subfieldList.className = 'subfield-list';
  field.subfields.forEach((subfield, subfieldIndex) => {
    subfieldList.append(renderSubfieldRow(field, subfieldIndex, record));
  });

  const addSubfieldButton = document.createElement('button');
  addSubfieldButton.type = 'button';
  addSubfieldButton.className = 'secondary';
  addSubfieldButton.textContent = 'Add subfield';
  addSubfieldButton.addEventListener('click', () => {
    field.subfields.push({ code: 'a', value: '' });
    renderEditor(record);
  });
  card.append(subfieldList, addSubfieldButton);
  return card;
}

function renderSubfieldRow(field, subfieldIndex, record) {
  const subfield = field.subfields[subfieldIndex];
  const row = document.createElement('div');
  row.className = 'subfield-row';
  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Code';
  const codeInput = document.createElement('input');
  codeInput.maxLength = 1;
  codeInput.value = subfield.code;
  codeInput.addEventListener('input', (event) => {
    subfield.code = event.target.value.slice(0, 1) || 'a';
    marcPreview.textContent = recordToMarcText(record);
    refreshExportPreview();
  });
  codeLabel.append(codeInput);

  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Value';
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.value = subfield.value;
  valueInput.addEventListener('input', (event) => {
    subfield.value = event.target.value;
    marcPreview.textContent = recordToMarcText(record);
    refreshExportPreview();
    renderValidation(record);
  });
  valueLabel.append(valueInput);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'secondary danger';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    field.subfields.splice(subfieldIndex, 1);
    if (field.subfields.length === 0) field.subfields.push({ code: 'a', value: '' });
    renderEditor(record);
  });

  row.append(codeLabel, valueLabel, removeButton);
  return row;
}

function createInputField(labelText, value, onChange) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', (event) => onChange(event.target.value));
  label.append(input);
  return label;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getBatchReplaceOptions() {
  return {
    find: document.getElementById('batch-find').value,
    replace: document.getElementById('batch-replace').value,
    useRegex: document.getElementById('batch-regex').checked,
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

function getCleanupScopeAll() {
  return document.querySelector('input[name="cleanup-scope"]:checked')?.value === 'all';
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
function commitBatchChanges(before, after, statusEl, panel, list) {
  state.marcRecords.splice(0, state.marcRecords.length, ...after);
  const summaries = diffMarcRecords(before, after, state.parsedRows);

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

function applyBatchFindReplace(records, options) {
  return batchFindReplace(records, {
    ...options,
    targets: { ...DEFAULT_BATCH_TARGETS, ...options.targets },
  });
}

async function handleSpreadsheet(file) {
  if (!file) return;
  setStatus(`Loading ${file.name}...`);
  try {
    const result = await parseFile(await file.arrayBuffer(), file.name);
    loadImportResult(result, file.name);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read file.', true);
  }
}

async function handleMarcFile(file) {
  if (!file) return;
  setStatus(`Loading ${file.name}...`);
  try {
    const result = await importMarcFile(await file.arrayBuffer(), file.name);
    loadImportResult(result, file.name);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read MARC file.', true);
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

wireDropZone('drop-zone-spreadsheet', 'file-input-spreadsheet', handleSpreadsheet);
wireDropZone('drop-zone-marc', 'file-input-marc', handleMarcFile);

document.getElementById('new-record').addEventListener('click', () => {
  const recordType = document.getElementById('record-type-select').value;
  const record = createBlankRecord(recordType, state.marcRecords.length + 1);
  state.marcRecords.push(record);
  state.parsedRows.push(recordToParsedRow(record));
  patchState({ selectedIndex: state.marcRecords.length - 1 });
  refreshEditView();
  switchTab('edit');
});

document.getElementById('duplicate-record').addEventListener('click', () => {
  const source = state.marcRecords[state.selectedIndex];
  if (!source) return;
  const copy = cloneMarcRecord(source);
  copy.sourceRowNumber = state.marcRecords.length + 1;
  state.marcRecords.push(copy);
  state.parsedRows.push(recordToParsedRow(copy));
  patchState({ selectedIndex: state.marcRecords.length - 1 });
  refreshEditView();
});

document.getElementById('prev-record').addEventListener('click', () => selectRecord(state.selectedIndex - 1));
document.getElementById('next-record').addEventListener('click', () => selectRecord(state.selectedIndex + 1));

advancedToggle.addEventListener('change', (event) => {
  advancedView = event.target.checked;
  if (state.marcRecords[state.selectedIndex]) renderEditor(state.marcRecords[state.selectedIndex]);
});

exportFormat.addEventListener('change', () => {
  refreshExportPreview();
});

document.getElementById('export-records').addEventListener('click', async () => {
  if (!hasRecords()) return;
  if (blockInvalidExport.checked) {
    const issues = state.marcRecords.flatMap((record) => validateRecord(record));
    if (hasValidationErrors(issues)) {
      setStatus('Export blocked due to validation errors. Fix errors or disable the block option.', true);
      return;
    }
  }
  await exportRecords(state.marcRecords, exportFormat.value);
});

document.getElementById('batch-preview-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  if (!hasRecords()) {
    statusEl.textContent = 'Load records first.';
    return;
  }

  const options = getBatchReplaceOptions();
  if (!options.find) {
    statusEl.textContent = 'Enter text to find.';
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = applyBatchFindReplace(before, options);
  const summaries = diffMarcRecords(before, after, state.parsedRows);
  statusEl.textContent = `Preview: ${renderChangeLog(summaries, panel, list)}`;
});

document.getElementById('batch-apply-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  if (!hasRecords()) {
    statusEl.textContent = 'Load records first.';
    return;
  }

  const options = getBatchReplaceOptions();
  if (!options.find) {
    statusEl.textContent = 'Enter text to find.';
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = applyBatchFindReplace(state.marcRecords, options);
  commitBatchChanges(before, after, statusEl, panel, list);
});

document.getElementById('batch-normalize-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');

  if (!hasRecords()) {
    return;
  }

  const before = cloneRecords(state.marcRecords);
  const after = batchNormalize(state.marcRecords);
  commitBatchChanges(before, after, statusEl, panel, list);
});

document.getElementById('batch-delete-tag-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('batch-status');
  const panel = document.getElementById('batch-changes');
  const list = document.getElementById('batch-changes-list');
  const tag = document.getElementById('batch-tag').value.trim();

  if (!tag || !hasRecords()) {
    return;
  }

  const normalizedTag = tag.padStart(3, '0').slice(-3);
  const before = cloneRecords(state.marcRecords);
  const after = batchDeleteTag(state.marcRecords, normalizedTag);
  commitBatchChanges(before, after, statusEl, panel, list);
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

  if (!hasRecords()) {
    statusEl.textContent = 'Load records first.';
    return;
  }

  const scopeAll = getCleanupScopeAll();
  const options = getCleanupOptions();
  const indices = scopeAll
    ? state.marcRecords.map((_, index) => index)
    : [state.selectedIndex];

  const before = indices.map((index) => cloneMarcRecord(state.marcRecords[index]));
  const after = indices.map((index) => cleanupRecordWithOptions(state.marcRecords[index], options));
  const summaries = diffMarcRecords(before, after, indices.map((index) => state.parsedRows[index])).map((summary, summaryIndex) => ({
    ...summary,
    recordIndex: indices[summaryIndex],
  }));

  statusEl.textContent = `Preview: ${renderChangeLog(summaries, panel, list)}`;
});

document.getElementById('run-cleanup').addEventListener('click', () => {
  const statusEl = document.getElementById('cleanup-status');
  const panel = document.getElementById('cleanup-changes');
  const list = document.getElementById('cleanup-changes-list');

  if (!hasRecords()) {
    statusEl.textContent = 'Load records first.';
    return;
  }

  const scopeAll = getCleanupScopeAll();
  const options = getCleanupOptions();
  const indices = scopeAll
    ? state.marcRecords.map((_, index) => index)
    : [state.selectedIndex];

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

function openAddFieldModal() {
  addFieldForm.reset();
  addFieldError.classList.add('hidden');
  renderModalSubfields();
  addFieldDataOptions.classList.remove('hidden');
  addFieldControlValueWrap.classList.add('hidden');
  addFieldModal.classList.remove('hidden');
  addFieldTagInput.focus();
}

function closeAddFieldModal() {
  addFieldModal.classList.add('hidden');
}

document.getElementById('add-field').addEventListener('click', openAddFieldModal);
addFieldForm.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'field-type') {
    const isControl = event.target.value === 'control';
    addFieldDataOptions.classList.toggle('hidden', isControl);
    addFieldControlValueWrap.classList.toggle('hidden', !isControl);
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
    record.fields.push(createControlField(tag, addFieldControlValueInput.value));
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
    record.fields.push(createDataField(tag, addFieldInd1Input.value, addFieldInd2Input.value, subfields, `${tag} field`));
  }

  closeAddFieldModal();
  renderEditor(record);
});

addFieldModal.querySelectorAll('[data-close-modal]').forEach((element) => {
  element.addEventListener('click', closeAddFieldModal);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !addFieldModal.classList.contains('hidden')) closeAddFieldModal();
});

const sampleLink = document.querySelector('.sample-link');
if (sampleLink && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  sampleLink.href = chrome.runtime.getURL('BookDonationTemplate.xlsx');
}
