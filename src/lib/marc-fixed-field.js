/** @typedef {'bibliographic'|'authority'|'holdings'} RecordType */

/**
 * @typedef {Object} FixedFieldSegment
 * @property {number} start 0-based start index
 * @property {number} length
 * @property {string} label
 * @property {string} [placeholder]
 * @property {string} [hint]
 */

/**
 * @typedef {Object} FixedFieldDefinition
 * @property {number} totalLength
 * @property {FixedFieldSegment[]} segments
 * @property {string} docUrl
 * @property {string} docLabel
 */

const LEADER_DOC_URLS = {
  bibliographic: 'https://www.loc.gov/marc/bibliographic/bdleader.html',
  authority: 'https://www.loc.gov/marc/authority/adleader.html',
  holdings: 'https://www.loc.gov/marc/holdings/hdleader.html',
};

const FIELD_008_DOC_URLS = {
  bibliographic: 'https://www.loc.gov/marc/bibliographic/bd008a.html',
  authority: 'https://www.loc.gov/marc/authority/ad008.html',
  holdings: 'https://www.loc.gov/marc/holdings/hd008.html',
};

/** @type {Record<RecordType, FixedFieldSegment[]>} */
const LEADER_SEGMENTS = {
  bibliographic: [
    { start: 0, length: 5, label: '00–04 Length', placeholder: '00000', hint: 'System-generated record length' },
    { start: 5, length: 1, label: '05 Status', placeholder: 'n', hint: 'n=new, c=revised, d=deleted' },
    { start: 6, length: 1, label: '06 Type', placeholder: 'a', hint: 'a=language material, m=computer file, etc.' },
    { start: 7, length: 1, label: '07 Level', placeholder: 'm', hint: 'm=monograph, s=serial, etc.' },
    { start: 8, length: 1, label: '08 Control', placeholder: '#', hint: '#=none, a=archival' },
    { start: 9, length: 1, label: '09 Encoding', placeholder: '#', hint: '#=MARC-8, a=Unicode' },
    { start: 10, length: 1, label: '10 Indicators', placeholder: '2' },
    { start: 11, length: 1, label: '11 Subfields', placeholder: '2' },
    { start: 12, length: 5, label: '12–16 Base addr', placeholder: '00000', hint: 'System-generated' },
    { start: 17, length: 1, label: '17 Encoding lvl', placeholder: '#', hint: '#=full, 7=minimal, etc.' },
    { start: 18, length: 1, label: '18 Desc cat', placeholder: 'i', hint: 'i=ISBD punctuation included' },
    { start: 19, length: 1, label: '19 Multipart', placeholder: '#', hint: '#=N/A, a=set, b=part' },
    { start: 20, length: 1, label: '20 Dir length', placeholder: '4' },
    { start: 21, length: 1, label: '21 Dir start', placeholder: '5' },
    { start: 22, length: 1, label: '22 Dir impl', placeholder: '0' },
    { start: 23, length: 1, label: '23 Undefined', placeholder: '0' },
  ],
  authority: [
    { start: 0, length: 5, label: '00–04 Length', placeholder: '00000' },
    { start: 5, length: 1, label: '05 Status', placeholder: 'n', hint: 'n=new, c=revised, x=replaced heading' },
    { start: 6, length: 1, label: '06 Type', placeholder: 'z', hint: 'z=authority data' },
    { start: 7, length: 2, label: '07–08 Undefined', placeholder: '##', hint: 'Blank (#) per LoC' },
    { start: 9, length: 1, label: '09 Encoding', placeholder: '#', hint: '#=MARC-8, a=Unicode' },
    { start: 10, length: 1, label: '10 Indicators', placeholder: '2' },
    { start: 11, length: 1, label: '11 Subfields', placeholder: '2' },
    { start: 12, length: 5, label: '12–16 Base addr', placeholder: '00000' },
    { start: 17, length: 1, label: '17 Encoding lvl', placeholder: 'n', hint: 'n=complete, o=incomplete' },
    { start: 18, length: 1, label: '18 Punctuation', placeholder: '#', hint: 'i=included, c=omitted' },
    { start: 19, length: 1, label: '19 Undefined', placeholder: '#' },
    { start: 20, length: 1, label: '20 Dir length', placeholder: '4' },
    { start: 21, length: 1, label: '21 Dir start', placeholder: '5' },
    { start: 22, length: 1, label: '22 Dir impl', placeholder: '0' },
    { start: 23, length: 1, label: '23 Undefined', placeholder: '0' },
  ],
  holdings: [
    { start: 0, length: 5, label: '00–04 Length', placeholder: '00000' },
    { start: 5, length: 1, label: '05 Status', placeholder: 'n' },
    { start: 6, length: 1, label: '06 Type', placeholder: 'y', hint: 'x=single-part, y=serial, v=multipart' },
    { start: 7, length: 1, label: '07 Level', placeholder: 'u', hint: 'u=unknown holdings level' },
    { start: 8, length: 1, label: '08 Control', placeholder: '#' },
    { start: 9, length: 1, label: '09 Encoding', placeholder: '#' },
    { start: 10, length: 1, label: '10 Indicators', placeholder: '2' },
    { start: 11, length: 1, label: '11 Subfields', placeholder: '2' },
    { start: 12, length: 5, label: '12–16 Base addr', placeholder: '00000' },
    { start: 17, length: 1, label: '17 Encoding lvl', placeholder: '3', hint: 'Holdings encoding level' },
    { start: 18, length: 1, label: '18 Item info', placeholder: '#', hint: 'Form of holdings data' },
    { start: 19, length: 1, label: '19 Undefined', placeholder: '#' },
    { start: 20, length: 1, label: '20 Dir length', placeholder: '4' },
    { start: 21, length: 1, label: '21 Dir start', placeholder: '5' },
    { start: 22, length: 1, label: '22 Dir impl', placeholder: '0' },
    { start: 23, length: 1, label: '23 Undefined', placeholder: '0' },
  ],
};

/** @type {Record<RecordType, FixedFieldSegment[]>} */
const FIELD_008_SEGMENTS = {
  bibliographic: [
    { start: 0, length: 6, label: '00–05 Entered', placeholder: 'yymmdd', hint: 'Date entered on file' },
    { start: 6, length: 1, label: '06 Date type', placeholder: 's', hint: 's=single date, m=multiple, n=unknown' },
    { start: 7, length: 4, label: '07–10 Date 1', placeholder: 'yyyy', hint: 'Publication date 1' },
    { start: 11, length: 4, label: '11–14 Date 2', placeholder: 'uuuu', hint: 'Publication date 2' },
    { start: 15, length: 3, label: '15–17 Place', placeholder: 'xxu', hint: 'MARC country code' },
    { start: 18, length: 17, label: '18–34 Material', placeholder: '|||||||||||||||||', hint: 'Book-specific codes (LoC 008/Books)' },
    { start: 35, length: 3, label: '35–37 Language', placeholder: 'eng', hint: 'MARC language code' },
    { start: 38, length: 1, label: '38 Modified', placeholder: '#', hint: '#=not modified' },
    { start: 39, length: 1, label: '39 Source', placeholder: 'd', hint: 'd=other source' },
  ],
  authority: [
    { start: 0, length: 6, label: '00–05 Entered', placeholder: 'yymmdd' },
    { start: 6, length: 1, label: '06 Geo subdiv', placeholder: '#', hint: '#=not geographic' },
    { start: 7, length: 1, label: '07 Romanization', placeholder: '#', hint: '#=no attempt to code' },
    { start: 8, length: 1, label: '08 Catalog lang', placeholder: '#', hint: 'b=English and French' },
    { start: 9, length: 1, label: '09 Kind', placeholder: 'a', hint: 'a=established heading' },
    { start: 10, length: 1, label: '10 Rules', placeholder: 'c', hint: 'c=AACR2' },
    { start: 11, length: 1, label: '11 Thesaurus', placeholder: 'a', hint: 'a=LCSH' },
    { start: 12, length: 1, label: '12 Series type', placeholder: 'n', hint: 'n=not applicable' },
    { start: 13, length: 1, label: '13 Numbered', placeholder: 'n' },
    { start: 14, length: 1, label: '14 Main entry', placeholder: 'a' },
    { start: 15, length: 1, label: '15 Subject', placeholder: 'a' },
    { start: 16, length: 1, label: '16 Series entry', placeholder: 'a' },
    { start: 17, length: 1, label: '17 Subdiv type', placeholder: 'n' },
    { start: 18, length: 10, label: '18–27 Undefined', placeholder: '##########', hint: 'Blank (#) per LoC' },
    { start: 28, length: 1, label: '28 Govt agency', placeholder: '#' },
    { start: 29, length: 1, label: '29 Reference', placeholder: 'a' },
    { start: 30, length: 1, label: '30 Undefined', placeholder: '#' },
    { start: 31, length: 1, label: '31 Update', placeholder: 'a' },
    { start: 32, length: 1, label: '32 Personal name', placeholder: 'a' },
    { start: 33, length: 1, label: '33 Establishment', placeholder: 'a' },
    { start: 34, length: 4, label: '34–37 Undefined', placeholder: '####' },
    { start: 38, length: 1, label: '38 Modified', placeholder: '#' },
    { start: 39, length: 1, label: '39 Source', placeholder: 'd' },
  ],
  holdings: [
    { start: 0, length: 6, label: '00–05 Entered', placeholder: 'yymmdd' },
    { start: 6, length: 1, label: '06 Receipt', placeholder: '4', hint: '4=currently received' },
    { start: 7, length: 1, label: '07 Acquisition', placeholder: '#', hint: 'p=purchase, g=gift, etc.' },
    { start: 8, length: 4, label: '08–11 End date', placeholder: 'uuuu', hint: 'Expected acquisition end' },
    { start: 12, length: 1, label: '12 Retention', placeholder: '8', hint: '8=permanently retained' },
    { start: 13, length: 3, label: '13–15 Undefined', placeholder: '|||', hint: 'Fill (|) when not coded' },
    { start: 16, length: 1, label: '16 Complete', placeholder: '2', hint: '2=incomplete run' },
    { start: 17, length: 9, label: '17–25 Undefined', placeholder: '|||||||||', hint: 'Fill (|) when not coded' },
    { start: 26, length: 6, label: '26–31 Report', placeholder: 'yymmdd', hint: 'Date of report' },
  ],
};

const FIELD_008_LENGTHS = {
  bibliographic: 40,
  authority: 40,
  holdings: 32,
};

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./marc-builder.js').MarcField} MarcField */

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function formatYymmdd(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * MARC 005 uses yymmddhhmmss.t (14 digits + dot + fractional second).
 * @param {Date} [date]
 * @returns {string}
 */
export function format005Timestamp(date = new Date()) {
  return `${formatYymmdd(date)}000000.0`;
}

/**
 * @param {RecordType} recordType
 * @returns {number}
 */
export function getField008Length(recordType) {
  return FIELD_008_LENGTHS[recordType ?? 'bibliographic'];
}

/**
 * Strip MARC record/field/subfield delimiters accidentally captured during import.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeMarcControlValue(value) {
  return String(value ?? '')
    .replace(/\x1d/g, '')
    .replace(/\x1e/g, '')
    .replace(/\x1f/g, '');
}

/**
 * @param {string} value
 * @param {number} length
 * @returns {string}
 */
export function padFixedField(value, length) {
  return sanitizeMarcControlValue(value).padEnd(length, ' ').slice(0, length);
}

/**
 * @param {FixedFieldDefinition} definition
 * @param {Date} [date]
 * @returns {string}
 */
export function buildDefaultFixedFieldValue(definition, date = new Date()) {
  const yymmdd = formatYymmdd(date);
  const segmentValues = definition.segments.map((segment) => {
    const placeholder = (segment.placeholder ?? '').replace(/yymmdd/g, yymmdd);
    return padFixedField(placeholder, segment.length);
  });
  return rebuildFixedFieldValue(segmentValues, definition);
}

/**
 * @param {RecordType} recordType
 * @param {Date} [date]
 * @returns {string}
 */
export function buildDefaultLeader(recordType, date = new Date()) {
  return buildDefaultFixedFieldValue(getLeaderDefinition(recordType), date);
}

/**
 * @param {RecordType} recordType
 * @param {Date} [date]
 * @returns {string}
 */
export function buildDefault008(recordType, date = new Date()) {
  return buildDefaultFixedFieldValue(getField008Definition(recordType), date);
}

/**
 * Build a 40-character bibliographic 008 from spreadsheet-derived metadata.
 * @param {Object} params
 * @param {string} [params.year]
 * @param {string} [params.placeCode] Three-character place/country code.
 * @param {string} [params.langCode]
 * @param {Date} [params.date]
 * @returns {string}
 */
export function buildBibliographic008({ year = 'uuuu', placeCode = 'xxu', langCode = 'eng', date = new Date() }) {
  const definition = getField008Definition('bibliographic');
  const values = extractSegmentValues(buildDefault008('bibliographic', date), definition);
  values[0] = formatYymmdd(date);
  values[1] = 's';
  values[2] = String(year).padEnd(4, 'u').slice(0, 4);
  values[3] = 'uuuu';
  values[4] = placeCode.padEnd(3, ' ').slice(0, 3);
  values[5] = padFixedField('', 17);
  values[6] = langCode.padEnd(3, ' ').slice(0, 3);
  values[7] = ' ';
  values[8] = 'd';
  return rebuildFixedFieldValue(values, definition);
}

/**
 * @param {FixedFieldDefinition} definition
 * @returns {void}
 */
function assertFixedFieldDefinition(definition) {
  const covered = Array.from({ length: definition.totalLength }, () => false);

  definition.segments.forEach((segment) => {
    for (let index = segment.start; index < segment.start + segment.length; index += 1) {
      if (index < 0 || index >= definition.totalLength) {
        throw new Error(`Segment "${segment.label}" exceeds field length ${definition.totalLength}.`);
      }
      if (covered[index]) {
        throw new Error(`Overlapping segment "${segment.label}" at position ${index}.`);
      }
      covered[index] = true;
    }
  });

  if (covered.some((isCovered) => !isCovered)) {
    throw new Error(`Fixed field definition "${definition.docLabel}" does not cover all ${definition.totalLength} positions.`);
  }
}

/**
 * @param {string} tag
 * @param {string} value
 * @param {RecordType} recordType
 * @returns {string}
 */
export function normalizeControlFieldValue(tag, value, recordType) {
  const sanitized = sanitizeMarcControlValue(value);

  if (tag === '008') {
    return padFixedField(sanitized, getField008Length(recordType));
  }

  return sanitized.trim();
}

/**
 * @param {string} leader
 * @returns {RecordType}
 */
export function inferRecordTypeFromLeader(leader) {
  const normalized = padFixedField(leader, 24);
  const typeCode = normalized.charAt(6);
  if (typeCode === 'z') {
    return 'authority';
  }
  if (['u', 'v', 'x', 'y'].includes(typeCode)) {
    return 'holdings';
  }
  return 'bibliographic';
}

/**
 * LoC MARC21 defines fixed-position segments for the Leader (all record types)
 * and field 008 (bib/authority/holdings). Other control fields (001, 005, etc.)
 * and data subfields are variable-length and use a plain value input.
 *
 * @param {MarcRecord} record
 * @param {MarcField|null} [field] Omit for Leader; pass a control field for 008 checks.
 * @returns {boolean}
 */
export function shouldUseSegmentedFixedField(record, field = null) {
  const recordType = record.recordType ?? 'bibliographic';

  if (field === null) {
    return true;
  }

  return field.type === 'control' && field.tag === '008' && Boolean(getField008Definition(recordType));
}

/**
 * @param {MarcRecord} record
 * @returns {MarcRecord}
 */
export function normalizeMarcRecord(record) {
  record.leader = padFixedField(record.leader, 24);
  record.recordType = inferRecordTypeFromLeader(record.leader);

  const recordType = record.recordType ?? 'bibliographic';

  record.fields = record.fields.map((field) => {
    if (field.type === 'control') {
      return {
        ...field,
        value: normalizeControlFieldValue(field.tag, field.value, recordType),
      };
    }

    const subfields = field.subfields
      .map((subfield) => {
        const code = String(subfield.code ?? '').trim();
        if (code) {
          return subfield;
        }
        if (!subfield.value.trim()) {
          return null;
        }
        return { ...subfield, code: 'a' };
      })
      .filter(Boolean);

    if (subfields.length === field.subfields.length && subfields.every((subfield, index) => subfield === field.subfields[index])) {
      return field;
    }

    return { ...field, subfields };
  });

  return record;
}

/**
 * @param {MarcRecord[]} records
 * @returns {MarcRecord[]}
 */
export function normalizeMarcRecords(records) {
  records.forEach(normalizeMarcRecord);
  return records;
}

/**
 * @param {RecordType} recordType
 * @returns {FixedFieldDefinition}
 */
export function getLeaderDefinition(recordType) {
  const type = recordType ?? 'bibliographic';
  return {
    totalLength: 24,
    segments: LEADER_SEGMENTS[type],
    docUrl: LEADER_DOC_URLS[type],
    docLabel: `LoC MARC21 ${type.charAt(0).toUpperCase()}${type.slice(1)} Leader`,
  };
}

/**
 * @param {RecordType} recordType
 * @returns {FixedFieldDefinition|null}
 */
export function getField008Definition(recordType) {
  const type = recordType ?? 'bibliographic';
  return {
    totalLength: FIELD_008_LENGTHS[type],
    segments: FIELD_008_SEGMENTS[type],
    docUrl: FIELD_008_DOC_URLS[type],
    docLabel: `LoC MARC21 ${type.charAt(0).toUpperCase()}${type.slice(1)} Field 008`,
  };
}

/**
 * @param {string} value
 * @param {FixedFieldDefinition} definition
 * @returns {string[]}
 */
export function extractSegmentValues(value, definition) {
  const padded = padFixedField(value, definition.totalLength);
  return definition.segments.map((segment) => padded.slice(segment.start, segment.start + segment.length));
}

/**
 * @param {string[]} segmentValues
 * @param {FixedFieldDefinition} definition
 * @returns {string}
 */
export function rebuildFixedFieldValue(segmentValues, definition) {
  const chars = Array.from({ length: definition.totalLength }, () => ' ');

  definition.segments.forEach((segment, index) => {
    const segmentValue = padFixedField(segmentValues[index] ?? '', segment.length);
    for (let offset = 0; offset < segment.length; offset += 1) {
      chars[segment.start + offset] = segmentValue[offset] ?? ' ';
    }
  });

  return chars.join('');
}

/**
 * @param {Object} options
 * @param {FixedFieldDefinition} options.definition
 * @param {string} options.value
 * @param {(value: string) => void} options.onChange
 * @param {string} [options.fieldLabel]
 * @param {string} [options.inputClass]
 * @param {boolean} [options.isInvalid]
 * @param {boolean} [options.isWarning]
 * @returns {HTMLElement}
 */
export function createFixedFieldEditor({
  definition,
  value,
  onChange,
  fieldLabel,
  inputClass = '',
  isInvalid = false,
  isWarning = false,
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'fixed-field-editor';

  if (fieldLabel) {
    const title = document.createElement('div');
    title.className = 'fixed-field-title';
    title.textContent = fieldLabel;
    wrapper.append(title);
  }

  const segmentValues = extractSegmentValues(value, definition);
  const inputs = [];

  const segmentsRow = document.createElement('div');
  segmentsRow.className = 'fixed-field-segments';

  const commit = () => {
    const nextValue = rebuildFixedFieldValue(inputs.map((input) => input.value), definition);
    preview.textContent = nextValue;
    onChange(nextValue);
  };

  definition.segments.forEach((segment, index) => {
    const label = document.createElement('label');
    label.className = 'fixed-field-segment';
    label.title = segment.hint ?? segment.label;

    const segmentLabel = document.createElement('span');
    segmentLabel.className = 'fixed-field-segment-label';
    segmentLabel.textContent = segment.label;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = ['fixed-field-segment-input', inputClass].filter(Boolean).join(' ');
    input.value = segmentValues[index] ?? '';
    input.maxLength = segment.length;
    input.placeholder = segment.placeholder ?? '';
    input.setAttribute('aria-label', `${segment.label} (${segment.length} characters)`);
    input.style.setProperty('--segment-chars', String(segment.length));
    input.classList.toggle('input-invalid', isInvalid);
    input.classList.toggle('input-warning', isWarning);

    input.addEventListener('input', () => {
      commit();
    });
    input.addEventListener('blur', () => {
      input.value = padFixedField(input.value, segment.length);
      commit();
    });

    inputs.push(input);
    label.append(segmentLabel, input);
    segmentsRow.append(label);
  });

  wrapper.append(segmentsRow);

  const preview = document.createElement('div');
  preview.className = 'fixed-field-preview';
  preview.setAttribute('aria-live', 'polite');
  preview.textContent = padFixedField(value, definition.totalLength);
  wrapper.append(preview);

  const docLink = document.createElement('a');
  docLink.className = 'fixed-field-doc-link';
  docLink.href = definition.docUrl;
  docLink.target = '_blank';
  docLink.rel = 'noopener noreferrer';
  docLink.textContent = definition.docLabel;
  wrapper.append(docLink);

  return wrapper;
}

/** @type {RecordType[]} */
const RECORD_TYPES = ['bibliographic', 'authority', 'holdings'];

RECORD_TYPES.forEach((recordType) => {
  assertFixedFieldDefinition(getLeaderDefinition(recordType));
  assertFixedFieldDefinition(getField008Definition(recordType));
});
