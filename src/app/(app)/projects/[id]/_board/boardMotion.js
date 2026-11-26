// The board's moments (CONTRACT 28, Motion, Moments; motion.md 1.4 and 3): a card gliding to its
// new column (Move to phase…, the task window, Undo), a ticked card leaving for its fold, a face
// swap, a new card rising in once the refresh draws it, the Done phases rail widening. Each one
// measures, commits the change with flushSync, then plays; over 150 cards, in a hidden tab or with
// reduce motion the change shows at once with the flash. Only from handlers, animation callbacks
// and timers (rule 8).
import { flushSync } from 'react-dom';
import { DUR, EASE, LIMITS, duration } from '@/lib/motion/tokens';
import { done, flash, play } from '@/lib/motion/animate';
import { flipFrom, measure, tooManyToFlip } from '@/lib/motion/flip';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';

/** What moves with a card: the cards and the items after each column's list. */
export const MOVING = '[data-flip^="card:"], [data-follow]';

const cardIn = (root, taskId) => root?.querySelector?.(`[data-flip="card:${taskId}"]`) ?? null;
const columnIn = (root, key) => root?.querySelector?.(`[data-column="${key}"]`) ?? null;
const boardOf = (root) =>
  root?.matches?.('[data-board]') ? root : root?.querySelector?.('[data-board]');

/** The moving items of these columns (or of the whole root when a column isn't known). */
export const movingIn = (scopes) =>
  scopes.filter(Boolean).flatMap((el) => [...el.querySelectorAll(MOVING)]);

/** True when a box is drawn inside the board's view (and the window's). */
function inBoardView(root, box) {
  const board = boardOf(root);
  if (!box || !board || !(box.width > 0)) return false;
  const view = board.getBoundingClientRect();
  const height = globalThis.innerHeight ?? Infinity;
  const right = box.left + box.width; // a measured box has no right or bottom
  const bottom = box.top + (box.height ?? 0);
  return box.left >= view.left - 2 && right <= view.right + 2 && bottom > 0 && box.top < height;
}

/**
 * A card moved by "Move to phase…", the task window or Undo: it glides from its old place to its
 * new column (a fixed clone), the old column closes up, the new one makes room, then it flashes.
 * When the start or the end is out of the board's view there is no glide: the board scrolls to
 * the column and the card flashes.
 * @param {Element | null} root the board (or anything holding its columns)
 * @param {number} taskId
 * @param {() => void} change commits the move (the optimistic phase)
 * @param {{ scroll?: { show?: (key: string) => void }, to?: string | null }} [options] to: the
 *   column it goes to ('none' for No phase yet), so only the two columns are measured
 * @returns {Promise<void>}
 */
export async function glideMove(root, taskId, change, { scroll, to } = {}) {
  const card = cardIn(root, taskId);
  const fromColumn = card?.closest?.('[data-column]') ?? null;
  const target = to === undefined || to === null ? null : columnIn(root, to);
  if (!card || tooManyToFlip(root)) {
    flushSync(change);
    settleAfter(root, taskId, scroll, to);
    return;
  }
  const scopes = target ? [fromColumn, target] : [root];
  const first = measure(movingIn(scopes));
  const start = first.get(`card:${taskId}`);
  flushSync(change);
  const moved = cardIn(root, taskId);
  const end = moved?.getBoundingClientRect();
  const skip = new Set([`card:${taskId}`]);
  if (!moved || !inBoardView(root, start) || !inBoardView(root, end)) {
    flipFrom(first, movingIn(scopes), { skip });
    settleAfter(root, taskId, scroll, to);
    return;
  }
  const animations = flipFrom(first, movingIn(scopes), { moved: `card:${taskId}` });
  await Promise.all(animations.map(done));
}

/** No glide: bring the column into view and flash the card there. */
function settleAfter(root, taskId, scroll, to) {
  if (to !== undefined && to !== null) scroll?.show?.(to);
  flash(cardIn(root, taskId));
}

/**
 * A ticked card: after 600 ms (cancel it to untick) it fades out, then `onLeave` moves it into
 * its column's "› 6 done" (the caller FLIPs that). With reduce motion it leaves at once.
 * @param {Element | null} card
 * @param {{ onLeave?: () => void, undoRef?: { current: unknown }, wait?: number }} [options]
 *   undoRef: given the cancel, so an Undo can stop a leave still waiting
 * @returns {() => void} cancel (no card is ever left invisible in the open list)
 */
export function tickLeave(card, { onLeave, undoRef, wait = LIMITS.tickWait } = {}) {
  let timer = null;
  let fade = null;
  let over = false;
  const leave = () => {
    if (over) return;
    over = true;
    onLeave?.();
    fade?.cancel(); // the same task as the change that takes the card out of the list
  };
  const cancel = () => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    fade?.cancel();
    if (undoRef?.current === cancel) undoRef.current = null;
  };
  if (undoRef) undoRef.current = cancel;
  if (!card || prefersReducedMotion()) {
    leave();
    return cancel;
  }
  timer = setTimeout(() => {
    fade = play(card, [{ opacity: 0 }], {
      duration: duration('out'),
      easing: EASE.accelerate,
      fill: 'forwards',
      id: 'tick-leave',
    });
    done(fade).then((finished) => finished && leave());
  }, wait);
  return cancel;
}

/**
 * The person changes: the old face fades out, the change commits, the new face fades in from
 * scale(0.92) (a fade only with reduce motion), then the card flashes.
 * @param {Element | null} card
 * @param {() => void} change
 * @returns {Promise<void>}
 */
export async function swapFace(card, change) {
  const old = [...(card?.querySelectorAll?.('[data-face]') ?? [])];
  const outs = old
    .map((el) =>
      play(el, [{ opacity: 1 }, { opacity: 0 }], {
        duration: DUR.fade,
        easing: EASE.decelerate,
        fill: 'forwards',
        id: 'face-out',
      }),
    )
    .filter(Boolean);
  await Promise.all(outs.map(done));
  flushSync(change);
  for (const out of outs) out.cancel(); // the same task as the change
  for (const el of card?.querySelectorAll?.('[data-face]') ?? []) {
    play(
      el,
      [
        { opacity: 0, transform: 'scale(0.92)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: duration('tag'),
        easing: EASE.decelerate,
        id: 'face-in',
      },
    );
  }
  flash(card);
}

/**
 * Fades an element in from 8 px below after the others made room (`--dur-room`), then flashes
 * it. With reduce motion: the fade and the flash.
 * @param {Element | null} el
 * @returns {Animation | null}
 */
export function riseIn(el) {
  if (!el) return null;
  const rise = play(
    el,
    [
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: duration('tag'),
      easing: EASE.decelerate,
      delay: duration('room'),
      fill: 'backwards',
      id: 'rise-in',
    },
  );
  done(rise).then(() => flash(el));
  return rise;
}

/**
 * A new card from quick add or New task: the column's other cards make room and it rises in, in
 * the first commit that draws it. A refresh slower than 2 s simply shows it with the flash.
 * @param {{ expect: (request: object) => void }} motion useCommitMotion's queue
 * @param {Element | null} root
 * @param {string} columnKey
 * @param {number} taskId
 */
export function expectNewCard(motion, root, columnKey, taskId) {
  const column = columnIn(root, columnKey);
  if (!motion || !column) return;
  const first = measure(movingIn([column]), { relative: true });
  const asked = globalThis.performance?.now?.() ?? Date.now();
  const key = `card:${taskId}`;
  motion.expect({
    id: `enter:${taskId}`,
    maxAgeMs: LIMITS.newCardWait * 5,
    ready: (r) => Boolean(cardIn(r, taskId)),
    play(r) {
      const late = (globalThis.performance?.now?.() ?? Date.now()) - asked > LIMITS.newCardWait;
      if (late || tooManyToFlip(r)) return void flash(cardIn(r, taskId));
      flipFrom(first, movingIn([columnIn(r, columnKey)]), {
        onEnter: (el) => (el.dataset.flip === key ? riseIn(el) : null),
      });
    },
  });
}

/**
 * The Done phases rail opens or folds: its box scales from its old width (the box only, so the
 * text is never squashed), the columns slide, the tiles fade in (60 ms later).
 * @param {Element | null} board
 * @param {() => void} change
 * @returns {Promise<void>}
 */
export async function railFlip(board, change) {
  if (!board || tooManyToFlip(board)) {
    flushSync(change);
    return;
  }
  const columns = () => board.querySelectorAll('[data-flip^="col:"]');
  const first = measure(columns());
  const was = board.querySelector('[data-flip="rail"]')?.getBoundingClientRect().width ?? 0;
  flushSync(change);
  const rail = board.querySelector('[data-flip="rail"]');
  const now = rail?.getBoundingClientRect().width ?? 0;
  const animations = flipFrom(first, columns());
  if (rail && was > 0 && now > 0 && Math.abs(was - now) > 0.5) {
    const box = rail.querySelector('[data-rail-box]');
    animations.push(
      play(box, [{ transform: `scaleX(${was / now})` }, { transform: 'none' }], {
        duration: DUR.room,
        easing: EASE.standard,
        id: 'rail',
      }),
    );
  }
  if (now > was) {
    for (const tile of rail?.querySelectorAll('li') ?? []) {
      play(tile, [{ opacity: 0 }, { opacity: 1 }], {
        duration: duration('in'),
        easing: EASE.decelerate,
        delay: 60,
        fill: 'backwards',
        id: 'rail-tile',
      });
    }
  }
  await Promise.all(animations.filter(Boolean).map(done));
}
