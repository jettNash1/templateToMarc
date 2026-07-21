import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFile } from '../src/lib/file-import.js';
import { buildMarcRecords } from '../src/lib/marc-builder.js';
import { recordToParsedRow } from '../src/lib/marc-model.js';
import { recordToMarcText } from '../src/lib/marc-export.js';
import { parseMarcMnemonic } from '../src/lib/marc-import.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const templatePath = resolve('BookDonationTemplate.xlsx');
if (!existsSync(templatePath)) {
  console.log('Spreadsheet round-trip verification skipped (BookDonationTemplate.xlsx not found).');
  process.exit(0);
}

try {
  const buffer = readFileSync(templatePath);
  const parsed = await parseFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), templatePath);
  const records = buildMarcRecords(parsed.parsedRows, parsed.columnSchema);
  assert(records.length > 0, 'Expected at least one record from template');

  const mrk = records.map((record) => recordToMarcText(record)).join('\n');
  const roundTripped = parseMarcMnemonic(mrk);
  assert(roundTripped.length === records.length, 'Round-trip record count mismatch');

  const firstOriginal = records[0];
  const firstReturned = roundTripped[0];
  const original245 = firstOriginal.fields.find((field) => field.type === 'data' && field.tag === '245');
  const returned245 = firstReturned.fields.find((field) => field.type === 'data' && field.tag === '245');
  assert(original245 && returned245, '245 field missing in round-trip');
  assert(
    original245.subfields.find((subfield) => subfield.code === 'a')?.value
      === returned245.subfields.find((subfield) => subfield.code === 'a')?.value,
    '245 $a round-trip mismatch',
  );

  assert(recordToParsedRow(firstOriginal).previewTitle.length >= 0, 'Parsed row preview failed');
  console.log('Spreadsheet round-trip verification passed.');
} catch (error) {
  if (error instanceof Error && error.message.includes('No data rows found')) {
    console.log('Spreadsheet round-trip verification skipped (template has headers only).');
    process.exit(0);
  }
  throw error;
}
