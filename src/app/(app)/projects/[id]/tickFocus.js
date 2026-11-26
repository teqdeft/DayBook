// Where the focus goes back to when a ticked box has left the page with its card or row (CONTRACT
// 28, Look and accessibility: "Focus after a control goes away (never to the page)"). The "Marked
// done." toast takes the focus after a tick from the keyboard, often once the card has already left
// for its fold, so the place is read as the box is ticked (TaskCheck) and used later (Tab, Escape or
// Undo in the toast): the next card's or row's title, else the previous one's; else, on the Board,
// the column's "› 6 done" (or, when the column folded away, its tile or the rail) and its "+ Add
// task", in the Table the table and in My tasks the list; else the section it was in, else the page's
// main part. DOM only, no React.
import { RAIL_BUTTON_ID, addTaskId, foldButtonId, tileButtonId } from './_board/boardView';
import { isShown } from './_board/table/tableDom';

/** What a ticked box can be in: the item that leaves, the list around it, an item's title. */
const SPOTS = [
  { item: '[data-flip^="card:"]', list: '[data-cards]', title: '[data-card-title]' },
  {
    item: '[data-flip^="row:"]',
    list: '[data-table-body], [data-stack]',
    title: '[data-row-title]',
  },
  { item: '[data-flip^="mine:"]', list: '[data-mine-list]', title: '[data-mine-title]' },
];

const byId = (id) => globalThis.document?.getElementById(id) ?? null;

/** An element that isn't a control takes the focus with `tabindex="-1"`. */
function focusable(element) {
  if (element && !element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  return element;
}

/** The items after this one, then the ones before it (the nearest first), by their keys. */
function neighbours(list, item, selector) {
  const items = [...list.querySelectorAll(selector)];
  const at = items.indexOf(item);
  return [...items.slice(at + 1), ...items.slice(0, Math.max(at, 0)).reverse()].map((one) =>
    one.getAttribute('data-flip'),
  );
}

/** With no card or row left beside it: what stays of the column, the table or the list. */
function whatStays(list) {
  const column = list.closest('[data-column]')?.getAttribute('data-column');
  const own = column
    ? [foldButtonId(column), tileButtonId(column), RAIL_BUTTON_ID, addTaskId(column)].map(byId)
    : [list.closest('table'), list.hasAttribute('data-mine-list') ? list : null];
  return own.find(isShown) ?? null;
}

/**
 * @param {Element | null} box the box being ticked, still on the page
 * @returns {() => HTMLElement | null} finds the element to focus, later, once the box has left
 */
export function placeAfterTick(box) {
  const section = box?.closest('section') ?? null;
  const spot = SPOTS.find(({ item }) => box?.closest(item));
  const item = spot ? box.closest(spot.item) : null;
  const list = item?.closest(spot.list) ?? null;
  const keys = list ? neighbours(list, item, spot.item) : [];
  const title = (key) => list.querySelector(`[data-flip="${key}"] ${spot.title}`);
  return () =>
    keys.map(title).find(isShown) ??
    (list ? whatStays(list) : null) ??
    (isShown(section) ? focusable(section) : byId('main'));
}
