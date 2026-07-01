import { createControlField } from './marc-builder.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/** @typedef {'bibliographic'|'authority'|'holdings'} RecordType */

const LEADERS = {
  bibliographic: '00000nam a2200000 i 4500',
  authority: '00000nza a2200000 i 4500',
  holdings: '00000nam a22????? i 4500',
};

const DEFAULT_008 = {
  bibliographic: '230101s2023    xxu           000 0 eng d',
  authority: '230101 n anznnbabn          n aaa     d',
  holdings: '230101 0    8   3 1        000   d',
};

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
 * @param {RecordType} [recordType]
 * @param {number} [rowNumber]
 * @returns {MarcRecord}
 */
export function createBlankRecord(recordType = 'bibliographic', rowNumber = 1) {
  const now = new Date();
  const controlId = `ML${formatDate(now)}${String(rowNumber).padStart(4, '0')}`;

  return {
    recordType,
    leader: LEADERS[recordType],
    fields: [
      createControlField('001', controlId),
      createControlField('005', `${formatDate(now)}000000.0`),
      createControlField('008', DEFAULT_008[recordType]),
    ],
    sourceRowNumber: rowNumber,
    sourceValues: {},
  };
}

/**
 * @param {MarcRecord} record
 * @returns {{ title: string, author: string }}
 */
export function getRecordPreview(record) {
  let title = '';
  let author = '';

  for (const field of record.fields) {
    if (field.type !== 'data') {
      continue;
    }

    const subfieldA = field.subfields.find((subfield) => subfield.code === 'a');
    if (!subfieldA?.value) {
      continue;
    }

    if (!title && field.tag === '245') {
      title = subfieldA.value;
    }

    if (!author && (field.tag === '100' || field.tag === '700' || field.tag === '110')) {
      author = subfieldA.value;
    }
  }

  return {
    title: title || '(No title)',
    author: author || '(No author)',
  };
}

/**
 * @param {MarcRecord} record
 * @returns {import('./file-import.js').ParsedRow}
 */
export function recordToParsedRow(record) {
  const preview = getRecordPreview(record);
  return {
    rowNumber: record.sourceRowNumber,
    values: record.sourceValues ?? {},
    previewTitle: preview.title,
    previewAuthor: preview.author,
  };
}
