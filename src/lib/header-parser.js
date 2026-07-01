import { parseMarcNotation } from './template-mapping.js';

/** @typedef {import('./template-mapping.js').PunctuationRule} PunctuationRule */

/**
 * @typedef {Object} ColumnSchema
 * @property {number} index
 * @property {string} label
 * @property {string} tag
 * @property {string} ind1
 * @property {string} ind2
 * @property {string} subfield
 * @property {PunctuationRule} punctuation
 * @property {string} group
 */

/**
 * @typedef {Object} HeaderParseResult
 * @property {ColumnSchema[]} columns
 * @property {{ index: number, header: string, label: string }[]} skipped
 */

const MARC_LINE_PATTERN = /\d{3}[\/\s|]?\S*\$?[a-z0-9]/i;

/** @type {Record<string, string>} */
const TAG_GROUP_MAP = {
  '001': 'Control',
  '003': 'Control',
  '005': 'Control',
  '008': 'Control',
  '020': 'Identifiers',
  '022': 'Identifiers',
  '024': 'Identifiers',
  '100': 'Authors',
  '110': 'Authors',
  '111': 'Authors',
  '700': 'Authors',
  '710': 'Authors',
  '711': 'Authors',
  '245': 'Title',
  '240': 'Title',
  '246': 'Title',
  '260': 'Publication',
  '264': 'Publication',
  '300': 'Physical Description',
  '041': 'Language',
  '546': 'Language',
  '490': 'Series',
  '830': 'Series',
  '600': 'Subjects',
  '610': 'Subjects',
  '611': 'Subjects',
  '650': 'Subjects',
  '651': 'Subjects',
  '655': 'Genre',
  '500': 'Notes',
  '505': 'Notes',
  '520': 'Notes',
};

/**
 * @param {string} tag
 * @returns {string}
 */
export function inferFieldGroup(tag) {
  return TAG_GROUP_MAP[tag] ?? 'Other';
}

/**
 * @param {string} line
 * @returns {PunctuationRule}
 */
function parsePunctuationHint(line) {
  const normalized = line.trim().toLowerCase();

  if (normalized.includes('no punc')) {
    return 'no_punc';
  }
  if (/add\s*,/.test(normalized)) {
    return 'comma';
  }
  if (/add\s*\./.test(normalized)) {
    return 'period';
  }
  if (/add\s*:/.test(normalized)) {
    return 'colon';
  }
  if (/add\s*;/.test(normalized)) {
    return 'semicolon';
  }
  if (/^add\s*$/.test(normalized) || normalized === 'add') {
    return 'space';
  }

  return 'none';
}

/**
 * @param {string} line
 * @returns {string|null}
 */
function extractMarcLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !MARC_LINE_PATTERN.test(trimmed)) {
    return null;
  }

  const match = trimmed.match(/(\d{3}[\/\s|]?\S*\$?[a-z0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * @param {string} line
 * @returns {string}
 */
function cleanLabel(line) {
  return line
    .trim()
    .replace(/^\d+\s+/, '')
    .trim();
}

/**
 * @param {string} headerText
 * @param {number} index
 * @returns {ColumnSchema|null}
 */
export function parseHeaderCell(headerText, index) {
  const raw = String(headerText ?? '').trim();
  if (!raw) {
    return null;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let marcLine = null;
  let labelLine = null;
  /** @type {PunctuationRule} */
  let punctuation = 'none';

  for (const line of lines) {
    const candidate = extractMarcLine(line);
    if (candidate && !marcLine) {
      marcLine = candidate;
      continue;
    }

    const hint = parsePunctuationHint(line);
    if (hint !== 'none') {
      punctuation = hint;
      continue;
    }

    if (!labelLine && !extractMarcLine(line)) {
      labelLine = line;
    }
  }

  if (!marcLine) {
    marcLine = extractMarcLine(raw);
  }

  if (!marcLine) {
    return null;
  }

  const { tag, ind1, ind2, subfield } = parseMarcNotation(marcLine);
  const label = cleanLabel(labelLine ?? lines[0] ?? `Column ${index + 1}`);

  return {
    index,
    label,
    tag,
    ind1,
    ind2,
    subfield,
    punctuation,
    group: inferFieldGroup(tag),
  };
}

/**
 * @param {unknown[]} headerRow
 * @returns {HeaderParseResult}
 */
export function parseHeaders(headerRow) {
  /** @type {ColumnSchema[]} */
  const columns = [];
  /** @type {HeaderParseResult['skipped']} */
  const skipped = [];

  headerRow.forEach((cell, index) => {
    const raw = String(cell ?? '').trim();
    if (!raw) {
      return;
    }

    const parsed = parseHeaderCell(raw, index);
    if (!parsed) {
      skipped.push({
        index,
        header: raw.split(/\r?\n/)[0],
        label: raw.split(/\r?\n/)[0],
      });
      return;
    }

    columns.push(parsed);
  });

  return { columns, skipped };
}

/**
 * @param {ColumnSchema[]} columns
 * @param {Record<number, string>} values
 * @returns {{ previewTitle: string, previewAuthor: string }}
 */
export function derivePreviewFields(columns, values) {
  let previewTitle = '';
  let previewAuthor = '';

  for (const column of columns) {
    const value = values[column.index];
    if (!value) {
      continue;
    }

    if (!previewTitle && column.tag === '245' && column.subfield === 'a') {
      previewTitle = value;
    }

    if (!previewAuthor && (column.tag === '100' || column.tag === '700') && column.subfield === 'a') {
      previewAuthor = value;
    }
  }

  const firstValue = Object.values(values)[0] ?? '';

  return {
    previewTitle: previewTitle || firstValue || '(No title)',
    previewAuthor: previewAuthor || '(No author)',
  };
}
