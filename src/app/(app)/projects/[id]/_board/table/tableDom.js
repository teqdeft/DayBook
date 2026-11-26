// Where the Table's motion and focus find things on the page (CONTRACT 28, Table and bulk bar; Look
// and accessibility). The table and the phone's stacked list are both drawn (CSS shows one), so a
// row is looked for where it is shown. Focus after a bulk action, its Undo or Clear goes to
// "Select all shown tasks" (on a phone, the first changed row's select box, else the first row's);
// a row that leaves after a tick hands focus to the next row's title, else the previous one's, else
// the table. `--toast-offset` keeps toasts above the bulk bar. DOM only, no React.
import { toastOffset } from './bulkView';

/** The id of the header's "Select all shown tasks" box. */
export const SELECT_ALL_ID = 'board-table-select-all';
/** The rows and group rows that slide (the table's, or the phone list's). */
export const ROWS = '[data-flip^="row:"], [data-flip^="group:"]';

/** Drawn now (not `display: none` under a hidden table or list). */
export const isShown = (el) => Boolean(el?.isConnected) && el.getClientRects().length > 0;

/** The first element matching `selector` in `root` that is shown, or null. */
export function shownIn(root, selector) {
  for (const el of root?.querySelectorAll?.(selector) ?? []) {
    if (isShown(el)) return el;
  }
  return null;
}

/** Every shown element matching `selector` in `root`. */
export const allShownIn = (root, selector) =>
  [...(root?.querySelectorAll?.(selector) ?? [])].filter(isShown);

/** The rows' box shown now: the table's body, or the phone's stacked list. */
export const shownBody = (root) => shownIn(root, '[data-table-body], [data-stack]');

/** A row's selector by task id. */
export const rowOf = (taskId) => `[data-flip="row:${Number(taskId)}"]`;

/**
 * Where focus goes after a bulk action, its Undo or Clear: "Select all shown tasks"; on a phone
 * (no header) the first changed row's select box, else the first row's.
 * @param {ParentNode | null} root the Table
 * @param {number[]} [ids] the tasks the action changed
 * @returns {HTMLElement | null}
 */
export function bulkFocusTarget(root, ids = []) {
  const box = (selector) =>
    allShownIn(root, `${selector} input[type="checkbox"]`).find((input) => !input.disabled) ?? null;
  const header = box('[data-table-head]');
  if (header) return header;
  for (const id of ids) {
    const found = box(rowOf(id));
    if (found) return found;
  }
  return box('[data-flip^="row:"]') ?? shownIn(root, 'table');
}

/** Focus after a bulk action, once the windows that took it have given it back. */
export function focusAfterBulk(root, ids = []) {
  const move = () => bulkFocusTarget(root, ids)?.focus({ preventScroll: true });
  if (typeof requestAnimationFrame !== 'function') return move();
  requestAnimationFrame(() => requestAnimationFrame(move));
}

/**
 * The row that takes the focus when a focused row leaves: the next one still shown, else the
 * previous one, else none.
 * @param {number[]} before the rows' ids as drawn before
 * @param {number[]} now as drawn now
 * @param {number} goneId the row that left
 * @returns {number | null}
 */
export function nextRowId(before, now, goneId) {
  const here = new Set(now);
  if (here.has(goneId)) return goneId;
  const at = before.indexOf(goneId);
  if (at === -1) return now[0] ?? null;
  const after = before.slice(at + 1).find((id) => here.has(id));
  if (after !== undefined) return after;
  const earlier = before
    .slice(0, at)
    .reverse()
    .find((id) => here.has(id));
  return earlier ?? null;
}

/** A row's title button where it is shown. */
export const rowTitle = (root, taskId) => shownIn(root, `${rowOf(taskId)} [data-row-title]`);

/**
 * Keeps `--toast-offset` on the page's root (`<html>`) at the bar's height plus 12 px while it
 * shows, following its height (a phone wraps its buttons); the cleanup takes it away.
 * @param {HTMLElement | null} bar
 * @param {{ root?: HTMLElement, Observer?: typeof ResizeObserver }} [env]
 * @returns {() => void}
 */
export function keepToastOffset(bar, env = {}) {
  const root = env.root ?? globalThis.document?.documentElement;
  if (!bar || !root) return () => {};
  const write = () => root.style.setProperty('--toast-offset', toastOffset(bar.offsetHeight));
  write();
  const Observer = env.Observer ?? globalThis.ResizeObserver;
  const observer = Observer ? new Observer(write) : null;
  observer?.observe(bar);
  return () => {
    observer?.disconnect();
    root.style.removeProperty('--toast-offset');
  };
}
