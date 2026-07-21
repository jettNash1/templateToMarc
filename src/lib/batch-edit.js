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
 * @property {string} [tagFilter]
 * @property {string} [subfieldFilter]
 * @property {BatchReplaceTargets} targets
 * @property {number[]} [indices]
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
 * @param {string} find
 * @returns {boolean}
 */
function looksLikeRegex(find) {
  if (/^\/[\s\S]+\/[gimsuy]*$/.test(find)) {
    return true;
  }

  const signals = [
    /\\[dDsSwWbBnrt0-9xuU]/,
    /(?:^|[^\\])\[[^\]]+\]/,
    /(?:^|[^\\])\|/,
    /(?:\]|\)|\.|})\{[0-9,]+\}/,
    /(?:\]|\)|\.|\\[dDsSwW]|[^\\+*?])[+*?]/,
    /^\^/,
    /(?<!\\)\$$/,
  ];

  return signals.some((pattern) => pattern.test(find));
}

/**
 * @param {string} find
 * @returns {{ pattern: string, flags: string, useRegex: boolean }}
 */
function parseFindPattern(find) {
  if (!find) {
    return { pattern: find, flags: 'g', useRegex: false };
  }

  const slashWrapped = find.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
  if (slashWrapped) {
    const flags = slashWrapped[2].includes('g') ? slashWrapped[2] : `${slashWrapped[2]}g`;
    return { pattern: slashWrapped[1], flags, useRegex: true };
  }

  if (!looksLikeRegex(find)) {
    return { pattern: find, flags: 'g', useRegex: false };
  }

  try {
    new RegExp(find);
    return { pattern: find, flags: 'g', useRegex: true };
  } catch {
    return { pattern: find, flags: 'g', useRegex: false };
  }
}

/**
 * @param {string} value
 * @param {string} find
 * @param {string} replace
 * @returns {string}
 */
function replaceString(value, find, replace) {
  if (!find) {
    return value;
  }

  const { pattern, flags, useRegex } = parseFindPattern(find);

  if (useRegex) {
    try {
      return value.replace(new RegExp(pattern, flags), replace);
    } catch {
      return value.split(find).join(replace);
    }
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
 * @param {number} recordIndex
 * @param {number[]|undefined} indices
 * @returns {boolean}
 */
function isInScope(recordIndex, indices) {
  if (!indices || indices.length === 0) {
    return true;
  }
  return indices.includes(recordIndex);
}

/**
 * @param {MarcRecord} record
 * @param {BatchReplaceOptions} options
 * @returns {MarcRecord}
 */
function transformRecordFindReplace(record, options) {
  const targets = { ...DEFAULT_BATCH_TARGETS, ...options.targets };
  const tagFilter = options.tagFilter?.trim()
    ? options.tagFilter.padStart(3, '0').slice(-3)
    : undefined;
  const subfieldFilter = options.subfieldFilter?.trim() || undefined;
  const hasSubfieldFilter = Boolean(subfieldFilter);
  const hasTagFilter = Boolean(tagFilter);

  let leader = record.leader;

  if (targets.leader && !hasTagFilter && !hasSubfieldFilter) {
    leader = replaceString(leader, options.find, options.replace);
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
        tag = replaceString(tag, options.find, options.replace);
      }

      if (targets.controlValues) {
        value = replaceString(value, options.find, options.replace);
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
      ind1 = replaceString(ind1, options.find, options.replace);
      ind2 = replaceString(ind2, options.find, options.replace);
    }

    const subfields = field.subfields.map((subfield) => {
      if (subfieldFilter && subfield.code !== subfieldFilter) {
        return subfield;
      }

      let code = subfield.code;
      let value = subfield.value;

      if (targets.subfieldCodes) {
        const replaced = replaceString(code, options.find, options.replace).slice(0, 1);
        if (/^[a-z0-9]$/i.test(replaced)) {
          code = replaced.toLowerCase();
        }
      }

      if (targets.subfieldValues) {
        value = replaceString(value, options.find, options.replace);
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
}

/**
 * @param {MarcRecord[]} records
 * @param {BatchReplaceOptions} options
 * @returns {MarcRecord[]}
 */
export function batchFindReplace(records, options) {
  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, options.indices)) {
      return record;
    }
    return transformRecordFindReplace(record, options);
  });
}

/**
 * @param {MarcRecord[]} records
 * @param {number[]} indices
 * @param {string} tag
 * @param {string} subfieldCode
 * @param {string} value
 * @returns {MarcRecord[]}
 */
export function batchSetSubfieldValue(records, indices, tag, subfieldCode, value) {
  const normalizedTag = tag.padStart(3, '0').slice(-3);
  const code = subfieldCode.slice(0, 1) || 'a';

  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, indices)) {
      return record;
    }

    let matched = false;
    const fields = record.fields.map((field) => {
      if (field.type !== 'data' || field.tag !== normalizedTag) {
        return field;
      }

      matched = true;
      let replaced = false;
      const subfields = field.subfields.map((subfield) => {
        if (subfield.code !== code) {
          return subfield;
        }
        replaced = true;
        return { ...subfield, value };
      });

      if (!replaced) {
        subfields.push({ code, value });
      }

      return { ...field, subfields };
    });

    if (!matched && value.trim()) {
      fields.push({
        type: 'data',
        tag: normalizedTag,
        ind1: ' ',
        ind2: ' ',
        subfields: [{ code, value }],
        group: 'Other',
      });
    }

    return { ...record, fields };
  });
}

/**
 * @typedef {Object} BatchSetFieldOptions
 * @property {'leader'|'control-value'|'indicators'|'subfield-value'|'remove-subfield'} fieldPart
 * @property {string} [tag]
 * @property {string} [subfieldCode]
 * @property {string} value
 * @property {number[]} [indices]
 */

/**
 * @param {MarcRecord[]} records
 * @param {number[]} indices
 * @param {BatchSetFieldOptions} options
 * @returns {MarcRecord[]}
 */
/**
 * @param {MarcRecord[]} records
 * @param {number[]} indices
 * @param {string} tag
 * @param {string} subfieldCode
 * @returns {MarcRecord[]}
 */
export function batchRemoveSubfield(records, indices, tag, subfieldCode) {
  const normalizedTag = tag.padStart(3, '0').slice(-3);
  const trimmed = subfieldCode.trim();
  const removeBlankCodes = trimmed.length === 0 && subfieldCode.length > 0;
  const code = trimmed.slice(0, 1);

  if (!removeBlankCodes && !code) {
    return records;
  }

  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, indices)) {
      return record;
    }

    let changed = false;
    const fields = record.fields.map((field) => {
      if (field.type !== 'data' || field.tag !== normalizedTag) {
        return field;
      }

      const subfields = field.subfields.filter((subfield) => {
        if (removeBlankCodes) {
          return String(subfield.code ?? '').trim().length > 0;
        }
        return subfield.code !== code;
      });
      if (subfields.length === field.subfields.length) {
        return field;
      }

      changed = true;
      return { ...field, subfields };
    });

    return changed ? { ...record, fields } : record;
  });
}

export function batchSetFieldValue(records, indices, options) {
  const { fieldPart, value } = options;

  if (fieldPart === 'remove-subfield') {
    if (!options.tag || !options.subfieldCode) {
      return records;
    }
    return batchRemoveSubfield(records, indices, options.tag, options.subfieldCode);
  }

  if (fieldPart === 'subfield-value') {
    if (!options.tag || !options.subfieldCode) {
      return records;
    }
    return batchSetSubfieldValue(records, indices, options.tag, options.subfieldCode, value);
  }

  const normalizedTag = options.tag?.padStart(3, '0').slice(-3);

  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, indices)) {
      return record;
    }

    if (fieldPart === 'leader') {
      if (record.leader === value) {
        return record;
      }
      return { ...record, leader: value };
    }

    if (!normalizedTag) {
      return record;
    }

    let matched = false;
    const fields = record.fields.map((field) => {
      if (fieldPart === 'control-value') {
        if (field.type !== 'control' || field.tag !== normalizedTag) {
          return field;
        }
        matched = true;
        if (field.value === value) {
          return field;
        }
        return { ...field, value };
      }

      if (fieldPart === 'indicators') {
        if (field.type !== 'data' || field.tag !== normalizedTag) {
          return field;
        }
        matched = true;
        const normalized = value.padEnd(2, ' ').slice(0, 2);
        const ind1 = normalized[0] ?? ' ';
        const ind2 = normalized[1] ?? ' ';
        if (field.ind1 === ind1 && field.ind2 === ind2) {
          return field;
        }
        return { ...field, ind1, ind2 };
      }

      return field;
    });

    if (!matched) {
      return record;
    }

    if (fields.every((field, index) => field === record.fields[index])) {
      return record;
    }

    return { ...record, fields };
  });
}

export function batchAddSubfield(records, tag, subfieldCode, value, indices) {
  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, indices)) {
      return record;
    }

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
 * @param {number[]} [indices]
 * @returns {MarcRecord[]}
 */
export function batchDeleteTag(records, tag, indices) {
  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, indices)) {
      return record;
    }

    return {
      ...record,
      fields: record.fields.filter((field) => field.tag !== tag),
    };
  });
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
 * @param {number[]} [indices]
 * @returns {MarcRecord[]}
 */
export function batchNormalize(records, indices) {
  return records.map((record, recordIndex) => {
    if (!isInScope(recordIndex, indices)) {
      return record;
    }
    return cleanupRecord(record);
  });
}
