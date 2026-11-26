// What the move region says (CONTRACT 28, Motion, Keyboard move and the live region: Words).
// Pure. Positions count from 1; a phase is named (a phase key is turned into its name, and a card
// with no phase is "No phase yet"). `mode` is 'keyboard' or 'pointer': the pointer's lines are
// shorter, since the person sees where the card goes.
import { isPhase, phaseLabel } from '@/modules/projectPlan/phases';
import { positionText } from './sortedGap';

/** The hidden help every grip points at (`aria-describedby="move-help"`). */
export const MOVE_HELP =
  'Press Space to pick up. Use the Left and Right arrow keys to choose a phase. Press Space to drop or Escape to cancel.';

/** A phase key or name as people read it; null or 'none' is "No phase yet". */
export const nameOf = (phase) => {
  if (phase === null || phase === undefined || phase === 'none') return 'No phase yet';
  return isPhase(phase) ? phaseLabel(phase) : String(phase);
};

/** "Picked up …, in Development. Use the Left and Right arrow keys …" / "Picked up …." */
export function liftText(title, from, mode) {
  if (mode !== 'keyboard') return `Picked up ${title}.`;
  return `Picked up ${title}, in ${nameOf(from)}. Use the Left and Right arrow keys to choose a phase, Space to drop, Escape to cancel.`;
}

/**
 * "Over Testing. It goes in at 2 of 6." / "Over Testing.": `index` is the gap's place (from 0)
 * among the target's `count` open cards.
 */
export function overText(phase, index, count, mode) {
  if (mode !== 'keyboard') return `Over ${nameOf(phase)}.`;
  return `Over ${nameOf(phase)}. It goes in at ${positionText(index, count)}.`;
}

/** "Back in Development." */
export function backText(from) {
  return `Back in ${nameOf(from)}.`;
}

/** "Moved … to Testing from Development." */
export function dropText(title, to, from) {
  return `Moved ${title} to ${nameOf(to)} from ${nameOf(from)}.`;
}

/** "… stays in Development." */
export function stayText(title, from) {
  return `${title} stays in ${nameOf(from)}.`;
}

/** "Move cancelled. … is back in Development." */
export function cancelText(title, from) {
  return `Move cancelled. ${title} is back in ${nameOf(from)}.`;
}

/** Up or Down while a card is lifted. */
export function sortedText() {
  return 'Cards are sorted by priority, so it goes in its place.';
}

/** The dragged task was moved or deleted meanwhile. */
export function goneText() {
  return 'Move cancelled.';
}
