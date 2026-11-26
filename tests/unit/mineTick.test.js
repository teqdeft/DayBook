// The tick on a My tasks row (CONTRACT 28, Motion, Moments: My tasks tick; Look and accessibility,
// Focus after a control goes away): where the focus goes when the row leaves (the next row's title,
// else the previous one's, else the list, else the card or the page's main part), and the task
// opened again from outside its row (the "Marked done." toast's Undo, the task window's Reopen):
// within the wait the leave stops, after it the row is no longer hidden, and a row the refresh has
// already left out keeps its place, unticked, until the next refresh. React's hooks are stood in
// for by a store kept in call order; the effects run once, when the test says so.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, flushPromises, installGlobals } from '../helpers/motionFakes';

const hooks = vi.hoisted(() => ({ states: [], index: 0, effects: [] }));
vi.mock('react', async (original) => ({
  ...(await original()),
  useState(initial) {
    const at = hooks.index++;
    if (!(at in hooks.states)) {
      hooks.states[at] = typeof initial === 'function' ? initial() : initial;
    }
    const set = (next) => {
      hooks.states[at] = typeof next === 'function' ? next(hooks.states[at]) : next;
    };
    return [hooks.states[at], set];
  },
  useMemo: (make) => make(),
  useEffect: (effect) => hooks.effects.push(effect),
}));
vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const { focusAfterLeave, useMineTick } = await import('@/app/(app)/my-tasks/useMineTick.js');
const { sayReopened } = await import('@/app/(app)/projects/[id]/taskEvents.js');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

let page;
let main;
beforeEach(() => {
  Object.assign(hooks, { states: [], index: 0, effects: [] });
  vi.useFakeTimers();
  page = installGlobals();
  resetAnimateForTests();
  page.win.dispatchEvent = (event) => page.win.listeners.run(page.win, event, false);
  vi.stubGlobal(
    'CustomEvent',
    class {
      constructor(type, { detail }) {
        Object.assign(this, { type, detail });
      }
    },
  );
  main = drawn('main', { id: 'main', tabindex: '-1' });
  page.body.append(main);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** An element that has a box while it is on the page. */
function drawn(tag, attrs = {}, children = []) {
  const node = el(tag, { attrs, children, rect: { left: 0, top: 0, width: 100, height: 52 } });
  node.getClientRects = () => (node.isConnected ? [node.rect] : []);
  return node;
}

/** The home card (or the page's table) with a row per task: its box and its title. */
function drawList(ids, { card = false } = {}) {
  const row = (id) =>
    drawn(card ? 'li' : 'tr', { 'data-flip': `mine:${id}` }, [
      drawn('input', { type: 'checkbox', id: `box-${id}` }),
      drawn('button', { 'data-mine-title': '', id: `title-${id}` }),
    ]);
  const list = drawn(
    card ? 'ul' : 'table',
    { 'data-mine-list': '', tabindex: '-1', id: 'list' },
    ids.map(row),
  );
  const root = card ? drawn('section', { 'data-mine-root': '', id: 'card' }, [list]) : list;
  main.append(root);
  const rowOf = (id) => list.querySelector(`[data-flip="mine:${id}"]`);
  return { list, root, rowOf, box: (id) => rowOf(id).querySelector('input') };
}
const focused = () => page.doc.activeElement?.getAttribute('id') ?? null;

/** The row leaves with the focus on its box; returns the id of what has it then. */
function leaveRow(drawing, id, { last = false } = {}) {
  drawing.box(id).focus();
  const refocus = focusAfterLeave(drawing.rowOf(id));
  drawing.rowOf(id).remove();
  if (last) drawing.list.remove(); // the empty sentence takes the list's place
  refocus();
  return focused();
}

describe('focus after a row leaves', () => {
  it("goes to the next row's title", () => {
    expect(leaveRow(drawList([1, 2, 3]), 2)).toBe('title-3');
  });

  it("goes to the previous row's title after the last row", () => {
    expect(leaveRow(drawList([1, 2]), 2)).toBe('title-1');
  });

  it('skips a neighbour that has left meanwhile', () => {
    const drawing = drawList([1, 2, 3, 4]);
    drawing.box(2).focus();
    const refocus = focusAfterLeave(drawing.rowOf(2));
    drawing.rowOf(2).remove();
    drawing.rowOf(3).remove();
    refocus();
    expect(focused()).toBe('title-4');
  });

  it('goes to the list when no row is left in it', () => {
    expect(leaveRow(drawList([1]), 1)).toBe('list');
  });

  it('never falls to the page when the list goes too: the home card, or the main part', () => {
    expect(leaveRow(drawList([1]), 1, { last: true })).toBe('main');
    const home = drawList([1], { card: true });
    expect(leaveRow(home, 1, { last: true })).toBe('card');
    expect(home.root.getAttribute('tabindex')).toBe('-1');
  });

  it('stays where it is when the person has moved on', () => {
    const drawing = drawList([1, 2]);
    const search = drawn('input', { id: 'search' });
    main.append(search);
    search.focus();
    const refocus = focusAfterLeave(drawing.rowOf(1));
    drawing.rowOf(1).remove();
    refocus();
    expect(focused()).toBe('search');
  });
});

const task = (id) => ({
  id,
  title: `Task ${id}`,
  priority: 'p2',
  dueDate: `2026-12-${String(id).padStart(2, '0')}`,
  project: { id: 3, name: 'acme-store', color: 'green', status: 'active' },
  canManage: true,
});
const TASKS = [task(1), task(2), task(3)];
const without = (id) => TASKS.filter((one) => one.id !== id);

/** Draws the hook again, from its first slot. */
function render(tasks = TASKS, hook = useMineTick) {
  hooks.index = 0;
  return hook(tasks);
}
/** The first draw, with its effects run (the page hears TASK_REOPENED). */
function mount(tasks = TASKS) {
  const drawing = drawList(tasks.map((one) => one.id));
  render(tasks);
  hooks.effects.splice(0).forEach((effect) => effect());
  return drawing;
}
const rows = (tasks) => render(tasks).tasks.map((one) => [one.id, Boolean(one.ticking)]);
const tickRow = (drawing, id) =>
  render().tick(task(id), true, Promise.resolve(true), { el: drawing.box(id) });
/** Lets the 600 ms pass and the fade end. */
async function leave(drawing, id) {
  const row = drawing.rowOf(id);
  vi.advanceTimersByTime(600);
  row.animations.find((animation) => animation.id === 'tick-leave')?.finish();
  await flushPromises();
}

describe('a ticked task opened again from outside its row', () => {
  it('within the wait: the leave stops and the row is unticked', async () => {
    const drawing = mount();
    tickRow(drawing, 2);
    expect(drawing.rowOf(2).hasAttribute('data-ticking')).toBe(true);
    expect(rows()).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
    vi.advanceTimersByTime(300);
    sayReopened(2);
    expect(drawing.rowOf(2).hasAttribute('data-ticking')).toBe(false);
    await leave(drawing, 2);
    expect(drawing.rowOf(2).animations).toEqual([]);
    expect(rows()).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
  });

  it('after the leave, the page still listing it: the row shows at once, not after 15 s', async () => {
    const drawing = mount();
    tickRow(drawing, 2);
    await leave(drawing, 2);
    expect(rows().map(([id]) => id)).toEqual([1, 3]);
    sayReopened(2);
    expect(rows().map(([id]) => id)).toEqual([1, 2, 3]);
  });

  it('the refresh has left it out: the row keeps its place, unticked, until the next one', async () => {
    const drawing = mount();
    tickRow(drawing, 2);
    const done = without(2);
    render(done); // the refresh that says done, while the row is held
    sayReopened(2);
    expect(rows(done)).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
    await leave(drawing, 2);
    expect(rows(done).map(([id]) => id)).toEqual([1, 2, 3]);
    render([...TASKS]); // the refresh after the Undo lists it again
    expect(rows(done).map(([id]) => id)).toEqual([1, 3]); // the page's own answer, nothing held
  });

  it('a row ticked again is held and ticked again', () => {
    const drawing = mount();
    tickRow(drawing, 2);
    const done = without(2);
    render(done);
    sayReopened(2);
    tickRow(drawing, 2);
    expect(rows(done)[1]).toEqual([2, true]);
  });

  it("changes nothing for a task it isn't holding or hiding", () => {
    mount();
    const before = hooks.states[0];
    sayReopened(2);
    sayReopened(99);
    expect(hooks.states[0]).toBe(before);
  });
});
