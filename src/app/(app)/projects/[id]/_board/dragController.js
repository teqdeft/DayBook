// Who may pick up a card, and when (CONTRACT 28, Motion, Pointer drag: "Who and where", "Start",
// "Click after a drag"; Keyboard move: the grip). A press is left alone unless every rule holds,
// and never preventDefault'ed, so a press that doesn't move 6 px stays a click and opens the task.
// One session at a time (dragSession.js); a press while one settles is ignored, and any press
// ends a keyboard move. The click the browser sends after a drag, or after a cancel while the
// button was still down, is swallowed once. usePointerDrag.js is the React wiring around this.
import { LIMITS } from '@/lib/motion/tokens';
import { browserEnv, createDragSession } from './dragSession';

/** Controls a press on them doesn't start a drag from, but for the grip and the card's title. */
export const NO_DRAG =
  'button, a, input, textarea, select, label, summary, [role="menuitem"], [contenteditable], [data-no-drag]';
const LIFTS_ANYWAY = '[data-grip], [data-card-title]';
const OPEN_CARD = '[data-flip^="card:"][data-open]';

/** The task id of a card element (`data-flip="card:12"`). */
export const taskIdOf = (card) => Number(String(card?.dataset?.flip ?? '').slice(5)) || null;

/** True while a window is open (presses can't reach the board then anyway). */
const windowOpen = (doc) => Boolean(doc?.querySelector?.('[aria-modal="true"]'));

/**
 * The card a press may lift, or null (then the press stays a click).
 * @param {PointerEvent} event
 * @param {{ board: HTMLElement, ctx: object, doc: Document }} where
 * @returns {HTMLElement | null}
 */
export function pressTarget(event, { board, ctx, doc }) {
  if (!ctx?.enabled || !event.isPrimary || event.button !== 0) return null;
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (!(board.clientWidth > 640) || windowOpen(doc)) return null;
  const card = event.target?.closest?.(OPEN_CARD);
  if (!card || !board.contains(card) || !card.closest('[data-column]')) return null;
  const control = event.target.closest(NO_DRAG);
  if (control && card.contains(control) && !control.closest(LIFTS_ANYWAY)) return null;
  const task = ctx.findTask?.(taskIdOf(card));
  if (!task || task.status === 'done') return null;
  if (ctx.isBusy?.(task) || card.querySelector('[role="progressbar"]')) return null; // files going up
  return card;
}

function swallowClick(env) {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  env.win.addEventListener('click', stop, { capture: true, once: true });
  env.later(() => env.win.removeEventListener('click', stop, true), 0);
}

function startSession(c, { card, mode, start, pointerId, point, grip }) {
  const ctx = c.context();
  const task = ctx?.findTask?.(taskIdOf(card));
  if (!task) return;
  c.session = createDragSession({
    board: c.board,
    card,
    task,
    mode,
    start,
    pointerId,
    point,
    grip,
    columnsOf: () => c.context()?.columnsOf?.() ?? [],
    findTask: (id) => c.context()?.findTask?.(id) ?? null,
    onDrop: (dropped, key, how) => c.context()?.onDrop?.(dropped, key, how),
    say: (text) => c.context()?.say?.(text),
    onEnd: (how) => ended(c, how),
    env: c.env,
  });
}

function ended(c, how) {
  if (how?.cancelled && how.pointerDown) c.swallowPointer = c.session?.pointerId ?? null;
  c.endedBy = how?.cause ?? null; // the press that ended a keyboard move lifts nothing
  c.session = null;
}

function endPress(c) {
  c.press = null;
  for (const off of c.pressOff.splice(0)) off();
}

function onPressMove(c, event) {
  const press = c.press;
  if (!press || event.pointerId !== press.pointerId) return;
  if (event.buttons === 0) return endPress(c); // released outside the window
  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  if (moved < LIMITS.dragThreshold) return;
  endPress(c);
  const point = { x: event.clientX, y: event.clientY };
  startSession(c, {
    card: press.card,
    mode: 'pointer',
    start: press,
    pointerId: press.pointerId,
    point,
  });
}

function onPointerDown(c, event) {
  if (c.session?.mode === 'keyboard' && c.session.state === 'lifted') {
    c.session.cancel({ instant: true }); // any press ends a keyboard move; it never starts a drag
    return;
  }
  if (event === c.endedBy) return; // the session's own listener ended the move with this press
  if (c.session || c.press) return;
  const card = pressTarget(event, { board: c.board, ctx: c.context(), doc: c.env.doc });
  if (!card) return;
  c.press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, card };
  const on = (type, handler) => {
    c.env.win.addEventListener(type, handler, true);
    c.pressOff.push(() => c.env.win.removeEventListener(type, handler, true));
  };
  on('pointermove', (move) => onPressMove(c, move));
  on('pointerup', (up) => up.pointerId === c.press?.pointerId && endPress(c));
  on('pointercancel', (up) => up.pointerId === c.press?.pointerId && endPress(c));
}

/** The pointer of a cancelled drag: its pointerup and the click after it open nothing. */
function onAnyPointerUp(c, event) {
  if (c.swallowPointer === null || event.pointerId !== c.swallowPointer) return;
  c.swallowPointer = null;
  swallowClick(c.env);
}

function liftFromGrip(c, task, event) {
  const ctx = c.context();
  if (!ctx?.enabled || c.session || !(c.board.clientWidth > 640)) return;
  const grip = event.currentTarget;
  const card = grip.closest?.(OPEN_CARD);
  if (!card || !c.board.contains(card) || ctx.isBusy?.(task)) return;
  startSession(c, { card, mode: 'keyboard', grip });
}

/** The grip's props (C3 spreads them on the grip button; merge `className` with its own). */
function gripProps(c, task) {
  return {
    'data-grip': '',
    'aria-describedby': 'move-help',
    className: c.env.classes.grip,
    onKeyDown(event) {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (event.repeat) return;
      c.flagKey();
      liftFromGrip(c, task, event);
    },
    onClick() {
      // the click a lifting or dropping key causes, or one after a drag, opens nothing
      if (c.keyFlag || c.session) return;
      c.context()?.askMove?.(task);
    },
  };
}

function listenBoard(c) {
  const { board, env } = c;
  const handlers = [
    [board, 'pointerdown', (event) => onPointerDown(c, event), false],
    [
      board,
      'dragstart',
      (event) => event.target?.closest?.('[data-flip^="card:"]') && event.preventDefault(),
      false,
    ],
    [env.win, 'pointerup', (event) => onAnyPointerUp(c, event), true],
    [
      env.doc,
      'keyup',
      (event) => (event.key === ' ' || event.key === 'Enter') && c.clearFlag(),
      true,
    ],
  ];
  for (const [target, type, handler, captureIt] of handlers) {
    target?.addEventListener(type, handler, captureIt);
    c.off.push(() => target?.removeEventListener(type, handler, captureIt));
  }
}

/**
 * @param {{ board: HTMLElement, context: () => { enabled: boolean, findTask: Function,
 *   columnsOf: Function, onDrop: Function, say?: Function, askMove?: Function,
 *   isBusy?: Function }, env?: object }} options context: read fresh at every event
 * @returns {{ board: HTMLElement, relayout: () => void, destroy: () => void,
 *   gripProps: (task: object) => object, readonly session: object | null }}
 */
export function createDragController({ board, context, env: overrides }) {
  const env = browserEnv(overrides);
  const c = { board, context, press: null, session: null, swallowPointer: null, keyFlag: false };
  c.off = [];
  c.pressOff = [];
  c.flagKey = () => (c.keyFlag = true);
  c.clearFlag = () => c.keyFlag && env.later(() => (c.keyFlag = false), 0);
  c.env = { ...env, swallowClick: () => swallowClick(env), flagKey: c.flagKey };
  listenBoard(c);
  return {
    board,
    relayout: () => c.session?.relayout(),
    destroy() {
      endPress(c);
      c.session?.destroy();
      c.session = null;
      for (const off of c.off.splice(0)) off();
    },
    gripProps: (task) => gripProps(c, task),
    get session() {
      return c.session;
    },
  };
}
