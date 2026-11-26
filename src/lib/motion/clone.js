// A copy of an element for motion only (CONTRACT 28, Motion, rule 9): no duplicate ids, nothing to
// focus or read, never in the way of a click. Duplicate ids would break the focus code
// (getElementById in useBoard.js and useCardFocus.js) and screen readers.

const STRIPPED = [
  'id',
  'for',
  'name',
  'tabindex',
  'aria-describedby',
  'aria-labelledby',
  'aria-controls',
];

// The drag preview is the card at full strength: not ticking, not the dashed outline it left
// behind, not a drop target. Its dimmed look (a filter's 40%) is undone by BoardDrag.module.css.
const PREVIEW_STRIPPED = ['data-ticking', 'data-outline', 'data-drop', 'data-room'];

/**
 * @param {Element} el
 * @param {{ preview?: boolean }} [options] preview: also drop the card's passing states
 * @returns {Element} a deep copy, `inert` and `aria-hidden="true"`, without ids or references
 */
export function cloneForMotion(el, { preview = false } = {}) {
  const copy = el.cloneNode(true);
  const names = preview ? [...STRIPPED, ...PREVIEW_STRIPPED] : STRIPPED;
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of names) node.removeAttribute(name);
    if (node.style?.transform) node.style.transform = ''; // a room shift is not the card's look
  }
  copy.setAttribute('inert', '');
  copy.setAttribute('aria-hidden', 'true');
  return copy;
}
