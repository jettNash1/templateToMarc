/**
 * Apply trailing punctuation rules from the Book Donation template.
 * @param {string} value
 * @param {string|undefined} rule
 * @returns {string}
 */
export function applyPunctuation(value, rule) {
  if (value == null || value === '') {
    return '';
  }

  const trimmed = String(value).trim();
  if (!trimmed || !rule || rule === 'none' || rule === 'no_punc') {
    return trimmed;
  }

  const suffixMap = {
    comma: ',',
    period: '.',
    colon: ':',
    semicolon: ';',
    space: ' ',
  };

  const suffix = suffixMap[rule];
  if (!suffix) {
    return trimmed;
  }

  if (trimmed.endsWith(suffix)) {
    return trimmed;
  }

  return `${trimmed}${suffix}`;
}
