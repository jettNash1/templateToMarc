import { parseWorkbook } from '../lib/xlsx-import.js';
import { buildMarcRecords, cloneMarcRecord, createEmptyDataField } from '../lib/marc-builder.js';
import {
  downloadBinaryFile,
  downloadTextFile,
  recordToMarcText,
  recordsToMarcBinary,
  recordsToMarcText,
  recordsToMarcXml,
} from '../lib/marc-export.js';
import { FIELD_GROUPS } from '../lib/template-mapping.js';

/** @typedef {import('../lib/marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('../lib/marc-builder.js').MarcField} MarcField */
/** @typedef {import('../lib/marc-builder.js').MarcDataField} MarcDataField */
/** @typedef {import('../lib/xlsx-import.js').ParsedRow} ParsedRow */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const workspace = document.getElementById('workspace');
const recordList = document.getElementById('record-list');
const recordCount = document.getElementById('record-count');
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

/** @type {ParsedRow[]} */
let parsedRows = [];
/** @type {MarcRecord[]} */
let marcRecords = [];
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
  if (field.type !== 'control' || !['001', '005', '008'].includes(field.tag)) {
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
  selectedRecordMeta.textContent = `Excel row ${record.sourceRowNumber}`;
  renderLeader(record);
  fieldEditor.innerHTML = '';

  const groupedFields = FIELD_GROUPS.filter((group) => group !== 'Control').map((groupName) => {
    const fields = record.fields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => (field.group ?? 'Notes') === groupName);

    if (fields.length === 0) {
      return null;
    }

    const section = document.createElement('section');
    section.className = 'field-group';
    section.innerHTML = `<h3 class="field-group-title">${groupName}</h3>`;

    fields.forEach(({ field, index }) => {
      section.append(renderFieldCard(field, index, record));
    });

    return section;
  }).filter(Boolean);

  const controlFields = record.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.type === 'control');

  if (controlFields.length > 0) {
    const section = document.createElement('section');
    section.className = 'field-group';
    section.innerHTML = '<h3 class="field-group-title">Control</h3>';
    controlFields.forEach(({ field, index }) => {
      section.append(renderFieldCard(field, index, record));
    });
    groupedFields.unshift(section);
  }

  groupedFields.forEach((section) => fieldEditor.append(section));
  renderPreview(record);
}

function renderRecordList() {
  recordList.innerHTML = '';
  recordCount.textContent = `${marcRecords.length} record${marcRecords.length === 1 ? '' : 's'}`;

  marcRecords.forEach((record, index) => {
    const item = document.createElement('li');
    item.className = 'record-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === selectedIndex));
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="record-item-title">${escapeHtml(record.sourceValues[7] ?? '(No title)')}</div>
      <div class="record-item-author">${escapeHtml(record.sourceValues[1] ?? '(No author)')}</div>
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
    parsedRows = await parseWorkbook(buffer);
    marcRecords = buildMarcRecords(parsedRows).map((record) => cloneMarcRecord(record));
    selectedIndex = 0;
    workspace.classList.remove('hidden');
    renderRecordList();
    renderEditor(marcRecords[selectedIndex]);
    setStatus(`Loaded ${marcRecords.length} record${marcRecords.length === 1 ? '' : 's'} from ${file.name}.`);
  } catch (error) {
    workspace.classList.add('hidden');
    setStatus(error instanceof Error ? error.message : 'Unable to read the workbook.', true);
  }
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
  renderEditor(marcRecords[selectedIndex]);
});

prevRecordButton.addEventListener('click', () => {
  selectRecord(selectedIndex - 1);
});

nextRecordButton.addEventListener('click', () => {
  selectRecord(selectedIndex + 1);
});

addFieldButton.addEventListener('click', () => {
  const record = marcRecords[selectedIndex];
  record.fields.push(createEmptyDataField());
  renderEditor(record);
});

exportTextButton.addEventListener('click', () => {
  downloadTextFile(recordsToMarcText(marcRecords), 'book-donation-records.txt');
});

exportXmlButton.addEventListener('click', () => {
  downloadTextFile(recordsToMarcXml(marcRecords), 'book-donation-records.xml', 'application/xml;charset=utf-8');
});

exportMrcButton.addEventListener('click', () => {
  downloadBinaryFile(recordsToMarcBinary(marcRecords), 'book-donation-records.mrc');
});

const sampleLink = document.querySelector('.sample-link');
if (sampleLink && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  sampleLink.href = chrome.runtime.getURL('BookDonationTemplate.xlsx');
}
