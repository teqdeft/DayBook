'use client';
// "Move Fix the login page" / "Move 2 tasks" (CONTRACT 28, The people window, Move to phase…): the
// single-click way to move cards, from a card's "⋯", the grip's click, the task window and the
// Table's bulk bar (keyboard, screen readers, voice and phones). The six phases in order as 44 px
// buttons with their counts; the phase every task is in already reads "Development (here now)" and
// can't be picked. A 400 px Dialog (a bottom sheet on a phone). Choosing a phase closes it and moves
// the cards. TaskActionsProvider renders it; until the Board stops rendering its own, the 1.12 `task`
// prop still works as `tasks: [task]` (and its onMove gets the task first).
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';
import windowStyles from '../projectWindows.module.css';
import { columnOf, countText } from './bandView';
import styles from './MoveTaskDialog.module.css';

/**
 * The dialog's rows: each phase with its count; "(here now)" only when every task is in it.
 * @param {Array<{ phase: string | null }>} tasks
 * @param {Record<string, { total: number, done: number }> | null | undefined} counts every task
 *   per phase; without it the rows show no count
 * @returns {Array<{ key: string, label: string, count: string | null, here: boolean }>}
 */
export function moveRows(tasks, counts) {
  return PROJECT_PHASES.map(({ key, label }) => {
    const here = tasks.length > 0 && tasks.every((task) => columnOf(task) === key);
    return {
      key,
      label: here ? `${label} (here now)` : label,
      count: counts ? countText(counts[key]) : null,
      here,
    };
  });
}

/** "Move Fix the login page" for one task, "Move 2 tasks" for several. */
export const moveTitle = (tasks) =>
  tasks.length === 1 ? `Move ${tasks[0].title}` : `Move ${tasks.length} tasks`;

/**
 * @param {{ tasks?: object[] | null, task?: object | null,
 *   counts?: Record<string, { total: number, done: number }> | null, open?: boolean,
 *   onMove: (to: string) => void, onClose: () => void }} props tasks: the cards to move, null when
 *   closed; task: 1.12's one card (then onMove gets `(task, to)`); counts: every task per phase;
 *   open: false while the window plays its exit
 */
export default function MoveTaskDialog({ tasks, task, counts, open = true, onMove, onClose }) {
  const list = tasks ?? (task ? [task] : null);
  if (!list || list.length === 0) return null;
  const rows = moveRows(list, counts);
  const first = rows.find((row) => !row.here)?.key;
  const move = (to) => (tasks ? onMove(to) : onMove(task, to));
  return (
    <Dialog
      open={open}
      width={400}
      className={`${windowStyles.window} ${styles.sheet}`}
      title={moveTitle(list)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              className={styles.target}
              aria-disabled={row.here || undefined}
              data-autofocus={row.key === first ? '' : undefined}
              onClick={() => {
                if (!row.here) move(row.key);
              }}
            >
              <span>{row.label}</span>
              {row.count ? <span className={styles.count}>{row.count}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
