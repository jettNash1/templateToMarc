/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./marc-builder.js').MarcField} MarcField */

/**
 * @typedef {Object} ValidationIssue
 * @property {'error'|'warning'} level
 * @property {string} message
 * @property {number|null} fieldIndex
 * @property {string} [tag]
 */

/**
 * @param {MarcRecord} record
 * @returns {ValidationIssue[]}
 */
export function validateRecord(record) {
  /** @type {ValidationIssue[]} */
  const issues = [];

  if (record.leader.length !== 24) {
    issues.push({
      level: 'error',
      message: `Leader must be 24 characters (currently ${record.leader.length}).`,
      fieldIndex: null,
    });
  }

  const has245 = record.fields.some(
    (field) =>
      field.type === 'data' &&
      field.tag === '245' &&
      field.subfields.some((subfield) => subfield.code === 'a' && subfield.value.trim()),
  );

  if (!has245 && record.recordType !== 'authority') {
    issues.push({
      level: 'warning',
      message: 'Bibliographic record has no 245 $a title field.',
      fieldIndex: null,
      tag: '245',
    });
  }

  record.fields.forEach((field, fieldIndex) => {
    if (field.type === 'control') {
      if (!/^\d{3}$/.test(field.tag)) {
        issues.push({
          level: 'error',
          message: `Invalid control tag "${field.tag}".`,
          fieldIndex,
          tag: field.tag,
        });
      }
      return;
    }

    if (!/^\d{3}$/.test(field.tag) || field.tag < '010') {
      issues.push({
        level: 'error',
        message: `Invalid data field tag "${field.tag}".`,
        fieldIndex,
        tag: field.tag,
      });
    }

    if (field.ind1.length !== 1 || field.ind2.length !== 1) {
      issues.push({
        level: 'error',
        message: `Field ${field.tag} must have single-character indicators.`,
        fieldIndex,
        tag: field.tag,
      });
    }

    if (field.subfields.length === 0) {
      issues.push({
        level: 'error',
        message: `Field ${field.tag} has no subfields.`,
        fieldIndex,
        tag: field.tag,
      });
    }

    field.subfields.forEach((subfield) => {
      if (!/^[a-z0-9]$/i.test(subfield.code)) {
        issues.push({
          level: 'error',
          message: `Invalid subfield code "${subfield.code}" in tag ${field.tag}.`,
          fieldIndex,
          tag: field.tag,
        });
      }

      if (!subfield.value.trim()) {
        issues.push({
          level: 'warning',
          message: `Empty subfield $${subfield.code} in tag ${field.tag}.`,
          fieldIndex,
          tag: field.tag,
        });
      }
    });

    if (field.tag === '245' && field.ind1 === ' ' && field.ind2 === ' ') {
      issues.push({
        level: 'warning',
        message: '245 title field often uses indicators 00 or 10.',
        fieldIndex,
        tag: '245',
      });
    }
  });

  const requiredControl = ['001', '008'];
  for (const tag of requiredControl) {
    if (!record.fields.some((field) => field.type === 'control' && field.tag === tag)) {
      issues.push({
        level: 'warning',
        message: `Missing control field ${tag}.`,
        fieldIndex: null,
        tag,
      });
    }
  }

  return issues;
}

/**
 * @param {MarcRecord[]} records
 * @returns {ValidationIssue[]}
 */
export function validateRecords(records) {
  return records.flatMap((record, index) =>
    validateRecord(record).map((issue) => ({
      ...issue,
      message: `Record ${index + 1}: ${issue.message}`,
    })),
  );
}

/**
 * @param {ValidationIssue[]} issues
 * @returns {boolean}
 */
export function hasValidationErrors(issues) {
  return issues.some((issue) => issue.level === 'error');
}
