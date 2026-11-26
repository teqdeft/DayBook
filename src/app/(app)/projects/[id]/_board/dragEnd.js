// How a held card ends (CONTRACT 28, Motion, Pointer drag: Drop, Cancel and lost pointers): it
// settles into the gap (`min(400, 250 + distance / 1500 × 150)` ms, --ease-settle), then one
// flushSync commits the move, the room and outline go together, the two columns FLIP (the old one
// closes its hole) and the card flashes; or it flies back to its outline in 0.6 of that time. A new
// drag waits while one settles (at most 400 ms). The Board unmounting while it settles commits the
// drop without motion: a drop is never lost.
import { cancelDuration, distanceBetween, dropDuration } from '@/lib/motion/settle';
import { done, flash } from '@/lib/motion/animate';
import { flipFrom, measure, tooManyToFlip } from '@/lib/motion/flip';
import { clearRoom, clearTint, visibleGapRect } from './dragTargets';
import { cancelText, dropText, goneText, stayText } from './moveWords';
// Circular on purpose: dragSession.js imports this file and these are only called later.
import { cardNode, finalHit, setTarget, unlisten, unmarkOutline } from './dragSession';

const MOVING = '[data-flip^="card:"], [data-follow]';

/** Everything that can move in these columns: their cards and the items after their lists. */
const movingIn = (columns) =>
  columns.filter(Boolean).flatMap((el) => [...el.querySelectorAll(MOVING)]);

/** Takes every mark of the drag off the page. */
function clearMarks(s) {
  const { doc, classes } = s.env;
  unmarkOutline(s, s.card);
  doc.documentElement.removeAttribute('data-dragging');
  if (classes.dragging) doc.documentElement.classList.remove(classes.dragging);
  s.board.removeAttribute('data-dragging');
  s.board.style.removeProperty('--drag-room');
}

function stopLoop(s) {
  if (s.raf) s.env.cancelFrame(s.raf);
  if (s.liftFrame) s.env.cancelFrame(s.liftFrame);
  s.raf = null;
  s.liftFrame = null;
}

function release(s) {
  if (s.mode !== 'pointer') return;
  try {
    s.board.releasePointerCapture?.(s.pointerId);
  } catch {
    // already released (pointerup releases it by itself)
  }
}

/** The end of every way out: nothing of the drag is left, the session is idle. */
function finish(s, how = {}) {
  if (s.state === 'idle') return;
  unlisten(s);
  s.preview?.remove();
  clearMarks(s);
  s.state = 'idle';
  s.onEnd?.({ ...how, pointerDown: s.mode === 'pointer' && s.pointerDown });
}

/** Drops the card on the column under it (Space for the keyboard), or flies it back. */
export function dropSession(s) {
  if (s.state !== 'lifted') return;
  if (s.mode === 'pointer') finalHit(s);
  if (!s.target) {
    cancelSession(s, s.mode === 'keyboard' ? { stay: true } : {});
    return;
  }
  s.state = 'settling';
  stopLoop(s);
  release(s);
  s.dropKey = s.target.column.key;
  const gap = visibleGapRect(s.target, s.rowGap, s.size.height);
  const ms = dropDuration(distanceBetween(s.preview.position(), gap), s.env.reduced());
  s.settle = s.preview.settle(gap, ms);
  done(s.settle).then(() => commitDrop(s));
}

/** The move commits in one render, then the columns close up and the card flashes. */
export function commitDrop(s, { still = false } = {}) {
  if (s.committed) return;
  s.committed = true;
  const fromColumn = s.card.closest?.('[data-column]');
  const toColumn = s.target.column.el;
  const quiet = still || tooManyToFlip(s.board);
  const first = quiet ? null : measure(movingIn([fromColumn, toColumn]));
  first?.set(`card:${s.task.id}`, s.preview.position()); // the moved card starts where it was dropped
  const how = { mode: s.mode };
  if (still) s.onDrop(s.task, s.dropKey, how);
  else s.env.flushSync(() => s.onDrop(s.task, s.dropKey, how));
  clearRoom(s.target.column.list, { instant: true });
  clearTint(s.target, s.env.classes.dropOn);
  const to = s.target.column.key;
  s.target = null;
  finish(s, { dropped: to });
  if (still) return;
  if (first) flipFrom(first, movingIn([fromColumn?.isConnected ? fromColumn : null, toColumn]));
  const moved = cardNode(s.board, s.task.id);
  flash(moved);
  s.say(dropText(s.task.title, to, s.fromKey));
  if (s.mode === 'keyboard') moved?.querySelector('[data-grip]')?.focus({ preventScroll: true });
}

/**
 * Flies the card back to its outline (Escape, a drop where it can't go, a lost pointer) or puts
 * it back at once (`instant`: a hidden tab, the task gone meanwhile).
 * @param {object} s
 * @param {{ instant?: boolean, stay?: boolean, gone?: boolean, quiet?: boolean,
 *   cause?: Event | null }} [how] stay: a keyboard drop on its own column ("… stays in
 *   Development."); gone: "Move cancelled."; cause: the press that ended a keyboard move
 */
export function cancelSession(
  s,
  { instant = false, stay = false, gone = false, quiet = false, cause = null } = {},
) {
  if (s.state !== 'lifted') return;
  s.state = 'settling';
  stopLoop(s);
  release(s);
  setTarget(s, null); // the room slides back while it flies
  if (!quiet) s.say(cancelLine(s, { stay, gone }));
  const home = s.card.isConnected === false ? s.preview.position() : s.card.getBoundingClientRect();
  const ms = instant
    ? 0
    : cancelDuration(distanceBetween(s.preview.position(), home), s.env.reduced());
  s.settle = s.preview.settle(home, ms);
  const end = () => {
    finish(s, { cancelled: true, cause });
    if (s.mode === 'keyboard' && s.grip?.isConnected) s.grip.focus({ preventScroll: true });
  };
  if (!s.settle) end();
  else done(s.settle).then(end);
}

function cancelLine(s, { stay, gone }) {
  if (gone) return goneText();
  if (stay) return stayText(s.task.title, s.fromKey);
  return cancelText(s.task.title, s.fromKey);
}

/** A hidden tab while it settles: the settle ends now, so the commit and the save still run. */
export function finishSettle(s) {
  try {
    s.settle?.finish();
  } catch {
    s.settle?.cancel();
  }
  if (!s.settle && s.dropKey) commitDrop(s);
}

/** The Board goes: everything is removed; a drop that was settling still commits, once. */
export function destroySession(s) {
  if (s.state === 'idle') return;
  stopLoop(s);
  s.settle?.cancel();
  if (s.state === 'settling' && s.dropKey && !s.committed) {
    commitDrop(s, { still: true });
    return;
  }
  if (s.target) {
    clearRoom(s.target.column.list, { instant: true });
    clearTint(s.target, s.env.classes.dropOn);
    s.target = null;
  }
  release(s);
  finish(s, { destroyed: true });
}
