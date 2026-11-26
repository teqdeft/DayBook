// A focused card drawn again (CONTRACT 27, Board tab; useCardFocus.js): the refresh after Mark
// done in the window keeps the focus on its new copy, or its column's done fold; and the place that
// took the focus of a column's last card ("› 1 done", a tile, the rail) hands it to the card of the
// task opened again when it goes (the toast's Undo). Split from the card actions' tests
// (boardActions.test.js) by CONTRACT 28, Files and owners. The browser path is in
// tests/e2e/project-board.spec.js and board-focus.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { focusedCardControl, focusedPlace, placeTarget, refocusTarget } =
  await import('@/app/(app)/projects/[id]/_board/useCardFocus.js');

const task = (id) => ({ id, title: `Task ${id}`, phase: 'development', status: 'open' });

let onPage;
beforeEach(() => {
  onPage = new Map();
  vi.stubGlobal('document', { getElementById: (id) => onPage.get(id) ?? null });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('a focused card drawn again', () => {
  const inCard = (taskId, menu = false) => ({
    closest: () => ({ id: `board-card-${taskId}` }),
    getAttribute: (name) => (name === 'aria-haspopup' && menu ? 'menu' : null),
  });
  const DONE = [{ key: 'development', open: [], done: [task(2)] }];

  it('knows which card control had the focus, and nothing outside a card', () => {
    expect(focusedCardControl(inCard(2))).toMatchObject({ taskId: 2, menu: false });
    expect(focusedCardControl(inCard(2, true))).toMatchObject({ taskId: 2, menu: true });
    expect(focusedCardControl({ closest: () => null })).toBeNull();
    expect(focusedCardControl(null)).toBeNull();
  });

  it('goes to the same control on the new copy, else the closed fold of its column', () => {
    const byId = (id) => onPage.get(id) ?? null;
    const fold = { id: 'board-development-done' };
    onPage.set('board-development-done', fold);
    expect(refocusTarget({ taskId: 2, menu: false }, DONE, byId)).toBe(fold);
    const title = { id: 'board-card-2-title' };
    const menu = { id: 'menu 2' };
    onPage.set('board-card-2-title', title);
    onPage.set('board-card-2', { querySelector: () => menu });
    expect(refocusTarget({ taskId: 2, menu: false }, DONE, byId)).toBe(title);
    expect(refocusTarget({ taskId: 2, menu: true }, DONE, byId)).toBe(menu);
  });

  it('leaves a card that is no longer on the board to its own rules (a delete)', () => {
    onPage.set('board-development-done', { id: 'fold' });
    const byId = (id) => onPage.get(id) ?? null;
    expect(refocusTarget({ taskId: 9, menu: false }, DONE, byId)).toBeNull();
    expect(refocusTarget(null, DONE, byId)).toBeNull();
  });
});

describe('a focused fold, tile or rail that goes away', () => {
  const byId = (id) => onPage.get(id) ?? null;
  const COLUMNS = [
    { key: 'launch', open: [task(7), task(8)], done: [] },
    { key: 'testing', open: [], done: [] },
  ];

  it('knows each of them, and nothing else on the board', () => {
    const at = (id) => focusedPlace({ id });
    expect(at('board-launch-done')).toMatchObject({ column: 'launch' });
    expect(at('board-requirement_gathering-done').column).toBe('requirement_gathering');
    expect(at('board-tile-design')).toMatchObject({ column: 'design' });
    expect(at('board-rail')).toMatchObject({ column: null });
    for (const id of ['board-launch-add', 'board-card-7-title', 'board-search', '', undefined]) {
      expect(at(id)).toBeNull();
    }
    expect(focusedPlace(null)).toBeNull();
  });

  it('gives the focus to the task opened again, else the first open card of its column', () => {
    for (const id of [7, 8]) onPage.set(`board-card-${id}-title`, { id });
    expect(placeTarget({ column: 'launch' }, COLUMNS, byId, 8)).toEqual({ id: 8 });
    expect(placeTarget({ column: 'launch' }, COLUMNS, byId)).toEqual({ id: 7 });
    expect(placeTarget({ column: null }, COLUMNS, byId, 8)).toEqual({ id: 8 }); // the rail's button
  });

  it('else to the rail, else the "+ Add task" of its column', () => {
    const add = { id: 'add' };
    onPage.set('board-testing-add', add);
    expect(placeTarget({ column: 'testing' }, COLUMNS, byId)).toBe(add);
    onPage.set('board-rail', { id: 'rail' });
    expect(placeTarget({ column: 'testing' }, COLUMNS, byId)).toEqual({ id: 'rail' });
    expect(placeTarget(null, COLUMNS, byId, 7)).toBeNull();
  });
});
