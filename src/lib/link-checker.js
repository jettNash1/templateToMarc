/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/**
 * @typedef {Object} LinkCheckResult
 * @property {number} recordIndex
 * @property {number} fieldIndex
 * @property {string} url
 * @property {'ok'|'broken'|'skipped'} status
 * @property {string} [detail]
 */

/**
 * @param {MarcRecord[]} records
 * @param {number[]} [indices]
 * @returns {{ recordIndex: number, fieldIndex: number, url: string }[]}
 */
export function collect856Urls(records, indices) {
  const scope = indices ?? records.map((_, i) => i);
  /** @type {{ recordIndex: number, fieldIndex: number, url: string }[]} */
  const urls = [];

  scope.forEach((recordIndex) => {
    const record = records[recordIndex];
    if (!record) return;
    record.fields.forEach((field, fieldIndex) => {
      if (field.type !== 'data' || field.tag !== '856') return;
      field.subfields.forEach((subfield) => {
        if (subfield.code !== 'u') return;
        const url = subfield.value.trim();
        if (url.startsWith('http://') || url.startsWith('https://')) {
          urls.push({ recordIndex, fieldIndex, url });
        }
      });
    });
  });

  return urls;
}

/**
 * @param {MarcRecord[]} records
 * @param {number[]} [indices]
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<LinkCheckResult[]>}
 */
export async function check856Links(records, indices, onProgress) {
  const entries = collect856Urls(records, indices);
  /** @type {LinkCheckResult[]} */
  const results = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    try {
      const response = await fetch(entry.url, { method: 'HEAD', mode: 'no-cors' });
      results.push({
        ...entry,
        status: response.ok || response.type === 'opaque' ? 'ok' : 'broken',
        detail: response.status ? String(response.status) : undefined,
      });
    } catch (error) {
      results.push({
        ...entry,
        status: 'broken',
        detail: error instanceof Error ? error.message : 'Request failed',
      });
    }
    if (onProgress) {
      onProgress(i + 1, entries.length);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return results;
}
