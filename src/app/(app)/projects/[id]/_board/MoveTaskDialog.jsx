'use client';
// "Move Fix the login page" (CONTRACT 27, Moving a card): the single-click way to move a card, from
// its "⋯" (keyboard, screen readers and phones). The six phases in order as 44 px buttons with
// their counts; the card's own phase reads "Development (here now)" and can't be picked. A 400 px
// Dialog (a bottom sheet on a phone). Choosing a phase closes it and moves the card.
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import windowStyles from '../projectWindows.module.css';
import { moveTargets } from './boardMoves';
import styles from './MoveTaskDialog.module.css';

/**
 * @param {{ task: object | null, counts: Record<string, { total: number, done: number }>,
 *   onMove: (task: object, phase: string) => void, onClose: () => void }} props task: the card
 *   to move, or null when the dialog is closed; counts: every task per phase
 */
export default function MoveTaskDialog({ task, counts, onMove, onClose }) {
  if (!task) return null;
  const rows = moveTargets(task, counts);
  const first = rows.find((row) => !row.here)?.key;
  return (
    <Dialog
      open
      width={400}
      className={windowStyles.window}
      title={`Move ${task.title}`}
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
                if (!row.here) onMove(task, row.key);
              }}
            >
              <span>{row.label}</span>
              <span className={styles.count}>{row.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
