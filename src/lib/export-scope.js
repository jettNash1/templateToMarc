/** @typedef {'all'|'scope'|'visible'} ExportScopeMode */

/**
 * @param {ExportScopeMode} mode
 * @param {number[]} allIndices
 * @param {number[]} scopedIndices
 * @param {number[]} visibleIndices
 * @returns {number[]}
 */
export function resolveExportIndices(mode, allIndices, scopedIndices, visibleIndices) {
  if (mode === 'scope') {
    return scopedIndices.length > 0 ? scopedIndices : allIndices;
  }
  if (mode === 'visible') {
    return visibleIndices.length > 0 ? visibleIndices : allIndices;
  }
  return allIndices;
}

/**
 * @param {import('./marc-builder.js').MarcRecord[]} records
 * @param {number[]} indices
 * @returns {import('./marc-builder.js').MarcRecord[]}
 */
export function pickRecordsByIndices(records, indices) {
  return indices.map((index) => records[index]).filter(Boolean);
}
