'use client';
// The Board's tasks and columns as the viewer sees them right now (CONTRACT 27 and 28): the page's
// tasks with the moves on their way, the persons just given (Assign to me, the people window), the
// ticked cards still playing their leave, and without the ones waiting to be deleted; then the
// columns, the rail's tiles, the band's counts and whether the board fills the window. React owns
// this structure; the motion only plays on it.
import { useMemo, useState } from 'react';
import { countByPhase } from './bandView';
import { boardColumns, fillsWindow, phoneSteps } from './boardView';

/**
 * The tasks shown: the page's, then the moves on their way (useCardMoves), the persons just given
 * (useTaskActions' apply), the ticked cards held in their open list (useTickLeave's apply),
 * without the ones whose delete waits on Undo (the editor's).
 */
export function shownTasks({ moves, actions, leave, editor }) {
  const moved = moves.tasks;
  const given = actions ? actions.apply(moved) : moved;
  const held = leave.apply(given);
  return held.filter((task) => !editor?.isHidden(task.id));
}

/**
 * Whether the toolbar and the board take the window's height (data-fill), after a render: worked
 * out on load and on each switch back from the Table; once on it stays on for the visit, so the
 * viewer's own drop, move, tick or delete never makes the page jump under the running motion.
 * Never for the Table.
 * @param {{ view: string, fill: boolean }} before the last render's
 * @param {{ view: 'board' | 'table', wants: boolean }} now wants: a shown column has 4 or more
 *   cards (boardView.fillsWindow)
 * @returns {{ view: string, fill: boolean }}
 */
export function fillAfter(before, { view, wants }) {
  if (before.view !== view) return { view, fill: view === 'board' && wants };
  return { view, fill: view === 'board' && (before.fill || wants) };
}

function useFill(columns, isFoldOpen, view) {
  const wants = fillsWindow(columns, isFoldOpen);
  const [before, setBefore] = useState(() => fillAfter({ view, fill: false }, { view, wants }));
  const now = fillAfter(before, { view, wants });
  if (now.fill !== before.fill || now.view !== before.view) setBefore(now);
  return now.fill;
}

/**
 * @param {{ props: object, plan: object, tasks: object[], opened: string[],
 *   isFoldOpen: (column: object) => boolean, view: 'board' | 'table', status: string }} args
 *   plan: as shown (a phase move shows at once); tasks: shownTasks'; status: the project's as
 *   shown (Reopen changes it at once)
 * @returns {{ tiles: object[], columns: object[], counts: object, fill: boolean,
 *   steps: string[], columnArgs: object }} counts: every task per phase for the band (a
 *   member's from the server, which counts the tasks they can't see); columnArgs: boardColumns'
 *   arguments but the plan (a phase move works out its folds with them)
 */
export function useBoardData({ props, plan, tasks, opened, isFoldOpen, view, status }) {
  const member = props.access === 'member';
  const completed = status === 'completed';
  const { tiles, columns } = useMemo(
    () => boardColumns({ plan, tasks, member, today: props.today, opened, completed }),
    [plan, tasks, member, props.today, opened, completed],
  );
  const counts = useMemo(
    () => (member ? props.counts : countByPhase(tasks)),
    [member, props.counts, tasks],
  );
  const fill = useFill(columns, isFoldOpen, view);
  const columnArgs = { tasks, member, opened, completed };
  return { tiles, columns, counts, fill, steps: phoneSteps(columns), columnArgs };
}
