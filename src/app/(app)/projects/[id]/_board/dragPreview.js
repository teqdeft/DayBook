// The lifted picture of a dragged card (CONTRACT 28, Motion, Pointer drag: "Preview"): a fixed
// wrapper holding cloneForMotion(card), moved by translate3d from exactly where it was grabbed. It
// lifts two frames after it is drawn (BoardDrag.module.css transitions the scale, tilt and shadow),
// glides on a keyboard step, settles into the gap or flies back, and is removed at the end. It is
// inert, aria-hidden and never takes a click.
import { EASE } from '@/lib/motion/tokens';
import { play } from '@/lib/motion/animate';
import { cloneForMotion } from '@/lib/motion/clone';

const at = (x, y) => `translate3d(${x}px, ${y}px, 0)`;

/**
 * @param {HTMLElement} card the real card
 * @param {{ left: number, top: number, width: number, height: number }} rect its box now
 * @param {{ className?: string, doc?: Document, focusRing?: boolean }} [options] focusRing: the
 *   keyboard move, so the picture's grip draws the focus ring
 * @returns {{ wrap: HTMLElement, inner: HTMLElement, moveTo: (x: number, y: number) => void,
 *   glideTo: (x: number, y: number, ms: number) => Animation | null, lift: () => void,
 *   settle: (toRect: { left: number, top: number }, ms: number) => Animation | null,
 *   position: () => { left: number, top: number }, remove: () => void }}
 */
export function createPreview(
  card,
  rect,
  { className = '', doc = globalThis.document, focusRing = false } = {},
) {
  const wrap = doc.createElement('div');
  if (className) wrap.className = className;
  wrap.setAttribute('data-drag-preview', '');
  wrap.setAttribute('inert', '');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.width = `${rect.width}px`;
  wrap.style.height = `${rect.height}px`;
  const inner = cloneForMotion(card, { preview: true });
  if (focusRing) inner.querySelector?.('[data-grip]')?.setAttribute('data-focus-ring', '');
  wrap.append(inner);
  doc.body.append(wrap);
  const mover = moverOf(wrap, rect);
  return {
    wrap,
    inner,
    moveTo: mover.moveTo,
    glideTo: mover.glideTo,
    lift() {
      inner.setAttribute('data-lifted', '');
    },
    settle(toRect, ms) {
      inner.style.transition = `transform ${Math.max(0, ms)}ms ${EASE.settle}`;
      inner.removeAttribute('data-lifted'); // scale 1, tilt 0, the card's own shadow
      return mover.glideTo(toRect.left, toRect.top, ms, EASE.settle);
    },
    position: () => ({ ...mover.pos(), width: rect.width, height: rect.height }),
    remove() {
      mover.stop();
      wrap.remove();
    },
  };
}

/**
 * Moves the wrapper: at once (every pointer frame), or gliding from where it is now. The inline
 * transform is always the end; a glide (fill forwards: the wrapper is removed at the end) plays
 * the way there.
 */
function moverOf(wrap, rect) {
  let pos = { left: rect.left, top: rect.top };
  let running = null;
  const stop = () => {
    running?.cancel();
    running = null;
  };
  const moveTo = (x, y) => {
    stop();
    pos = { left: x, top: y };
    wrap.style.transform = at(x, y);
  };
  const glideTo = (x, y, ms, easing = EASE.standard) => {
    const from = running ? currentTransform(wrap) : at(pos.left, pos.top);
    moveTo(x, y);
    running = play(wrap, [{ transform: from }, { transform: at(x, y) }], {
      duration: ms,
      easing,
      fill: 'forwards',
      id: 'drag-preview',
    });
    return running;
  };
  moveTo(rect.left, rect.top);
  return { moveTo, glideTo, stop, pos: () => pos };
}

/** Where a gliding wrapper is drawn right now (one style read, only mid-glide). */
function currentTransform(wrap) {
  const view = wrap.ownerDocument?.defaultView;
  const now = view?.getComputedStyle?.(wrap).transform;
  return now && now !== 'none' ? now : wrap.style.transform;
}
