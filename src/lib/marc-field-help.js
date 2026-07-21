/** @typedef {{ summary: string, indicators?: string, subfields?: string, locUrl?: string }} FieldHelpEntry */

/** @type {Record<string, FieldHelpEntry>} */
export const MARC_FIELD_HELP = {
  '001': {
    summary: 'Record control number — unique identifier for this record in your system.',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd001.html',
  },
  '008': {
    summary: 'Fixed-length control field — dates, place, language, and material type encoded by position.',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd008.html',
  },
  '020': {
    summary: 'International Standard Book Number (ISBN) and related notes.',
    indicators: 'Ind1: blank. Ind2: blank or source of note.',
    subfields: '$a ISBN, $c terms, $q qualifier',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd020.html',
  },
  '100': {
    summary: 'Main personal name entry — primary author.',
    indicators: 'Ind1: 1 = surname forename, 0 = forename only. Ind2: number of character positions to skip.',
    subfields: '$a name, $d dates, $e relator',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd100.html',
  },
  '245': {
    summary: 'Title and statement of responsibility.',
    indicators: 'Ind1: 0 = no author entry, 1 = author entry present. Ind2: non-filing characters (e.g. 4 for "The ").',
    subfields: '$a title, $b remainder, $c statement of responsibility',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd245.html',
  },
  '650': {
    summary: 'Topical subject heading.',
    indicators: 'Ind1: blank. Ind2: source of term (0 = LCSH, 7 = source in $2).',
    subfields: '$a heading, $x subdivision, $0 authority URI',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd650.html',
  },
  '856': {
    summary: 'Electronic location and access — URLs and related link text.',
    indicators: 'Ind1: access method. Ind2: relationship (0 = resource, 1 = version).',
    subfields: '$u URL, $z public note, $3 materials specified',
    locUrl: 'https://www.loc.gov/marc/bibliographic/bd856.html',
  },
};

/**
 * @param {string} tag
 * @returns {FieldHelpEntry|null}
 */
export function getFieldHelp(tag) {
  return MARC_FIELD_HELP[tag] ?? null;
}
