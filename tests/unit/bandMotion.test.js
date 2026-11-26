// The band's progress moment (CONTRACT 28, Motion, Moments: Band progress; motion.md 3.6): after the
// viewer's own tick, move or delete the changed part's fill grows with scaleX (--dur-fill,
// --ease-decelerate) and the percent counts up on its aria-hidden copy, ending on its hidden twin's
// number. Nothing plays on load, for what a refresh brings from others, for a phase move (it plays
// the band itself) or with reduce motion. React's hooks are stood in for, effects run in order at
// each render (a commit).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';
import { el, fakeEvent, fakeFrames, installGlobals } from '../helpers/motionFakes';

const hooks = { states: [], index: 0 };
/** A hook's value, kept in call order. */
function slot(make) {
  const at = hooks.index++;
  if (!(at in hooks.states)) hooks.states[at] = make();
  return hooks.states[at];
}
vi.mock('react', async (original) => ({
  ...(await original()),
  useRef: (initial) => slot(() => ({ current: initial })),
  useMemo: (make, deps) => {
    const kept = slot(() => ({ deps: null, value: null }));
    if (!kept.deps || deps.some((dep, at) => dep !== kept.deps[at])) {
      Object.assign(kept, { deps, value: make() });
    }
    return kept.value;
  },
  useCallback: (fn) => fn,
  useLayoutEffect: (effect) => effect(),
  useEffect: (effect) => slot(() => ({ stop: effect() })),
}));
vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const { useBandMotion } = await import('@/app/(app)/projects/[id]/_board/useBandMotion.js');
const { bandValues } = await import('@/app/(app)/projects/[id]/_board/bandView.js');
const { bandDiffers, playBandChange } =
  await import('@/app/(app)/projects/[id]/_board/bandMotion.js');
const { TASK_REOPENED } = await import('@/app/(app)/projects/[id]/taskEvents.js');
const { DUR, EASE } = await import('@/lib/motion/tokens');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

const PLAN = {
  currentPhase: 'development',
  phases: PROJECT_PHASES.map(({ key, label }) => ({ key, label })),
};
/** Development with `done` of 4 tasks done (Testing has one open task). */
const countsOf = (done) => ({
  development: { total: 4, done },
  testing: { total: 1, done: 0 },
});

let page;
let frames;
let band;
let fills;
let clock;
beforeEach(() => {
  hooks.states = [];
  page = installGlobals();
  resetAnimateForTests();
  frames = fakeFrames();
  clock = 1000;
  vi.stubGlobal('requestAnimationFrame', frames.frame);
  vi.stubGlobal('cancelAnimationFrame', frames.cancelFrame);
  vi.stubGlobal('performance', { now: () => clock });
  fills = Object.fromEntries(
    PROJECT_PHASES.map(({ key }) => [key, el('span', { attrs: { 'data-fill': key } })]),
  );
  band = el('section', {
    children: [
      el('span', { attrs: { 'data-pct': '', 'aria-hidden': 'true' } }),
      el('span', { attrs: { 'data-pct-final': '' } }),
      ...Object.values(fills),
    ],
  });
  page.body.append(band);
});
afterEach(() => vi.unstubAllGlobals());

const PAGE = [{ id: 1 }]; // the page's tasks: the same list until a refresh
const pct = () => band.querySelector('[data-pct]');
const animations = () => Object.values(fills).flatMap((fill) => fill.animations);

const useBand = (args) => useBandMotion(args);
/** A commit: React's numbers on the page, then the hook's effects. */
function commit({ done, tasks = PAGE, plan = PLAN }, hook = useBand) {
  const counts = countsOf(done);
  const text = `${bandValues({ plan, counts }).pct}%`;
  pct().textContent = text;
  band.querySelector('[data-pct-final]').textContent = text;
  hooks.index = 0;
  return hook({ bandRef: { current: band }, plan, counts, tasks });
}

describe('the band after the viewer’s own change', () => {
  it('plays nothing on load, then grows the part and counts the percent up', () => {
    commit({ done: 1 });
    expect(animations()).toEqual([]);
    commit({ done: 2 }); // a move or a delete, or a ticked card that has left: the same page tasks
    expect(fills.development.animations).toHaveLength(1);
    const [grow] = fills.development.animations;
    expect(grow.keyframes).toEqual([{ transform: 'scaleX(0.25)' }, { transform: 'scaleX(0.5)' }]);
    expect(grow.options).toMatchObject({
      id: 'band-fill',
      duration: DUR.fill,
      easing: EASE.decelerate,
      fill: 'none',
    });
    expect(fills.testing.animations).toEqual([]);
    expect(pct().textContent).toBe('20%');
    frames.step(0);
    frames.step(DUR.fill / 2);
    expect(Number.parseInt(pct().textContent, 10)).toBeGreaterThan(20);
    frames.step(DUR.fill);
    expect(pct().textContent).toBe('40%');
    expect(frames.waiting).toBe(0);
  });

  it('ends on what React holds by then, and a second change starts from the first', () => {
    commit({ done: 1 });
    commit({ done: 2 });
    frames.step(0);
    commit({ done: 3 }); // before the count ended
    expect(pct().textContent).toBe('40%');
    frames.step(0);
    frames.step(DUR.fill);
    expect(pct().textContent).toBe('60%');
    expect(fills.development.animations.map((one) => one.keyframes[0].transform)).toEqual([
      'scaleX(0.25)',
      'scaleX(0.5)',
    ]);
  });

  it('shrinks when the share falls (Undo, a task opened again)', () => {
    commit({ done: 2 });
    commit({ done: 1 });
    expect(fills.development.animations[0].keyframes).toEqual([
      { transform: 'scaleX(0.5)' },
      { transform: 'scaleX(0.25)' },
    ]);
  });
});

describe('the band after a refresh', () => {
  it('plays nothing for a change by others', () => {
    commit({ done: 1 });
    commit({ done: 2, tasks: [{ id: 1 }] });
    expect(animations()).toEqual([]);
    expect(pct().textContent).toBe('40%');
  });

  it('plays the viewer’s tick once, in the commit that draws it', () => {
    const expectBand = commit({ done: 1 });
    expectBand();
    commit({ done: 1 }); // the hold: nothing has changed yet
    expect(animations()).toEqual([]);
    commit({ done: 2, tasks: [{ id: 1 }] });
    expect(fills.development.animations).toHaveLength(1);
    commit({ done: 3, tasks: [{ id: 1 }] }); // someone else's, later
    expect(fills.development.animations).toHaveLength(1);
  });

  it('plays two ticks in two commits', () => {
    commit({ done: 1 })();
    commit({ done: 1 })();
    commit({ done: 2, tasks: [{ id: 1 }] });
    commit({ done: 3, tasks: [{ id: 1 }] });
    expect(fills.development.animations.map((one) => one.keyframes[1].transform)).toEqual([
      'scaleX(0.5)',
      'scaleX(0.75)',
    ]);
  });

  it('a refresh slower than 2 s simply shows it', () => {
    commit({ done: 1 })();
    clock += 2100;
    commit({ done: 2, tasks: [{ id: 1 }] });
    expect(animations()).toEqual([]);
  });

  it('plays a task opened again from its window or the toast (TASK_REOPENED)', () => {
    commit({ done: 2 });
    page.win.listeners.run(page.win, fakeEvent(TASK_REOPENED, { detail: { taskId: 1 } }), false);
    commit({ done: 1, tasks: [{ id: 1 }] });
    expect(fills.development.animations).toHaveLength(1);
  });
});

describe('what never plays', () => {
  it('a phase move: the sequence plays the band itself', () => {
    commit({ done: 1 });
    commit({ done: 1, plan: { ...PLAN, currentPhase: 'testing' } });
    expect(animations()).toEqual([]);
    commit({ done: 2, plan: { ...PLAN, currentPhase: 'testing' } }); // a past phase: only the percent
    expect(animations()).toEqual([]);
    expect(frames.waiting).toBe(1);
  });

  it('movement with reduce motion: the numbers change at once', () => {
    page.matchMedia.reduce = true;
    commit({ done: 1 });
    commit({ done: 2 });
    expect(animations()).toEqual([]);
    expect(frames.waiting).toBe(0);
    expect(pct().textContent).toBe('40%');
  });

  it('a change that draws the same band, or a band that is not there', () => {
    const before = bandValues({ plan: PLAN, counts: countsOf(1) });
    expect(bandDiffers(before, { ...before })).toBe(false);
    expect(bandDiffers(before, { ...before, pct: 99 })).toBe(true);
    const now = bandValues({ plan: PLAN, counts: countsOf(2) });
    expect(() => playBandChange(null, before, now)()).not.toThrow();
  });

  it('the count ends when the Board goes', () => {
    commit({ done: 1 });
    commit({ done: 2 });
    frames.step(0);
    const stop = hooks.states.find((one) => typeof one?.stop === 'function' && !('drawn' in one));
    stop.stop();
    expect(pct().textContent).toBe('40%');
    expect(frames.waiting).toBe(0);
  });
});
