import { applyPunctuation } from './punctuation.js';

/** @typedef {'comma'|'period'|'colon'|'semicolon'|'space'|'none'|'no_punc'} PunctuationRule */

/**
 * @typedef {Object} MarcTarget
 * @property {string} tag
 * @property {string} ind1
 * @property {string} ind2
 * @property {string} subfield
 * @property {PunctuationRule} [punctuation]
 * @property {'single'|'repeatable'|'merge264'|'merge300'|'merge830'|'language'} [emit]
 * @property {string} [mergeKey]
 */

/**
 * @typedef {Object} ColumnDefinition
 * @property {number} index
 * @property {string} label
 * @property {string} group
 * @property {MarcTarget} target
 */

/** @type {ColumnDefinition[]} */
export const COLUMN_DEFINITIONS = [
  { index: 0, label: 'ISBN', group: 'Identifiers', target: { tag: '020', ind1: ' ', ind2: ' ', subfield: 'a', punctuation: 'none', emit: 'single' } },
  { index: 1, label: 'Primary Author', group: 'Authors', target: { tag: '100', ind1: '1', ind2: ' ', subfield: 'a', punctuation: 'comma', emit: 'single', mergeKey: 'author100' } },
  { index: 2, label: 'Primary Author Role', group: 'Authors', target: { tag: '100', ind1: '1', ind2: ' ', subfield: 'e', punctuation: 'space', emit: 'single', mergeKey: 'author100' } },
  { index: 3, label: 'Secondary Author 1', group: 'Authors', target: { tag: '700', ind1: '1', ind2: ' ', subfield: 'a', punctuation: 'comma', emit: 'repeatable', mergeKey: 'author700-1' } },
  { index: 4, label: 'Secondary Author 1 Role', group: 'Authors', target: { tag: '700', ind1: '1', ind2: ' ', subfield: 'e', punctuation: 'space', emit: 'repeatable', mergeKey: 'author700-1' } },
  { index: 5, label: 'Secondary Author 2', group: 'Authors', target: { tag: '700', ind1: '1', ind2: ' ', subfield: 'a', punctuation: 'comma', emit: 'repeatable', mergeKey: 'author700-2' } },
  { index: 6, label: 'Secondary Author 2 Role', group: 'Authors', target: { tag: '700', ind1: '1', ind2: ' ', subfield: 'e', punctuation: 'space', emit: 'repeatable', mergeKey: 'author700-2' } },
  { index: 7, label: 'Title', group: 'Title', target: { tag: '245', ind1: '0', ind2: '0', subfield: 'a', punctuation: 'period', emit: 'single' } },
  { index: 8, label: 'Place of Publication', group: 'Publication', target: { tag: '264', ind1: ' ', ind2: '1', subfield: 'a', punctuation: 'colon', emit: 'merge264', mergeKey: 'pub264' } },
  { index: 9, label: 'Publisher', group: 'Publication', target: { tag: '264', ind1: ' ', ind2: '1', subfield: 'b', punctuation: 'semicolon', emit: 'merge264', mergeKey: 'pub264' } },
  { index: 10, label: 'Date', group: 'Publication', target: { tag: '264', ind1: ' ', ind2: '1', subfield: 'c', punctuation: 'none', emit: 'merge264', mergeKey: 'pub264' } },
  { index: 11, label: 'Pages', group: 'Physical Description', target: { tag: '300', ind1: ' ', ind2: ' ', subfield: 'a', punctuation: 'semicolon', emit: 'merge300', mergeKey: 'phys300' } },
  { index: 12, label: 'Height', group: 'Physical Description', target: { tag: '300', ind1: ' ', ind2: ' ', subfield: 'c', punctuation: 'none', emit: 'merge300', mergeKey: 'phys300' } },
  { index: 13, label: 'Languages', group: 'Language', target: { tag: '546', ind1: ' ', ind2: ' ', subfield: 'a', punctuation: 'none', emit: 'language' } },
  { index: 14, label: 'Series', group: 'Series', target: { tag: '830', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'no_punc', emit: 'merge830', mergeKey: 'series830' } },
  { index: 15, label: 'Series Number', group: 'Series', target: { tag: '830', ind1: ' ', ind2: '0', subfield: 'v', punctuation: 'none', emit: 'merge830', mergeKey: 'series830' } },
  { index: 16, label: 'Name Subject', group: 'Subjects', target: { tag: '600', ind1: '1', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 17, label: 'Subject 1', group: 'Subjects', target: { tag: '650', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'space', emit: 'repeatable' } },
  { index: 18, label: 'Subject 2', group: 'Subjects', target: { tag: '650', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 19, label: 'Subject 3', group: 'Subjects', target: { tag: '650', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 20, label: 'Subject 4', group: 'Subjects', target: { tag: '650', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 21, label: 'Subject 5', group: 'Subjects', target: { tag: '650', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 22, label: 'Subject 6', group: 'Subjects', target: { tag: '650', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 23, label: 'Geographic Subject 1', group: 'Subjects', target: { tag: '651', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 24, label: 'Geographic Subject 2', group: 'Subjects', target: { tag: '651', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 25, label: 'Geographic Subject 3', group: 'Subjects', target: { tag: '651', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 26, label: 'Geographic Subject 4', group: 'Subjects', target: { tag: '651', ind1: ' ', ind2: '0', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 27, label: 'MESH Subject', group: 'Subjects', target: { tag: '650', ind1: '1', ind2: '2', subfield: 'a', punctuation: 'none', emit: 'repeatable' } },
  { index: 28, label: 'Genre', group: 'Genre', target: { tag: '655', ind1: ' ', ind2: '7', subfield: 'a', punctuation: 'no_punc', emit: 'repeatable' } },
  { index: 29, label: 'Note (format)', group: 'Notes', target: { tag: '500', ind1: ' ', ind2: ' ', subfield: 'a', punctuation: 'none', emit: 'single' } },
];

/** @type {Record<string, string>} */
export const LANGUAGE_CODE_MAP = {
  english: 'eng',
  eng: 'eng',
  en: 'eng',
  french: 'fre',
  fre: 'fre',
  fr: 'fre',
  german: 'ger',
  ger: 'ger',
  de: 'ger',
  spanish: 'spa',
  spa: 'spa',
  es: 'spa',
  latin: 'lat',
  lat: 'lat',
  italian: 'ita',
  ita: 'ita',
  dutch: 'dut',
  dut: 'dut',
  welsh: 'wel',
  wel: 'wel',
};

/**
 * @param {string} languageText
 * @returns {string}
 */
export function resolveLanguageCode(languageText) {
  if (!languageText) {
    return 'eng';
  }

  const normalized = languageText.trim().toLowerCase();
  if (LANGUAGE_CODE_MAP[normalized]) {
    return LANGUAGE_CODE_MAP[normalized];
  }

  if (/^[a-z]{3}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }

  return 'eng';
}

/**
 * @param {Record<number, string>} rowValues
 * @returns {Record<number, string>}
 */
export function normalizeRowValues(rowValues) {
  /** @type {Record<number, string>} */
  const normalized = {};

  for (const column of COLUMN_DEFINITIONS) {
    const raw = rowValues[column.index];
    if (raw == null || String(raw).trim() === '') {
      continue;
    }

    normalized[column.index] = applyPunctuation(String(raw), column.target.punctuation);
  }

  return normalized;
}

/**
 * @param {string} notation
 * @returns {{ tag: string, ind1: string, ind2: string, subfield: string }}
 */
export function parseMarcNotation(notation) {
  const cleaned = notation.replace(/\$/g, '').trim();
  const tagMatch = cleaned.match(/^(\d{3})/);
  if (!tagMatch) {
    throw new Error(`Invalid MARC notation: ${notation}`);
  }

  const tag = tagMatch[1];
  const remainder = cleaned.slice(3);
  let ind1 = ' ';
  let ind2 = ' ';
  let subfield = 'a';

  if (remainder.includes('|')) {
    const [indicatorPart, subfieldPart] = remainder.split('|');
    ind2 = indicatorPart.trim().slice(-1) || ' ';
    subfield = subfieldPart.trim().charAt(0) || 'a';
  } else if (remainder.includes('/')) {
    const [, indicatorPart = '', subfieldPart = 'a'] = remainder.split('/');
    if (indicatorPart.length >= 2) {
      ind1 = indicatorPart[0] === '' ? ' ' : indicatorPart[0];
      ind2 = indicatorPart[1] === '' ? ' ' : indicatorPart[1];
    } else if (indicatorPart.length === 1) {
      ind2 = indicatorPart;
    }
    subfield = subfieldPart.trim().charAt(0) || 'a';
  } else if (/^\d{2}[a-z]$/i.test(remainder)) {
    ind1 = remainder[0];
    ind2 = remainder[1];
    subfield = remainder[2];
  } else if (/^\d[a-z]$/i.test(remainder)) {
    ind2 = remainder[0];
    subfield = remainder[1];
  } else if (/^[a-z]$/i.test(remainder)) {
    subfield = remainder;
  }

  return { tag, ind1, ind2, subfield };
}

export const FIELD_GROUPS = [
  'Control',
  'Identifiers',
  'Authors',
  'Title',
  'Publication',
  'Physical Description',
  'Language',
  'Series',
  'Subjects',
  'Genre',
  'Notes',
];
