/**
 * @typedef {Object} ParseScopeResult
 * @property {number[]} indices 0-based sorted unique indices
 * @property {string} [error]
 */

/**
 * @param {number[]} indices
 * @returns {string}
 */
export function formatRecordRanges(indices) {
  if (indices.length === 0) {
    return '';
  }

  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  /** @type {string[]} */
  const parts = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index];
    if (value === rangeEnd + 1) {
      rangeEnd = value;
      continue;
    }

    parts.push(rangeStart === rangeEnd ? `${rangeStart + 1}` : `${rangeStart + 1}–${rangeEnd + 1}`);
    rangeStart = value;
    rangeEnd = value;
  }

  parts.push(rangeStart === rangeEnd ? `${rangeStart + 1}` : `${rangeStart + 1}–${rangeEnd + 1}`);
  return parts.join(', ');
}

/**
 * @param {string} text
 * @param {number} totalRecords
 * @returns {ParseScopeResult}
 */
export function parseRecordScope(text, totalRecords) {
  if (totalRecords <= 0) {
    return { indices: [], error: 'No records loaded.' };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { indices: Array.from({ length: totalRecords }, (_, index) => index) };
  }

  /** @type {number[]} */
  const indices = [];
  const segments = trimmed.split(',');

  for (const segment of segments) {
    const part = segment.trim();
    if (!part) {
      continue;
    }

    if (part.includes('-')) {
      const [startText, endText] = part.split('-').map((value) => value.trim());
      const start = Number(startText);
      const end = Number(endText);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return { indices: [], error: `Invalid range "${part}".` };
      }

      if (start < 1 || end < 1 || start > totalRecords || end > totalRecords) {
        return { indices: [], error: `Range "${part}" is out of bounds (1–${totalRecords}).` };
      }

      if (start > end) {
        return { indices: [], error: `Range "${part}" must start before it ends.` };
      }

      for (let recordNumber = start; recordNumber <= end; recordNumber += 1) {
        indices.push(recordNumber - 1);
      }
      continue;
    }

    const recordNumber = Number(part);
    if (!Number.isInteger(recordNumber)) {
      return { indices: [], error: `Invalid record number "${part}".` };
    }

    if (recordNumber < 1 || recordNumber > totalRecords) {
      return { indices: [], error: `Record ${recordNumber} is out of bounds (1–${totalRecords}).` };
    }

    indices.push(recordNumber - 1);
  }

  if (indices.length === 0) {
    return { indices: [], error: 'Enter at least one record number.' };
  }

  return { indices: [...new Set(indices)].sort((a, b) => a - b) };
}

/**
 * @param {string} text
 * @param {number} totalRecords
 * @returns {boolean}
 */
export function isValidScopeText(text, totalRecords) {
  return !parseRecordScope(text, totalRecords).error;
}

/**
 * @param {number} totalRecords
 * @returns {number[]}
 */
export function allRecordIndices(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index);
}
