// The tick of a card (CONTRACT 28, Motion, Moments: Tick done; useTickLeave.js): the card turns
// ticking at once, after 600 ms it fades and joins its column's done cards (unticking cancels), the
// last open card of a past phase folds the column away, a failed save brings it back, and the hold
// keeps a ticked card in its open list, ticked, even when the refresh lands first (at 100 ms); the
// toast's Undo (reopen) stops the leave or drops the optimistic done at once; and the page's own
// "done" ends it, so a later "open" from the server (the task window's Reopen, or another manager)
// shows at once, not 15 s later.
// React's hooks are stood in for by a store kept in call order; flushSync is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBoard, flushPromises, installGlobals } from '../helpers/motionFakes';

const hooks = { states: [], index: 0 };
vi.mock('react', async (original) => ({
  ...(await original()),
  useState(initial) {
    const at = hooks.index++;
    if (!(at in hooks.states))
      hooks.states[at] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[at], () => {}];
  },
  useSyncExternalStore: (subscribe, get) => get(),
  useMemo: (make) => make(),
  useEffect: () => {},
  useLayoutEffect: (effect) => effect(), // each render is a commit here
}));
vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const { applyTicks, createTickStore, useTickLeave } =
  await import('@/app/(app)/projects/[id]/_board/useTickLeave');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

let page;
let b;
let rootRef;
let pageTasks;
const useTicks = () => useTickLeave({ rootRef, tasks: pageTasks });
/** Renders the hook again from its first slot, as React would. */
function render(hook = useTicks) {
  hooks.index = 0;
  return hook();
}

beforeEach(() => {
  hooks.states = [];
  pageTasks = undefined;
  vi.useFakeTimers();
  page = installGlobals();
  resetAnimateForTests();
  b = fakeBoard(page);
  rootRef = { current: b.wrap };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const task = (id) => b.findTask(id);
const input = (id) => b.cards[id].querySelector('input');

/** Lets the 600 ms pass and the fade end. */
async function leave(id) {
  vi.advanceTimersByTime(600);
  b.cards[id].animations.find((a) => a.id === 'tick-leave')?.finish();
  await flushPromises();
}

describe('applyTicks', () => {
  it('holds a leaving task open and shows a left one done until the refresh agrees', () => {
    const tasks = [task(1), task(3)];
    expect(applyTicks(tasks, { leaving: new Set(), done: new Set() })).toBe(tasks);
    const held = applyTicks(tasks, { leaving: new Set([1]), done: new Set([3]) });
    expect(held[0]).toMatchObject({ id: 1, holdOpen: true, status: 'open' });
    expect(held[1]).toMatchObject({ id: 3, status: 'done' });
  });
});

describe('useTickLeave', () => {
  it('ticks at once, waits 600 ms, fades, then the card joins its done cards', async () => {
    const saved = Promise.resolve(true);
    render().tick(task(1), true, saved, { el: input(1) });
    expect(b.cards[1].hasAttribute('data-ticking')).toBe(true);
    expect(render().apply([task(1)])[0].holdOpen).toBe(true);
    vi.advanceTimersByTime(599);
    expect(b.cards[1].animations.some((a) => a.id === 'tick-leave')).toBe(false);
    await leave(1);
    expect(b.cards[1].hasAttribute('data-ticking')).toBe(false);
    const [shown] = render().apply([task(1)]);
    expect(shown.holdOpen).toBeUndefined();
    expect(shown.status).toBe('done');
    expect(b.cards[6].animations.some((a) => a.id === 'flip')).toBe(false); // no layout change faked
  });

  it('the hold: a refresh that says done at 100 ms still finds it in the open list, ticked', async () => {
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    vi.advanceTimersByTime(100);
    const refreshed = { ...task(1), status: 'done' };
    const [held] = render().apply([refreshed]);
    expect(held).toMatchObject({ holdOpen: true, status: 'done' });
    await leave(1);
    expect(render().apply([refreshed])[0].holdOpen).toBeUndefined();
  });

  it('unticking within the wait cancels the leave', async () => {
    const tick = render().tick;
    tick(task(1), true, Promise.resolve(true), { el: input(1) });
    vi.advanceTimersByTime(300);
    render().tick(task(1), false, Promise.resolve(true), { el: input(1) });
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(b.cards[1].hasAttribute('data-ticking')).toBe(false);
    expect(b.cards[1].animations.some((a) => a.id === 'tick-leave')).toBe(false);
    expect(render().apply([task(1)])[0]).toBe(task(1));
  });

  it('a failed save during the wait cancels the fade and lets the card go back', async () => {
    let fail;
    render().tick(task(1), true, new Promise((resolve) => (fail = resolve)), { el: input(1) });
    vi.advanceTimersByTime(650);
    const fade = b.cards[1].animations.find((a) => a.id === 'tick-leave');
    fail(false);
    await flushPromises();
    expect(fade.playState).toBe('idle');
    expect(b.cards[1].hasAttribute('data-ticking')).toBe(false);
    expect(render().apply([task(1)])[0]).toBe(task(1));
  });

  it('a failed save after the leave brings the card back, rising in', async () => {
    let fail;
    render().tick(task(1), true, new Promise((resolve) => (fail = resolve)), { el: input(1) });
    await leave(1);
    expect(render().apply([task(1)])[0].status).toBe('done');
    fail(false);
    await flushPromises();
    expect(render().apply([task(1)])[0]).toBe(task(1));
    expect(b.cards[1].animations.some((a) => a.id === 'rise-in')).toBe(true);
  });

  it('the last open card of a past phase folds its column into the rail', async () => {
    // Testing is the current phase now, and Development has one open card left.
    const tag = b.columns.development.querySelector('[data-current-tag]');
    b.columns.testing.children[0].append(tag);
    b.cards[6].remove();
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    await leave(1);
    const ghost = b.wrap.children.find((node) =>
      node.animations.some((a) => a.id === 'phase-fold'),
    );
    expect(ghost).toBeTruthy();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
  });

  it('a card that is not the last one simply leaves for the fold', async () => {
    const tag = b.columns.development.querySelector('[data-current-tag]');
    b.columns.testing.children[0].append(tag);
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    await leave(1);
    expect(b.wrap.children.some((node) => node.animations.some((a) => a.id === 'phase-fold'))).toBe(
      false,
    );
  });

  it("the toast's Undo after the leave shows the task open at once (no optimistic done)", async () => {
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    await leave(1);
    expect(render().apply([task(1)])[0].status).toBe('done');
    render().reopen(1);
    expect(render().apply([task(1)])[0]).toBe(task(1));
  });

  it("the toast's Undo within the wait stops the leave", async () => {
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    vi.advanceTimersByTime(300);
    render().reopen(1);
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(b.cards[1].hasAttribute('data-ticking')).toBe(false);
    expect(b.cards[1].animations.some((a) => a.id === 'tick-leave')).toBe(false);
    expect(render().apply([task(1)])[0]).toBe(task(1));
  });

  /** A refresh: the page lists these tasks now; the status the board shows for the first one. */
  function refreshed(status) {
    pageTasks = [{ ...task(1), status }];
    return render().apply(pageTasks)[0].status;
  }

  it('a task opened again after the refresh agreed shows open at once, not after 15 s', async () => {
    pageTasks = [task(1)];
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    await leave(1);
    expect(refreshed('open'), 'the refresh has not caught up yet').toBe('done');
    expect(refreshed('done')).toBe('done');
    expect(refreshed('open'), 'reopened in the task window or by someone else').toBe('open');
  });

  it('the same when the refresh said done before the card left', async () => {
    pageTasks = [task(1)];
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    vi.advanceTimersByTime(100);
    expect(refreshed('done')).toBe('done');
    await leave(1);
    expect(render().apply(pageTasks)[0]).toBe(pageTasks[0]); // nothing laid over it
    expect(refreshed('open')).toBe('open');
  });

  it('with reduce motion the card leaves at once', () => {
    page.matchMedia.reduce = true;
    render().tick(task(1), true, Promise.resolve(true), { el: input(1) });
    expect(render().apply([task(1)])[0].status).toBe('done');
  });

  it('returns the save it was given', () => {
    const saved = Promise.resolve(true);
    expect(render().tick(task(1), true, saved, { el: input(1) })).toBe(saved);
  });
});

describe('createTickStore', () => {
  it('tells its listeners of every change', () => {
    const store = createTickStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.hold(1);
    store.left(1);
    store.forget(1);
    off();
    store.hold(2);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.get().leaving.has(2)).toBe(true);
  });

  it('agree drops only what the page shows done, and tells nobody when nothing drops', () => {
    const store = createTickStore();
    store.left(1);
    store.left(2);
    const listener = vi.fn();
    store.subscribe(listener);
    store.agree([{ id: 1, status: 'open' }]);
    expect(listener).not.toHaveBeenCalled();
    store.agree([
      { id: 1, status: 'done' },
      { id: 2, status: 'open' },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...store.get().done]).toEqual([2]);
  });
});
