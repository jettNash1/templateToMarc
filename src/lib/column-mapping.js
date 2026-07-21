import { parseMarcNotation } from './template-mapping.js';
import { inferFieldGroup } from './header-parser.js';

/** @typedef {import('./header-parser.js').ColumnSchema} ColumnSchema */

/**
 * @typedef {Object} MappingRow
 * @property {string} id
 * @property {number} sourceIndex
 * @property {string} headerLabel
 * @property {string} notation
 * @property {boolean} isSkipped
 * @property {number} sortOrder
 */

/**
 * @param {ColumnSchema} column
 * @returns {string}
 */
export function formatColumnNotation(column) {
  const tag = column.tag;
  const ind1 = column.ind1 ?? ' ';
  const ind2 = column.ind2 ?? ' ';
  const subfield = column.subfield ?? 'a';

  if (ind1 !== ' ' || ind2 !== ' ') {
    return `${tag}/${ind1}${ind2}$${subfield}`;
  }

  return `${tag}//$${subfield}`;
}

/**
 * @param {string} notation
 * @param {number} index
 * @param {string} label
 * @returns {ColumnSchema|null}
 */
export function notationToColumnSchema(notation, index, label) {
  try {
    const parsed = parseMarcNotation(notation);
    if (!parsed) {
      return null;
    }

    return {
      index,
      label: label || notation,
      tag: parsed.tag,
      ind1: parsed.ind1,
      ind2: parsed.ind2,
      subfield: parsed.subfield,
      punctuation: 'none',
      group: inferFieldGroup(parsed.tag),
    };
  } catch {
    return null;
  }
}

/**
 * @param {ColumnSchema[]} columnSchema
 * @param {{ index: number, header: string, label: string }[]} skippedColumns
 * @returns {MappingRow[]}
 */
export function buildInitialMappingRows(columnSchema, skippedColumns) {
  /** @type {MappingRow[]} */
  const rows = [];

  columnSchema.forEach((column, order) => {
    rows.push({
      id: `mapped-${column.index}`,
      sourceIndex: column.index,
      headerLabel: column.label,
      notation: formatColumnNotation(column),
      isSkipped: false,
      sortOrder: order,
    });
  });

  skippedColumns.forEach((column, offset) => {
    rows.push({
      id: `skipped-${column.index}`,
      sourceIndex: column.index,
      headerLabel: column.label || column.header,
      notation: '',
      isSkipped: true,
      sortOrder: columnSchema.length + offset,
    });
  });

  return rows;
}

/**
 * @param {MappingRow[]} mappingRows
 * @returns {{ columnSchema: ColumnSchema[], errors: string[] }}
 */
export function buildColumnSchemaFromMappingRows(mappingRows) {
  /** @type {ColumnSchema[]} */
  const columnSchema = [];
  /** @type {string[]} */
  const errors = [];

  [...mappingRows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((row) => {
      const notation = row.notation.trim();
      if (!notation) {
        if (row.isSkipped) {
          return;
        }
        errors.push(`Column "${row.headerLabel}" has no MARC notation.`);
        return;
      }

      const mapped = notationToColumnSchema(notation, row.sourceIndex, row.headerLabel);
      if (!mapped) {
        errors.push(`Column "${row.headerLabel}": invalid notation "${notation}".`);
        return;
      }

      columnSchema.push(mapped);
    });

  return { columnSchema, errors };
}

/**
 * @param {MappingRow[]} rows
 * @param {number} rowIndex
 * @param {-1|1} direction
 * @returns {MappingRow[]}
 */
export function reorderMappingRows(rows, rowIndex, direction) {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const targetIndex = rowIndex + direction;
  if (targetIndex < 0 || targetIndex >= sorted.length) {
    return rows;
  }

  const [moved] = sorted.splice(rowIndex, 1);
  sorted.splice(targetIndex, 0, moved);
  return sorted.map((row, index) => ({ ...row, sortOrder: index }));
}

/**
 * @param {ColumnSchema[]} columnSchema
 * @param {Record<string, string>} overrides keyed by column index string
 * @returns {ColumnSchema[]}
 */
export function mergeColumnMappingOverrides(columnSchema, overrides) {
  const existingIndices = new Set(columnSchema.map((column) => column.index));
  const merged = [...columnSchema];

  Object.entries(overrides).forEach(([indexKey, notation]) => {
    const index = Number(indexKey);
    const trimmed = notation.trim();
    if (!trimmed) {
      return;
    }

    const mapped = notationToColumnSchema(trimmed, index, trimmed);
    if (!mapped) {
      return;
    }

    const existingPosition = merged.findIndex((column) => column.index === index);
    if (existingPosition >= 0) {
      merged[existingPosition] = mapped;
      return;
    }

    if (!existingIndices.has(index)) {
      merged.push(mapped);
      existingIndices.add(index);
    }
  });

  return merged.sort((a, b) => a.index - b.index);
}

/**
 * @param {{ index: number, header: string, label: string }[]} skippedColumns
 * @returns {{ index: number, label: string }[]}
 */
export function buildMappableColumns(skippedColumns) {
  return skippedColumns.map((column) => ({
    index: column.index,
    label: column.label || column.header,
  }));
}
