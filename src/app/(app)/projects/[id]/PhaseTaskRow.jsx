'use client';
// One task on the Phases tab (CONTRACT 22), as the prototype draws it: the box, the title, its owner,
// due date and priority, then Edit and Delete. Under the title: the details as a muted line and the
// latest reported status ("Neha, yesterday: In progress"), which helps the PM decide to tick it;
// under the owner: why they can't work on it any more. Only the PM and Admin get the box and buttons.
import { useId, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import IconButton from '@/components/IconButton';
import PriorityTag from '@/components/PriorityTag';
import DueTag from './DueTag';
import TaskCheck from './TaskCheck';
import styles from './PhaseTasks.module.css';

// Details longer than this start folded to two lines.
const LONG_DETAILS = 140;

function Details({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text) return null;
  const long = text.length > LONG_DETAILS;
  return (
    <>
      <span id={id} className={`${styles.details} ${long && !open ? styles.folded : ''}`}>
        {text}
      </span>
      {long ? (
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function Owner({ assignee }) {
  return (
    <span className={styles.owner}>
      <span className="visually-hidden">Owner: </span>
      <span className={assignee ? styles.ownerName : styles.anyone}>
        {assignee?.name ?? 'Anyone on the project'}
      </span>
      {assignee?.away ? <span className={styles.away}>{assignee.away}</span> : null}
    </span>
  );
}

/** The ids the board moves focus to: this row's Edit and Delete buttons. */
export const taskButtonId = (taskId, action) => `phases-task-${taskId}-${action}`;

/**
 * @param {{ task: object, today: string, canManage: boolean, onEdit: () => void,
 *   onDelete: (event: import('react').MouseEvent) => void }} props task: a board row
 *   (phasesView.toBoardTask)
 */
export default function PhaseTaskRow({ task, today, canManage, onEdit, onDelete }) {
  const done = task.status === 'done';
  return (
    <li className={styles.row}>
      <div className={styles.taskCell}>
        {canManage ? <TaskCheck taskId={task.id} title={task.title} done={done} /> : null}
        <div className={styles.taskText}>
          <span className={done ? `${styles.title} ${styles.titleDone}` : styles.title}>
            {task.title}
          </span>
          <Details text={task.details} />
          {!done && task.latest ? (
            <span
              className={`${styles.latest} ${task.latestStatus === 'blocked' ? styles.blocked : ''}`}
            >
              <span className="visually-hidden">Latest report: </span>
              {task.latest}
            </span>
          ) : null}
        </div>
      </div>
      <Owner assignee={task.assignee} />
      <span className={styles.cell}>
        <DueTag dueDate={task.dueDate} today={today} done={done} />
      </span>
      <span className={styles.cell}>
        <PriorityTag priority={task.priority} size="md" />
      </span>
      {canManage ? (
        <span className={styles.actions}>
          <IconButton
            variant="ghost"
            id={taskButtonId(task.id, 'edit')}
            className={styles.iconButton}
            label={`Edit task: ${task.title}`}
            icon={<Pencil size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onEdit}
          />
          <IconButton
            variant="ghost"
            id={taskButtonId(task.id, 'delete')}
            className={styles.iconButton}
            label={`Delete task: ${task.title}`}
            icon={<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onDelete}
          />
        </span>
      ) : null}
    </li>
  );
}
