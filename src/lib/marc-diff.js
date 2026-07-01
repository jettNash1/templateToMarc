import { getRecordPreview } from './marc-model.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */
/** @typedef {import('./marc-builder.js').MarcField} MarcField */

/**
 * @typedef {Object} MarcChange
 * @property {string} kind
 * @property {string} label
 * @property {string} before
 * @property {string} after
 */

/**
 * @typedef {Object} RecordChangeSummary
 * @property {number} recordIndex
 * @property {string} title
 * @property {MarcChange[]} changes
 */

/**
 * @param {MarcRecord} record
 * @param {import('./file-import.js').ParsedRow} [parsedRow]
 * @returns {string}
 */
export function getRecordLabel(record, parsedRow) {
  if (parsedRow?.previewTitle && parsedRow.previewTitle !== '(No title)') {
    return parsedRow.previewTitle;
  }
  return getRecordPreview(record).title;
}

/**
 * @param {string} value
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncateValue(value, maxLength = 80) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

/**
 * @param {string} label
 * @param {string} before
 * @param {string} after
 * @returns {MarcChange|null}
 */
function pushChange(label, before, after, kind = 'field') {
  if (before === after) {
    return null;
  }
  return {
    kind,
    label,
    before: truncateValue(before),
    after: truncateValue(after),
  };
}

/**
 * @param {MarcField} field
 * @returns {string}
 */
function fieldSummary(field) {
  if (field.type === 'control') {
    return field.tag;
  }
  return field.tag;
}

/**
 * @param {MarcRecord} before
 * @param {MarcRecord} after
 * @returns {MarcChange[]}
 */
export function diffMarcRecord(before, after) {
  /** @type {MarcChange[]} */
  const changes = [];

  const leaderChange = pushChange('LDR', before.leader, after.leader, 'leader');
  if (leaderChange) {
    changes.push(leaderChange);
  }

  const maxFields = Math.max(before.fields.length, after.fields.length);

  for (let index = 0; index < maxFields; index += 1) {
    const beforeField = before.fields[index];
    const afterField = after.fields[index];

    if (!beforeField && afterField) {
      changes.push({
        kind: 'added',
        label: `+${fieldSummary(afterField)}`,
        before: '',
        after: summarizeField(afterField),
      });
      continue;
    }

    if (beforeField && !afterField) {
      changes.push({
        kind: 'removed',
        label: `-${fieldSummary(beforeField)}`,
        before: summarizeField(beforeField),
        after: '',
      });
      continue;
    }

    if (!beforeField || !afterField) {
      continue;
    }

    diffField(beforeField, afterField, changes);
  }

  return changes;
}

/**
 * @param {MarcField} field
 * @returns {string}
 */
function summarizeField(field) {
  if (field.type === 'control') {
    return `${field.tag}: ${truncateValue(field.value, 60)}`;
  }
  const subfields = field.subfields.map((subfield) => `$${subfield.code}${subfield.value}`).join('');
  return `${field.tag} ${field.ind1}${field.ind2}${truncateValue(subfields, 60)}`;
}

/**
 * @param {MarcField} before
 * @param {MarcField} after
 * @param {MarcChange[]} changes
 */
function diffField(before, after, changes) {
  if (before.type === 'control' && after.type === 'control') {
    const tagChange = pushChange(`${before.tag} tag`, before.tag, after.tag);
    if (tagChange) {
      changes.push(tagChange);
    }
    const valueChange = pushChange(before.tag, before.value, after.value);
    if (valueChange) {
      changes.push(valueChange);
    }
    return;
  }

  if (before.type !== 'data' || after.type !== 'data') {
    const beforeText = summarizeField(before);
    const afterText = summarizeField(after);
    const change = pushChange(fieldSummary(before), beforeText, afterText);
    if (change) {
      changes.push(change);
    }
    return;
  }

  const tagChange = pushChange(`${before.tag} tag`, before.tag, after.tag);
  if (tagChange) {
    changes.push(tagChange);
  }

  const ind1Change = pushChange(`${before.tag} ind1`, before.ind1, after.ind1);
  if (ind1Change) {
    changes.push(ind1Change);
  }

  const ind2Change = pushChange(`${before.tag} ind2`, before.ind2, after.ind2);
  if (ind2Change) {
    changes.push(ind2Change);
  }

  const maxSubfields = Math.max(before.subfields.length, after.subfields.length);
  for (let index = 0; index < maxSubfields; index += 1) {
    const beforeSubfield = before.subfields[index];
    const afterSubfield = after.subfields[index];

    if (!beforeSubfield && afterSubfield) {
      changes.push({
        kind: 'added',
        label: `${before.tag} $${afterSubfield.code}`,
        before: '',
        after: truncateValue(afterSubfield.value),
      });
      continue;
    }

    if (beforeSubfield && !afterSubfield) {
      changes.push({
        kind: 'removed',
        label: `${before.tag} $${beforeSubfield.code}`,
        before: truncateValue(beforeSubfield.value),
        after: '',
      });
      continue;
    }

    if (!beforeSubfield || !afterSubfield) {
      continue;
    }

    const codeChange = pushChange(
      `${before.tag} subfield code`,
      beforeSubfield.code,
      afterSubfield.code,
    );
    if (codeChange) {
      changes.push(codeChange);
    }

    const valueLabel = `${before.tag} $${beforeSubfield.code}`;
    const valueChange = pushChange(valueLabel, beforeSubfield.value, afterSubfield.value);
    if (valueChange) {
      changes.push(valueChange);
    }
  }
}

/**
 * @param {MarcRecord[]} beforeRecords
 * @param {MarcRecord[]} afterRecords
 * @param {import('./file-import.js').ParsedRow[]} [parsedRows]
 * @returns {RecordChangeSummary[]}
 */
export function diffMarcRecords(beforeRecords, afterRecords, parsedRows = []) {
  /** @type {RecordChangeSummary[]} */
  const summaries = [];

  for (let index = 0; index < beforeRecords.length; index += 1) {
    const before = beforeRecords[index];
    const after = afterRecords[index];
    if (!before || !after) {
      continue;
    }

    const changes = diffMarcRecord(before, after);
    if (changes.length === 0) {
      continue;
    }

    summaries.push({
      recordIndex: index,
      title: getRecordLabel(before, parsedRows[index]),
      changes,
    });
  }

  return summaries;
}

/**
 * @param {RecordChangeSummary[]} summaries
 * @returns {{ recordsChanged: number, totalEdits: number }}
 */
export function summarizeChangeLog(summaries) {
  const totalEdits = summaries.reduce((sum, summary) => sum + summary.changes.length, 0);
  return {
    recordsChanged: summaries.length,
    totalEdits,
  };
}
