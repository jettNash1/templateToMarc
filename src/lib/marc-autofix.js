import { padFixedField } from './marc-fixed-field.js';

/** @typedef {import('./marc-validate.js').ValidationIssue} ValidationIssue */
/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/**
 * @param {ValidationIssue} issue
 * @returns {boolean}
 */
export function canAutoFixIssue(issue) {
  const key = issue.issueKey ?? '';
  return key === '245-indicators'
    || key.startsWith('empty-subfield')
    || key === '008-length'
    || (issue.path === 'leader' && issue.level === 'error');
}

/**
 * @param {MarcRecord} record
 * @param {ValidationIssue} issue
 * @returns {MarcRecord|null}
 */
export function applyAutoFix(record, issue) {
  const next = structuredClone(record);
  const key = issue.issueKey ?? '';

  if (key === '245-indicators' && issue.fieldIndex != null) {
    const field = next.fields[issue.fieldIndex];
    if (field?.type === 'data' && field.tag === '245') {
      const hasAuthor = next.fields.some(
        (f) => f.type === 'data' && /^1(00|10|11|30)/.test(f.tag),
      );
      field.ind1 = hasAuthor ? '1' : '0';
      field.ind2 = '0';
      return next;
    }
  }

  if (key.startsWith('empty-subfield') && issue.fieldIndex != null && issue.subfieldIndex != null) {
    const field = next.fields[issue.fieldIndex];
    if (field?.type === 'data') {
      field.subfields.splice(issue.subfieldIndex, 1);
      if (field.subfields.length === 0) {
        field.subfields.push({ code: 'a', value: '' });
      }
      return next;
    }
  }

  if (key === '008-length' && issue.fieldIndex != null) {
    const field = next.fields[issue.fieldIndex];
    if (field?.type === 'control' && field.tag === '008') {
      const len = next.recordType === 'holdings' ? 32 : 40;
      field.value = padFixedField(field.value, len);
      return next;
    }
  }

  if (issue.path === 'leader' && issue.level === 'error') {
    next.leader = padFixedField(next.leader, 24);
    return next;
  }

  return null;
}
