import { createBlankRecord } from './marc-model.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./marc-builder.js').MarcField} MarcField */

/**
 * @typedef {Object} RecordTemplate
 * @property {string} id
 * @property {string} label
 * @property {string} recordType
 * @property {string} leader
 * @property {MarcField[]} fields
 */

export const CUSTOM_TEMPLATE_PREFIX = 'custom:';

/** Built-in starter templates (reference only; not shown in the new-record dropdown). */
/** @type {RecordTemplate[]} */
export const RECORD_TEMPLATES = [
  {
    id: 'monograph',
    label: 'New monograph (bibliographic)',
    recordType: 'bibliographic',
    leader: '00000nam a2200000 i 4500',
    fields: [
      { type: 'control', tag: '001', value: '', group: 'Control' },
      { type: 'control', tag: '005', value: '', group: 'Control' },
      {
        type: 'control',
        tag: '008',
        value: '      s2026    xxu     |||| 000 0 eng d',
        group: 'Control',
      },
      {
        type: 'data',
        tag: '245',
        ind1: '1',
        ind2: '0',
        subfields: [{ code: 'a', value: '' }],
        group: 'Title',
      },
    ],
  },
  {
    id: 'authority-nar',
    label: 'New authority (NAR)',
    recordType: 'authority',
    leader: '00000nz a2200000 n 4500',
    fields: [
      { type: 'control', tag: '001', value: '', group: 'Control' },
      { type: 'control', tag: '005', value: '', group: 'Control' },
      {
        type: 'control',
        tag: '008',
        value: '      n2026    xxu     |||| 000 0 eng d',
        group: 'Control',
      },
      {
        type: 'data',
        tag: '100',
        ind1: '1',
        ind2: ' ',
        subfields: [{ code: 'a', value: '' }],
        group: 'Name',
      },
    ],
  },
  {
    id: 'holdings',
    label: 'New holdings record',
    recordType: 'holdings',
    leader: '00000nu a2200000 i 4500',
    fields: [
      { type: 'control', tag: '001', value: '', group: 'Control' },
      { type: 'control', tag: '005', value: '', group: 'Control' },
      {
        type: 'control',
        tag: '008',
        value: '      u2026    xxu     |||| 000 0 eng d',
        group: 'Control',
      },
      {
        type: 'data',
        tag: '852',
        ind1: ' ',
        ind2: ' ',
        subfields: [{ code: 'a', value: '' }],
        group: 'Holdings',
      },
    ],
  },
];

/**
 * @param {string} selectValue
 * @returns {boolean}
 */
export function isCustomTemplateSelectValue(selectValue) {
  return selectValue.startsWith(CUSTOM_TEMPLATE_PREFIX);
}

/**
 * @param {RecordTemplate} template
 * @returns {string}
 */
export function toTemplateSelectValue(template) {
  return `${CUSTOM_TEMPLATE_PREFIX}${template.id}`;
}

/**
 * @param {string} selectValue
 * @returns {string|null}
 */
export function parseCustomTemplateId(selectValue) {
  if (!isCustomTemplateSelectValue(selectValue)) {
    return null;
  }
  return selectValue.slice(CUSTOM_TEMPLATE_PREFIX.length);
}

/**
 * @param {string} recordType
 * @param {RecordTemplate[]} customTemplates
 * @returns {RecordTemplate[]}
 */
export function getCustomTemplatesForRecordType(recordType, customTemplates) {
  return customTemplates.filter((template) => template.recordType === recordType);
}

/**
 * @param {string} selectValue
 * @param {RecordTemplate[]} customTemplates
 * @returns {RecordTemplate|undefined}
 */
export function findTemplateBySelectValue(selectValue, customTemplates) {
  const customId = parseCustomTemplateId(selectValue);
  if (!customId) {
    return undefined;
  }
  return customTemplates.find((template) => template.id === customId);
}

/**
 * @param {MarcField} field
 * @returns {MarcField}
 */
function sanitizeFieldForTemplate(field) {
  if (field.type === 'control' && (field.tag === '001' || field.tag === '005')) {
    return { ...field, value: '' };
  }
  return field;
}

/**
 * @param {MarcRecord} record
 * @param {string} label
 * @returns {RecordTemplate}
 */
export function createTemplateFromRecord(record, label) {
  return {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: label.trim(),
    recordType: record.recordType ?? 'bibliographic',
    leader: record.leader ?? '',
    fields: structuredClone(record.fields ?? []).map(sanitizeFieldForTemplate),
  };
}

/**
 * @param {string} selectValue
 * @param {number} sourceRowNumber
 * @param {RecordTemplate[]} customTemplates
 * @returns {MarcRecord}
 */
export function buildRecordFromTemplate(selectValue, sourceRowNumber, customTemplates = []) {
  const template = findTemplateBySelectValue(selectValue, customTemplates);
  if (!template) {
    return createBlankRecord('bibliographic', sourceRowNumber);
  }

  const record = createBlankRecord(template.recordType, sourceRowNumber);
  record.leader = template.leader;
  record.fields = structuredClone(template.fields);
  return record;
}
