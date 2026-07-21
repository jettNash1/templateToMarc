/** Common Latin diacritics and MARC subfield markers for insertion. */
export const DIACRITIC_CHARS = [
  { label: 'é', char: 'é' },
  { label: 'è', char: 'è' },
  { label: 'ê', char: 'ê' },
  { label: 'ë', char: 'ë' },
  { label: 'á', char: 'á' },
  { label: 'à', char: 'à' },
  { label: 'ä', char: 'ä' },
  { label: 'ö', char: 'ö' },
  { label: 'ü', char: 'ü' },
  { label: 'ñ', char: 'ñ' },
  { label: 'ç', char: 'ç' },
  { label: 'ø', char: 'ø' },
  { label: 'ß', char: 'ß' },
  { label: 'æ', char: 'æ' },
  { label: 'œ', char: 'œ' },
  { label: '$a', char: '$a' },
  { label: '$b', char: '$b' },
  { label: '$c', char: '$c' },
  { label: '$v', char: '$v' },
  { label: '$x', char: '$x' },
  { label: '$0', char: '$0' },
  { label: '$2', char: '$2' },
];

/**
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @param {string} text
 */
export function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = before + text + after;
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * @param {HTMLElement} container
 * @param {(char: string) => void} onInsert
 */
export function renderDiacriticsPopover(container, onInsert) {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'diacritics-grid';

  DIACRITIC_CHARS.forEach(({ label, char }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost btn-sm';
    button.textContent = label;
    button.title = `Insert ${char}`;
    button.addEventListener('click', () => onInsert(char));
    grid.appendChild(button);
  });

  container.appendChild(grid);
}
