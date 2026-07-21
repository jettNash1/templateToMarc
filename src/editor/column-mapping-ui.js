import {
  buildInitialMappingRows,
  buildColumnSchemaFromMappingRows,
  reorderMappingRows,
} from '../lib/column-mapping.js';
import { cloneMarcRecord } from '../lib/marc-builder.js';

/**
 * @typedef {import('../lib/column-mapping.js').MappingRow} MappingRow
 * @typedef {import('../lib/file-import.js').ImportResult} SpreadsheetImportResult
 */

/**
 * @param {Object} deps
 * @param {(result: object, filename: string) => void} deps.loadImportResult
 * @param {(message: string, isError?: boolean) => void} deps.setStatus
 * @param {import('../lib/marc-builder.js').buildMarcRecords} deps.buildMarcRecords
 * @param {import('../lib/marc-fixed-field.js').normalizeMarcRecords} deps.normalizeMarcRecords
 * @param {(patch: object) => void} deps.patchState
 */
export function initColumnMappingUI(deps) {
  const { loadImportResult, setStatus, buildMarcRecords, normalizeMarcRecords, patchState } = deps;

  /** @type {SpreadsheetImportResult|null} */
  let pendingImport = null;
  /** @type {MappingRow[]} */
  let mappingRows = [];

  const panel = document.getElementById('column-mapping-panel');
  const tableBody = document.getElementById('column-mapping-table');
  const applyButton = document.getElementById('apply-column-mapping');

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readRowsFromTable() {
    if (!tableBody) {
      return mappingRows;
    }

    return [...mappingRows]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => {
        const input = tableBody.querySelector(
          `.column-mapping-input[data-row-id="${row.id}"]`,
        );
        return {
          ...row,
          notation: input instanceof HTMLInputElement ? input.value.trim() : row.notation,
        };
      });
  }

  function renderMappingTable() {
    if (!tableBody) {
      return;
    }

    tableBody.innerHTML = '';
    const sortedRows = [...mappingRows].sort((a, b) => a.sortOrder - b.sortOrder);

    sortedRows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;

      const orderCell = document.createElement('td');
      orderCell.className = 'column-mapping-order';
      const orderControls = document.createElement('div');
      orderControls.className = 'column-mapping-order-controls';

      const upButton = document.createElement('button');
      upButton.type = 'button';
      upButton.className = 'secondary';
      upButton.textContent = '↑';
      upButton.disabled = rowIndex === 0;
      upButton.setAttribute('aria-label', `Move ${row.headerLabel} up`);
      upButton.addEventListener('click', () => {
        mappingRows = reorderMappingRows(readRowsFromTable(), rowIndex, -1);
        renderMappingTable();
      });

      const downButton = document.createElement('button');
      downButton.type = 'button';
      downButton.className = 'secondary';
      downButton.textContent = '↓';
      downButton.disabled = rowIndex === sortedRows.length - 1;
      downButton.setAttribute('aria-label', `Move ${row.headerLabel} down`);
      downButton.addEventListener('click', () => {
        mappingRows = reorderMappingRows(readRowsFromTable(), rowIndex, 1);
        renderMappingTable();
      });

      orderControls.append(upButton, downButton);
      orderCell.append(orderControls);

      const labelCell = document.createElement('td');
      labelCell.innerHTML = row.isSkipped
        ? `<span class="column-mapping-skipped-label">${escapeHtml(row.headerLabel)}</span> <span class="meta-text">(unmapped)</span>`
        : escapeHtml(row.headerLabel);

      const notationCell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'column-mapping-input';
      input.dataset.rowId = row.id;
      input.dataset.columnIndex = String(row.sourceIndex);
      input.value = row.notation;
      input.placeholder = 'e.g. 245//$a or 650/0$a';
      input.setAttribute('aria-label', `MARC notation for ${row.headerLabel}`);
      notationCell.append(input);

      tr.append(orderCell, labelCell, notationCell);
      tableBody.append(tr);
    });
  }

  function applyMapping() {
    if (!pendingImport) {
      setStatus('No spreadsheet is waiting to import. Upload a file first.', true);
      return;
    }

    const rows = readRowsFromTable();
    const { columnSchema, errors } = buildColumnSchemaFromMappingRows(rows);

    if (errors.length > 0) {
      setStatus(errors[0], true);
      return;
    }

    if (columnSchema.length === 0) {
      setStatus('Add at least one MARC notation before importing.', true);
      return;
    }

    try {
      const parsedRows = pendingImport.parsedRows ?? pendingImport.rows ?? [];
      const records = normalizeMarcRecords(
        buildMarcRecords(parsedRows, columnSchema).map(cloneMarcRecord),
      );

      if (records.length === 0) {
        setStatus('No records could be built from the spreadsheet rows.', true);
        return;
      }

      /** @type {Record<string, string>} */
      const overrides = {};
      rows.forEach((row) => {
        if (row.notation.trim()) {
          overrides[String(row.sourceIndex)] = row.notation.trim();
        }
      });

      patchState({ columnMappingOverrides: overrides });
      loadImportResult({
        columnSchema,
        skippedColumns: pendingImport.skippedColumns ?? [],
        parsedRows,
        records,
      }, pendingImport.filename ?? 'spreadsheet import');

      pendingImport = null;
      mappingRows = [];
      panel?.classList.add('hidden');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to apply column mapping.', true);
    }
  }

  /**
   * @param {SpreadsheetImportResult & { filename?: string }} importResult
   */
  function showColumnMappingPanel(importResult) {
    pendingImport = importResult;
    mappingRows = buildInitialMappingRows(
      importResult.columnSchema ?? [],
      importResult.skippedColumns ?? [],
    );

    if (!panel || !tableBody) {
      setStatus('Column mapping panel is unavailable.', true);
      return;
    }

    renderMappingTable();
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  applyButton?.addEventListener('click', applyMapping);

  return { showColumnMappingPanel };
}
