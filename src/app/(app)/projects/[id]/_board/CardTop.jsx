// A card's top line (CONTRACT 28, Cards and the card menu): the task number "#34", its P tag and
// the status chip from the newest daily-report line the viewer may see ("In progress", "Blocked",
// "Done", with the line's date in its title and in visually hidden text). A done card has no chip
// (it is folded and ticked), and an open card without a report line has none either. Server-safe.
import PriorityTag from '@/components/PriorityTag';
import Tag from '@/components/Tag';
import { formatDayShort } from '@/lib/time';
import styles from './TaskCard.module.css';

/** The status chip's words and tone by the report line's status. */
export const CHIPS = {
  in_progress: { text: 'In progress', tone: 'primary' },
  blocked: { text: 'Blocked', tone: 'red' },
  done: { text: 'Done', tone: 'green' },
};

/**
 * The chip a card shows, or null: none on a done task, none without a report line.
 * @param {{ status: string, statusChip?: { status: string, workDate: string } | null }} task
 * @returns {{ text: string, tone: string, date: string | null } | null}
 */
export function chipOf(task) {
  const chip = task?.statusChip;
  if (!chip || task.status === 'done') return null;
  const look = CHIPS[chip.status];
  if (!look) return null;
  return { ...look, date: chip.workDate ? formatDayShort(chip.workDate) : null };
}

/** @param {{ task: object }} props task: a board row (phasesView.toBoardTask) */
export default function CardTop({ task }) {
  const chip = chipOf(task);
  return (
    <div className={styles.top}>
      <span className={styles.number}>#{task.id}</span>
      <PriorityTag priority={task.priority} />
      {chip ? (
        <Tag tone={chip.tone} padX={8} title={chip.date ?? undefined}>
          {chip.text}
          {chip.date ? <span className="visually-hidden">, {chip.date}</span> : null}
        </Tag>
      ) : null}
    </div>
  );
}
