import { getRecordPreview } from './marc-model.js';
import { formatRecordRanges } from './record-scope.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/**
 * @typedef {Object} ValidationIssue
 * @property {'error'|'warning'} level
 * @property {string} message
 * @property {number|null} fieldIndex
 * @property {number|null} [subfieldIndex]
 * @property {string} [tag]
 * @property {string} [path]
 * @property {string} [issueKey]
 * @property {string} [subfieldCode]
 * @property {number} [recordIndex]
 * @property {string} [recordLabel]
 */

/**
 * @typedef {Object} GroupedValidationIssue
 * @property {string} issueKey
 * @property {'error'|'warning'} level
 * @property {string} message
 * @property {string} [tag]
 * @property {string} [subfieldCode]
 * @property {number[]} recordIndices
 * @property {string} recordRangeLabel
 * @property {ValidationIssue[]} issues
 * @property {boolean} supportsBatchEdit
 */

const CONTROL_TAG_PATTERN = /^00[1-9]$/;
const DATA_TAG_MIN = '010';
const DATA_TAG_MAX = '999';
const BIB_008_LENGTH = 40;

/**
 * @param {number|null} fieldIndex
 * @param {number|null} [subfieldIndex]
 * @param {string} [suffix]
 * @returns {string}
 */
function fieldPath(fieldIndex, subfieldIndex = null, suffix = '') {
  if (fieldIndex == null) {
    return suffix || 'record';
  }
  if (subfieldIndex == null) {
    return suffix ? `field:${fieldIndex}:${suffix}` : `field:${fieldIndex}`;
  }
  return `field:${fieldIndex}:subfield:${subfieldIndex}${suffix ? `:${suffix}` : ''}`;
}

/**
 * @param {MarcRecord} record
 * @returns {ValidationIssue[]}
 */
export function validateRecord(record) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const recordType = record.recordType ?? 'bibliographic';

  if (record.leader.length !== 24) {
    issues.push({
      level: 'error',
      message: `Leader must be exactly 24 characters (currently ${record.leader.length}).`,
      fieldIndex: null,
      path: 'leader',
    });
  } else if (!/^[0-9A-Za-z ]{24}$/.test(record.leader)) {
    issues.push({
      level: 'warning',
      message: 'Leader contains unusual characters; MARC leaders are typically alphanumeric or space.',
      fieldIndex: null,
      path: 'leader',
    });
  }

  const controlTagsSeen = new Set();

  record.fields.forEach((field, fieldIndex) => {
    if (field.type === 'control') {
      if (!CONTROL_TAG_PATTERN.test(field.tag)) {
        issues.push({
          level: 'error',
          message: `Control field tag "${field.tag}" is invalid. Control tags must be 001–009.`,
          fieldIndex,
          tag: field.tag,
          path: fieldPath(fieldIndex, null, 'tag'),
        });
      }

      if (controlTagsSeen.has(field.tag)) {
        issues.push({
          level: 'error',
          message: `Duplicate control field ${field.tag}. Each control tag should appear once.`,
          fieldIndex,
          tag: field.tag,
          path: fieldPath(fieldIndex),
        });
      }
      controlTagsSeen.add(field.tag);

      if (!field.value.trim()) {
        issues.push({
          level: 'warning',
          message: `Control field ${field.tag} has an empty value.`,
          fieldIndex,
          tag: field.tag,
          path: fieldPath(fieldIndex, null, 'value'),
        });
      }

      if (field.tag === '001' && !field.value.trim()) {
        issues.push({
          level: 'error',
          message: 'Control field 001 (record identifier) must not be empty.',
          fieldIndex,
          tag: '001',
          path: fieldPath(fieldIndex, null, 'value'),
        });
      }

      if (field.tag === '008' && recordType === 'bibliographic' && field.value.length !== BIB_008_LENGTH) {
        issues.push({
          level: 'warning',
          message: `Control field 008 is usually ${BIB_008_LENGTH} characters for bibliographic records (currently ${field.value.length}).`,
          fieldIndex,
          tag: '008',
          path: fieldPath(fieldIndex, null, 'value'),
        });
      }

      return;
    }

    if (!/^\d{3}$/.test(field.tag)) {
      issues.push({
        level: 'error',
        message: `Data field tag "${field.tag}" must be a 3-digit number.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex, null, 'tag'),
      });
    } else if (field.tag < DATA_TAG_MIN || field.tag > DATA_TAG_MAX) {
      issues.push({
        level: 'error',
        message: `Data field tag "${field.tag}" is out of range. Data fields use tags 010–999.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex, null, 'tag'),
      });
    }

    if (field.ind1.length !== 1) {
      issues.push({
        level: 'error',
        message: `Field ${field.tag} indicator 1 must be exactly one character.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex, null, 'ind1'),
      });
    }

    if (field.ind2.length !== 1) {
      issues.push({
        level: 'error',
        message: `Field ${field.tag} indicator 2 must be exactly one character.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex, null, 'ind2'),
      });
    }

    if (!/^[0-9A-Za-z #]$/.test(field.ind1)) {
      issues.push({
        level: 'warning',
        message: `Field ${field.tag} indicator 1 "${field.ind1}" is unusual for MARC21.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex, null, 'ind1'),
      });
    }

    if (!/^[0-9A-Za-z #]$/.test(field.ind2)) {
      issues.push({
        level: 'warning',
        message: `Field ${field.tag} indicator 2 "${field.ind2}" is unusual for MARC21.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex, null, 'ind2'),
      });
    }

    if (field.subfields.length === 0) {
      issues.push({
        level: 'error',
        message: `Field ${field.tag} has no subfields. Data fields require at least one subfield.`,
        fieldIndex,
        tag: field.tag,
        path: fieldPath(fieldIndex),
      });
    }

    field.subfields.forEach((subfield, subfieldIndex) => {
      if (!/^[a-z0-9]$/i.test(subfield.code)) {
        issues.push({
          level: 'error',
          message: `Invalid subfield code "${subfield.code}" in field ${field.tag}. Codes must be a single letter or digit.`,
          fieldIndex,
          subfieldIndex,
          tag: field.tag,
          path: fieldPath(fieldIndex, subfieldIndex, 'code'),
        });
      }

      if (!subfield.value.trim()) {
        issues.push({
          level: 'warning',
          message: `Empty subfield $${subfield.code} in field ${field.tag}.`,
          fieldIndex,
          subfieldIndex,
          tag: field.tag,
          path: fieldPath(fieldIndex, subfieldIndex, 'value'),
        });
      }
    });

    if (field.tag === '245' && field.ind1 === ' ' && field.ind2 === ' ') {
      issues.push({
        level: 'warning',
        message: 'Field 245 (title) often uses indicators 00 or 10.',
        fieldIndex,
        tag: '245',
        path: fieldPath(fieldIndex),
      });
    }
  });

  const requiredControl = ['001', '008'];
  for (const tag of requiredControl) {
    if (!record.fields.some((field) => field.type === 'control' && field.tag === tag)) {
      issues.push({
        level: recordType === 'bibliographic' ? 'error' : 'warning',
        message: `Missing required control field ${tag}.`,
        fieldIndex: null,
        tag,
        path: `missing:${tag}`,
      });
    }
  }

  if (recordType === 'bibliographic') {
    const has245 = record.fields.some(
      (field) =>
        field.type === 'data' &&
        field.tag === '245' &&
        field.subfields.some((subfield) => subfield.code === 'a' && subfield.value.trim()),
    );

    if (!has245) {
      issues.push({
        level: 'warning',
        message: 'Bibliographic record has no 245 $a (title) field.',
        fieldIndex: null,
        tag: '245',
        path: 'missing:245$a',
      });
    }
  }

  if (recordType === 'authority') {
    const hasHeading = record.fields.some(
      (field) =>
        field.type === 'data' &&
        ['100', '110', '111', '130', '150', '151'].includes(field.tag) &&
        field.subfields.some((subfield) => subfield.code === 'a' && subfield.value.trim()),
    );

    if (!hasHeading) {
      issues.push({
        level: 'warning',
        message: 'Authority record has no heading field (100/110/111/130/150/151 $a).',
        fieldIndex: null,
        path: 'missing:heading',
      });
    }
  }

  if (recordType === 'holdings') {
    const has852 = record.fields.some(
      (field) =>
        field.type === 'data' &&
        field.tag === '852' &&
        field.subfields.some((subfield) => subfield.value.trim()),
    );

    if (!has852) {
      issues.push({
        level: 'warning',
        message: 'Holdings record has no 852 location/holdings field.',
        fieldIndex: null,
        tag: '852',
        path: 'missing:852',
      });
    }
  }

  return issues.map((issue) => enrichIssue(issue));
}

/**
 * @param {Omit<ValidationIssue, 'issueKey'|'subfieldCode'>} issue
 * @returns {ValidationIssue}
 */
function enrichIssue(issue) {
  /** @type {ValidationIssue} */
  const enriched = { ...issue };

  if (issue.path === 'leader') {
    enriched.issueKey = issue.message.includes('24 characters') ? 'leader:length' : 'leader:chars';
  } else if (issue.path?.startsWith('missing:')) {
    enriched.issueKey = issue.path;
  } else if (issue.message.startsWith('Duplicate control')) {
    enriched.issueKey = `duplicate-control:${issue.tag}`;
  } else if (issue.message.includes('Empty subfield')) {
    const codeMatch = issue.message.match(/\$([a-z0-9])/i);
    enriched.subfieldCode = codeMatch?.[1] ?? undefined;
    enriched.issueKey = `empty-subfield:${issue.tag}:${enriched.subfieldCode ?? 'x'}`;
  } else if (issue.message.includes('Invalid subfield code')) {
    enriched.issueKey = `invalid-subfield-code:${issue.tag}`;
  } else if (issue.message.includes('indicator 1')) {
    enriched.issueKey = `indicator1:${issue.tag}`;
  } else if (issue.message.includes('indicator 2')) {
    enriched.issueKey = `indicator2:${issue.tag}`;
  } else if (issue.message.includes('no subfields')) {
    enriched.issueKey = `no-subfields:${issue.tag}`;
  } else if (issue.message.includes('Control field tag')) {
    enriched.issueKey = `invalid-control-tag:${issue.tag}`;
  } else if (issue.message.includes('Control field') && issue.message.includes('empty value')) {
    enriched.issueKey = `empty-control:${issue.tag}`;
  } else if (issue.message.includes('Control field 001')) {
    enriched.issueKey = 'empty-001';
  } else if (issue.message.includes('Control field 008')) {
    enriched.issueKey = '008-length';
  } else if (issue.message.includes('Data field tag') && issue.message.includes('out of range')) {
    enriched.issueKey = `invalid-data-tag-range:${issue.tag}`;
  } else if (issue.message.includes('Data field tag')) {
    enriched.issueKey = `invalid-data-tag:${issue.tag}`;
  } else if (issue.message.includes('245 (title)')) {
    enriched.issueKey = '245-indicators';
  } else if (issue.message.includes('no 245 $a')) {
    enriched.issueKey = 'missing:245:a';
  } else if (issue.message.includes('no heading field')) {
    enriched.issueKey = 'missing:heading';
  } else if (issue.message.includes('no 852')) {
    enriched.issueKey = 'missing:852';
  } else if (issue.message.includes('Missing required control')) {
    enriched.issueKey = `missing:${issue.tag}`;
  } else {
    enriched.issueKey = `${issue.level}:${issue.path ?? issue.message}`;
  }

  return enriched;
}

/**
 * @param {string} issueKey
 * @returns {boolean}
 */
function supportsBatchEditForKey(issueKey) {
  const notActionable = ['missing:heading', 'missing:852'];
  return !notActionable.includes(issueKey);
}

/**
 * @param {MarcRecord[]} records
 * @returns {ValidationIssue[]}
 */
export function validateAllRecords(records) {
  return records.flatMap((record, recordIndex) => {
    const preview = getRecordPreview(record);
    const recordLabel = preview.title;

    return validateRecord(record).map((issue) => ({
      ...issue,
      recordIndex,
      recordLabel,
    }));
  });
}

/**
 * @param {ValidationIssue[]} issues
 * @returns {{ groups: GroupedValidationIssue[], individuals: ValidationIssue[] }}
 */
export function groupValidationIssues(issues) {
  /** @type {Map<string, ValidationIssue[]>} */
  const buckets = new Map();

  issues.forEach((issue) => {
    const key = `${issue.level}|${issue.issueKey ?? issue.message}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(issue);
  });

  /** @type {GroupedValidationIssue[]} */
  const groups = [];
  /** @type {ValidationIssue[]} */
  const individuals = [];

  buckets.forEach((bucketIssues) => {
    if (bucketIssues.length < 2) {
      individuals.push(...bucketIssues);
      return;
    }

    const sample = bucketIssues[0];
    const recordIndices = bucketIssues
      .map((issue) => issue.recordIndex)
      .filter((index) => index != null);

    groups.push({
      issueKey: sample.issueKey ?? sample.message,
      level: sample.level,
      message: sample.message,
      tag: sample.tag,
      subfieldCode: sample.subfieldCode,
      recordIndices,
      recordRangeLabel: `Records ${formatRecordRanges(recordIndices)}`,
      issues: bucketIssues,
      supportsBatchEdit: supportsBatchEditForKey(sample.issueKey ?? ''),
    });
  });

  groups.sort((a, b) => a.recordIndices[0] - b.recordIndices[0]);
  individuals.sort((a, b) => (a.recordIndex ?? 0) - (b.recordIndex ?? 0));

  return { groups, individuals };
}

/**
 * @param {ValidationIssue[]} issues
 * @returns {{ errors: number, warnings: number, recordsWithErrors: number }}
 */
export function summarizeValidation(issues) {
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;
  const recordsWithErrors = new Set(
    issues.filter((issue) => issue.level === 'error').map((issue) => issue.recordIndex),
  ).size;

  return { errors, warnings, recordsWithErrors };
}

/**
 * @param {ValidationIssue[]} issues
 * @param {number} recordIndex
 * @returns {ValidationIssue[]}
 */
export function getRecordIssues(issues, recordIndex) {
  return issues.filter((issue) => issue.recordIndex === recordIndex);
}

/**
 * @param {ValidationIssue[]} issues
 * @param {number} fieldIndex
 * @param {'error'|'warning'|null} [level]
 * @returns {ValidationIssue[]}
 */
export function getFieldIssues(issues, fieldIndex, level = null) {
  return issues.filter(
    (issue) =>
      issue.fieldIndex === fieldIndex &&
      (level == null || issue.level === level),
  );
}

/**
 * @param {ValidationIssue[]} issues
 * @returns {boolean}
 */
export function hasValidationErrors(issues) {
  return issues.some((issue) => issue.level === 'error');
}

/** @deprecated Use validateAllRecords */
export function validateRecords(records) {
  return validateAllRecords(records).map((issue) => ({
    ...issue,
    message: `Record ${(issue.recordIndex ?? 0) + 1}: ${issue.message}`,
  }));
}
