import { getSearchFilteredIndices, intersectRecordIndices } from '../lib/record-search.js';
import { getFieldHelp } from '../lib/marc-field-help.js';
import { canAutoFixIssue, applyAutoFix } from '../lib/marc-autofix.js';
import { pickRecordsByIndices, resolveExportIndices } from '../lib/export-scope.js';
import { insertAtCursor, renderDiacriticsPopover } from '../lib/diacritics.js';
import { check856Links, collect856Urls } from '../lib/link-checker.js';
import { computeRecordStats } from '../lib/marc-stats.js';
import {
  buildSessionPayload,
  downloadSessionFile,
  parseSessionFile,
  saveDraftToStorage,
  loadDraftFromStorage,
  clearDraftFromStorage,
  loadBatchPresets,
  saveBatchPresets,
  draftDiffersFromSession,
  getRecordIdentityKey,
} from '../lib/session-storage.js';
import { createUndoStack } from '../lib/undo-stack.js';
import { parseMarcTextToRecord } from '../lib/marc-import.js';
import { recordToMarcText } from '../lib/marc-export.js';

/** @typedef {import('../lib/marc-builder.js').MarcRecord} MarcRecord */

/** @type {import('../lib/marc-builder.js').MarcField|null} */
export let fieldClipboard = null;

export const undoStack = createUndoStack();

const RECORD_ITEM_HEIGHT = 76;

/**
 * @param {string} query
 * @param {MarcRecord[]} records
 * @param {import('../lib/file-import.js').ParsedRow[]} parsedRows
 * @param {number[]} typeFilteredIndices
 */
export function getVisibleRecordIndices(query, records, parsedRows, typeFilteredIndices) {
  const searchIndices = getSearchFilteredIndices(records, parsedRows, query);
  return intersectRecordIndices(typeFilteredIndices, searchIndices);
}

/**
 * @param {string} tag
 * @returns {HTMLElement|null}
 */
export function createFieldHelpPanel(tag) {
  const help = getFieldHelp(tag);
  if (!help) {
    return null;
  }

  const details = document.createElement('details');
  details.className = 'field-help-panel';
  const summary = document.createElement('summary');
  summary.textContent = 'Field help';
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'field-help-body';
  body.innerHTML = `<p>${help.summary}</p>`;
  if (help.indicators) {
    body.innerHTML += `<p><strong>Indicators:</strong> ${help.indicators}</p>`;
  }
  if (help.subfields) {
    body.innerHTML += `<p><strong>Subfields:</strong> ${help.subfields}</p>`;
  }
  if (help.locUrl) {
    const link = document.createElement('a');
    link.href = help.locUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'LoC MARC21 documentation';
    body.append(link);
  }
  details.append(body);
  return details;
}

/**
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 */
export function attachDiacriticsButton(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'diacritics-wrap';
  input.parentElement?.insertBefore(wrapper, input);
  wrapper.append(input);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'secondary diacritics-toggle';
  toggle.textContent = 'Chars';
  toggle.setAttribute('aria-label', 'Insert diacritics or subfield markers');
  wrapper.append(toggle);

  const popover = document.createElement('div');
  popover.className = 'diacritics-popover hidden';
  renderDiacriticsPopover(popover, (char) => insertAtCursor(input, char));
  wrapper.append(popover);

  toggle.addEventListener('click', () => {
    popover.classList.toggle('hidden');
  });
}

/**
 * @param {HTMLElement} listElement
 * @param {number[]} indices
 * @param {(index: number) => HTMLElement} renderItem
 */
export function renderVirtualRecordList(listElement, indices, renderItem) {
  listElement.innerHTML = '';
  listElement.classList.add('record-list-virtual');

  const spacerTop = document.createElement('li');
  spacerTop.className = 'record-list-spacer';
  spacerTop.setAttribute('aria-hidden', 'true');
  const viewport = document.createElement('li');
  viewport.className = 'record-list-viewport';
  const spacerBottom = document.createElement('li');
  spacerBottom.className = 'record-list-spacer';
  spacerBottom.setAttribute('aria-hidden', 'true');

  listElement.append(spacerTop, viewport, spacerBottom);

  const paint = () => {
    const scrollTop = listElement.scrollTop;
    const viewportHeight = listElement.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / RECORD_ITEM_HEIGHT) - 3);
    const visibleCount = Math.ceil(viewportHeight / RECORD_ITEM_HEIGHT) + 6;
    const end = Math.min(indices.length, start + visibleCount);

    spacerTop.style.height = `${start * RECORD_ITEM_HEIGHT}px`;
    spacerBottom.style.height = `${Math.max(0, indices.length - end) * RECORD_ITEM_HEIGHT}px`;
    viewport.innerHTML = '';
    for (let i = start; i < end; i += 1) {
      viewport.append(renderItem(indices[i]));
    }
  };

  listElement.onscroll = paint;
  paint();
}

/**
 * @param {Object} ctx
 */
export function initRoadmapFeatures(ctx) {
  let draftSaveTimer = null;

  const {
    state,
    patchState,
    hasRecords,
    getFilteredRecordIndices,
    getVisibleRecordIndices: getVisible,
    refreshEditView,
    refreshExportPreview,
    populateCompareRecordSelects,
    resetRecordEditTracking,
    switchTab,
    setStatus,
    loadImportResult,
    buildMarcRecords,
    normalizeMarcRecords,
    cloneMarcRecord,
    selectRecord,
    commitRecordChange,
    renderEditor,
    refreshValidationUI,
    getScopeIndicesOrError,
    filterIndicesByRecordType,
    getScopedIndices,
    createBlankRecord,
    recordToParsedRow,
    allValidationIssuesRef,
    navigateToNextValidationIssue,
    setRecordSearchQuery,
  } = ctx;

  function scheduleDraftSave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(async () => {
      if (!hasRecords()) {
        return;
      }
      await saveDraftToStorage(buildSessionPayload({
        marcRecords: state.marcRecords,
        parsedRows: state.parsedRows,
        columnSchema: state.columnSchema,
        scopedIndices: [...state.scopedRecordIndices],
        recordScopeMode: state.recordScopeMode,
        scopeRecordTypeFilter: state.scopeRecordTypeFilter,
        selectedIndex: state.selectedIndex,
        validationProfile: state.validationProfile,
        columnMappingOverrides: state.columnMappingOverrides,
      }));
    }, 1500);
  }

  function getExportScopeIndices() {
    const allIndices = state.marcRecords.map((_, index) => index);
    const scoped = filterIndicesByRecordType(getScopedIndices());
    const visible = getVisible();
    return resolveExportIndices(state.exportScopeMode, allIndices, scoped, visible);
  }

  function getExportScopeLabel() {
    if (state.exportScopeMode === 'scope') {
      return 'scoped records';
    }
    if (state.exportScopeMode === 'visible') {
      return 'visible records';
    }
    return 'all records';
  }

  function updateLinkCheckButtonLabel() {
    const button = document.getElementById('check-links');
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    if (!hasRecords()) {
      button.textContent = 'Check URL links';
      button.disabled = true;
      button.title = 'Checks http(s) URLs in MARC field 856 subfield $u.';
      return;
    }

    const indices = getExportScopeIndices();
    const linkCount = collect856Urls(state.marcRecords, indices).length;
    const scopeLabel = getExportScopeLabel();
    button.disabled = linkCount === 0;
    button.textContent = linkCount > 0
      ? `Check URL links (${linkCount} in ${scopeLabel})`
      : `Check URL links (none in ${scopeLabel})`;
    button.title = `Checks http(s) URLs in MARC field 856 subfield $u within ${scopeLabel}.`;
  }

  function getExportRecords() {
    return pickRecordsByIndices(state.marcRecords, getExportScopeIndices());
  }

  document.getElementById('record-search')?.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) {
      ctx.setRecordSearchQuery?.(event.target.value);
      updateLinkCheckButtonLabel();
    }
  });

  document.getElementById('editor-view-form')?.addEventListener('change', () => {
    patchState({ editorViewMode: 'form' });
    if (hasRecords()) {
      renderEditor(state.marcRecords[state.selectedIndex]);
    }
  });

  document.getElementById('editor-view-mnemonic')?.addEventListener('change', () => {
    patchState({ editorViewMode: 'mnemonic' });
    if (hasRecords()) {
      renderEditor(state.marcRecords[state.selectedIndex]);
    }
  });

  document.getElementById('mnemonic-sync')?.addEventListener('click', () => {
    const textarea = document.getElementById('mnemonic-editor');
    const record = state.marcRecords[state.selectedIndex];
    if (!(textarea instanceof HTMLTextAreaElement) || !record) {
      return;
    }
    try {
      const parsed = parseMarcTextToRecord(textarea.value);
      parsed.sourceRowNumber = record.sourceRowNumber;
      parsed.recordType = record.recordType;
      state.marcRecords[state.selectedIndex] = parsed;
      state.parsedRows[state.selectedIndex] = recordToParsedRow(parsed);
      refreshEditView();
      renderEditor(parsed);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to parse mnemonic text.', true);
    }
  });

  document.querySelectorAll('input[name="export-scope"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        patchState({ exportScopeMode: radio.value });
        refreshExportPreview();
        updateLinkCheckButtonLabel();
      }
    });
  });

  document.getElementById('validation-profile')?.addEventListener('change', (event) => {
    patchState({ validationProfile: event.target.value });
    refreshEditView();
  });

  document.getElementById('save-session')?.addEventListener('click', () => {
    if (!hasRecords()) {
      return;
    }
    downloadSessionFile(buildSessionPayload({
      marcRecords: state.marcRecords,
      parsedRows: state.parsedRows,
      columnSchema: state.columnSchema,
      scopedIndices: [...state.scopedRecordIndices],
      recordScopeMode: state.recordScopeMode,
      scopeRecordTypeFilter: state.scopeRecordTypeFilter,
      selectedIndex: state.selectedIndex,
      validationProfile: state.validationProfile,
      columnMappingOverrides: state.columnMappingOverrides,
    }));
  });

  document.getElementById('file-input-session')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const payload = parseSessionFile(await file.text());
      patchState({
        marcRecords: payload.marcRecords,
        parsedRows: payload.parsedRows,
        columnSchema: payload.columnSchema,
        selectedIndex: payload.selectedIndex,
        recordScopeMode: payload.recordScopeMode,
        scopeRecordTypeFilter: payload.scopeRecordTypeFilter,
        validationProfile: payload.validationProfile,
        columnMappingOverrides: payload.columnMappingOverrides ?? {},
      });
      state.scopedRecordIndices = new Set(payload.scopedIndices ?? []);
      refreshEditView();
      switchTab('edit');
      setStatus(`Loaded session with ${payload.marcRecords.length} records.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load session.', true);
    }
    event.target.value = '';
  });

  document.getElementById('restore-draft')?.addEventListener('click', async () => {
    const draft = await loadDraftFromStorage();
    if (!draft) {
      setStatus('No saved draft found.', true);
      return;
    }

    if (hasRecords() && draftDiffersFromSession(draft, state.marcRecords, recordToMarcText)) {
      openRestoreDraftModal(draft);
      return;
    }

    if (hasRecords()) {
      setStatus('Draft matches the current session — nothing to restore.');
      return;
    }

    applyDraftPayload(draft);
    setStatus(`Restored draft with ${draft.marcRecords.length} records.`);
  });

  /** @type {import('../lib/session-storage.js').SessionPayload|null} */
  let pendingRestoreDraft = null;

  const restoreDraftModal = document.getElementById('restore-draft-modal');
  const restoreDraftMessage = document.getElementById('restore-draft-message');

  function closeRestoreDraftModal() {
    restoreDraftModal?.classList.add('hidden');
    pendingRestoreDraft = null;
  }

  /**
   * @param {import('../lib/session-storage.js').SessionPayload} draft
   */
  function openRestoreDraftModal(draft) {
    pendingRestoreDraft = draft;
    if (restoreDraftMessage) {
      const savedAt = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'unknown time';
      restoreDraftMessage.textContent = `The saved draft has ${draft.marcRecords.length} record(s) from ${savedAt}. Your current session has ${state.marcRecords.length} record(s). Choose how to combine them.`;
    }
    restoreDraftModal?.classList.remove('hidden');
  }

  /**
   * @param {import('../lib/session-storage.js').SessionPayload} draft
   */
  function applyDraftPayload(draft) {
    patchState({
      marcRecords: draft.marcRecords.map((record) => cloneMarcRecord(record)),
      parsedRows: draft.parsedRows.map((row) => ({ ...row })),
      columnSchema: draft.columnSchema ?? [],
      selectedIndex: Math.min(draft.selectedIndex ?? 0, Math.max(0, draft.marcRecords.length - 1)),
      recordScopeMode: draft.recordScopeMode ?? 'custom',
      scopeRecordTypeFilter: draft.scopeRecordTypeFilter ?? 'all',
      validationProfile: draft.validationProfile ?? 'cataloguing',
      columnMappingOverrides: draft.columnMappingOverrides ?? {},
    });
    state.scopedRecordIndices = new Set(draft.scopedIndices ?? []);
    refreshEditView();
    switchTab('edit');
    closeRestoreDraftModal();
  }

  /**
   * @param {import('../lib/session-storage.js').SessionPayload} draft
   */
  function restoreDraftDeleteNew(draft) {
    const draftKeys = new Set(draft.marcRecords.map((record) => getRecordIdentityKey(record)));
    const keptFromCurrent = state.marcRecords
      .filter((record) => draftKeys.has(getRecordIdentityKey(record)))
      .map((record) => cloneMarcRecord(record));
    const draftOnly = draft.marcRecords
      .filter((record) => !keptFromCurrent.some((kept) => getRecordIdentityKey(kept) === getRecordIdentityKey(record)))
      .map((record) => cloneMarcRecord(record));
    const records = [...keptFromCurrent, ...draftOnly];
    const parsedRows = records.map((record) => recordToParsedRow(record));

    patchState({
      marcRecords: records,
      parsedRows,
      columnSchema: draft.columnSchema ?? state.columnSchema,
      selectedIndex: Math.min(draft.selectedIndex ?? 0, Math.max(0, records.length - 1)),
      recordScopeMode: draft.recordScopeMode ?? state.recordScopeMode,
      scopeRecordTypeFilter: draft.scopeRecordTypeFilter ?? state.scopeRecordTypeFilter,
      validationProfile: draft.validationProfile ?? state.validationProfile,
      columnMappingOverrides: draft.columnMappingOverrides ?? state.columnMappingOverrides,
    });
    state.scopedRecordIndices = new Set(draft.scopedIndices ?? []);
    refreshEditView();
    switchTab('edit');
    closeRestoreDraftModal();
    setStatus(`Removed new records and restored draft (${records.length} record(s)).`);
  }

  /**
   * @param {import('../lib/session-storage.js').SessionPayload} draft
   */
  function restoreDraftMerge(draft) {
    const records = [
      ...draft.marcRecords.map((record) => cloneMarcRecord(record)),
      ...state.marcRecords.map((record) => cloneMarcRecord(record)),
    ];
    const parsedRows = records.map((record) => recordToParsedRow(record));

    patchState({
      marcRecords: records,
      parsedRows,
      columnSchema: draft.columnSchema?.length ? draft.columnSchema : state.columnSchema,
      selectedIndex: Math.min(draft.selectedIndex ?? 0, Math.max(0, records.length - 1)),
      recordScopeMode: draft.recordScopeMode ?? state.recordScopeMode,
      scopeRecordTypeFilter: draft.scopeRecordTypeFilter ?? state.scopeRecordTypeFilter,
      validationProfile: draft.validationProfile ?? state.validationProfile,
      columnMappingOverrides: { ...draft.columnMappingOverrides, ...state.columnMappingOverrides },
    });
    state.scopedRecordIndices = new Set([
      ...(draft.scopedIndices ?? []),
      ...state.scopedRecordIndices,
    ]);
    refreshEditView();
    switchTab('edit');
    closeRestoreDraftModal();
    setStatus(`Merged draft with current session (${records.length} record(s)).`);
  }

  restoreDraftModal?.querySelectorAll('[data-close-restore-draft]').forEach((element) => {
    element.addEventListener('click', closeRestoreDraftModal);
  });

  document.getElementById('restore-draft-delete-new')?.addEventListener('click', () => {
    if (!pendingRestoreDraft) {
      return;
    }
    restoreDraftDeleteNew(pendingRestoreDraft);
  });

  document.getElementById('restore-draft-merge')?.addEventListener('click', () => {
    if (!pendingRestoreDraft) {
      return;
    }
    restoreDraftMerge(pendingRestoreDraft);
  });

  document.getElementById('restore-draft-overwrite')?.addEventListener('click', () => {
    if (!pendingRestoreDraft) {
      return;
    }
    applyDraftPayload(pendingRestoreDraft);
    setStatus(`Restored draft with ${pendingRestoreDraft.marcRecords.length} records.`);
  });

  document.getElementById('clear-draft')?.addEventListener('click', async () => {
    await clearDraftFromStorage();
    setStatus('Draft cleared.');
  });

  document.getElementById('paste-field')?.addEventListener('click', () => {
    const record = state.marcRecords[state.selectedIndex];
    if (!record || !fieldClipboard) {
      return;
    }
    record.fields.push(structuredClone(fieldClipboard));
    refreshValidationUI();
    renderEditor(record);
    scheduleDraftSave();
  });

  document.getElementById('history-undo')?.addEventListener('click', () => {
    const entry = undoStack.undo();
    if (!entry) {
      return;
    }
    entry.snapshots.forEach((snapshot, index) => {
      state.marcRecords[index] = cloneMarcRecord(snapshot);
      state.parsedRows[index] = recordToParsedRow(state.marcRecords[index]);
    });
    resetRecordEditTracking?.(state.selectedIndex);
    refreshEditView();
    const statusEl = document.getElementById('history-status');
    if (statusEl) {
      statusEl.textContent = `Undid: ${entry.label}`;
    }
    refreshUndoButton();
  });

  function refreshUndoButton() {
    const button = document.getElementById('history-undo');
    if (button instanceof HTMLButtonElement) {
      button.disabled = !undoStack.peek();
    }
  }

  async function refreshPresetSelect() {
    const select = document.getElementById('batch-preset-select');
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const presets = await loadBatchPresets();
    select.innerHTML = '<option value="">Load preset…</option>';
    presets.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = preset.name;
      select.append(option);
    });
  }

  document.getElementById('batch-preset-save')?.addEventListener('click', async () => {
    const name = window.prompt('Preset name');
    if (!name?.trim()) {
      return;
    }
    const presets = await loadBatchPresets();
    presets.push({
      name: name.trim(),
      operation: document.querySelector('input[name="batch-operation"]:checked')?.value ?? 'find-replace',
      fieldPart: document.getElementById('batch-set-part')?.value ?? 'indicators',
      find: document.getElementById('batch-find')?.value ?? '',
      replace: document.getElementById('batch-replace')?.value ?? '',
      setValue: document.getElementById('batch-set-value')?.value ?? '',
      tagFilter: document.getElementById('batch-tag')?.value ?? '',
      subfieldFilter: document.getElementById('batch-subfield')?.value ?? '',
      setTag: document.getElementById('batch-set-tag')?.value ?? '',
      setSubfield: document.getElementById('batch-set-subfield')?.value ?? '',
      targets: '',
      scopeMode: state.recordScopeMode,
      scopeText: document.getElementById('batch-scope-text')?.value ?? '',
      recordTypeFilter: state.scopeRecordTypeFilter,
    });
    await saveBatchPresets(presets);
    await refreshPresetSelect();
  });

  document.getElementById('batch-preset-load')?.addEventListener('click', async () => {
    const select = document.getElementById('batch-preset-select');
    if (!(select instanceof HTMLSelectElement) || !select.value) {
      return;
    }
    const presets = await loadBatchPresets();
    const preset = presets[Number(select.value)];
    if (!preset) {
      return;
    }
    document.getElementById('batch-find').value = preset.find;
    document.getElementById('batch-replace').value = preset.replace;
    document.getElementById('batch-tag').value = preset.tagFilter;
    document.getElementById('batch-subfield').value = preset.subfieldFilter;
    const setTagInput = document.getElementById('batch-set-tag');
    const setSubfieldInput = document.getElementById('batch-set-subfield');
    const setValueInput = document.getElementById('batch-set-value');
    if (setTagInput instanceof HTMLInputElement) {
      setTagInput.value = preset.setTag ?? preset.tagFilter ?? '';
    }
    if (setSubfieldInput instanceof HTMLInputElement) {
      setSubfieldInput.value = preset.setSubfield ?? preset.subfieldFilter ?? '';
    }
    if (setValueInput instanceof HTMLInputElement) {
      setValueInput.value = preset.setValue ?? preset.replace ?? '';
    }
    const operationInput = document.querySelector(`input[name="batch-operation"][value="${preset.operation ?? 'find-replace'}"]`);
    if (operationInput instanceof HTMLInputElement) {
      operationInput.checked = true;
    }
    const setPartSelect = document.getElementById('batch-set-part');
    if (setPartSelect instanceof HTMLSelectElement && preset.fieldPart) {
      setPartSelect.value = preset.fieldPart;
    }
    document.dispatchEvent(new Event('batch-operation-sync'));
    document.getElementById('batch-scope-text').value = preset.scopeText;
    patchState({ scopeRecordTypeFilter: preset.recordTypeFilter });
  });

  document.getElementById('batch-preset-delete')?.addEventListener('click', async () => {
    const select = document.getElementById('batch-preset-select');
    if (!(select instanceof HTMLSelectElement) || !select.value) {
      return;
    }
    const presets = await loadBatchPresets();
    presets.splice(Number(select.value), 1);
    await saveBatchPresets(presets);
    await refreshPresetSelect();
  });

  document.getElementById('check-links')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('link-check-status');
    if (!hasRecords()) {
      return;
    }
    const indices = getExportScopeIndices();
    const linkCount = collect856Urls(state.marcRecords, indices).length;
    if (linkCount === 0) {
      statusEl.textContent = `No http(s) URLs found in 856 $u within ${getExportScopeLabel()}.`;
      document.getElementById('link-check-results').innerHTML = '';
      return;
    }
    statusEl.textContent = `Checking ${linkCount} URL link(s) in 856 $u (${getExportScopeLabel()})…`;
    const results = await check856Links(state.marcRecords, indices, (done, total) => {
      statusEl.textContent = `Checking 856 $u links ${done}/${total} (${getExportScopeLabel()})…`;
    });
    const broken = results.filter((result) => result.status === 'broken');
    statusEl.textContent = broken.length === 0
      ? `Checked ${results.length} URL link(s) in 856 $u; none reported broken.`
      : `${broken.length} broken URL link(s) found in 856 $u.`;
    const panel = document.getElementById('link-check-results');
    if (panel) {
      panel.innerHTML = broken.map((result) => `<li>Record ${result.recordIndex + 1}: ${result.url} — ${result.detail ?? 'failed'}</li>`).join('');
    }
  });

  document.getElementById('compare-records')?.addEventListener('click', () => {
    const selectA = document.getElementById('compare-record-a');
    const selectB = document.getElementById('compare-record-b');
    const results = document.getElementById('compare-results');
    const placeholder = document.getElementById('compare-placeholder');
    const labelA = document.getElementById('compare-label-a');
    const labelB = document.getElementById('compare-label-b');
    const textA = document.getElementById('compare-text-a');
    const textB = document.getElementById('compare-text-b');
    if (!(selectA instanceof HTMLSelectElement) || !(selectB instanceof HTMLSelectElement) || !results || !textA || !textB) {
      return;
    }
    const a = Number(selectA.value);
    const b = Number(selectB.value);
    if (Number.isNaN(a) || Number.isNaN(b) || selectA.value === '' || selectB.value === '') {
      results.classList.add('hidden');
      placeholder?.classList.remove('hidden');
      if (placeholder) {
        placeholder.textContent = 'Select two records to compare.';
      }
      return;
    }
    const left = state.marcRecords[a];
    const right = state.marcRecords[b];
    if (!left || !right) {
      results.classList.add('hidden');
      placeholder?.classList.remove('hidden');
      if (placeholder) {
        placeholder.textContent = 'Invalid record selection.';
      }
      return;
    }
    if (labelA) {
      labelA.textContent = selectA.options[selectA.selectedIndex]?.textContent ?? `Record ${a + 1}`;
    }
    if (labelB) {
      labelB.textContent = selectB.options[selectB.selectedIndex]?.textContent ?? `Record ${b + 1}`;
    }
    textA.textContent = recordToMarcText(left);
    textB.textContent = recordToMarcText(right);
    results.classList.remove('hidden');
    placeholder?.classList.add('hidden');
  });

  document.getElementById('compare-use-selected')?.addEventListener('click', () => {
    const recordA = document.getElementById('compare-record-a');
    if (recordA instanceof HTMLSelectElement && hasRecords()) {
      recordA.value = String(state.selectedIndex);
    }
  });

  function renderStats() {
    const target = document.getElementById('stats-output');
    if (!target || !hasRecords()) {
      return;
    }
    const stats = computeRecordStats(state.marcRecords);
    const topTags = Object.entries(stats.tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => `${tag}: ${count}`)
      .join(', ');
    target.innerHTML = `
      <p><strong>Total records:</strong> ${stats.totalRecords}</p>
      <p><strong>Missing 245:</strong> ${stats.missing245} · <strong>Missing 100:</strong> ${stats.missing100}</p>
      <p><strong>Blank 245 indicators:</strong> ${stats.blank245Indicators}</p>
      <p><strong>Top tags:</strong> ${topTags || 'n/a'}</p>
    `;
  }

  document.querySelector('.nav-tab[data-tab="help"]')?.addEventListener('click', renderStats);

  document.querySelector('.nav-tab[data-tab="compare"]')?.addEventListener('click', () => {
    populateCompareRecordSelects?.();
    if (!hasRecords()) {
      return;
    }
    const recordA = document.getElementById('compare-record-a');
    const recordB = document.getElementById('compare-record-b');
    if (recordA instanceof HTMLSelectElement && !recordA.value) {
      recordA.value = String(state.selectedIndex);
    }
    if (recordB instanceof HTMLSelectElement && !recordB.value) {
      const nextIndex = Math.min(state.selectedIndex + 1, state.marcRecords.length - 1);
      recordB.value = String(nextIndex);
    }
  });

  document.querySelector('.nav-tab[data-tab="export"]')?.addEventListener('click', () => {
    refreshExportPreview();
    updateLinkCheckButtonLabel();
  });

  updateLinkCheckButtonLabel();

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      const isMnemonic = target.id === 'mnemonic-editor';
      if (!isMnemonic && !event.ctrlKey && !event.metaKey && !event.altKey) {
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      document.getElementById('save-record')?.click();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      navigateToNextValidationIssue();
      return;
    }

    if ((event.altKey || event.ctrlKey || event.metaKey) && event.key === 'ArrowUp') {
      event.preventDefault();
      document.getElementById('prev-record')?.click();
      return;
    }

    if ((event.altKey || event.ctrlKey || event.metaKey) && event.key === 'ArrowDown') {
      event.preventDefault();
      document.getElementById('next-record')?.click();
    }
  });

  loadDraftFromStorage().then((draft) => {
    const promptEl = document.getElementById('draft-restore-prompt');
    if (draft && promptEl && !hasRecords()) {
      promptEl.classList.remove('hidden');
      promptEl.textContent = `A draft with ${draft.marcRecords.length} record(s) is available. Use "Restore draft" to continue.`;
    }
  });

  refreshPresetSelect();
  refreshUndoButton();

  return {
    getExportRecords,
    scheduleDraftSave,
    updateLinkCheckButtonLabel,
    renderAutoFixButton(issue, record, onFixed) {
      if (!canAutoFixIssue(issue)) {
        return null;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary validation-fix-btn';
      button.textContent = 'Fix';
      button.addEventListener('click', () => {
        const fixed = applyAutoFix(record, issue);
        if (!fixed) {
          return;
        }
        state.marcRecords[state.selectedIndex] = fixed;
        state.parsedRows[state.selectedIndex] = recordToParsedRow(fixed);
        onFixed(fixed);
      });
      return button;
    },
    pushUndo(label, snapshots) {
      undoStack.push(label, snapshots);
      refreshUndoButton();
    },
    setFieldClipboard(field) {
      fieldClipboard = structuredClone(field);
    },
    renderMnemonicEditor(container, record) {
      container.innerHTML = '';
      const textarea = document.createElement('textarea');
      textarea.id = 'mnemonic-editor';
      textarea.className = 'mnemonic-editor';
      textarea.rows = 18;
      textarea.value = recordToMarcText(record);
      textarea.setAttribute('aria-label', 'MARC mnemonic editor');
      attachDiacriticsButton(textarea);
      container.append(textarea);
    },
  };
}
