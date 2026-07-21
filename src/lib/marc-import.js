import { inferFieldGroup } from './header-parser.js';
import { inferRecordTypeFromLeader, normalizeMarcRecord, padFixedField, sanitizeMarcControlValue } from './marc-fixed-field.js';
/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./marc-builder.js').MarcField} MarcField */

const FIELD_TERMINATOR = '\x1e';
const RECORD_TERMINATOR = '\x1d';
const SUBFIELD_DELIMITER = '\x1f';

/**
 * @param {string} leader
 * @param {MarcField[]} fields
 * @param {number} rowNumber
 * @returns {MarcRecord}
 */
function buildRecord(leader, fields, rowNumber) {
  return normalizeMarcRecord({
    recordType: inferRecordTypeFromLeader(leader),
    leader: padFixedField(leader, 24),
    fields,
    sourceRowNumber: rowNumber,
    sourceValues: {},
  });
}

/**
 * @param {Uint8Array} buffer
 * @returns {MarcRecord[]}
 */
export function parseMarcBinary(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  /** @type {MarcRecord[]} */
  const records = [];
  let start = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x1d) {
      continue;
    }

    const chunk = bytes.slice(start, index + 1);
    if (chunk.length >= 25) {
      const parsed = parseSingleBinaryRecord(chunk);
      if (parsed) {
        parsed.sourceRowNumber = records.length + 1;
        records.push(parsed);
      }
    }
    start = index + 1;
  }

  if (records.length === 0) {
    throw new Error('No MARC records found in the binary file.');
  }

  return records;
}

/**
 * @param {Uint8Array} chunk
 * @returns {MarcRecord|null}
 */
function parseSingleBinaryRecord(chunk) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(chunk);
  const leader = sanitizeMarcControlValue(text.slice(0, 24));
  const baseAddress = Number.parseInt(leader.slice(12, 17), 10);

  if (Number.isNaN(baseAddress) || baseAddress >= text.length) {
    return null;
  }

  const directoryEnd = text.indexOf(FIELD_TERMINATOR, 24);
  if (directoryEnd < 0 || directoryEnd > baseAddress) {
    return null;
  }

  const directory = text.slice(24, directoryEnd);
  /** @type {MarcField[]} */
  const fields = [];

  for (let offset = 0; offset + 12 <= directory.length; offset += 12) {
    const entry = directory.slice(offset, offset + 12);
    const tag = entry.slice(0, 3);
    const length = Number.parseInt(entry.slice(3, 7), 10);
    const position = Number.parseInt(entry.slice(7, 12), 10);

    if (Number.isNaN(length) || Number.isNaN(position)) {
      continue;
    }

    const rawField = text.slice(baseAddress + position, baseAddress + position + length);
    const fieldBody = rawField.replace(new RegExp(`${FIELD_TERMINATOR}$`), '');

    if (tag >= '010') {
      const ind1 = fieldBody.charAt(0) || ' ';
      const ind2 = fieldBody.charAt(1) || ' ';
      const subfieldPart = fieldBody.slice(2);
      /** @type {{ code: string, value: string }[]} */
      const subfields = [];
      const parts = subfieldPart.split(SUBFIELD_DELIMITER).filter(Boolean);

      for (const part of parts) {
        subfields.push({ code: part.charAt(0), value: part.slice(1) });
      }

      if (subfields.length > 0) {
        fields.push({
          type: 'data',
          tag,
          ind1,
          ind2,
          subfields,
          group: inferFieldGroup(tag),
        });
      }
    } else {
      fields.push({
        type: 'control',
        tag,
        value: sanitizeMarcControlValue(fieldBody),
        group: 'Control',
      });
    }
  }

  return buildRecord(leader, fields, 1);
}

/**
 * @param {string} text
 * @returns {MarcRecord[]}
 */
export function parseMarcMnemonic(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const chunks = normalized.split(/\n(?==)/);
  /** @type {MarcRecord[]} */
  const records = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) {
      continue;
    }

    const record = parseMnemonicChunk(trimmed);
    if (record) {
      record.sourceRowNumber = records.length + 1;
      records.push(record);
    }
  }

  if (records.length === 0) {
    throw new Error('No MARC mnemonic records found.');
  }

  return records;
}

/**
 * @param {string} chunk
 * @returns {MarcRecord|null}
 */
function parseMnemonicChunk(chunk) {
  const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  let leader = '00000nam a2200000 i 4500';
  /** @type {MarcField[]} */
  const fields = [];

  for (const line of lines) {
    if (!line.startsWith('=')) {
      continue;
    }

    const body = line.slice(1);
    if (body.startsWith('LDR') || body.startsWith('000')) {
      leader = sanitizeMarcControlValue(body.replace(/^LDR\s+/, '').replace(/^000\s+/, '')).slice(0, 24);
      continue;
    }

    const tagMatch = body.match(/^(\d{3})\s*(.*)$/);
    if (!tagMatch) {
      continue;
    }

    const tag = tagMatch[1];
    const remainder = tagMatch[2].trim();

    if (tag < '010') {
      fields.push({ type: 'control', tag, value: sanitizeMarcControlValue(remainder), group: 'Control' });
      continue;
    }

    const indicatorMatch = remainder.match(/^(.{2})([\s\S]*)$/);
    const ind1 = indicatorMatch?.[1]?.charAt(0) ?? ' ';
    const ind2 = indicatorMatch?.[1]?.charAt(1) ?? ' ';
    const subfieldText = indicatorMatch?.[2] ?? remainder;
    /** @type {{ code: string, value: string }[]} */
    const subfields = [];

    for (const match of subfieldText.matchAll(/\$([a-z0-9])([^\$]*)/gi)) {
      subfields.push({ code: match[1], value: match[2] });
    }

    if (subfields.length > 0) {
      fields.push({
        type: 'data',
        tag,
        ind1,
        ind2,
        subfields,
        group: inferFieldGroup(tag),
      });
    }
  }

  return buildRecord(leader, fields, 1);
}

/**
 * @param {string} xmlText
 * @returns {MarcRecord[]}
 */
export function parseMarcXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid MARCXML document.');
  }

  const recordNodes = doc.querySelectorAll('record');
  /** @type {MarcRecord[]} */
  const records = [];

  recordNodes.forEach((node, index) => {
    const leader = sanitizeMarcControlValue(node.querySelector('leader')?.textContent?.trim() ?? '00000nam a2200000 i 4500');
    /** @type {MarcField[]} */
    const fields = [];

    node.querySelectorAll('controlfield').forEach((control) => {
      const tag = control.getAttribute('tag') ?? '001';
      fields.push({
        type: 'control',
        tag,
        value: sanitizeMarcControlValue(control.textContent ?? ''),
        group: 'Control',
      });
    });

    node.querySelectorAll('datafield').forEach((datafield) => {
      const tag = datafield.getAttribute('tag') ?? '500';
      const ind1 = datafield.getAttribute('ind1') ?? ' ';
      const ind2 = datafield.getAttribute('ind2') ?? ' ';
      /** @type {{ code: string, value: string }[]} */
      const subfields = [];

      datafield.querySelectorAll('subfield').forEach((subfield) => {
        subfields.push({
          code: subfield.getAttribute('code') ?? 'a',
          value: subfield.textContent ?? '',
        });
      });

      if (subfields.length > 0) {
        fields.push({
          type: 'data',
          tag,
          ind1,
          ind2,
          subfields,
          group: inferFieldGroup(tag),
        });
      }
    });

    records.push(buildRecord(leader, fields, index + 1));
  });

  if (records.length === 0) {
    throw new Error('No records found in MARCXML file.');
  }

  return records;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @returns {Promise<{ records: MarcRecord[], columnSchema: [], skippedColumns: [], parsedRows: import('./marc-model.js').recordToParsedRow extends Function ? ReturnType<import('./marc-model.js').recordToParsedRow>[] : never }>}
 */
export async function importMarcFile(buffer, filename) {
  const lower = filename.toLowerCase();
  const { recordToParsedRow } = await import('./marc-model.js');

  let records;
  if (lower.endsWith('.mrc')) {
    records = parseMarcBinary(new Uint8Array(buffer));
  } else if (lower.endsWith('.mrk') || lower.endsWith('.txt')) {
    records = parseMarcMnemonic(new TextDecoder('utf-8').decode(buffer));
  } else if (lower.endsWith('.xml')) {
    records = parseMarcXml(new TextDecoder('utf-8').decode(buffer));
  } else {
    throw new Error('Unsupported MARC file type.');
  }

  return {
    records,
    columnSchema: [],
    skippedColumns: [],
    parsedRows: records.map((record) => recordToParsedRow(record)),
  };
}
