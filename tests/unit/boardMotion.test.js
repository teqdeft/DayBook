// The board's moments (CONTRACT 28, Motion, Moments; boardMotion.js) with a stubbed flushSync: each
// one reads before the change, commits the change once, then plays; with reduce motion only the
// fades and the flash are left. A card moved from its menu glides (a fixed clone), a ticked card
// leaves after 600 ms, a face swaps, a new card rises in once the refresh draws it, the rail widens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, fakeBoard, flushPromises, installGlobals } from '../helpers/motionFakes';

const log = [];
vi.mock('react-dom', () => ({
  flushSync: (fn) => {
    log.push('change');
    fn();
  },
}));

const { expectNewCard, glideMove, railFlip, riseIn, swapFace, tickLeave } =
  await import('@/app/(app)/projects/[id]/_board/boardMotion');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

let page;
let b;
beforeEach(() => {
  log.length = 0;
  page = installGlobals();
  resetAnimateForTests();
  b = fakeBoard(page);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Logs every box read and every animation started on these elements. */
function watch(elements) {
  for (const node of elements) {
    const read = node.getBoundingClientRect.getMockImplementation();
    node.getBoundingClientRect.mockImplementation(() => {
      log.push('read');
      return read();
    });
    const animate = node.animate.getMockImplementation();
    node.animate.mockImplementation((frames, options) => {
      log.push(`play:${options.id}`);
      return animate(frames, options);
    });
  }
}

/** The move of card 1 to Testing as React would draw it: another list, a new box. */
const moveCardOne = () => {
  const card = b.cards[1];
  b.lists.testing.append(card);
  card.rect = { left: 390, top: 372, width: 260, height: 100 };
  b.cards[4].rect = { ...b.cards[4].rect, top: 484 };
};

describe('glideMove', () => {
  it('reads first, commits once, then the card glides as a clone and the columns close up', async () => {
    watch([b.cards[1], b.cards[4], b.cards[6]]);
    const moving = glideMove(b.board, 1, moveCardOne, { to: 'testing' });
    const firstChange = log.indexOf('change');
    expect(log.slice(0, firstChange).every((step) => step === 'read')).toBe(true);
    expect(log.filter((step) => step === 'change')).toHaveLength(1);
    expect(log.slice(firstChange + 1)).toContain('play:fly-hide');
    expect(log.slice(firstChange + 1)).toContain('play:flip');
    const clone = page.body.children.find((node) => node.hasAttribute('data-fly-clone'));
    expect(clone.animations[0].keyframes).toEqual([
      { transform: 'translate(90px, 260px)' },
      { transform: 'translate(390px, 372px)' },
    ]);
    for (const node of [clone, b.cards[1], b.cards[4], b.cards[6]]) {
      node.animations.forEach((a) => a.finish());
    }
    await moving;
    await flushPromises();
    expect(b.cards[1].animations.at(-1).id).toBe('flash');
    expect(clone.parentElement).toBeNull();
  });

  it('out of the board view: no glide, the board shows the column and the card flashes', async () => {
    const show = vi.fn();
    await glideMove(
      b.board,
      1,
      () => {
        moveCardOne();
        b.cards[1].rect.left = 1500; // past the board's right edge
      },
      { to: 'testing', scroll: { show } },
    );
    expect(show).toHaveBeenCalledWith('testing');
    expect(page.body.children.some((node) => node.hasAttribute('data-fly-clone'))).toBe(false);
    expect(b.cards[1].animations.map((a) => a.id)).toEqual(['flash']);
  });

  it('with reduce motion the change shows at once with the flash', async () => {
    page.matchMedia.reduce = true;
    const change = vi.fn(moveCardOne);
    await glideMove(b.board, 1, change, { to: 'testing' });
    expect(change).toHaveBeenCalledTimes(1);
    expect(b.cards[1].animations.map((a) => a.id)).toEqual(['flash']);
    expect(b.cards[4].animations).toEqual([]);
  });

  it('without the card on the board it simply commits', async () => {
    const change = vi.fn();
    await glideMove(b.board, 99, change);
    expect(change).toHaveBeenCalledTimes(1);
  });
});

describe('tickLeave', () => {
  it('waits 600 ms, fades the card out, then leaves', async () => {
    vi.useFakeTimers();
    const onLeave = vi.fn();
    tickLeave(b.cards[1], { onLeave });
    vi.advanceTimersByTime(599);
    expect(b.cards[1].animations).toEqual([]);
    vi.advanceTimersByTime(1);
    const [fade] = b.cards[1].animations;
    expect(fade.keyframes).toEqual([{ opacity: 0 }]);
    expect(fade.options).toMatchObject({ duration: 160, fill: 'forwards', id: 'tick-leave' });
    expect(onLeave).not.toHaveBeenCalled();
    fade.finish();
    await flushPromises();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(fade.cancel).toHaveBeenCalled(); // in the same task as the change
  });

  it('unticking (the cancel) within the wait or the fade never leaves the card invisible', async () => {
    vi.useFakeTimers();
    const onLeave = vi.fn();
    const undoRef = { current: null };
    const cancel = tickLeave(b.cards[1], { onLeave, undoRef });
    expect(undoRef.current).toBe(cancel);
    vi.advanceTimersByTime(650);
    cancel();
    expect(b.cards[1].animations[0].playState).toBe('idle');
    await flushPromises();
    expect(onLeave).not.toHaveBeenCalled();
    expect(undoRef.current).toBeNull();
  });

  it('with reduce motion the card leaves at once', () => {
    page.matchMedia.reduce = true;
    const onLeave = vi.fn();
    tickLeave(b.cards[1], { onLeave });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('swapFace', () => {
  it('the old face fades out, the change commits, the new face fades in, the card flashes', async () => {
    const card = b.cards[1];
    const swapping = swapFace(card, () => {
      card.querySelector('[data-face]').remove();
      card.append(el('span', { attrs: { 'data-face': '' } }));
    });
    const old = card.querySelector('[data-face]');
    expect(old.animations[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(log).toEqual([]);
    old.animations[0].finish();
    await swapping;
    expect(log).toEqual(['change']);
    const fresh = card.querySelector('[data-face]');
    expect(fresh.animations[0].keyframes).toEqual([
      { opacity: 0, transform: 'scale(0.92)' },
      { opacity: 1, transform: 'none' },
    ]);
    expect(card.animations.at(-1).id).toBe('flash');
  });

  it('with reduce motion it is a fade only', async () => {
    page.matchMedia.reduce = true;
    const card = b.cards[1];
    const swapping = swapFace(card, () => {});
    card.querySelector('[data-face]').animations[0].finish();
    await swapping;
    const [, fadeIn] = card.querySelector('[data-face]').animations;
    expect(fadeIn.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});

describe('expectNewCard and riseIn', () => {
  /** The queue as useCommitMotion keeps it, played by hand. */
  const queue = () => {
    const requests = [];
    return { expect: (request) => requests.push(request), requests };
  };

  it('the column makes room and the new card rises in once the refresh draws it', async () => {
    const motion = queue();
    expectNewCard(motion, b.board, 'testing', 42);
    const [request] = motion.requests;
    expect(request.ready(b.board)).toBe(false);
    const card = el('li', {
      attrs: { 'data-flip': 'card:42', 'data-open': '' },
      rect: { left: 390, top: 260, width: 260, height: 100 },
    });
    b.lists.testing.children.unshift(card);
    card.parentElement = b.lists.testing;
    b.cards[3].rect.top = 372;
    expect(request.ready(b.board)).toBe(true);
    request.play(b.board);
    const [rise] = card.animations;
    expect(rise.options).toMatchObject({ delay: 200, duration: 200, fill: 'backwards' });
    expect(rise.keyframes[0]).toEqual({ opacity: 0, transform: 'translateY(8px)' });
    expect(b.cards[3].animations[0].options.id).toBe('flip');
    rise.finish();
    await flushPromises();
    expect(card.animations.at(-1).id).toBe('flash');
  });

  it('a refresh slower than 2 s simply shows it with the flash', () => {
    const motion = queue();
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    expectNewCard(motion, b.board, 'testing', 43);
    const card = el('li', { attrs: { 'data-flip': 'card:43' } });
    b.lists.testing.append(card);
    now = 2500;
    motion.requests[0].play(b.board);
    expect(card.animations.map((a) => a.id)).toEqual(['flash']);
  });

  it('riseIn with reduce motion keeps the fade and the flash', async () => {
    page.matchMedia.reduce = true;
    const card = el('li');
    const rise = riseIn(card);
    expect(rise.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    rise.finish();
    await flushPromises();
    expect(card.animations.at(-1).id).toBe('flash');
  });
});

describe('railFlip', () => {
  it('the rail box scales from its old width, the columns slide, the tiles fade in later', () => {
    const box = b.rail.querySelector('[data-rail-box]');
    railFlip(b.board, () => {
      b.rail.rect.width = 220;
      b.rail.append(el('li'));
      b.columns.development.rect.left = 230;
    });
    expect(box.animations[0].keyframes).toEqual([
      { transform: `scaleX(${72 / 220})` },
      { transform: 'none' },
    ]);
    expect(b.columns.development.animations[0].keyframes[0]).toEqual({
      transform: 'translate(-150px, 0px)',
    });
    const tile = b.rail.querySelector('li');
    expect(tile.animations[0].options).toMatchObject({ delay: 60, fill: 'backwards' });
  });

  it('with reduce motion the rail simply changes', () => {
    page.matchMedia.reduce = true;
    const change = vi.fn();
    railFlip(b.board, change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(b.rail.querySelector('[data-rail-box]').animations).toEqual([]);
  });
});
