// Windows and toasts that play their exit (CONTRACT 28, Motion, Modules and signatures; presence.js):
// rendered while closing, removed on their own animationend or after exitMs + 50; a window open on
// the page's first render has no entrance; a closing window holds its last content. React's hooks
// are stood in for by a tiny store kept in call order, with effects run after each render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = { states: [], effects: [], index: 0, pending: [] };
vi.mock('react', async (original) => ({
  ...(await original()),
  useState(initial) {
    const at = hooks.index++;
    if (!(at in hooks.states))
      hooks.states[at] = typeof initial === 'function' ? initial() : initial;
    const set = (next) => {
      hooks.states[at] = typeof next === 'function' ? next(hooks.states[at]) : next;
    };
    return [hooks.states[at], set];
  },
  useCallback: (fn) => fn,
  useEffect(effect, deps) {
    const at = hooks.index++;
    const was = hooks.effects[at];
    if (was && deps && was.deps.every((d, i) => Object.is(d, deps[i]))) return;
    hooks.pending.push(() => {
      was?.cleanup?.();
      hooks.effects[at] = { deps, cleanup: effect() };
    });
  },
}));

const {
  exitTimeout,
  nextPresence,
  ownAnimationEnd,
  useHeldValue,
  usePresence,
  useWindowPresence,
  windowMarks,
} = await import('@/lib/motion/presence');

/** Renders a hook like React would: the body twice while it adjusts its state, then effects. */
function renderHook(hook) {
  let result;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = JSON.stringify(hooks.states);
    hooks.index = 0;
    result = hook();
    if (JSON.stringify(hooks.states) === before) break;
  }
  for (const run of hooks.pending.splice(0)) run();
  return result;
}

beforeEach(() => {
  hooks.states = [];
  hooks.effects = [];
  hooks.pending = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('nextPresence', () => {
  it('opens, starts closing when open turns false, and stays when nothing changes', () => {
    const closed = { open: false, closing: false };
    const opened = nextPresence(closed, true, 160);
    expect(opened).toEqual({ open: true, closing: false });
    expect(nextPresence(opened, true, 160)).toBe(opened);
    expect(nextPresence(opened, false, 160)).toEqual({ open: false, closing: true });
    expect(nextPresence(opened, false, 0)).toEqual({ open: false, closing: false });
    expect(nextPresence(closed, false, 160)).toBe(closed);
  });

  it('counts only the element’s own animationend, and waits exitMs + 50 at most', () => {
    const panel = {};
    expect(ownAnimationEnd({ target: panel, currentTarget: panel })).toBe(true);
    expect(ownAnimationEnd({ target: {}, currentTarget: panel })).toBe(false);
    expect(exitTimeout(160)).toBe(210);
    expect(exitTimeout(-5)).toBe(50);
  });
});

describe('usePresence', () => {
  it('stays rendered while closing and goes on its own animationend', () => {
    let open = true;
    const useView = () => usePresence(open, 160);
    expect(renderHook(useView)).toMatchObject({ rendered: true, closing: false });
    open = false;
    const closing = renderHook(useView);
    expect(closing).toMatchObject({ rendered: true, closing: true });
    const panel = {};
    closing.onAnimationEnd({ target: {}, currentTarget: panel }); // a child's animation: not yet
    expect(renderHook(useView).rendered).toBe(true);
    closing.onAnimationEnd({ target: panel, currentTarget: panel });
    expect(renderHook(useView)).toMatchObject({ rendered: false, closing: false });
  });

  it('goes after exitMs + 50 when no animationend comes', () => {
    let open = true;
    const useView = () => usePresence(open, 160);
    renderHook(useView);
    open = false;
    renderHook(useView);
    vi.advanceTimersByTime(209);
    expect(renderHook(useView).rendered).toBe(true);
    vi.advanceTimersByTime(1);
    expect(renderHook(useView).rendered).toBe(false);
  });

  it('opens again while closing without leaving the page', () => {
    let open = true;
    const useView = () => usePresence(open, 160);
    renderHook(useView);
    open = false;
    renderHook(useView);
    open = true;
    expect(renderHook(useView)).toMatchObject({ rendered: true, closing: false });
    vi.advanceTimersByTime(500);
    expect(renderHook(useView).rendered).toBe(true);
  });
});

describe('useWindowPresence', () => {
  it('a window open on the first render (hydrating) has no entrance; later ones do', () => {
    let open = true;
    let isClient = false;
    const useView = () => useWindowPresence(open, isClient, 160);
    expect(renderHook(useView).rendered).toBe(false); // nothing on the server or while hydrating
    isClient = true;
    expect(renderHook(useView).marks).toEqual({
      'data-closing': undefined,
      'data-instant': '',
      inert: undefined,
    });
    open = false;
    expect(renderHook(useView).marks).toEqual({
      'data-closing': '',
      'data-instant': undefined,
      inert: true,
    });
    vi.advanceTimersByTime(300);
    renderHook(useView);
    open = true;
    expect(renderHook(useView).marks['data-instant']).toBeUndefined();
  });

  it('a window opened by a click after the page loaded plays its entrance', () => {
    const useView = () => useWindowPresence(true, true, 160);
    expect(renderHook(useView).marks['data-instant']).toBeUndefined();
  });
});

describe('windowMarks', () => {
  it('marks closing (inert, no clicks) and instant', () => {
    expect(windowMarks(false, false)).toEqual({
      'data-closing': undefined,
      'data-instant': undefined,
      inert: undefined,
    });
    expect(windowMarks(true, true)['data-instant']).toBeUndefined();
  });
});

describe('useHeldValue', () => {
  it('shows the value while open and the last open one while closing', () => {
    let open = true;
    let value = { title: 'Dates for Testing' };
    const useView = () => useHeldValue(open, value);
    expect(renderHook(useView)).toBe(value);
    const last = value;
    open = false;
    value = { title: undefined };
    expect(renderHook(useView)).toBe(last);
  });
});
