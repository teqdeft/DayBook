// Focus after a tick from the keyboard (CONTRACT 28, Look and accessibility: "Focus after a control
// goes away (never to the page)"; tickFocus.js, TaskUndoProvider's returnFocus). The "Marked done."
// toast often comes after the card has left for its fold, so the place is read as the box is ticked:
// the next card's title, else the previous one's, else the column's "› 6 done", its rail tile or the
// rail, "+ Add task"; in the Table the next row's title, else the previous one's, else the table; in
// My tasks the same, else the list; else the section, else the page's main part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, fakeBoard, installGlobals } from '../helpers/motionFakes';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/lib/apiClient', () => ({ api: {} }));

const { placeAfterTick } = await import('@/app/(app)/projects/[id]/tickFocus.js');
const { returnFocus } = await import('@/app/(app)/projects/[id]/TaskUndoProvider.jsx');

let page;
let b;
beforeEach(() => {
  page = installGlobals();
  b = fakeBoard(page);
});
afterEach(() => vi.unstubAllGlobals());

const box = (item) => item.querySelector('input');
const title = (item, mark = 'data-card-title') => item.querySelector(`[${mark}]`);

/** A place on the page with this id (a fold, a tile, the rail, "+ Add task"). */
function place(id, { shown = true } = {}) {
  const node = el('button', { attrs: { id } });
  node.shown = shown;
  page.body.append(node);
  return node;
}

describe('a card on the Board', () => {
  it("gives the focus to the next card's title once it has left", () => {
    const find = placeAfterTick(box(b.cards[1]));
    b.cards[1].remove();
    expect(find()).toBe(title(b.cards[6]));
  });

  it('takes the previous card when it was the last, and skips cards that left meanwhile', () => {
    const last = placeAfterTick(box(b.cards[4]));
    const first = placeAfterTick(box(b.cards[3]));
    b.cards[4].remove();
    expect(last()).toBe(title(b.cards[3]));
    b.cards[3].remove();
    const fold = place('board-testing-done');
    expect(first()).toBe(fold);
  });

  it('with no card left beside it: the fold, the tile, the rail, then "+ Add task"', () => {
    b.cards[6].remove();
    const find = placeAfterTick(box(b.cards[1]));
    b.cards[1].remove();
    const add = place('board-development-add');
    expect(find()).toBe(add);
    const rail = place('board-rail');
    expect(find()).toBe(rail);
    const tile = place('board-tile-development');
    expect(find()).toBe(tile);
    const fold = place('board-development-done', { shown: false }); // the column folded away
    expect(find()).toBe(tile);
    fold.shown = true;
    expect(find()).toBe(fold);
  });

  it("the column itself takes it when nothing else is there, then the page's main part", () => {
    b.cards[6].remove();
    const find = placeAfterTick(box(b.cards[1]));
    b.cards[1].remove();
    expect(find()).toBe(b.columns.development);
    expect(b.columns.development.getAttribute('tabindex')).toBe('-1');
    b.columns.development.remove(); // the Table took the Board's place
    const main = place('main');
    expect(find()).toBe(main);
  });
});

describe('a row', () => {
  /** A list of rows in its section: the Table's (`row`) or My tasks' (`mine`). */
  function rows(kind, count) {
    const list = el(kind === 'row' ? 'tbody' : 'div', {
      attrs: kind === 'row' ? { 'data-table-body': '' } : { 'data-mine-list': '', tabindex: '-1' },
    });
    const mark = kind === 'row' ? 'data-row-title' : 'data-mine-title';
    const items = Array.from({ length: count }, (_, at) =>
      el('tr', {
        attrs: { 'data-flip': `${kind}:${at + 1}` },
        children: [
          el('input', { attrs: { type: 'checkbox' } }),
          el('button', { attrs: { [mark]: '' } }),
        ],
      }),
    );
    list.append(...items);
    const around = kind === 'row' ? el('table', { attrs: { tabindex: '-1' } }) : el('div');
    around.append(list);
    const section = el('section', { attrs: { 'aria-label': 'Tasks' } });
    section.append(around);
    page.body.append(section);
    return { list, items, around, mark };
  }

  it.each(['row', 'mine'])("gives the focus to the next %s's title, else the previous", (kind) => {
    const { items, mark } = rows(kind, 3);
    const first = placeAfterTick(box(items[0]));
    const last = placeAfterTick(box(items[2]));
    items[0].remove();
    items[2].remove();
    expect(first()).toBe(title(items[1], mark));
    expect(last()).toBe(title(items[1], mark));
  });

  it('falls to the table, or to the My tasks list, with no row left', () => {
    const table = rows('row', 1);
    const inTable = placeAfterTick(box(table.items[0]));
    table.items[0].remove();
    expect(inTable()).toBe(table.around);

    const mine = rows('mine', 1);
    const inMine = placeAfterTick(box(mine.items[0]));
    mine.items[0].remove();
    expect(inMine()).toBe(mine.list);
  });
});

describe('a box in none of them (Critical tasks on the Summary tab)', () => {
  it('gives the focus to its section', () => {
    const input = el('input', { attrs: { type: 'checkbox' } });
    const section = el('section', { children: [input] });
    page.body.append(section);
    const find = placeAfterTick(input);
    input.remove();
    expect(find()).toBe(section);
  });

  it('answers nothing without a box on the page', () => {
    expect(placeAfterTick(null)()).toBeNull();
  });
});

describe("the toast's way back", () => {
  it('goes to the box while it is there, else to the place read as it was ticked', () => {
    const origin = box(b.cards[1]);
    const find = placeAfterTick(origin);
    returnFocus({ origin, place: find });
    expect(page.doc.activeElement).toBe(origin);
    b.cards[1].remove();
    returnFocus({ origin, place: find });
    expect(page.doc.activeElement).toBe(title(b.cards[6]));
    expect(title(b.cards[6]).focus).toHaveBeenCalledWith({ preventScroll: false });
  });

  it('does nothing with neither (Mark done in the task window)', () => {
    page.doc.activeElement = page.body;
    returnFocus({ origin: null, place: null });
    expect(page.doc.activeElement).toBe(page.body);
  });
});
