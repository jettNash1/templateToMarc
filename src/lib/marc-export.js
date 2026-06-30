/**
 * @typedef {import('./marc-builder.js').MarcRecord} MarcRecord
 * @typedef {import('./marc-builder.js').MarcField} MarcField
 * @typedef {import('./marc-builder.js').MarcDataField} MarcDataField
 */

const SUBFIELD_DELIMITER = '\x1f';
const FIELD_TERMINATOR = '\x1e';
const RECORD_TERMINATOR = '\x1d';

/**
 * @param {MarcRecord} record
 * @returns {string}
 */
export function recordToMarcText(record) {
  const lines = [`=LDR  ${record.leader}`];

  for (const field of record.fields) {
    if (field.type === 'control') {
      lines.push(`=${field.tag}  ${field.value}`);
      continue;
    }

    const subfieldText = field.subfields
      .map((subfield) => `$${subfield.code}${subfield.value}`)
      .join('');
    lines.push(`=${field.tag}  ${field.ind1}${field.ind2}${subfieldText}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * @param {MarcRecord[]} records
 * @returns {string}
 */
export function recordsToMarcText(records) {
  return records.map((record) => recordToMarcText(record)).join('\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {MarcRecord} record
 * @returns {string}
 */
export function recordToMarcXml(record) {
  const fieldXml = record.fields
    .map((field) => {
      if (field.type === 'control') {
        return `    <controlfield tag="${field.tag}">${escapeXml(field.value)}</controlfield>`;
      }

      const subfields = field.subfields
        .map((subfield) => `      <subfield code="${subfield.code}">${escapeXml(subfield.value)}</subfield>`)
        .join('\n');

      return [
        `    <datafield tag="${field.tag}" ind1="${field.ind1 === ' ' ? ' ' : escapeXml(field.ind1)}" ind2="${field.ind2 === ' ' ? ' ' : escapeXml(field.ind2)}">`,
        subfields,
        '    </datafield>',
      ].join('\n');
    })
    .join('\n');

  return [
    '  <record xmlns="http://www.loc.gov/MARC21/slim">',
    `    <leader>${escapeXml(record.leader)}</leader>`,
    fieldXml,
    '  </record>',
  ].join('\n');
}

/**
 * @param {MarcRecord[]} records
 * @returns {string}
 */
export function recordsToMarcXml(records) {
  const body = records.map((record) => recordToMarcXml(record)).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<collection xmlns="http://www.loc.gov/MARC21/slim">',
    body,
    '</collection>',
  ].join('\n');
}

/**
 * @param {MarcDataField} field
 * @returns {string}
 */
function serializeDataField(field) {
  const subfields = field.subfields
    .map((subfield) => `${SUBFIELD_DELIMITER}${subfield.code}${subfield.value}`)
    .join('');
  return `${field.tag}${field.ind1}${field.ind2}${subfields}${FIELD_TERMINATOR}`;
}

/**
 * @param {MarcRecord} record
 * @returns {Uint8Array}
 */
export function recordToMarcBinary(record) {
  const directoryEntries = [];
  const fieldDataParts = [];

  for (const field of record.fields) {
    const fieldContent =
      field.type === 'control'
        ? `${field.value}${FIELD_TERMINATOR}`
        : serializeDataField(field);

    directoryEntries.push({
      tag: field.tag,
      length: fieldContent.length,
    });
    fieldDataParts.push(fieldContent);
  }

  const baseAddress = 24 + directoryEntries.length * 12 + 1;
  let offset = 0;
  const directory = directoryEntries
    .map((entry) => {
      const line = `${entry.tag}${String(entry.length).padStart(4, '0')}${String(offset).padStart(5, '0')}`;
      offset += entry.length;
      return line;
    })
    .join('');

  const fieldData = fieldDataParts.join('');
  const recordLength = baseAddress + fieldData.length + 1;
  const leader = `${String(recordLength).padStart(5, '0')}${record.leader.slice(5, 12)}${String(baseAddress).padStart(5, '0')}${record.leader.slice(17)}`;
  const recordString = `${leader}${directory}${FIELD_TERMINATOR}${fieldData}${RECORD_TERMINATOR}`;

  return new TextEncoder().encode(recordString);
}

/**
 * @param {MarcRecord[]} records
 * @returns {Uint8Array}
 */
export function recordsToMarcBinary(records) {
  const chunks = records.map((record) => recordToMarcBinary(record));
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

/**
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadTextFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  triggerDownload(blob, filename);
}

/**
 * @param {Uint8Array} content
 * @param {string} filename
 */
export function downloadBinaryFile(content, filename) {
  const blob = new Blob([content], { type: 'application/marc' });
  triggerDownload(blob, filename);
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
