// The phase move sequence (CONTRACT 28, Motion, Phase move sequence; phaseMotion.js and
// phaseParts.js) with a stubbed flushSync: everything is read before the commit, the commit runs
// once, then each row of the timeline starts at its time (fill 0, ring 200, check 250, tags 350,
// fold 400, slide 480, scroll 700, toast 760); reduce motion changes everything at once with the
// tags' fade and the flash; a new rail fades in; a move over two phases folds both; the cleanup
// ends it all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, fakeBoard, installGlobals } from '../helpers/motionFakes';

const log = [];
vi.mock('react-dom', () => ({
  flushSync: (fn) => {
    log.push('commit');
    fn();
  },
}));

const { TIMELINE, playFold, playPhaseMove } =
  await import('@/app/(app)/projects/[id]/_board/phaseMotion');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

const KEYS = ['requirement_gathering', 'design', 'development', 'testing', 'launch', 'support'];

/** The band as C1 draws it: six parts with a fill, a green layer and a check, one ring, a tag. */
function fakeBand(current = 2) {
  const band = el('div', { rect: { left: 0, top: 80, width: 1200, height: 60 } });
  KEYS.forEach((key, at) => {
    const fill = el('span', { attrs: { 'data-fill': key } });
    fill.style.setProperty('--share', at < current ? '1' : at === current ? '0.6' : '0');
    const check = el('svg', { attrs: { 'data-check': key }, children: [el('path')] });
    band.append(fill, el('span', { attrs: { 'data-done-layer': key } }), check);
  });
  const ring = el('span', {
    attrs: { 'data-ring': '' },
    rect: { left: current * 200, top: 80, width: 196, height: 8 },
  });
  const tag = el('span', {
    attrs: { 'data-current-tag': '' },
    rect: { left: current * 200, top: 100, width: 60, height: 20 },
  });
  band.append(ring, tag);
  return { band, ring, tag };
}

let page;
let b;
let band;
let calls;
beforeEach(() => {
  log.length = 0;
  vi.useFakeTimers();
  page = installGlobals();
  resetAnimateForTests();
  b = fakeBoard(page);
  band = fakeBand();
  page.body.append(band.band);
  calls = { toast: vi.fn(() => log.push('toast')), refresh: vi.fn(() => log.push('refresh')) };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Development finished: the band and the board as the commit draws them. */
function commitTesting({ fold = true } = {}) {
  return vi.fn(() => {
    log.push('change');
    band.band.querySelector('[data-fill="development"]').style.setProperty('--share', '1');
    band.ring.rect.left = 600;
    band.tag.rect.left = 600;
    if (fold) b.columns.development.remove();
    b.columns.testing.rect.left = 80;
    b.columns.none.rect.left = 380;
  });
}

const byId = (node, id) => node.animations.find((a) => a.id === id);

describe('playPhaseMove', () => {
  it('reads first, commits once, then plays every row at its time', () => {
    const fill = band.band.querySelector('[data-fill="development"]');
    const commit = commitTesting();
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      folds: ['development'],
      commit,
      ...calls,
    });
    expect(log).toEqual(['commit', 'change']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(byId(fill, 'phase-fill').keyframes).toEqual([
      { transform: 'scaleX(0.6)' },
      { transform: 'scaleX(1)' },
    ]);
    expect(byId(fill, 'phase-fill').options).toMatchObject({ duration: 500, delay: 0 });
    const layer = band.band.querySelector('[data-done-layer="development"]');
    expect(layer.animations[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    const ring = byId(band.ring, 'phase-ring');
    expect(ring.keyframes[0]).toEqual({ translate: '-200px 0' });
    expect(ring.options).toMatchObject({ delay: TIMELINE.ring, duration: 300, fill: 'backwards' });
    const check = band.band.querySelector('[data-check="development"] path');
    expect(check.animations[0].options).toMatchObject({ delay: 250, duration: 250 });
    const tagIn = byId(band.tag, 'phase-tag-in');
    expect(tagIn.options).toMatchObject({ delay: 350, duration: 200, fill: 'backwards' });
    const ghost = b.wrap.children.find((node) =>
      node.animations.some((a) => a.id === 'phase-fold'),
    );
    expect(ghost.getAttribute('inert')).toBe('');
    expect(ghost.hasAttribute('data-column')).toBe(false);
    expect(byId(ghost, 'phase-fold').options).toMatchObject({ delay: 400, duration: 300 });
    expect(byId(b.columns.testing, 'flip').options).toMatchObject({ delay: 480, duration: 300 });
    const tagOut = band.band.children.find((node) =>
      node.animations.some((a) => a.id === 'phase-tag-out'),
    );
    expect(tagOut).toBeTruthy();
    expect(calls.toast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(byId(b.columns.testing, 'flash')).toBeTruthy();
    vi.advanceTimersByTime(410);
    expect(calls.toast).toHaveBeenCalledTimes(1);
    expect(calls.refresh).toHaveBeenCalledTimes(1);
  });

  it('with the rail closed the count changes and its check draws at 400 ms', () => {
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      folds: ['development'],
      commit: commitTesting(),
      ...calls,
    });
    const count = b.rail.querySelector('[data-rail-n]');
    expect(byId(count, 'phase-count-in').options).toMatchObject({ delay: 400, fill: 'backwards' });
    const old = b.wrap.children.find((node) =>
      node.animations.some((a) => a.id === 'phase-count-out'),
    );
    expect(old.textContent).toBe('2');
  });

  it('with the rail open the folded phase becomes a tile that rises in', () => {
    const commit = vi.fn(() => {
      b.columns.development.remove();
      b.rail.append(el('li', { attrs: { 'data-tile': 'development' } }));
    });
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      folds: ['development'],
      commit,
      ...calls,
    });
    const tile = b.rail.querySelector('[data-tile="development"]');
    expect(byId(tile, 'phase-tile').keyframes[0]).toEqual({
      opacity: 0,
      transform: 'translateY(8px)',
    });
  });

  it('a rail that is new at the commit fades in at 400 ms', () => {
    b.rail.remove();
    const rail = el('aside', {
      attrs: { 'data-flip': 'rail' },
      rect: { left: 0, top: 200, width: 72, height: 700 },
    });
    const commit = vi.fn(() => {
      b.board.children.unshift(rail);
      rail.parentElement = b.board;
      b.columns.development.remove();
    });
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      folds: ['development'],
      railIsNew: true,
      commit,
      ...calls,
    });
    expect(byId(rail, 'phase-in').options).toMatchObject({ delay: 400, fill: 'backwards' });
  });

  it('a move over two phases folds both', () => {
    const commit = vi.fn(() => {
      b.columns.development.remove();
      b.columns.testing.remove();
    });
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'launch',
      folds: ['development', 'testing'],
      commit,
      ...calls,
    });
    const ghosts = b.wrap.children.filter((node) =>
      node.animations.some((a) => a.id === 'phase-fold'),
    );
    expect(ghosts).toHaveLength(2);
  });

  it('"Go back" plays the fill from 1 and the green layer out, with no check', () => {
    const commit = vi.fn(() =>
      band.band.querySelector('[data-fill="design"]').style.setProperty('--share', '0.5'),
    );
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'design',
      commit,
      ...calls,
    });
    const fill = band.band.querySelector('[data-fill="design"]');
    expect(byId(fill, 'phase-fill').keyframes).toEqual([
      { transform: 'scaleX(1)' },
      { transform: 'scaleX(0.5)' },
    ]);
    const layer = band.band.querySelector('[data-done-layer="design"]');
    expect(layer.animations[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(band.band.querySelector('[data-check="design"] path').animations).toEqual([]);
  });

  it('with reduce motion everything changes at once: the tags fade, the flash stays, the toast comes', () => {
    page.matchMedia.reduce = true;
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      folds: ['development'],
      commit: commitTesting(),
      ...calls,
    });
    const fill = band.band.querySelector('[data-fill="development"]');
    expect(fill.animations).toEqual([]);
    expect(band.ring.animations).toEqual([]);
    expect(byId(band.tag, 'phase-tag-in').options).toMatchObject({ duration: 120, delay: 0 });
    expect(b.wrap.children.some((node) => node.animations.some((a) => a.id === 'phase-fold'))).toBe(
      false,
    );
    vi.advanceTimersByTime(0);
    expect(byId(b.columns.testing, 'flash')).toBeTruthy();
    expect(calls.toast).toHaveBeenCalledTimes(1);
  });

  it('the cleanup ends every animation and clone, and a toast still due runs at once', () => {
    const cleanup = playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      folds: ['development'],
      commit: commitTesting(),
      ...calls,
    });
    const fill = band.band.querySelector('[data-fill="development"]');
    cleanup();
    expect(byId(fill, 'phase-fill').playState).toBe('idle');
    expect(b.wrap.children.some((node) => node.hasAttribute('inert'))).toBe(false);
    expect(calls.toast).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(calls.toast).toHaveBeenCalledTimes(1);
  });

  it('waits `wait` ms before the commit when asked', () => {
    const commit = commitTesting();
    playPhaseMove({
      board: b.board,
      band: band.band,
      from: 'development',
      to: 'testing',
      wait: 160,
      commit,
      ...calls,
    });
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(160);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('playFold', () => {
  it('folds a column on its own (the last open card of a past phase was ticked)', () => {
    const commit = vi.fn(() => {
      b.columns.development.remove();
      b.columns.testing.rect.left = 80;
    });
    playFold({ board: b.wrap, keys: ['development'], commit });
    expect(commit).toHaveBeenCalledTimes(1);
    const ghost = b.wrap.children.find((node) =>
      node.animations.some((a) => a.id === 'phase-fold'),
    );
    expect(byId(ghost, 'phase-fold').options.delay).toBe(0);
    expect(byId(b.columns.testing, 'flip').options.delay).toBe(80);
  });
});
