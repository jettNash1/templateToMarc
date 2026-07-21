import {
  buildBibliographic008,
  buildDefault008,
  extractSegmentValues,
  getField008Definition,
  getLeaderDefinition,
  inferRecordTypeFromLeader,
  normalizeMarcRecord,
  rebuildFixedFieldValue,
} from '../src/lib/marc-fixed-field.js';

const sampleLeader = '00000nam a2200000 i 4500';
const sample008 = buildBibliographic008({ year: '2023', placeCode: 'xxu', langCode: 'eng' });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyRoundTrip(definition, value, label) {
  const segments = extractSegmentValues(value, definition);
  const rebuilt = rebuildFixedFieldValue(segments, definition);
  assert(rebuilt.length === definition.totalLength, `${label} length mismatch`);
  assert(rebuilt === value.padEnd(definition.totalLength, ' ').slice(0, definition.totalLength), `${label} round-trip failed`);
}

verifyRoundTrip(getLeaderDefinition('bibliographic'), sampleLeader, 'Bibliographic leader');
verifyRoundTrip(getField008Definition('bibliographic'), sample008, 'Bibliographic 008');
verifyRoundTrip(getField008Definition('authority'), buildDefault008('authority'), 'Authority 008');
verifyRoundTrip(getField008Definition('holdings'), buildDefault008('holdings'), 'Holdings 008');

assert(inferRecordTypeFromLeader('00000nza a2200000 i 4500') === 'authority', 'Authority leader inference failed');
assert(inferRecordTypeFromLeader('00000nyu a22000003# 4500') === 'holdings', 'Holdings leader inference failed');

const normalized = normalizeMarcRecord({
  leader: sampleLeader,
  fields: [{ type: 'control', tag: '008', value: sample008.trim(), group: 'Control' }],
  sourceRowNumber: 1,
  sourceValues: {},
});

assert(normalized.fields[0].value.length === 40, 'Imported 008 should pad to 40 characters');
assert(extractSegmentValues(normalized.fields[0].value, getField008Definition('bibliographic'))[2] === '2023', 'Imported 008 year segment mismatch');

console.log('MARC fixed-field verification passed.');
