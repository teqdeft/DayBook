// Auto-scroll while a card is dragged (CONTRACT 28, Motion, Pointer drag; autoScroll.js): nothing in
// the first 300 ms, then within edge = min(160 px, 25% of the box) of an edge the box scrolls by
// 20 × ((edge - distance) / edge)² px a frame, scaled by the frame time and clamped.
import { describe, expect, it } from 'vitest';
import { autoScrollStep, edgeSpeed } from '@/app/(app)/projects/[id]/_board/autoScroll';

const board = (extra = {}) => ({
  left: 0,
  right: 1200,
  top: 200,
  bottom: 800,
  scrollLeft: 400,
  maxScrollLeft: 1000,
  ...extra,
});

describe('edgeSpeed', () => {
  it('is 0 outside the edge bands', () => {
    expect(edgeSpeed(600, 0, 1200)).toBe(0);
    expect(edgeSpeed(161, 0, 1200)).toBe(0);
    expect(edgeSpeed(1039, 0, 1200)).toBe(0);
  });

  it('is 20 at and past the edge, toward the start negative', () => {
    expect(edgeSpeed(0, 0, 1200)).toBe(-20);
    expect(edgeSpeed(-30, 0, 1200)).toBe(-20);
    expect(edgeSpeed(1200, 0, 1200)).toBe(20);
    expect(edgeSpeed(1260, 0, 1200)).toBe(20);
  });

  it('is quadratic between: half way into a 160 px band gives 5', () => {
    expect(edgeSpeed(80, 0, 1200)).toBe(-5);
    expect(edgeSpeed(1120, 0, 1200)).toBe(5);
    expect(edgeSpeed(40, 0, 1200)).toBeCloseTo(-11.25);
  });

  it('uses 25% of a small box: a 400 px body has a 100 px band', () => {
    expect(edgeSpeed(100, 0, 400)).toBe(0);
    expect(edgeSpeed(50, 0, 400)).toBe(-5);
    expect(edgeSpeed(350, 0, 400)).toBe(5);
  });

  it('is 0 for a box with no size', () => {
    expect(edgeSpeed(10, 100, 100)).toBe(0);
  });
});

describe('autoScrollStep', () => {
  const point = { x: 1200, y: 500 };

  it('does nothing in the first 300 ms of a drag', () => {
    expect(autoScrollStep({ point, board: board(), elapsed: 299, frameMs: 16.7 })).toEqual({
      x: 0,
      y: 0,
      page: 0,
      any: false,
    });
    expect(autoScrollStep({ point, board: board(), elapsed: 300, frameMs: 16.7 }).x).toBe(20);
  });

  it('scales by the frame time (a 30 fps laptop scrolls as fast per second)', () => {
    const step = autoScrollStep({ point, board: board(), elapsed: 500, frameMs: 33.4 });
    expect(step.x).toBe(40);
    expect(step.any).toBe(true);
  });

  it('clamps to what is left to scroll', () => {
    const atEnd = board({ scrollLeft: 995 });
    expect(autoScrollStep({ point, board: atEnd, elapsed: 500, frameMs: 16.7 }).x).toBe(5);
    const atStart = board({ scrollLeft: 0 });
    const left = { x: 0, y: 500 };
    expect(autoScrollStep({ point: left, board: atStart, elapsed: 500, frameMs: 16.7 })).toEqual({
      x: 0,
      y: 0,
      page: 0,
      any: false,
    });
  });

  it('scrolls the column body under the pointer up and down', () => {
    const body = { left: 300, right: 580, top: 300, bottom: 700, scrollTop: 50, maxScrollTop: 400 };
    const down = autoScrollStep({ point: { x: 400, y: 700 }, body, elapsed: 400, frameMs: 16.7 });
    expect(down.y).toBe(20);
    const up = autoScrollStep({ point: { x: 400, y: 350 }, body, elapsed: 400, frameMs: 16.7 });
    expect(up.y).toBe(-5);
    const beside = autoScrollStep({ point: { x: 200, y: 700 }, body, elapsed: 400, frameMs: 16.7 });
    expect(beside.y).toBe(0);
  });

  it('scrolls the page near the window edges only when it can scroll', () => {
    const page = { top: 0, bottom: 900, scrollY: 100, maxScrollY: 600 };
    const near = { x: 600, y: 900 };
    expect(autoScrollStep({ point: near, page, elapsed: 400, frameMs: 16.7 }).page).toBe(20);
    const still = { ...page, maxScrollY: 0, scrollY: 0 };
    expect(autoScrollStep({ point: near, page: still, elapsed: 400, frameMs: 16.7 }).page).toBe(0);
  });

  it('leaves the board alone when the pointer is far above or below it', () => {
    const far = { x: 1200, y: 100 };
    expect(autoScrollStep({ point: far, board: board(), elapsed: 400, frameMs: 16.7 }).x).toBe(0);
  });
});
