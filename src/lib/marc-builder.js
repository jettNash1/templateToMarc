import {
  COLUMN_DEFINITIONS,
  normalizeRowValues,
  resolveLanguageCode,
} from './template-mapping.js';

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

const DEFAULT_LEADER = '00000nam a2200000 i 4500';

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
 * @param {string} place
 * @returns {string}
 */
function mapPlaceToCode(place) {
  if (!place) {
    return 'xx ';
  }

  const normalized = place.toLowerCase();
  if (normalized.includes('london') || normalized.includes('england') || normalized.includes('uk')) {
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
 * @param {string} _langCode
 * @returns {string}
 */
function buildLeader(_langCode) {
  return DEFAULT_LEADER;
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
function createDataField(tag, ind1, ind2, subfields, sourceLabel, group) {
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
    group,
  };
}

/**
 * @param {Record<number, string>} rowValues
 * @param {number} rowNumber
 * @returns {MarcRecord}
 */
export function buildMarcRecord(rowValues, rowNumber) {
  const values = normalizeRowValues(rowValues);
  const langCode = resolveLanguageCode(values[13] ?? '');
  const year = extractYear(values[10] ?? '');
  const place = values[8] ?? '';
  const now = new Date();
  const controlId = `BD${formatDate(now)}${String(rowNumber).padStart(4, '0')}`;

  /** @type {MarcField[]} */
  const fields = [
    {
      type: 'control',
      tag: '001',
      value: controlId,
      group: 'Control',
    },
    {
      type: 'control',
      tag: '005',
      value: `${formatDate(now)}000000.0`,
      group: 'Control',
    },
    {
      type: 'control',
      tag: '008',
      value: build008Field(year, place, langCode),
      group: 'Control',
    },
  ];

  /** @type {Record<string, MarcSubfield[]>} */
  const mergeBuckets = {};

  for (const column of COLUMN_DEFINITIONS) {
    const cellValue = values[column.index];
    if (!cellValue) {
      continue;
    }

    const { target, label, group } = column;

    if (target.emit === 'language') {
      fields.push({
        type: 'data',
        tag: '546',
        ind1: ' ',
        ind2: ' ',
        subfields: [{ code: 'a', value: cellValue }],
        sourceLabel: label,
        group,
      });
      continue;
    }

    if (target.emit === 'merge264' || target.emit === 'merge300' || target.emit === 'merge830') {
      const key = target.mergeKey ?? target.tag;
      if (!mergeBuckets[key]) {
        mergeBuckets[key] = [];
      }
      mergeBuckets[key].push({
        code: target.subfield,
        value: cellValue,
        meta: { tag: target.tag, ind1: target.ind1, ind2: target.ind2, group, label },
      });
      continue;
    }

    if (target.emit === 'repeatable' && target.mergeKey?.startsWith('author700')) {
      const key = target.mergeKey;
      if (!mergeBuckets[key]) {
        mergeBuckets[key] = [];
      }
      mergeBuckets[key].push({
        code: target.subfield,
        value: cellValue,
        meta: { tag: target.tag, ind1: target.ind1, ind2: target.ind2, group, label },
      });
      continue;
    }

    if (target.mergeKey === 'author100') {
      const key = target.mergeKey;
      if (!mergeBuckets[key]) {
        mergeBuckets[key] = [];
      }
      mergeBuckets[key].push({
        code: target.subfield,
        value: cellValue,
        meta: { tag: target.tag, ind1: target.ind1, ind2: target.ind2, group, label },
      });
      continue;
    }

    const dataField = createDataField(
      target.tag,
      target.ind1,
      target.ind2,
      [{ code: target.subfield, value: cellValue }],
      label,
      group,
    );

    if (dataField) {
      fields.push(dataField);
    }
  }

  for (const [key, bucket] of Object.entries(mergeBuckets)) {
    if (bucket.length === 0) {
      continue;
    }

    const subfields = bucket.map(({ code, value }) => ({ code, value }));
    const meta = bucket[0].meta;
    const requiresAuthorName = key.startsWith('author700') || key === 'author100';
    const hasAuthorName = subfields.some(
      (subfield) => subfield.code === 'a' && subfield.value.trim() !== '',
    );

    if (requiresAuthorName && !hasAuthorName) {
      continue;
    }

    const dataField = createDataField(meta.tag, meta.ind1, meta.ind2, subfields, key, meta.group);

    if (dataField) {
      fields.push(dataField);
    }
  }

  return {
    leader: buildLeader(langCode),
    fields,
    sourceRowNumber: rowNumber,
    sourceValues: values,
  };
}

/**
 * @param {ParsedRow[]} parsedRows
 * @returns {MarcRecord[]}
 */
export function buildMarcRecords(parsedRows) {
  return parsedRows.map((row) => buildMarcRecord(row.values, row.rowNumber));
}

/**
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function cloneMarcRecord(record) {
  return structuredClone(record);
}

/**
 * @param {MarcRecord} record
 * @returns {MarcDataField}
 */
export function createEmptyDataField() {
  return {
    type: 'data',
    tag: '500',
    ind1: ' ',
    ind2: ' ',
    subfields: [{ code: 'a', value: '' }],
    sourceLabel: 'Custom field',
    group: 'Notes',
  };
}
