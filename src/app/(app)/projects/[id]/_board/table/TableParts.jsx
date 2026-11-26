'use client';
// Small pieces the Table's rows and the phone's stacked list share (CONTRACT 28, Table and bulk
// bar): the select box (18 px in a 44 px target, "Select Payment settings page"), the task number
// "#9", the Status column's chip ("In progress", "Blocked", "Done", or the muted "To do"), the
// paperclip with the file count (nothing at 0), and the person: for the project's PM and Admins a
// button with the full name that opens the people window ("Assigned to Simran Kaur. Change
// person"), for another PM the face and name, for a member "For you" or "Anyone".
import { ChevronDown, Paperclip } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Tag from '@/components/Tag';
import { plural } from '@/lib/text';
import { AnyoneCircle, faceLabel } from '../CardFace';
import { filesOf, statusText } from './tableView';
import styles from './TableParts.module.css';

/** "Select Payment settings page": a done row's box can't be ticked. */
export function SelectBox({ task, checked, onToggle, className }) {
  const done = task.status === 'done';
  return (
    <label className={[styles.select, className].filter(Boolean).join(' ')}>
      <input
        type="checkbox"
        aria-label={`Select ${task.title}`}
        checked={checked}
        disabled={done}
        onChange={(event) => onToggle(task.id, event.target.checked)}
      />
    </label>
  );
}

/** "#9" */
export function TaskNumber({ id }) {
  return <span className={styles.number}>#{id}</span>;
}

/** The Status column: a chip (with the line's date in its title), else the muted "To do". */
export function StatusChip({ task }) {
  const status = statusText(task);
  if (!status.tone) return <span className={styles.todo}>{status.text}</span>;
  return (
    <Tag tone={status.tone} padX={8} title={status.date ?? undefined}>
      {status.text}
      {status.date ? <span className="visually-hidden">, {status.date}</span> : null}
    </Tag>
  );
}

/** The paperclip and the number of files the viewer may see on it; nothing at 0. */
export function FilesCount({ task }) {
  const count = filesOf(task);
  if (!count) return null;
  const words = `${count} ${plural(count, 'file')}`;
  return (
    <span className={styles.clip} title={words}>
      <Paperclip size={14} strokeWidth={1.8} aria-hidden="true" />
      <span className="visually-hidden">{words}</span>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

/** The face and the full name ("Anyone on the project"), faded with the away label. */
function FullFace({ assignee }) {
  const key = assignee ? String(assignee.id) : 'anyone';
  return (
    <span key={key} className={styles.faceIn} data-face={key}>
      {assignee ? (
        <Avatar user={assignee} size={24} className={assignee.away ? styles.away : undefined} />
      ) : (
        <AnyoneCircle />
      )}
      <span>{assignee ? assignee.name : 'Anyone on the project'}</span>
      {assignee?.away ? <span className={styles.awayText}>{assignee.away}</span> : null}
    </span>
  );
}

/**
 * The Person column.
 * @param {{ task: object, access: 'manage' | 'team' | 'member',
 *   onPeople?: (button: HTMLElement) => void }} props onPeople: opens the people window (managers)
 */
export function PersonCell({ task, access, onPeople }) {
  const assignee = task.assignee ?? null;
  if (access === 'member') {
    if (assignee) return <span className={styles.own}>For you</span>;
    return (
      <span className={styles.face}>
        <AnyoneCircle />
        <span>Anyone</span>
      </span>
    );
  }
  if (access !== 'manage' || !onPeople) {
    return (
      <span className={styles.face}>
        <FullFace assignee={assignee} />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.face}
      data-face-button=""
      aria-haspopup="dialog"
      aria-label={faceLabel(assignee)}
      onClick={(event) => onPeople(event.currentTarget)}
    >
      <FullFace assignee={assignee} />
      <ChevronDown className={styles.chevron} size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
