// Auto-scroll while a card is dragged (CONTRACT 28, Motion, Pointer drag): not in the first
// 300 ms; then, within `edge = min(160 px, 25% of the box)` of an edge, the box scrolls by
// `20 × ((edge - distance) / edge)²` px a frame, scaled by the frame time (a 30 fps laptop scrolls
// as fast per second) and clamped to what is left to scroll. The board sideways, the column body
// under the pointer (only with `data-fill`) and the page up and down. It stays with reduce motion:
// the person drives it. Pure, plus `applyScroll`, the one step that writes.
import { LIMITS } from '@/lib/motion/tokens';

const FRAME_MS = 16.7;
const BOARD_SLACK = 40; // px above and below the board where its sideways scroll still reacts

/**
 * px to scroll along one axis this frame: negative toward the start, 0 outside the edge bands.
 * @param {number} pos the pointer
 * @param {number} start the box's start (left or top)
 * @param {number} end the box's end (right or bottom)
 * @param {{ edgeMax?: number, share?: number, max?: number }} [options]
 * @returns {number}
 */
export function edgeSpeed(
  pos,
  start,
  end,
  { edgeMax = LIMITS.edgeMax, share = LIMITS.edgeShare, max = LIMITS.edgeSpeed } = {},
) {
  const size = end - start;
  if (!(size > 0)) return 0;
  const edge = Math.min(edgeMax, size * share);
  if (!(edge > 0)) return 0;
  if (pos - start < edge) return -max * ((edge - Math.max(0, pos - start)) / edge) ** 2;
  if (end - pos < edge) return max * ((edge - Math.max(0, end - pos)) / edge) ** 2;
  return 0;
}

const clampTo = (delta, at, most) => {
  if (!delta) return 0;
  const next = Math.min(Math.max(at + delta, 0), Math.max(0, most));
  return next - at;
};

const within = (value, low, high) => value >= low && value <= high;

/**
 * One frame's scroll.
 * @param {{ point: { x: number, y: number },
 *   board?: { left: number, right: number, top: number, bottom: number, scrollLeft: number,
 *     maxScrollLeft: number } | null,
 *   body?: { left: number, right: number, top: number, bottom: number, scrollTop: number,
 *     maxScrollTop: number } | null,
 *   page?: { top: number, bottom: number, scrollY: number, maxScrollY: number } | null,
 *   elapsed: number, frameMs: number }} input elapsed: since the lift; frameMs: since the
 *   last frame
 * @returns {{ x: number, y: number, page: number, any: boolean }} x: the board's scrollLeft
 *   change, y: the body's scrollTop change, page: window.scrollY's change
 */
export function autoScrollStep({ point, board, body, page, elapsed, frameMs }) {
  const none = { x: 0, y: 0, page: 0, any: false };
  if (!point || !(elapsed >= LIMITS.autoScrollDelay)) return none;
  const scale = Math.min(3, Math.max(0, (frameMs || FRAME_MS) / FRAME_MS));
  let x = 0;
  let y = 0;
  let pageY = 0;
  if (board && within(point.y, board.top - BOARD_SLACK, board.bottom + BOARD_SLACK)) {
    x = clampTo(
      edgeSpeed(point.x, board.left, board.right) * scale,
      board.scrollLeft,
      board.maxScrollLeft,
    );
  }
  if (body && within(point.x, body.left, body.right)) {
    y = clampTo(
      edgeSpeed(point.y, body.top, body.bottom) * scale,
      body.scrollTop,
      body.maxScrollTop,
    );
  }
  if (page && page.maxScrollY > 0) {
    pageY = clampTo(
      edgeSpeed(point.y, page.top, page.bottom) * scale,
      page.scrollY,
      page.maxScrollY,
    );
  }
  return { x, y, page: pageY, any: Boolean(x || y || pageY) };
}

/**
 * The scroll boxes as autoScrollStep reads them (reads only).
 * @param {{ board: HTMLElement, body: HTMLElement | null, win: Window }} elements
 */
export function scrollBoxes({ board, body, win }) {
  const b = board.getBoundingClientRect();
  const boardBox = {
    left: b.left,
    right: b.right,
    top: b.top,
    bottom: b.bottom,
    scrollLeft: board.scrollLeft,
    maxScrollLeft: board.scrollWidth - board.clientWidth,
  };
  let bodyBox = null;
  if (body && body.scrollHeight > body.clientHeight + 1) {
    const r = body.getBoundingClientRect();
    bodyBox = {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      scrollTop: body.scrollTop,
      maxScrollTop: body.scrollHeight - body.clientHeight,
    };
  }
  const root = win.document.documentElement;
  const pageBox = {
    top: 0,
    bottom: win.innerHeight,
    scrollY: win.scrollY,
    maxScrollY: root.scrollHeight - win.innerHeight,
  };
  return { board: boardBox, body: bodyBox, page: pageBox };
}

/** Writes one frame's scroll (instant). */
export function applyScroll(step, { board, body, win }) {
  if (step.x) board.scrollLeft += step.x;
  if (step.y && body) body.scrollTop += step.y;
  if (step.page) win.scrollBy?.({ top: step.page, behavior: 'instant' });
}
