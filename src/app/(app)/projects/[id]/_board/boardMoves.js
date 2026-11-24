// Moving a card to another phase (CONTRACT 27, Board tab): which columns take a dropped card, the
// rows of the "Move Fix the login page" dialog, the card moved at once while the request runs
// (optimistic), the toast and its Undo, and where focus goes after. Pure and safe in the browser.
import { PROJECT_PHASES, isPhase, phaseLabel } from '@/modules/projectPlan/phases';
import { NO_PHASE, sortOpenTasks } from '../phasesView';
import { columnOf, countText } from './bandView';

/**
 * True when a dragged card may land on a column: an open card, on another phase's column (an
 * opened done phase included). Done phases, No phase yet and the card's own column never take it.
 * @param {{ status: string, phase: string | null }} task
 * @param {string} columnKey a phase key, NO_PHASE or anything else (Done phases)
 */
export function canDropOn(task, columnKey) {
  if (!task || task.status === 'done') return false;
  return isPhase(columnKey) && columnKey !== columnOf(task);
}

/**
 * The rows of the Move to phase dialog: the six phases in order with their counts; the task's own
 * phase reads "Development (here now)" and can't be picked.
 * @param {{ phase: string | null }} task
 * @param {Record<string, { total: number, done: number }>} counts every task per phase
 * @returns {Array<{ key: string, label: string, count: string, here: boolean }>}
 */
export function moveTargets(task, counts) {
  return PROJECT_PHASES.map(({ key, label }) => {
    const here = columnOf(task) === key;
    return {
      key,
      label: here ? `${label} (here now)` : label,
      count: countText(counts?.[key]),
      here,
    };
  });
}

/**
 * One move, and the move that takes it back.
 * @param {{ id: number, phase: string | null }} task
 * @param {string} to a phase key
 * @returns {{ taskId: number, from: string | null, to: string }}
 */
export function moveOf(task, to) {
  return { taskId: task.id, from: isPhase(task.phase) ? task.phase : null, to };
}

/** The move Undo sends: back to where the card was (null: No phase yet). */
export function undoOf(move) {
  return { taskId: move.taskId, from: move.to, to: move.from };
}

/** 'Moved to Testing.' */
export const movedText = (phase) => `Moved to ${phaseLabel(phase)}.`;

/**
 * The tasks with the moves still on their way shown already.
 * @param {object[]} tasks board rows
 * @param {Map<number, string | null>} moves task id → the phase it is moving to
 */
export function withMoves(tasks, moves) {
  if (!moves || moves.size === 0) return tasks;
  return tasks.map((task) => (moves.has(task.id) ? { ...task, phase: moves.get(task.id) } : task));
}

/**
 * The moves the page's data doesn't show yet: once a refresh brings a task in its new phase, its
 * move is dropped (and a later move by someone else shows as it is).
 * @param {Map<number, string | null>} moves
 * @param {object[]} tasks the page's board rows
 * @returns {Map<number, string | null>} the same Map when nothing changed
 */
export function pendingMoves(moves, tasks) {
  if (!moves || moves.size === 0) return moves;
  const next = new Map(moves);
  for (const task of tasks) {
    if (next.has(task.id) && (task.phase ?? null) === next.get(task.id)) next.delete(task.id);
  }
  return next.size === moves.size ? moves : next;
}

/**
 * Where a dragged card would land among a column's open cards (P1, P2, P3, then due, then title):
 * the dashed gap goes before the card at this index.
 * @param {object[]} openCards the column's open cards, in order
 * @param {object} task the dragged card
 */
export function landingIndex(openCards, task) {
  const others = openCards.filter((card) => card.id !== task.id);
  const sorted = sortOpenTasks([...others, task]);
  return sorted.findIndex((card) => card.id === task.id);
}

/**
 * Where focus goes on a phone after a card leaves the column shown: the next card's title, else
 * the one before, else "+ Add task".
 * @param {object[]} openCards the column's open cards before the move
 * @param {number} taskId the moved card
 * @returns {number | null} the card to focus, null for "+ Add task"
 */
export function nextCardAfter(openCards, taskId) {
  const index = openCards.findIndex((card) => card.id === taskId);
  if (index === -1) return null;
  return openCards[index + 1]?.id ?? openCards[index - 1]?.id ?? null;
}

/** The PATCH body of a move ('No phase yet' is null). */
export function moveBody(move) {
  return { phase: move.to === NO_PHASE ? null : move.to };
}
