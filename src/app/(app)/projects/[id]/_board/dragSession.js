// One card held by the pointer or the keyboard (CONTRACT 28, Motion, Pointer drag; Keyboard
// move): idle → pressed (dragController.js) → lifted → settling → idle. Plain DOM work on the
// data attributes the board renders; React doesn't render while a card is held, only once at the
// drop (inside flushSync, dragEnd.js). Reads first and writes after, one requestAnimationFrame
// loop while a pointer drag is lifted, and nothing left behind on any way out. `env` is injected
// so tests step frames and time by hand.
import { flushSync } from 'react-dom';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { columnOf } from './bandView';
import { applyScroll, autoScrollStep, scrollBoxes } from './autoScroll';
import { cancelSession, destroySession, dropSession, finishSettle } from './dragEnd';
import { keyLifted, placeOnGap } from './dragKeys';
import { createPreview } from './dragPreview';
import { applyTarget, measureColumns } from './dragTargets';
import { hitColumn } from './sortedGap';
import { liftText, overText } from './moveWords';

/** The browser's clock, frames, timers and documents (tests pass their own). */
export function browserEnv(overrides = {}) {
  return {
    now: () => performance.now(),
    frame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    later: (cb, ms) => setTimeout(cb, ms),
    reduced: prefersReducedMotion,
    doc: globalThis.document,
    win: globalThis.window,
    flushSync,
    classes: {},
    ...overrides,
  };
}

/** The card element of a task on the board. */
export const cardNode = (board, taskId) => board.querySelector(`[data-flip="card:${taskId}"]`);

/** Marks the place the card left (the dashed outline). */
function markOutline(s, card) {
  card.setAttribute('data-outline', '');
  if (s.env.classes.outline) card.classList.add(s.env.classes.outline);
}

/** Takes the outline off a card. */
export function unmarkOutline(s, card) {
  card?.removeAttribute('data-outline');
  if (s.env.classes.outline) card?.classList.remove(s.env.classes.outline);
}

/** The column's sorted gap, the tint and the room; announces a new pointer target. */
export function setTarget(s, next, { force = false } = {}) {
  const was = s.target?.column.key ?? null;
  if (!force && was === (next?.key ?? null)) {
    if (s.target && next) s.target.column = next; // measured again: same column
    return;
  }
  const room = {
    task: s.task,
    height: s.size.height,
    rowGap: s.rowGap,
    dropClass: s.env.classes.dropOn,
    later: s.env.later,
  };
  s.target = applyTarget(s.target, next, room);
  if (s.mode === 'pointer' && s.target && !force) {
    s.say(overText(s.target.column.key, s.target.index, s.target.count, 'pointer'));
  }
}

/** Reads every column again (after a scroll, a resize or a refresh). */
export function remeasure(s) {
  s.measured = measureColumns(s.board, s.task, s.columnsOf?.() ?? s.columns);
  s.dirty = false;
}

/** The column whose box is under the pointer (its body auto-scrolls with `data-fill`). */
const bodyUnder = (s) =>
  s.measured.columns.find(({ rect }) => s.point.x >= rect.left && s.point.x <= rect.right)?.body ??
  null;

/** The column under the card: the preview's centre across, its centre or the pointer up and down. */
function columnUnder(s, pos) {
  const centre = { x: pos.left + s.size.width / 2, y: pos.top + s.size.height / 2 };
  return hitColumn(s.measured.columns, centre, s.point);
}

/** One frame of a pointer drag: reads (the columns only when dirty), then writes. */
function frame(s, now) {
  if (s.state !== 'lifted') return;
  const frameMs = now - s.last;
  s.last = now;
  if (s.dirty) remeasure(s);
  const elements = { board: s.board, body: bodyUnder(s), win: s.env.win };
  const step = autoScrollStep({
    point: s.point,
    ...scrollBoxes(elements),
    elapsed: now - s.liftedAt,
    frameMs,
  });
  const pos = { left: s.point.x - s.grab.x, top: s.point.y - s.grab.y };
  const next = columnUnder(s, pos);
  s.preview.moveTo(pos.left, pos.top);
  setTarget(s, next);
  if (step.any) {
    applyScroll(step, elements);
    s.dirty = true;
  }
  s.raf = s.env.frame((t) => frame(s, t));
}

/** The last hit test with the up event's point (a fast flick sends the move and the up together). */
export function finalHit(s) {
  if (s.dirty) remeasure(s);
  const pos = { left: s.point.x - s.grab.x, top: s.point.y - s.grab.y };
  s.preview.moveTo(pos.left, pos.top);
  setTarget(s, columnUnder(s, pos));
}

/** Window and document listeners while a card is held; removed by `unlisten`. */
function listen(s) {
  const { doc, win } = s.env;
  const on = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    s.off.push(() => target?.removeEventListener(type, handler, options));
  };
  on(doc, 'keydown', (event) => keyLifted(s, event), true);
  on(win, 'blur', () => cancelSession(s));
  on(doc, 'visibilitychange', () => {
    if (!doc.hidden) return;
    if (s.state === 'settling') finishSettle(s);
    else cancelSession(s, { instant: true });
  });
  on(win, 'scroll', () => onScroll(s), { capture: true, passive: true });
  on(win, 'resize', () => (s.dirty = true));
  on(doc, 'contextmenu', (event) => s.state === 'lifted' && event.preventDefault());
  if (s.mode === 'pointer') listenPointer(s, on);
  else listenKeyboard(s, on);
}

function onScroll(s) {
  s.dirty = true;
  if (s.mode === 'keyboard' && s.state === 'lifted') placeOnGap(s, { animate: false });
}

function listenPointer(s, on) {
  const mine = (event) => event.pointerId === s.pointerId;
  on(s.env.win, 'pointermove', (event) => {
    if (mine(event)) s.point = { x: event.clientX, y: event.clientY };
  });
  on(s.env.win, 'pointerup', (event) => {
    if (!mine(event)) return;
    // The click the browser sends after this release opens nothing: after a drop, and after a
    // cancel (Escape, blur) while the button was still down, even mid fly-back.
    if (s.pointerDown) s.env.swallowClick?.();
    s.pointerDown = false;
    if (s.state !== 'lifted') return;
    s.point = { x: event.clientX, y: event.clientY };
    dropSession(s);
  });
  on(s.env.win, 'pointercancel', (event) => mine(event) && cancelSession(s));
  on(s.board, 'lostpointercapture', (event) => mine(event) && cancelSession(s));
}

function listenKeyboard(s, on) {
  // Any press ends a keyboard move at once; the controller sees `cause` and starts no drag from it.
  on(s.env.doc, 'pointerdown', (event) => cancelSession(s, { instant: true, cause: event }), true);
  on(s.grip, 'focusout', (event) => {
    if (s.state === 'lifted' && !s.grip.contains(event.relatedTarget)) cancelSession(s);
  });
}

/** Stops listening (every way out). */
export function unlisten(s) {
  for (const off of s.off.splice(0)) off();
}

/** The reads and writes of the lift (in this order), then the two-frame wait before `data-lifted`. */
function lift(s) {
  const rect = s.card.getBoundingClientRect();
  const list = s.card.parentElement;
  s.rowGap = parseFloat(s.env.win.getComputedStyle?.(list)?.rowGap) || 12;
  s.size = { width: rect.width, height: rect.height };
  s.grab = s.start ? { x: s.start.x - rect.left, y: s.start.y - rect.top } : { x: 0, y: 0 };
  remeasure(s);
  const { classes, doc } = s.env;
  s.preview = createPreview(s.card, rect, {
    className: classes.preview,
    doc,
    focusRing: s.mode === 'keyboard',
  });
  markOutline(s, s.card);
  doc.documentElement.setAttribute('data-dragging', '');
  if (classes.dragging) doc.documentElement.classList.add(classes.dragging);
  s.board.setAttribute('data-dragging', '');
  s.board.style.setProperty('--drag-room', `${s.size.height + s.rowGap}px`);
  s.dirty = true; // without data-fill, data-dragging has just stretched the short columns
  if (s.mode === 'pointer') capture(s);
  doc.getSelection?.()?.removeAllRanges?.();
  s.liftFrame = s.env.frame(() => {
    s.liftFrame = s.env.frame(() => s.state === 'lifted' && s.preview.lift());
  });
}

function capture(s) {
  try {
    s.board.setPointerCapture(s.pointerId);
  } catch {
    // the pointer is already gone (NotFoundError): its pointerup still ends the drag
  }
}

/** Puts the outline on the card's new node after a refresh, and the room on the fresh list. */
function relayout(s) {
  if (s.state !== 'lifted') return;
  const node = cardNode(s.board, s.task.id);
  const now = s.findTask?.(s.task.id) ?? s.task;
  if (!node || now.status === 'done' || columnOf(now) !== s.fromKey) {
    cancelSession(s, { instant: true, gone: true });
    return;
  }
  if (node !== s.card) {
    unmarkOutline(s, s.card);
    s.card = node;
    markOutline(s, node);
  }
  remeasure(s);
  const key = s.target?.column.key ?? null;
  setTarget(s, null, { force: true });
  setTarget(s, s.measured.columns.find((column) => column.key === key) ?? null, { force: true });
  if (s.mode === 'keyboard') placeOnGap(s, { animate: false });
}

/**
 * Lifts a card. The caller (dragController.js) has checked who and where.
 * @param {{ board: HTMLElement, card: HTMLElement, task: object, mode: 'pointer' | 'keyboard',
 *   start?: { x: number, y: number } | null, pointerId?: number | null,
 *   point?: { x: number, y: number } | null, columns?: object[], columnsOf?: () => object[],
 *   findTask?: (id: number) => object | null, grip?: HTMLElement | null,
 *   onDrop: (task: object, toKey: string, how: { mode: string }) => void,
 *   say?: (text: string) => void, onEnd?: (how: object) => void, env?: object }} options
 * @returns {{ move: Function, key: Function, drop: Function, cancel: Function,
 *   relayout: Function, destroy: Function, readonly state: string, readonly mode: string }}
 */
export function createDragSession(options) {
  const env = browserEnv(options.env);
  const s = {
    ...options,
    env,
    state: 'lifted',
    say: options.say ?? (() => {}),
    point: options.point ?? options.start ?? { x: 0, y: 0 },
    columns: options.columns ?? [],
    fromKey: columnOf(options.task),
    grip: options.grip ?? options.card.querySelector?.('[data-grip]') ?? null,
    pointerDown: options.mode === 'pointer',
    target: null,
    dirty: true,
    off: [],
  };
  lift(s);
  listen(s);
  s.say(liftText(s.task.title, s.fromKey, s.mode));
  if (s.mode === 'pointer') {
    s.liftedAt = env.now();
    s.last = s.liftedAt;
    s.raf = env.frame((t) => frame(s, t));
  } else {
    s.walkAt = null;
    placeOnGap(s, { animate: false });
  }
  return {
    move: (point) => (s.point = { x: point.x, y: point.y }),
    key: (event) => keyLifted(s, event),
    drop: () => dropSession(s),
    cancel: (how) => cancelSession(s, how),
    relayout: () => relayout(s),
    destroy: () => destroySession(s),
    get state() {
      return s.state;
    },
    get mode() {
      return s.mode;
    },
    get pointerId() {
      return s.pointerId;
    },
  };
}
