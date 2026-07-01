import { applyPunctuation } from './punctuation.js';
import { inferFieldGroup } from './header-parser.js';
import { resolveLanguageCode } from './template-mapping.js';

/**
 * @typedef {import('./header-parser.js').ColumnSchema} ColumnSchema
 */

/**
 * @typedef {Object} MarcSubfield
 * @property {string} code
 * @property {string} value
 */

/**
 * @typedef {Object} MarcDataField
 * @property {'data'} type
 * @property {string} tag
 * @property {string} ind1
 * @property {string} ind2
 * @property {MarcSubfield[]} subfields
 * @property {string} [sourceLabel]
 * @property {string} [group]
 */

/**
 * @typedef {Object} MarcControlField
 * @property {'control'} type
 * @property {string} tag
 * @property {string} value
 * @property {string} [group]
 */

/**
 * @typedef {MarcControlField|MarcDataField} MarcField
 */

/**
 * @typedef {Object} MarcRecord
 * @property {string} leader
 * @property {MarcField[]} fields
 * @property {number} sourceRowNumber
 * @property {Record<number, string>} sourceValues
 */

/**
 * @typedef {import('./file-import.js').ParsedRow} ParsedRow
 */

const DEFAULT_LEADER = '00000nam a2200000 i 4500';
const PROTECTED_CONTROL_TAGS = new Set(['001', '005', '008']);

/**
 * @param {string} dateText
 * @returns {string}
 */
function extractYear(dateText) {
  if (!dateText) {
    return 'uuuu';
  }

  const match = String(dateText).match(/\d{4}/);
  return match ? match[0] : 'uuuu';
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * @param {string} year
 * @param {string} place
 * @param {string} langCode
 * @returns {string}
 */
function build008Field(year, place, langCode) {
  const dateEntered = formatDate(new Date()).slice(2);
  const pubYear = year.padEnd(4, 'u').slice(0, 4);
  const placeCode = mapPlaceToCode(place);
  const lang = langCode.padEnd(3, ' ').slice(0, 3);

  return `${dateEntered}s${pubYear}${' '.repeat(3)}${placeCode}||||||||||||||||${lang} d`;
}

/**
 * @param {string} place
 * @returns {string}
 */
function mapPlaceToCode(place) {
  if (!place) {
    return 'xx ';
  }

  const normalized = place.toLowerCase();
  if (normalized.includes(' london') || normalized.includes('england') || normalized.includes(' uk')) {
    return 'enk';
  }
  if (normalized.includes('united states') || normalized.includes('usa') || normalized.includes('u.s.')) {
    return 'nju';
  }
  if (normalized.includes('france') || normalized.includes('paris')) {
    return 'fr ';
  }

  return 'xx ';
}

/**
 * @param {MarcSubfield[]} subfields
 * @returns {MarcSubfield[]}
 */
function sortSubfields(subfields) {
  return [...subfields].sort((left, right) => left.code.localeCompare(right.code));
}

/**
 * @param {string} tag
 * @param {string} ind1
 * @param {string} ind2
 * @param {MarcSubfield[]} subfields
 * @param {string} [sourceLabel]
 * @param {string} [group]
 * @returns {MarcDataField|null}
 */
export function buildDataFieldFromSubfields(tag, ind1, ind2, subfields, sourceLabel, group) {
  const filtered = subfields.filter((subfield) => subfield.value.trim() !== '');
  if (filtered.length === 0) {
    return null;
  }

  return {
    type: 'data',
    tag,
    ind1: ind1 || ' ',
    ind2: ind2 || ' ',
    subfields: sortSubfields(filtered),
    sourceLabel,
    group: group ?? inferFieldGroup(tag),
  };
}

/**
 * @param {string} tag
 * @param {string} value
 * @returns {MarcControlField}
 */
export function createControlField(tag, value = '') {
  return {
    type: 'control',
    tag: tag.padStart(3, '0').slice(-3),
    value,
    group: 'Control',
  };
}

/**
 * @param {string} tag
 * @param {string} ind1
 * @param {string} ind2
 * @param {MarcSubfield[]} subfields
 * @param {string} [label]
 * @returns {MarcDataField}
 */
export function createDataField(tag, ind1, ind2, subfields, label) {
  const normalizedTag = tag.padStart(3, '0').slice(-3);
  return {
    type: 'data',
    tag: normalizedTag,
    ind1: (ind1 || ' ').slice(0, 1),
    ind2: (ind2 || ' ').slice(0, 1),
    subfields: subfields.length > 0 ? subfields : [{ code: 'a', value: '' }],
    sourceLabel: label ?? `${normalizedTag} field`,
    group: inferFieldGroup(normalizedTag),
  };
}

/**
 * @param {Record<number, string>} rowValues
 * @param {ColumnSchema[]} columnSchema
 * @returns {Record<number, string>}
 */
function normalizeRowValues(rowValues, columnSchema) {
  /** @type {Record<number, string>} */
  const normalized = {};

  for (const column of columnSchema) {
    const raw = rowValues[column.index];
    if (raw == null || String(raw).trim() === '') {
      continue;
    }

    normalized[column.index] = applyPunctuation(String(raw), column.punctuation);
  }

  return normalized;
}

/**
 * @param {ColumnSchema} column
 * @returns {string}
 */
function fieldGroupKey(column) {
  return `${column.tag}|${column.ind1}|${column.ind2}`;
}

/**
 * @param {ColumnSchema[]} columns
 * @param {Record<number, string>} values
 * @returns {{ column: ColumnSchema, value: string }[][]}
 */
function groupColumnInstances(columns, values) {
  /** @type {Record<string, { column: ColumnSchema, value: string }[]>} */
  const partitions = {};

  for (const column of columns) {
    const value = values[column.index];
    if (!value) {
      continue;
    }

    const key = fieldGroupKey(column);
    if (!partitions[key]) {
      partitions[key] = [];
    }
    partitions[key].push({ column, value });
  }

  /** @type {{ column: ColumnSchema, value: string }[][]} */
  const instanceGroups = [];

  for (const entries of Object.values(partitions)) {
    const subfieldCounts = entries.reduce((counts, entry) => {
      counts[entry.column.subfield] = (counts[entry.column.subfield] ?? 0) + 1;
      return counts;
    }, /** @type {Record<string, number>} */ ({}));

    const hasDuplicateSubfields = Object.values(subfieldCounts).some((count) => count > 1);
    const allSameSubfield = Object.keys(subfieldCounts).length === 1;

    if (allSameSubfield && hasDuplicateSubfields) {
      for (const entry of entries) {
        instanceGroups.push([entry]);
      }
      continue;
    }

    /** @type {{ column: ColumnSchema, value: string }[]} */
    let currentGroup = [];
    const usedSubfields = new Set();

    for (const entry of entries) {
      const { subfield } = entry.column;

      if (currentGroup.length > 0 && usedSubfields.has(subfield)) {
        instanceGroups.push(currentGroup);
        currentGroup = [];
        usedSubfields.clear();
      }

      currentGroup.push(entry);
      usedSubfields.add(subfield);
    }

    if (currentGroup.length > 0) {
      instanceGroups.push(currentGroup);
    }
  }

  return instanceGroups;
}

/**
 * @param {ColumnSchema[]} columnSchema
 * @param {Record<number, string>} values
 * @returns {{ year: string, place: string, langText: string }}
 */
function deriveControlHints(columnSchema, values) {
  let year = '';
  let place = '';
  let langText = '';

  for (const column of columnSchema) {
    const value = values[column.index];
    if (!value) {
      continue;
    }

    if (!year && (column.tag === '264' || column.tag === '260') && column.subfield === 'c') {
      year = value;
    }

    if (!place && (column.tag === '264' || column.tag === '260') && column.subfield === 'a') {
      place = value;
    }

    if (!langText && (column.tag === '546' || /ldr|language/i.test(column.label))) {
      langText = value;
    }
  }

  return { year, place, langText };
}

/**
 * @param {Record<number, string>} rowValues
 * @param {number} rowNumber
 * @param {ColumnSchema[]} columnSchema
 * @returns {MarcRecord}
 */
export function buildMarcRecord(rowValues, rowNumber, columnSchema) {
  const values = normalizeRowValues(rowValues, columnSchema);
  const hints = deriveControlHints(columnSchema, values);
  const langCode = resolveLanguageCode(hints.langText);
  const now = new Date();
  const controlId = `BD${formatDate(now)}${String(rowNumber).padStart(4, '0')}`;

  /** @type {MarcField[]} */
  const fields = [
    createControlField('001', controlId),
    createControlField('005', `${formatDate(now)}000000.0`),
    createControlField('008', build008Field(extractYear(hints.year), hints.place, langCode)),
  ];

  const instanceGroups = groupColumnInstances(columnSchema, values);

  for (const group of instanceGroups) {
    const first = group[0].column;
    const subfields = group.map(({ column, value }) => ({
      code: column.subfield,
      value,
    }));

    const requiresAuthorName = first.tag === '100' || first.tag === '700';
    const hasAuthorName = subfields.some(
      (subfield) => subfield.code === 'a' && subfield.value.trim() !== '',
    );

    if (requiresAuthorName && !hasAuthorName) {
      continue;
    }

    const label = group.length === 1 ? first.label : `${first.label} (+${group.length - 1})`;
    const dataField = buildDataFieldFromSubfields(
      first.tag,
      first.ind1,
      first.ind2,
      subfields,
      label,
      first.group,
    );

    if (dataField) {
      fields.push(dataField);
    }
  }

  return {
    leader: DEFAULT_LEADER,
    fields,
    sourceRowNumber: rowNumber,
    sourceValues: values,
  };
}

/**
 * @param {ParsedRow[]} parsedRows
 * @param {ColumnSchema[]} columnSchema
 * @returns {MarcRecord[]}
 */
export function buildMarcRecords(parsedRows, columnSchema) {
  return parsedRows.map((row) => buildMarcRecord(row.values, row.rowNumber, columnSchema));
}

/**
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function cloneMarcRecord(record) {
  return structuredClone(record);
}

/**
 * @param {string} tag
 * @returns {boolean}
 */
export function isProtectedControlTag(tag) {
  return PROTECTED_CONTROL_TAGS.has(tag);
}

/**
 * @param {MarcRecord} record
 * @returns {string[]}
 */
export function collectFieldGroups(record) {
  /** @type {string[]} */
  const groups = ['Control'];

  for (const field of record.fields) {
    const group = field.group ?? (field.type === 'control' ? 'Control' : inferFieldGroup(field.tag));
    if (!groups.includes(group)) {
      groups.push(group);
    }
  }

  if (!groups.includes('Other')) {
    const hasOther = record.fields.some(
      (field) => field.type === 'data' && (field.group ?? inferFieldGroup(field.tag)) === 'Other',
    );
    if (hasOther) {
      groups.push('Other');
    }
  }

  return groups;
}
