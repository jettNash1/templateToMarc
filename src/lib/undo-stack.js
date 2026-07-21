/** @typedef {import('./marc-builder.js').MarcRecord} MarcRecord */

/**
 * @typedef {Object} UndoEntry
 * @property {string} label
 * @property {Map<number, MarcRecord>} snapshots
 * @property {number} timestamp
 */

const MAX_STACK = 10;

/**
 * @returns {{ push: (label: string, snapshots: Map<number, MarcRecord>) => void, undo: () => UndoEntry|null, peek: () => UndoEntry|null, list: () => UndoEntry[], clear: () => void }}
 */
export function createUndoStack() {
  /** @type {UndoEntry[]} */
  const stack = [];

  return {
    /**
     * @param {string} label
     * @param {Map<number, MarcRecord>} snapshots
     */
    push(label, snapshots) {
      stack.push({ label, snapshots, timestamp: Date.now() });
      while (stack.length > MAX_STACK) {
        stack.shift();
      }
    },

    /** @returns {UndoEntry|null} */
    undo() {
      return stack.pop() ?? null;
    },

    /** @returns {UndoEntry|null} */
    peek() {
      return stack.length > 0 ? stack[stack.length - 1] : null;
    },

    /** @returns {UndoEntry[]} */
    list() {
      return [...stack].reverse();
    },

    clear() {
      stack.length = 0;
    },
  };
}
