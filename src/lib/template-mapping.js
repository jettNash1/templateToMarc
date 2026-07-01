/** @typedef {'comma'|'period'|'colon'|'semicolon'|'space'|'none'|'no_punc'} PunctuationRule */

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
    return { tag, ind1, ind2, subfield };
  }

  if (remainder.includes('/')) {
    const slashIndex = remainder.indexOf('/');
    const beforeSlash = remainder.slice(0, slashIndex);
    const afterSlash = remainder.slice(slashIndex + 1).replace(/^\//, '');

    if (beforeSlash.length === 0) {
      if (/^\d{2}[a-z]/i.test(afterSlash)) {
        ind1 = afterSlash[0];
        ind2 = afterSlash[1];
        subfield = afterSlash[2] || 'a';
      } else if (/^\d[a-z]/i.test(afterSlash)) {
        ind2 = afterSlash[0];
        subfield = afterSlash[1] || 'a';
      } else {
        subfield = afterSlash.charAt(0) || 'a';
      }
    } else if (beforeSlash.length === 1 && /^\d$/.test(beforeSlash)) {
      ind1 = beforeSlash;
      subfield = afterSlash.charAt(0) || 'a';
    } else if (beforeSlash.length >= 2 && /^\d+$/.test(beforeSlash)) {
      ind1 = beforeSlash[0];
      ind2 = beforeSlash[1];
      subfield = afterSlash.charAt(0) || 'a';
    } else {
      ind2 = beforeSlash.slice(-1);
      subfield = afterSlash.charAt(0) || 'a';
    }

    return { tag, ind1, ind2, subfield };
  }

  if (/^\d{2}[a-z]$/i.test(remainder)) {
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
