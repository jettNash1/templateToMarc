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

/**
 * @param {MarcRecord[]} records
 * @returns {string}
 */
export function recordsToCsv(records) {
  const rows = ['record,tag,ind1,ind2,subfield_code,subfield_value'];

  records.forEach((record, recordIndex) => {
    rows.push(`${recordIndex + 1},LDR,,,leader,${escapeCsv(record.leader)}`);

    for (const field of record.fields) {
      if (field.type === 'control') {
        rows.push(`${recordIndex + 1},${field.tag},,,control,${escapeCsv(field.value)}`);
        continue;
      }

      for (const subfield of field.subfields) {
        rows.push(
          `${recordIndex + 1},${field.tag},${field.ind1},${field.ind2},${subfield.code},${escapeCsv(subfield.value)}`,
        );
      }
    }
  });

  return `${rows.join('\n')}\n`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCsv(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * @param {MarcRecord[]} records
 * @returns {string}
 */
export function recordsToJson(records) {
  return `${JSON.stringify(records, null, 2)}\n`;
}

/** @typedef {'mrk'|'mrc'|'xml'|'csv'|'json'|'dublin-core'|'mods'|'bibframe'} ExportFormat */

/**
 * @typedef {Object} SerializeResult
 * @property {string} [text]
 * @property {Uint8Array} [binary]
 * @property {string} [summary]
 * @property {string} filename
 * @property {string} [mimeType]
 */

const EXPORT_FILENAMES = {
  mrk: 'marclite-records.mrk',
  mrc: 'marclite-records.mrc',
  xml: 'marclite-records.xml',
  csv: 'marclite-records.csv',
  json: 'marclite-records.json',
  'dublin-core': 'marclite-records-dc.xml',
  mods: 'marclite-records-mods.xml',
  bibframe: 'marclite-records-bibframe.json',
};

/**
 * @param {MarcRecord[]} records
 * @param {ExportFormat} format
 * @returns {Promise<SerializeResult>}
 */
export async function serializeRecords(records, format) {
  if (records.length === 0) {
    throw new Error('No records to export.');
  }

  switch (format) {
    case 'mrk':
      return {
        text: recordsToMarcText(records),
        filename: EXPORT_FILENAMES.mrk,
        mimeType: 'text/plain;charset=utf-8',
      };
    case 'mrc': {
      const binary = recordsToMarcBinary(records);
      const sizeKb = (binary.length / 1024).toFixed(1);
      return {
        binary,
        summary: `Binary MARC — ${records.length} record${records.length === 1 ? '' : 's'}, ~${sizeKb} KB. Use .mrk or .xml for text preview.`,
        filename: EXPORT_FILENAMES.mrc,
      };
    }
    case 'xml':
      return {
        text: recordsToMarcXml(records),
        filename: EXPORT_FILENAMES.xml,
        mimeType: 'application/xml;charset=utf-8',
      };
    case 'csv':
      return {
        text: recordsToCsv(records),
        filename: EXPORT_FILENAMES.csv,
        mimeType: 'text/csv;charset=utf-8',
      };
    case 'json':
      return {
        text: recordsToJson(records),
        filename: EXPORT_FILENAMES.json,
        mimeType: 'application/json;charset=utf-8',
      };
    case 'dublin-core': {
      const { marcToDublinCore } = await import('./converters/non-marc.js');
      return {
        text: `${records.map((record) => marcToDublinCore(record)).join('\n')}\n`,
        filename: EXPORT_FILENAMES['dublin-core'],
        mimeType: 'application/xml;charset=utf-8',
      };
    }
    case 'mods': {
      const { marcToMods } = await import('./converters/non-marc.js');
      return {
        text: `${records.map((record) => marcToMods(record)).join('\n')}\n`,
        filename: EXPORT_FILENAMES.mods,
        mimeType: 'application/xml;charset=utf-8',
      };
    }
    case 'bibframe': {
      const { marcToBibframe } = await import('./converters/non-marc.js');
      return {
        text: `${records.map((record) => marcToBibframe(record)).join('\n')}\n`,
        filename: EXPORT_FILENAMES.bibframe,
        mimeType: 'application/json;charset=utf-8',
      };
    }
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

const PREVIEW_MAX_CHARS = 2500;

/**
 * @param {MarcRecord[]} records
 * @param {ExportFormat} format
 * @returns {Promise<string>}
 */
export async function previewExport(records, format) {
  if (records.length === 0) {
    return 'Load records to preview export output.';
  }

  const serialized = await serializeRecords(records, format);

  if (serialized.summary) {
    return serialized.summary;
  }

  const text = serialized.text ?? '';
  if (text.length <= PREVIEW_MAX_CHARS) {
    return text;
  }

  return `${text.slice(0, PREVIEW_MAX_CHARS)}\n… (truncated; ${records.length} record${records.length === 1 ? '' : 's'} total)`;
}

/**
 * @param {MarcRecord[]} records
 * @param {ExportFormat} format
 */
export async function exportRecords(records, format) {
  const serialized = await serializeRecords(records, format);

  if (serialized.binary) {
    downloadBinaryFile(serialized.binary, serialized.filename);
    return;
  }

  downloadTextFile(serialized.text ?? '', serialized.filename, serialized.mimeType);
}
