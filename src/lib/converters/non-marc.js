/** @typedef {import('../marc-builder.js').MarcRecord} MarcRecord */

/**
 * @param {MarcRecord} record
 * @returns {string}
 */
export function marcToDublinCore(record) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'];

  for (const field of record.fields) {
    if (field.type !== 'data') {
      continue;
    }

    for (const subfield of field.subfields) {
      if (!subfield.value.trim()) {
        continue;
      }

      const element = mapToDublinCore(field.tag, subfield.code);
      if (element) {
        lines.push(`  <dc:${element}>${escapeXml(subfield.value)}</dc:${element}>`);
      }
    }
  }

  lines.push('</metadata>');
  return lines.join('\n');
}

/**
 * @param {string} tag
 * @param {string} code
 * @returns {string|null}
 */
function mapToDublinCore(tag, code) {
  if (tag === '245' && code === 'a') {
    return 'title';
  }
  if ((tag === '100' || tag === '700') && code === 'a') {
    return 'creator';
  }
  if (tag === '520' && code === 'a') {
    return 'description';
  }
  if (tag === '650' && code === 'a') {
    return 'subject';
  }
  if (tag === '020' && code === 'a') {
    return 'identifier';
  }
  if ((tag === '264' || tag === '260') && code === 'c') {
    return 'date';
  }
  if ((tag === '264' || tag === '260') && code === 'b') {
    return 'publisher';
  }
  if (tag === '041' && code === 'a') {
    return 'language';
  }
  return null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {MarcRecord} record
 * @returns {string}
 */
export function marcToMods(record) {
  const preview = record.fields
    .filter((field) => field.type === 'data')
    .flatMap((field) =>
      field.subfields.map(
        (subfield) =>
          `    <${modsElement(field.tag, subfield.code)}>${escapeXml(subfield.value)}</${modsElement(field.tag, subfield.code)}>`,
      ),
    )
    .filter((line) => !line.includes('></'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mods xmlns="http://www.loc.gov/mods/v3">',
    ...preview,
    '</mods>',
  ].join('\n');
}

/**
 * @param {string} tag
 * @param {string} code
 * @returns {string|null}
 */
function modsElement(tag, code) {
  if (tag === '245' && code === 'a') {
    return 'title';
  }
  if ((tag === '100' || tag === '700') && code === 'a') {
    return 'name';
  }
  if (tag === '650' && code === 'a') {
    return 'subject';
  }
  if ((tag === '264' || tag === '260') && code === 'b') {
    return 'publisher';
  }
  if ((tag === '264' || tag === '260') && code === 'c') {
    return 'dateIssued';
  }
  return null;
}

/**
 * @param {MarcRecord} record
 * @returns {string}
 */
export function marcToBibframe(record) {
  const title = findSubfield(record, '245', 'a');
  const creator = findSubfield(record, '100', 'a') || findSubfield(record, '700', 'a');
  const isbn = findSubfield(record, '020', 'a');

  return JSON.stringify(
    {
      '@context': { bf: 'http://id.loc.gov/ontologies/bibframe/' },
      '@graph': [
        {
          '@type': 'bf:Work',
          'bf:title': title,
          'bf:contribution': creator ? [{ '@type': 'bf:Contribution', 'bf:agent': { 'bf:name': creator } }] : [],
        },
        {
          '@type': 'bf:Instance',
          'bf:identifiedBy': isbn ? [{ '@type': 'bf:Isbn', 'rdf:value': isbn }] : [],
        },
      ],
    },
    null,
    2,
  );
}

/**
 * @param {MarcRecord} record
 * @param {string} tag
 * @param {string} code
 * @returns {string}
 */
function findSubfield(record, tag, code) {
  for (const field of record.fields) {
    if (field.type === 'data' && field.tag === tag) {
      const match = field.subfields.find((subfield) => subfield.code === code);
      if (match?.value) {
        return match.value;
      }
    }
  }
  return '';
}
