'use client';
// One task card on the Board (CONTRACT 27, Cards). Line one: the round tick (the project's PM and
// Admins) or a status dot, the title (a button that opens the task window) and the "⋯" menu. Line
// two: the latest report on an open task. Line three: who it is for, the due date, the priority and
// the paperclip with its count. A click anywhere else on the card opens the task window too. The PM
// can drag an open card to another phase and drop files on any card.
import { Paperclip, Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import PriorityTag from '@/components/PriorityTag';
import { plural } from '@/lib/text';
import DueTag from '../DueTag';
import TaskCheck from '../TaskCheck';
import CardMenu from './CardMenu';
import { cardId, cardTitleId, reportLine } from './boardView';
import styles from './TaskCard.module.css';
import tickStyles from './TaskTick.module.css';

/** Who the card is for: the avatar (PM view) or "For you" / "Anyone" (a member's board). */
function Owner({ assignee, member }) {
  if (member) {
    return assignee ? (
      <span className={styles.owner}>For you</span>
    ) : (
      <span className={styles.owner}>
        <AnyoneCircle />
        Anyone
      </span>
    );
  }
  if (!assignee) {
    return (
      <span className={styles.owner} title="Anyone on the project">
        <AnyoneCircle />
        <span className="visually-hidden">Anyone on the project</span>
      </span>
    );
  }
  return (
    <span className={styles.owner}>
      <Avatar
        user={assignee}
        size={24}
        title={assignee.name}
        className={assignee.away ? styles.away : undefined}
      />
      <span className="visually-hidden">{assignee.name}</span>
      {assignee.away ? <span className={styles.awayText}>{assignee.away}</span> : null}
    </span>
  );
}

function AnyoneCircle() {
  return (
    <span className={styles.anyone} aria-hidden="true">
      <Users size={12} strokeWidth={1.8} />
    </span>
  );
}

/** The files on the card: "2 files", never shown at 0. */
function Clip({ count }) {
  if (!(count > 0)) return null;
  const words = `${count} ${plural(count, 'file')}`;
  return (
    <span className={styles.clip} role="img" aria-label={words} title={words}>
      <Paperclip size={14} strokeWidth={1.8} aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

/** "Adding 2 files…" with its bar, while files dropped on the card go up. */
function Adding({ batch, title }) {
  if (!batch?.busy) return null;
  const percent = Math.max(0, Math.min(100, Math.round(batch.percent ?? 0)));
  return (
    <div className={styles.adding}>
      <span>
        Adding {batch.count} {plural(batch.count, 'file')}…
      </span>
      <span
        className={styles.bar}
        role="progressbar"
        aria-label={`Adding files to ${title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className={styles.barFill} style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

const fromControl = (event) =>
  event.target instanceof Element &&
  Boolean(event.target.closest('button, a, input, label, [role="menu"], [role="menuitem"]'));

/** Line one: the tick (PM and Admins) or the status dot, the title button and the "⋯" menu. */
function CardTop({ task, board, done, manage }) {
  return (
    <div className={styles.top}>
      {manage ? (
        <TaskCheck taskId={task.id} title={task.title} done={done} className={tickStyles.tick} />
      ) : (
        <span
          className={`${tickStyles.dot} ${done ? tickStyles.dotDone : ''}`}
          role="img"
          aria-label={done ? 'Done' : 'Open'}
        />
      )}
      <button
        type="button"
        id={cardTitleId(task.id)}
        className={styles.title}
        onClick={(event) => board.openTask(task, event.currentTarget)}
      >
        {task.title}
      </button>
      {manage ? <CardMenu task={task} board={board} className={styles.more} /> : null}
    </div>
  );
}

/** The card's classes for done, dimmed by the pressed pill, highlighted after a save, lifted. */
const cardClasses = ({ done, dimmed, highlighted, lifted }) =>
  [
    styles.card,
    done ? styles.done : null,
    dimmed ? styles.dim : null,
    highlighted ? styles.highlight : null,
    lifted ? styles.lift : null,
  ]
    .filter(Boolean)
    .join(' ');

/**
 * @param {{ task: object, board: object, dimmed?: boolean, highlighted?: boolean,
 *   lifted?: boolean, drag?: object, fileDrop?: object }} props task: a board row
 *   (phasesView.toBoardTask); board: useBoard's shared values and actions; drag: the card's
 *   drag handlers (useBoardDrag), none when it can't be dragged; fileDrop: its file drop
 *   handlers and whether files are over it (useCardFileDrop)
 */
export default function TaskCard({ task, board, dimmed, highlighted, lifted, drag, fileDrop }) {
  const done = task.status === 'done';
  const manage = board.access === 'manage';
  const report = reportLine(task);
  const batch = board.batchFor?.(task.id) ?? null;
  return (
    <li
      id={cardId(task.id)}
      className={cardClasses({ done, dimmed, highlighted, lifted })}
      onClick={(event) => {
        if (!fromControl(event)) board.openTask(task, event.currentTarget);
      }}
      {...drag}
      {...fileDrop?.handlers}
    >
      <CardTop task={task} board={board} done={done} manage={manage} />
      {report ? (
        <p
          className={`${styles.report} ${report.tone === 'red' ? styles.reportRed : styles.reportPrimary}`}
        >
          {report.text}
        </p>
      ) : null}
      <div className={styles.meta}>
        <Owner assignee={task.assignee} member={board.access === 'member'} />
        <DueTag dueDate={task.dueDate} today={board.today} done={done} />
        <PriorityTag priority={task.priority} />
        {board.showFiles ? <Clip count={task.fileCount} /> : null}
      </div>
      <Adding batch={batch} title={task.title} />
      {fileDrop?.over ? (
        <div className={styles.dropOverlay}>
          <Paperclip size={16} strokeWidth={1.8} aria-hidden="true" />
          Drop to attach
        </div>
      ) : null}
    </li>
  );
}
