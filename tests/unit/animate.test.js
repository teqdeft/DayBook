// The Web Animations helpers (CONTRACT 28, Motion, Modules and signatures; animate.js): `play`
// (null without `animate`, at 0 ms, or with only movement under reduce motion), `done` (never
// rejects), `finishAll` when reduce motion turns on, the flash, the count-up and the Board and
// Table crossfade. Elements and animations are hand-made fakes (tests/helpers/motionFakes.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, fakeAnimation, flushPromises, installGlobals } from '../helpers/motionFakes';

vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const {
  cancelById,
  countUp,
  crossfade,
  done,
  finishAll,
  flash,
  play,
  resetAnimateForTests,
  stillKeyframes,
} = await import('@/lib/motion/animate');
const { riseIn } = await import('@/app/(app)/projects/[id]/_board/boardMotion');

let page;
beforeEach(() => {
  page = installGlobals();
  resetAnimateForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('play', () => {
  it('returns null without an element, without el.animate, or at 0 ms', () => {
    expect(play(null, [{ opacity: 0 }], { duration: 100 })).toBeNull();
    expect(play({}, [{ opacity: 0 }], { duration: 100 })).toBeNull();
    const card = el('li');
    expect(play(card, [{ opacity: 0 }], { duration: 0 })).toBeNull();
    expect(card.animate).not.toHaveBeenCalled();
  });

  it('plays the keyframes with the token defaults', () => {
    const card = el('li');
    const animation = play(card, [{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
    expect(animation).toBe(card.animations[0]);
    expect(card.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 120,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      delay: 0,
      fill: 'none',
      id: 'motion',
    });
  });

  it("with reduce motion keeps riseIn's fade and drops its movement", () => {
    page.matchMedia.reduce = true;
    const card = el('li');
    riseIn(card);
    const [frames, options] = card.animate.mock.calls[0];
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(options.delay).toBe(0); // --dur-room is 0 with reduce
    expect(options.duration).toBe(120); // --dur-tag becomes the fade
  });

  it('with reduce motion returns null for a pure translate or a drawing check', () => {
    page.matchMedia.reduce = true;
    const card = el('li');
    const slide = [{ transform: 'translate(4px, 0)' }, { transform: 'none' }];
    expect(play(card, slide, { duration: 200 })).toBeNull();
    const draw = [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }];
    expect(play(card, draw, { duration: 250 })).toBeNull();
    expect(card.animate).not.toHaveBeenCalled();
  });

  it('stillKeyframes keeps offsets only beside a property that is left', () => {
    const frames = [
      { transform: 'none', offset: 0 },
      { opacity: 1, offset: 1 },
    ];
    expect(stillKeyframes(frames)).toEqual([{ opacity: 1, offset: 1 }]);
    expect(stillKeyframes({ transform: ['a', 'b'] })).toBeNull();
  });
});

describe('done', () => {
  it('is true when it finishes, false when it is cancelled, and never rejects', async () => {
    const finished = fakeAnimation();
    const cancelled = fakeAnimation();
    const a = done(finished);
    const b = done(cancelled);
    finished.finish();
    cancelled.cancel();
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(false);
    await expect(done(null)).resolves.toBe(true);
  });
});

describe('finishAll', () => {
  it('runs when reduce motion turns on: every running movement jumps to its end', async () => {
    const card = el('li');
    const frames = [{ transform: 'translateY(8px)' }, { transform: 'none' }];
    const animation = play(card, frames, { duration: 200 });
    page.matchMedia.setReduce(true);
    expect(animation.finish).toHaveBeenCalled();
    await flushPromises();
    finishAll(); // nothing is left running: no second finish
    expect(animation.finish).toHaveBeenCalledTimes(1);
  });
});

describe('flash', () => {
  it("plays --primary-soft fading to the element's own background, 700 ms", () => {
    const row = el('tr');
    const [animation] = flash(row);
    expect(animation.keyframes).toEqual([{ backgroundColor: '#eef0ff', offset: 0 }]);
    expect(animation.options).toMatchObject({ duration: 700, id: 'flash' });
    expect(animation.options.easing).toBe('cubic-bezier(0.25, 0.1, 0.25, 1)');
  });

  it('restarts a flash still running, and stays with reduce motion', () => {
    page.matchMedia.reduce = true;
    const row = el('tr');
    const [first] = flash(row);
    const [second] = flash(row);
    expect(first.cancel).toHaveBeenCalled();
    expect(second.playState).toBe('running');
  });

  it('takes a list and reads the colour once per call', () => {
    const spy = vi.fn(globalThis.getComputedStyle);
    vi.stubGlobal('getComputedStyle', spy);
    const rows = [el('tr'), el('tr'), el('tr')];
    expect(flash(rows)).toHaveLength(3);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(flash([])).toEqual([]);
  });

  it('takes another start colour (the phase move column)', () => {
    const column = el('section');
    const [animation] = flash(column, { color: 'red' });
    expect(animation.keyframes[0].backgroundColor).toBe('red');
  });
});

describe('cancelById', () => {
  it('cancels only the animations with that id', () => {
    const card = el('li');
    const flip = play(card, [{ opacity: 0 }], { duration: 100, id: 'flip' });
    const other = play(card, [{ opacity: 0 }], { duration: 100, id: 'flash' });
    cancelById(card, 'flip');
    expect(flip.cancel).toHaveBeenCalled();
    expect(other.cancel).not.toHaveBeenCalled();
  });
});

describe('countUp', () => {
  it('writes the end number at once with reduce motion', () => {
    page.matchMedia.reduce = true;
    const copy = el('span', { text: '40%' });
    countUp(copy, 40, 60, 500, { format: (n) => `${n}%` });
    expect(copy.textContent).toBe('60%');
  });

  it('counts on frames and always ends on the end number when cancelled', () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const copy = el('span');
    const cancel = countUp(copy, 0, 10, 100);
    expect(copy.textContent).toBe('0');
    frames.shift()(0);
    frames.shift()(50);
    expect(Number(copy.textContent)).toBeGreaterThan(0);
    cancel();
    expect(copy.textContent).toBe('10');
  });
});

describe('crossfade', () => {
  it('fades out, commits, fades in and cancels the fade-out in the same task', async () => {
    const view = el('div');
    const change = vi.fn();
    const switching = crossfade(view, change);
    const [out] = view.animations;
    expect(out.options).toMatchObject({ id: 'crossfade', fill: 'forwards', duration: 160 });
    expect(change).not.toHaveBeenCalled();
    out.finish();
    await switching;
    expect(change).toHaveBeenCalledTimes(1);
    const fadeIn = view.animations.find((a) => a.id === 'crossfade-in');
    expect(fadeIn.options).toMatchObject({ duration: 220, fill: 'none' });
    expect(out.cancel).toHaveBeenCalled(); // no frame left at opacity 0
  });

  it('two quick switches commit only the latest, and the view never stays at opacity 0', async () => {
    const view = el('div');
    const toTable = vi.fn();
    const toBoard = vi.fn();
    const first = crossfade(view, toTable);
    const second = crossfade(view, toBoard); // finishes the first fade at once
    await Promise.all([first, second]);
    expect(toTable).not.toHaveBeenCalled();
    expect(toBoard).toHaveBeenCalledTimes(1);
    const outs = view.animations.filter((a) => a.id === 'crossfade');
    expect(outs).toHaveLength(1);
    expect(outs[0].playState).not.toBe('running');
    expect(view.getAnimations().some((a) => a.id === 'crossfade')).toBe(false);
    expect(view.animations.some((a) => a.id === 'crossfade-in')).toBe(true);
  });

  it('with reduce motion both fades are --dur-fade', async () => {
    page.matchMedia.reduce = true;
    const view = el('div');
    const switching = crossfade(() => view, vi.fn());
    view.animations[0].finish();
    await switching;
    expect(view.animations.map((a) => a.options.duration)).toEqual([120, 120]);
  });
});
