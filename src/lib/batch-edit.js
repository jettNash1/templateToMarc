import { cleanupRecord } from './marc-cleanup.js';

/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/**
 * @typedef {Object} BatchReplaceTargets
 * @property {boolean} leader
 * @property {boolean} controlValues
 * @property {boolean} controlTags
 * @property {boolean} indicators
 * @property {boolean} subfieldCodes
 * @property {boolean} subfieldValues
 */

/**
 * @typedef {Object} BatchReplaceOptions
 * @property {string} find
 * @property {string} replace
 * @property {boolean} useRegex
 * @property {string} [tagFilter]
 * @property {string} [subfieldFilter]
 * @property {BatchReplaceTargets} targets
 */

/** @type {BatchReplaceTargets} */
export const DEFAULT_BATCH_TARGETS = {
  leader: true,
  controlValues: true,
  controlTags: true,
  indicators: true,
  subfieldCodes: true,
  subfieldValues: true,
};

/**
 * @param {string} value
 * @param {string} find
 * @param {string} replace
 * @param {boolean} useRegex
 * @returns {string}
 */
function replaceString(value, find, replace, useRegex) {
  if (!find) {
    return value;
  }

  if (useRegex) {
    return value.replace(new RegExp(find, 'g'), replace);
  }

  return value.split(find).join(replace);
}

/**
 * @param {string} tag
 * @param {string|undefined} tagFilter
 * @returns {boolean}
 */
function tagMatches(tag, tagFilter) {
  if (!tagFilter) {
    return true;
  }
  return tag === tagFilter.padStart(3, '0').slice(-3);
}

/**
 * @param {MarcRecord[]} records
 * @param {BatchReplaceOptions} options
 * @returns {MarcRecord[]}
 */
export function batchFindReplace(records, options) {
  const targets = { ...DEFAULT_BATCH_TARGETS, ...options.targets };
  const tagFilter = options.tagFilter?.trim()
    ? options.tagFilter.padStart(3, '0').slice(-3)
    : undefined;
  const subfieldFilter = options.subfieldFilter?.trim() || undefined;
  const hasSubfieldFilter = Boolean(subfieldFilter);
  const hasTagFilter = Boolean(tagFilter);

  return records.map((record) => {
    let leader = record.leader;

    if (targets.leader && !hasTagFilter && !hasSubfieldFilter) {
      leader = replaceString(leader, options.find, options.replace, options.useRegex);
    }

    const fields = record.fields.map((field) => {
      if (field.type === 'control') {
        if (!tagMatches(field.tag, tagFilter)) {
          return field;
        }

        if (hasSubfieldFilter) {
          return field;
        }

        let tag = field.tag;
        let value = field.value;

        if (targets.controlTags) {
          tag = replaceString(tag, options.find, options.replace, options.useRegex);
        }

        if (targets.controlValues) {
          value = replaceString(value, options.find, options.replace, options.useRegex);
        }

        if (tag === field.tag && value === field.value) {
          return field;
        }

        return { ...field, tag, value };
      }

      if (!tagMatches(field.tag, tagFilter)) {
        return field;
      }

      let ind1 = field.ind1;
      let ind2 = field.ind2;

      if (targets.indicators && !hasSubfieldFilter) {
        ind1 = replaceString(ind1, options.find, options.replace, options.useRegex);
        ind2 = replaceString(ind2, options.find, options.replace, options.useRegex);
      }

      const subfields = field.subfields.map((subfield) => {
        if (subfieldFilter && subfield.code !== subfieldFilter) {
          return subfield;
        }

        let code = subfield.code;
        let value = subfield.value;

        if (targets.subfieldCodes) {
          code = replaceString(code, options.find, options.replace, options.useRegex).slice(0, 1) || ' ';
        }

        if (targets.subfieldValues) {
          value = replaceString(value, options.find, options.replace, options.useRegex);
        }

        if (code === subfield.code && value === subfield.value) {
          return subfield;
        }

        return { ...subfield, code, value };
      });

      if (ind1 === field.ind1 && ind2 === field.ind2 && subfields.every((subfield, index) => subfield === field.subfields[index])) {
        return field;
      }

      return { ...field, ind1, ind2, subfields };
    });

    if (leader === record.leader && fields.every((field, index) => field === record.fields[index])) {
      return record;
    }

    return { ...record, leader, fields };
  });
}

/**
 * @param {MarcRecord[]} records
 * @param {string} tag
 * @param {string} subfieldCode
 * @param {string} value
 * @returns {MarcRecord[]}
 */
export function batchAddSubfield(records, tag, subfieldCode, value) {
  return records.map((record) => {
    const fields = record.fields.map((field) => {
      if (field.type !== 'data' || field.tag !== tag) {
        return field;
      }

      const exists = field.subfields.some((subfield) => subfield.code === subfieldCode);
      if (exists) {
        return field;
      }

      return {
        ...field,
        subfields: [...field.subfields, { code: subfieldCode, value }],
      };
    });

    return { ...record, fields };
  });
}

/**
 * @param {MarcRecord[]} records
 * @param {string} tag
 * @returns {MarcRecord[]}
 */
export function batchDeleteTag(records, tag) {
  return records.map((record) => ({
    ...record,
    fields: record.fields.filter((field) => field.tag !== tag),
  }));
}

/**
 * @param {MarcRecord[]} records
 * @param {(record: MarcRecord, index: number) => MarcRecord} mapper
 * @param {number} [chunkSize]
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<MarcRecord[]>}
 */
export async function batchProcessRecords(records, mapper, chunkSize = 100, onProgress) {
  /** @type {MarcRecord[]} */
  const output = [];

  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    output.push(...chunk.map((record, chunkIndex) => mapper(record, index + chunkIndex)));

    if (onProgress) {
      onProgress(Math.min(index + chunkSize, records.length), records.length);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return output;
}

/**
 * @param {MarcRecord[]} records
 * @returns {MarcRecord[]}
 */
export function batchNormalize(records) {
  return records.map((record) => cleanupRecord(record));
}
