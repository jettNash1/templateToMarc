import { applyPunctuation } from './punctuation.js';
import { inferFieldGroup } from './header-parser.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./marc-builder.js').MarcField} MarcField */

/**
 * Remove duplicate data/control fields by fingerprint.
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function removeDuplicateFields(record) {
  const seen = new Set();
  /** @type {MarcField[]} */
  const fields = [];

  for (const field of record.fields) {
    const fingerprint =
      field.type === 'control'
        ? `c:${field.tag}:${field.value}`
        : `d:${field.tag}:${field.ind1}:${field.ind2}:${field.subfields.map((s) => `${s.code}${s.value}`).join('|')}`;

    if (seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    fields.push(field);
  }

  return { ...record, fields };
}

/**
 * @param {string} value
 * @returns {string}
 */
export function fixEncoding(value) {
  return value
    .normalize('NFC')
    .replace(/\u00c2\u00a0/g, ' ')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\ufffd/g, '');
}

/**
 * @param {string} isbn
 * @returns {string}
 */
export function normalizeIsbn(isbn) {
  const digits = isbn.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (digits.length === 13) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4, 10)}-${digits.slice(10)}`;
  }
  return isbn.trim();
}

/**
 * @param {string} dateText
 * @returns {string}
 */
export function normalizeDate(dateText) {
  const yearMatch = dateText.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return yearMatch[0];
  }
  return dateText.trim();
}

const PUNCTUATION_RULES = [
  { tag: '245', subfield: 'a', rule: 'period' },
  { tag: '100', subfield: 'a', rule: 'comma' },
  { tag: '700', subfield: 'a', rule: 'comma' },
  { tag: '264', subfield: 'a', rule: 'colon' },
  { tag: '264', subfield: 'b', rule: 'semicolon' },
];

/**
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function standardizePunctuation(record) {
  const fields = record.fields.map((field) => {
    if (field.type !== 'data') {
      return field;
    }

    const subfields = field.subfields.map((subfield) => {
      const rule = PUNCTUATION_RULES.find(
        (entry) => entry.tag === field.tag && entry.subfield === subfield.code,
      );

      if (!rule) {
        return { ...subfield, value: fixEncoding(subfield.value) };
      }

      return {
        ...subfield,
        value: applyPunctuation(fixEncoding(subfield.value), rule.rule),
      };
    });

    return { ...field, subfields };
  });

  return { ...record, fields };
}

/**
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function normalizeMetadata(record) {
  const fields = record.fields.map((field) => {
    if (field.type !== 'data') {
      if (field.type === 'control') {
        return { ...field, value: fixEncoding(field.value) };
      }
      return field;
    }

    const subfields = field.subfields.map((subfield) => {
      let value = fixEncoding(subfield.value);

      if (field.tag === '020' && subfield.code === 'a') {
        value = normalizeIsbn(value);
      }

      if ((field.tag === '264' || field.tag === '260') && subfield.code === 'c') {
        value = normalizeDate(value);
      }

      return { ...subfield, value };
    });

    return { ...field, subfields };
  });

  return { ...record, fields };
}

/**
 * @typedef {Object} CleanupOptions
 * @property {boolean} dedupe
 * @property {boolean} punctuation
 * @property {boolean} encoding
 * @property {boolean} isbn
 * @property {boolean} dates
 */

/**
 * @param {MarcRecord} record
 * @param {CleanupOptions} options
 * @returns {MarcRecord}
 */
export function cleanupRecordWithOptions(record, options) {
  let next = {
    ...record,
    leader: options.encoding ? fixEncoding(record.leader) : record.leader,
    fields: record.fields.map((field) => {
      if (field.type === 'control') {
        return {
          ...field,
          value: options.encoding ? fixEncoding(field.value) : field.value,
        };
      }
      return field;
    }),
  };

  if (options.dedupe) {
    next = removeDuplicateFields(next);
  }

  if (options.punctuation) {
    next = standardizePunctuation(next);
  }

  if (options.isbn || options.dates || options.encoding) {
    next = normalizeMetadata(next);
  }

  return next;
}

/**
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function cleanupRecord(record) {
  return cleanupRecordWithOptions(record, {
    dedupe: true,
    punctuation: true,
    encoding: true,
    isbn: true,
    dates: true,
  });
}

/**
 * @param {MarcRecord[]} records
 * @returns {MarcRecord[]}
 */
export function cleanupRecords(records) {
  return records.map((record) => cleanupRecord(record));
}
