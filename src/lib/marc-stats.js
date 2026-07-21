/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/**
 * @typedef {Object} RecordStats
 * @property {number} totalRecords
 * @property {Record<string, number>} tagCounts
 * @property {number} missing245
 * @property {number} missing100
 * @property {number} blank245Indicators
 * @property {Record<string, number>} recordTypeCounts
 */

/**
 * @param {MarcRecord[]} records
 * @returns {RecordStats}
 */
export function computeRecordStats(records) {
  /** @type {Record<string, number>} */
  const tagCounts = {};
  /** @type {Record<string, number>} */
  const recordTypeCounts = {};
  let missing245 = 0;
  let missing100 = 0;
  let blank245Indicators = 0;

  records.forEach((record) => {
    const type = record.recordType ?? 'bibliographic';
    recordTypeCounts[type] = (recordTypeCounts[type] ?? 0) + 1;

    const has245a = record.fields.some(
      (f) => f.type === 'data' && f.tag === '245' && f.subfields.some((s) => s.code === 'a' && s.value.trim()),
    );
    const has100 = record.fields.some((f) => f.type === 'data' && f.tag.startsWith('100'));
    if (!has245a && type === 'bibliographic') missing245 += 1;
    if (!has100 && type === 'bibliographic') missing100 += 1;

    record.fields.forEach((field) => {
      tagCounts[field.tag] = (tagCounts[field.tag] ?? 0) + 1;
      if (field.type === 'data' && field.tag === '245' && field.ind1 === ' ' && field.ind2 === ' ') {
        blank245Indicators += 1;
      }
    });
  });

  return {
    totalRecords: records.length,
    tagCounts,
    missing245,
    missing100,
    blank245Indicators,
    recordTypeCounts,
  };
}
