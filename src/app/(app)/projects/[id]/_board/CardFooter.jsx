'use client';
// A card's footer (CONTRACT 28, Cards and the card menu), above a 1 px rule: who it is for
// (CardFace), the due date and, at the right, only when above zero, the time from timers ("5h 40m";
// a viewer without `team.view` sees only their own minutes, said " of your time from timers") and
// the number of report lines on it ("2", " updates").
import { Clock, MessageSquare } from 'lucide-react';
import { formatDuration } from '@/lib/time';
import { plural } from '@/lib/text';
import DueTag from '../DueTag';
import CardFace from './CardFace';
import styles from './CardParts.module.css';

/**
 * The time and updates a card shows, or null for each at zero.
 * @param {{ minutes?: number, updateCount?: number }} task
 * @param {boolean} ownTime true when the minutes are only the viewer's own (no `team.view`)
 */
export function statsOf(task, ownTime) {
  const minutes = Math.max(0, Math.floor(Number(task?.minutes) || 0));
  const updates = Math.max(0, Math.floor(Number(task?.updateCount) || 0));
  return {
    time:
      minutes > 0
        ? {
            text: formatDuration(minutes),
            hidden: ownTime ? ' of your time from timers' : ' from timers',
          }
        : null,
    updates:
      updates > 0 ? { text: String(updates), hidden: ` ${plural(updates, 'update')}` } : null,
  };
}

function Stats({ task, ownTime }) {
  const { time, updates } = statsOf(task, ownTime);
  if (!time && !updates) return null;
  return (
    <span className={styles.stats}>
      {time ? (
        <span className={styles.stat}>
          <Clock size={14} strokeWidth={1.8} aria-hidden="true" />
          {time.text}
          <span className="visually-hidden">{time.hidden}</span>
        </span>
      ) : null}
      {updates ? (
        <span className={styles.stat}>
          <MessageSquare size={14} strokeWidth={1.8} aria-hidden="true" />
          {updates.text}
          <span className="visually-hidden">{updates.hidden}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * @param {{ task: object, board: object, onPeople?: (button: HTMLElement) => void }} props
 *   board: the Board's values (access, today); onPeople: opens the people window from the face
 */
export default function CardFooter({ task, board, onPeople }) {
  const done = task.status === 'done';
  return (
    <div className={styles.footer}>
      <CardFace task={task} access={board.access} onOpen={onPeople} />
      <DueTag dueDate={task.dueDate} today={board.today} done={done} />
      <Stats task={task} ownTime={board.access === 'member'} />
    </div>
  );
}
