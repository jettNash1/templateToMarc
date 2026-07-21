/** @typedef {import('./marc-validate.js').ValidationIssue} ValidationIssue */

/**
 * @param {import('./marc-builder.js').MarcRecord[]} records
 * @param {(record: import('./marc-builder.js').MarcRecord, index: number) => ValidationIssue[]|Promise<ValidationIssue[]>} validateRecord
 * @param {number} [chunkSize]
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<ValidationIssue[]>}
 */
export async function validateRecordsChunked(records, validateRecord, chunkSize = 25, onProgress) {
  /** @type {ValidationIssue[]} */
  const allIssues = [];

  for (let index = 0; index < records.length; index += chunkSize) {
    const end = Math.min(index + chunkSize, records.length);
    for (let i = index; i < end; i += 1) {
      const issues = await validateRecord(records[i], i);
      allIssues.push(...issues);
    }
    if (onProgress) {
      onProgress(end, records.length);
    }
    await new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(undefined));
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  return allIssues;
}
