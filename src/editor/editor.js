import { parseFile } from '../lib/file-import.js';
import {
  buildMarcRecords,
  cloneMarcRecord,
  collectFieldGroups,
  createControlField,
  createDataField,
  isProtectedControlTag,
} from '../lib/marc-builder.js';
import { inferFieldGroup } from '../lib/header-parser.js';
import {
  downloadBinaryFile,
  downloadTextFile,
  recordToMarcText,
  recordsToMarcBinary,
  recordsToMarcText,
  recordsToMarcXml,
} from '../lib/marc-export.js';

/** @typedef {import('../lib/marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('../lib/marc-builder.js').MarcField} MarcField */
/** @typedef {import('../lib/marc-builder.js').MarcDataField} MarcDataField */
/** @typedef {import('../lib/file-import.js').ParsedRow} ParsedRow */
/** @typedef {import('../lib/header-parser.js').ColumnSchema} ColumnSchema */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const workspace = document.getElementById('workspace');
const recordList = document.getElementById('record-list');
const recordCount = document.getElementById('record-count');
const mappingSummaryText = document.getElementById('mapping-summary-text');
const mappingSkippedList = document.getElementById('mapping-skipped-list');
const selectedRecordMeta = document.getElementById('selected-record-meta');
const leaderEditor = document.getElementById('leader-editor');
const fieldEditor = document.getElementById('field-editor');
const marcPreview = document.getElementById('marc-preview');
const advancedToggle = document.getElementById('advanced-toggle');
const prevRecordButton = document.getElementById('prev-record');
const nextRecordButton = document.getElementById('next-record');
const addFieldButton = document.getElementById('add-field');
const exportTextButton = document.getElementById('export-text');
const exportXmlButton = document.getElementById('export-xml');
const exportMrcButton = document.getElementById('export-mrc');
const addFieldModal = document.getElementById('add-field-modal');
const addFieldForm = document.getElementById('add-field-form');
const addFieldTagInput = document.getElementById('add-field-tag');
const addFieldInd1Input = document.getElementById('add-field-ind1');
const addFieldInd2Input = document.getElementById('add-field-ind2');
const addFieldDataOptions = document.getElementById('add-field-data-options');
const addFieldControlValueWrap = document.getElementById('add-field-control-value-wrap');
const addFieldControlValueInput = document.getElementById('add-field-control-value');
const addFieldSubfieldsContainer = document.getElementById('add-field-subfields');
const addModalSubfieldButton = document.getElementById('add-modal-subfield');
const addFieldError = document.getElementById('add-field-error');

/** @type {ParsedRow[]} */
let parsedRows = [];
/** @type {MarcRecord[]} */
let marcRecords = [];
/** @type {ColumnSchema[]} */
let columnSchema = [];
/** @type {import('../lib/header-parser.js').HeaderParseResult['skipped']} */
let skippedColumns = [];
let selectedIndex = 0;
let advancedView = false;

/**
 * @param {string} message
 * @param {boolean} [isError]
 */
function setStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle('error', isError);
}

/**
 * @param {MarcRecord} record
 */
function renderPreview(record) {
  marcPreview.textContent = recordToMarcText(record);
}

/**
 * @param {number} index
 */
function selectRecord(index) {
  if (index < 0 || index >= marcRecords.length) {
    return;
  }

  selectedIndex = index;
  renderRecordList();
  renderEditor(marcRecords[selectedIndex]);
}

/**
 * @param {MarcField} field
 * @returns {string}
 */
function getFieldGroup(field) {
  if (field.type === 'control') {
    return 'Control';
  }
  return field.group ?? inferFieldGroup(field.tag);
}

/**
 * @param {MarcField} field
 * @param {number} fieldIndex
 * @param {MarcRecord} record
 */
function renderFieldCard(field, fieldIndex, record) {
  const card = document.createElement('article');
  card.className = 'field-card';
  card.dataset.fieldIndex = String(fieldIndex);

  const header = document.createElement('div');
  header.className = 'field-card-header';

  const label = document.createElement('div');
  label.className = 'field-card-label';
  label.textContent =
    field.type === 'control'
      ? `Control field ${field.tag}`
      : field.sourceLabel ?? `${field.tag} field`;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'secondary danger';
  removeButton.textContent = 'Remove';
  removeButton.setAttribute('aria-label', `Remove ${label.textContent}`);
  removeButton.addEventListener('click', () => {
    record.fields.splice(fieldIndex, 1);
    renderEditor(record);
  });

  header.append(label);
  const canRemove = field.type !== 'control' || !isProtectedControlTag(field.tag);
  if (canRemove) {
    header.append(removeButton);
  }

  card.append(header);

  if (field.type === 'control') {
    const controlLabel = document.createElement('label');
    controlLabel.textContent = `Tag ${field.tag}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value;
    input.setAttribute('aria-label', `Control field ${field.tag}`);
    input.addEventListener('input', (event) => {
      field.value = event.target.value;
      renderPreview(record);
    });
    controlLabel.append(input);
    card.append(controlLabel);
    return card;
  }

  if (advancedView) {
    const grid = document.createElement('div');
    grid.className = 'field-grid';

    grid.append(
      createInputField('Tag', field.tag, (value) => {
        field.tag = value.padStart(3, '0').slice(-3);
        field.group = inferFieldGroup(field.tag);
        renderPreview(record);
      }),
      createInputField('Ind1', field.ind1, (value) => {
        field.ind1 = value.slice(0, 1) || ' ';
        renderPreview(record);
      }),
      createInputField('Ind2', field.ind2, (value) => {
        field.ind2 = value.slice(0, 1) || ' ';
        renderPreview(record);
      }),
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

/**
 * @param {MarcDataField} field
 * @param {number} subfieldIndex
 * @param {MarcRecord} record
 */
function renderSubfieldRow(field, subfieldIndex, record) {
  const subfield = field.subfields[subfieldIndex];
  const row = document.createElement('div');
  row.className = 'subfield-row';

  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Code';
  const codeInput = document.createElement('input');
  codeInput.maxLength = 1;
  codeInput.value = subfield.code;
  codeInput.setAttribute('aria-label', `Subfield code ${subfieldIndex + 1}`);
  codeInput.addEventListener('input', (event) => {
    subfield.code = event.target.value.slice(0, 1) || 'a';
    renderPreview(record);
  });
  codeLabel.append(codeInput);

  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Value';
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.value = subfield.value;
  valueInput.setAttribute('aria-label', `Subfield value ${subfieldIndex + 1}`);
  valueInput.addEventListener('input', (event) => {
    subfield.value = event.target.value;
    renderPreview(record);
  });
  valueLabel.append(valueInput);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'secondary danger';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    field.subfields.splice(subfieldIndex, 1);
    if (field.subfields.length === 0) {
      field.subfields.push({ code: 'a', value: '' });
    }
    renderEditor(record);
  });

  row.append(codeLabel, valueLabel, removeButton);
  return row;
}

/**
 * @param {string} labelText
 * @param {string} value
 * @param {(value: string) => void} onChange
 */
function createInputField(labelText, value, onChange) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.setAttribute('aria-label', labelText);
  input.addEventListener('input', (event) => onChange(event.target.value));
  label.append(input);
  return label;
}

/**
 * @param {MarcRecord} record
 */
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
  input.setAttribute('aria-label', 'MARC leader');
  input.addEventListener('input', (event) => {
    record.leader = event.target.value.padEnd(24, ' ').slice(0, 24);
    renderPreview(record);
  });
  label.append(input);
  group.append(label);
  leaderEditor.append(group);
}

/**
 * @param {MarcRecord} record
 */
function renderEditor(record) {
  selectedRecordMeta.textContent = `Source row ${record.sourceRowNumber}`;
  renderLeader(record);
  fieldEditor.innerHTML = '';

  const groups = collectFieldGroups(record);

  for (const groupName of groups) {
    const fields = record.fields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => getFieldGroup(field) === groupName);

    if (fields.length === 0) {
      continue;
    }

    const section = document.createElement('section');
    section.className = 'field-group';
    section.innerHTML = `<h3 class="field-group-title">${groupName}</h3>`;

    fields.forEach(({ field, index }) => {
      section.append(renderFieldCard(field, index, record));
    });

    fieldEditor.append(section);
  }

  renderPreview(record);
}

function renderMappingSummary() {
  const skippedCount = skippedColumns.length;
  const mappedCount = columnSchema.length;
  mappingSummaryText.textContent = `Parsed ${mappedCount} MARC column${mappedCount === 1 ? '' : 's'}${
    skippedCount > 0 ? `, skipped ${skippedCount} without MARC notation` : ''
  }.`;

  mappingSkippedList.innerHTML = '';
  for (const skipped of skippedColumns) {
    const item = document.createElement('li');
    item.textContent = skipped.label;
    mappingSkippedList.append(item);
  }
}

function renderRecordList() {
  recordList.innerHTML = '';
  recordCount.textContent = `${marcRecords.length} record${marcRecords.length === 1 ? '' : 's'}`;

  marcRecords.forEach((record, index) => {
    const row = parsedRows[index];
    const item = document.createElement('li');
    item.className = 'record-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === selectedIndex));
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="record-item-title">${escapeHtml(row?.previewTitle ?? '(No title)')}</div>
      <div class="record-item-author">${escapeHtml(row?.previewAuthor ?? '(No author)')}</div>
      <div class="record-item-row">Row ${record.sourceRowNumber}</div>
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

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {File} file
 */
async function handleFile(file) {
  if (!file) {
    return;
  }

  setStatus(`Loading ${file.name}...`);

  try {
    const buffer = await file.arrayBuffer();
    const result = await parseFile(buffer, file.name);
    columnSchema = result.columnSchema;
    skippedColumns = result.skippedColumns;
    parsedRows = result.rows;
    marcRecords = buildMarcRecords(parsedRows, columnSchema).map((record) => cloneMarcRecord(record));
    selectedIndex = 0;
    workspace.classList.remove('hidden');
    renderMappingSummary();
    renderRecordList();
    renderEditor(marcRecords[selectedIndex]);
    setStatus(`Loaded ${marcRecords.length} record${marcRecords.length === 1 ? '' : 's'} from ${file.name}.`);
  } catch (error) {
    workspace.classList.add('hidden');
    setStatus(error instanceof Error ? error.message : 'Unable to read the file.', true);
  }
}

function renderModalSubfields() {
  addFieldSubfieldsContainer.innerHTML = '';

  const rows = addFieldSubfieldsContainer.dataset.count
    ? Number(addFieldSubfieldsContainer.dataset.count)
    : 1;

  for (let index = 0; index < rows; index += 1) {
    const row = document.createElement('div');
    row.className = 'subfield-row';

    const codeLabel = document.createElement('label');
    codeLabel.textContent = 'Code';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.maxLength = 1;
    codeInput.value = index === 0 ? 'a' : 'a';
    codeInput.className = 'modal-subfield-code';
    codeInput.setAttribute('aria-label', `New subfield code ${index + 1}`);
    codeLabel.append(codeInput);

    const valueLabel = document.createElement('label');
    valueLabel.textContent = 'Value';
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'modal-subfield-value';
    valueInput.setAttribute('aria-label', `New subfield value ${index + 1}`);
    valueLabel.append(valueInput);

    row.append(codeLabel, valueLabel, document.createElement('div'));
    addFieldSubfieldsContainer.append(row);
  }
}

function openAddFieldModal() {
  addFieldForm.reset();
  addFieldError.classList.add('hidden');
  addFieldError.textContent = '';
  addFieldSubfieldsContainer.dataset.count = '1';
  renderModalSubfields();
  updateAddFieldFormMode();
  addFieldModal.classList.remove('hidden');
  addFieldTagInput.focus();
}

function closeAddFieldModal() {
  addFieldModal.classList.add('hidden');
}

function updateAddFieldFormMode() {
  const fieldType = /** @type {HTMLInputElement|null} */ (
    addFieldForm.querySelector('input[name="field-type"]:checked')
  )?.value;

  const isControl = fieldType === 'control';
  addFieldDataOptions.classList.toggle('hidden', isControl);
  addFieldControlValueWrap.classList.toggle('hidden', !isControl);
}

function readModalSubfields() {
  const codes = addFieldSubfieldsContainer.querySelectorAll('.modal-subfield-code');
  const values = addFieldSubfieldsContainer.querySelectorAll('.modal-subfield-value');

  /** @type {{ code: string, value: string }[]} */
  const subfields = [];

  codes.forEach((codeInput, index) => {
    const valueInput = values[index];
    subfields.push({
      code: codeInput.value.slice(0, 1) || 'a',
      value: valueInput?.value ?? '',
    });
  });

  return subfields;
}

function handleAddFieldSubmit(event) {
  event.preventDefault();
  addFieldError.classList.add('hidden');
  addFieldError.textContent = '';

  const tag = addFieldTagInput.value.trim();
  if (!/^\d{3}$/.test(tag)) {
    addFieldError.textContent = 'Tag must be a 3-digit MARC field number.';
    addFieldError.classList.remove('hidden');
    return;
  }

  const fieldType = /** @type {HTMLInputElement|null} */ (
    addFieldForm.querySelector('input[name="field-type"]:checked')
  )?.value;

  const record = marcRecords[selectedIndex];

  if (fieldType === 'control') {
    record.fields.push(createControlField(tag, addFieldControlValueInput.value));
  } else {
    const subfields = readModalSubfields();
    if (subfields.every((subfield) => subfield.value.trim() === '')) {
      addFieldError.textContent = 'Add at least one subfield value for a data field.';
      addFieldError.classList.remove('hidden');
      return;
    }

    record.fields.push(
      createDataField(
        tag,
        addFieldInd1Input.value,
        addFieldInd2Input.value,
        subfields,
        `${tag} field`,
      ),
    );
  }

  closeAddFieldModal();
  renderEditor(record);
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = event.dataTransfer?.files?.[0];
  handleFile(file);
});

fileInput.addEventListener('change', (event) => {
  const input = event.target;
  handleFile(input.files?.[0]);
  input.value = '';
});

advancedToggle.addEventListener('change', (event) => {
  advancedView = event.target.checked;
  if (marcRecords[selectedIndex]) {
    renderEditor(marcRecords[selectedIndex]);
  }
});

prevRecordButton.addEventListener('click', () => {
  selectRecord(selectedIndex - 1);
});

nextRecordButton.addEventListener('click', () => {
  selectRecord(selectedIndex + 1);
});

addFieldButton.addEventListener('click', openAddFieldModal);

addFieldForm.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'field-type') {
    updateAddFieldFormMode();
  }
});

addFieldForm.addEventListener('submit', handleAddFieldSubmit);

addModalSubfieldButton.addEventListener('click', () => {
  const currentCount = addFieldSubfieldsContainer.querySelectorAll('.subfield-row').length;
  addFieldSubfieldsContainer.dataset.count = String(currentCount + 1);

  const row = document.createElement('div');
  row.className = 'subfield-row';

  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Code';
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.maxLength = 1;
  codeInput.value = 'a';
  codeInput.className = 'modal-subfield-code';
  codeLabel.append(codeInput);

  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Value';
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'modal-subfield-value';
  valueLabel.append(valueInput);

  row.append(codeLabel, valueLabel, document.createElement('div'));
  addFieldSubfieldsContainer.append(row);
});

addFieldModal.querySelectorAll('[data-close-modal]').forEach((element) => {
  element.addEventListener('click', closeAddFieldModal);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !addFieldModal.classList.contains('hidden')) {
    closeAddFieldModal();
  }
});

exportTextButton.addEventListener('click', () => {
  downloadTextFile(recordsToMarcText(marcRecords), 'marc-records.txt');
});

exportXmlButton.addEventListener('click', () => {
  downloadTextFile(recordsToMarcXml(marcRecords), 'marc-records.xml', 'application/xml;charset=utf-8');
});

exportMrcButton.addEventListener('click', () => {
  downloadBinaryFile(recordsToMarcBinary(marcRecords), 'marc-records.mrc');
});

const sampleLink = document.querySelector('.sample-link');
if (sampleLink && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  sampleLink.href = chrome.runtime.getURL('BookDonationTemplate.xlsx');
}
