'use client';
// One task card on the Board (CONTRACT 28, Cards and the card menu). In DOM order: the top line
// ("#34", the P tag, the status chip), the tick (the project's PM and Admins) or the status dot with
// the title (a button that opens the task window), the actions group placed at the top right (Assign
// to me, the grip, "⋯"; managers only, shown on hover and focus, always on touch screens), the files
// line, and the footer (who it is for, the due date, time and updates). So Tab goes tick, title,
// Assign to me, grip, "⋯". A click anywhere else on the card opens the task window too. The card
// carries the data attributes the motion reads (`data-flip`, `data-open`, `data-card-title`,
// `data-card-actions`, `data-face`, `data-grip`); it is never `draggable` (the pointer drag lifts it,
// and files from the computer still drop on it).
import { useLayoutEffect, useRef } from 'react';
import { GripVertical, Paperclip, UserPlus } from 'lucide-react';
import { flash } from '@/lib/motion/animate';
import { plural } from '@/lib/text';
import TaskCheck from '../TaskCheck';
import { isViewersTask } from './assignView';
import { cardId, cardTitleId } from './boardView';
import CardFiles from './CardFiles';
import CardFooter from './CardFooter';
import CardMenu from './CardMenu';
import CardTop from './CardTop';
import { useTaskActions } from './TaskActionsProvider';
import styles from './TaskCard.module.css';
import tickStyles from './TaskTick.module.css';

/** "Adding 2 files…" with its 3 px bar, while files dropped on the card go up. */
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
        <span className={styles.barFill} style={{ transform: `scaleX(${percent / 100})` }} />
      </span>
    </div>
  );
}

const CONTROLS = 'button, a, input, textarea, select, label, [role="menu"], [role="menuitem"]';

/** A click that should open the task: on the card itself, not on a control or a window over it. */
const opensTask = (event) =>
  event.target instanceof Element &&
  event.currentTarget.contains(event.target) &&
  !event.target.closest(CONTROLS);

/** The grip: its props come from the pointer drag (their class is merged with the card's own). */
function Grip({ task, grip }) {
  const { className, ...rest } = grip ?? {};
  return (
    <button
      type="button"
      className={[styles.action, styles.grip, className].filter(Boolean).join(' ')}
      aria-label={`Move ${task.title}`}
      {...rest}
    >
      <GripVertical size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/**
 * The actions group at the card's top right: Assign to me (an open task that isn't the viewer's),
 * the grip (an open task; hidden on phones and touch screens) and "⋯".
 */
function CardActions({ task, board, actions, grip }) {
  const open = task.status !== 'done';
  const take = open && actions && !isViewersTask(task, board.viewerId);
  return (
    <div className={styles.actions} data-card-actions="">
      {take ? (
        <button
          type="button"
          className={styles.action}
          aria-label={`Assign ${task.title} to me`}
          title="Assign to me"
          onClick={(event) => actions.take(task, { origin: event.currentTarget })}
        >
          <UserPlus size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
      {open ? <Grip task={task} grip={grip} /> : null}
      <CardMenu task={task} board={board} className={styles.action} />
    </div>
  );
}

/** The tick (PM and Admins) or the status dot, and the title button. */
function CardMain({ task, board, manage, onTick }) {
  const done = task.status === 'done';
  return (
    <div className={styles.main}>
      {manage ? (
        <TaskCheck
          taskId={task.id}
          title={task.title}
          done={done}
          className={tickStyles.tick}
          onChange={onTick}
        />
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
        data-card-title=""
        onClick={(event) => board.openTask(task, event.currentTarget)}
      >
        {task.title}
      </button>
    </div>
  );
}

/** The card's classes: done (muted), dimmed by a filter (never a done card), a manager's card. */
const cardClasses = ({ done, dimmed, manage }) =>
  [
    styles.card,
    manage ? styles.manage : null,
    done ? styles.done : null,
    dimmed && !done ? styles.dim : null,
  ]
    .filter(Boolean)
    .join(' ');

/** The grip's props before the pointer drag is wired: its click opens Move to phase…. */
const plainGrip = (board, task) => ({
  'data-grip': '',
  'aria-describedby': 'move-help',
  onClick: () => board.askMove?.(task),
});

/**
 * @param {{ task: object, board: object }} props task: a board row (phasesView.toBoardTask, with
 *   the persons on their way laid over it); board: useBoard's values and actions, whose
 *   `cardProps(task)` gives `{ dimmed, highlighted, fileDrop, gripProps, onTick }`
 */
export default function TaskCard({ task, board }) {
  const ref = useRef(null);
  const actions = useTaskActions();
  const parts = board.cardProps?.(task) ?? {};
  const { dimmed, highlighted, fileDrop, gripProps, onTick } = parts;
  const done = task.status === 'done';
  const manage = board.access === 'manage';
  const batch = board.batchFor?.(task.id) ?? null;

  // A card just added, edited or moved flashes once (`highlighted` turns on after that action).
  useLayoutEffect(() => {
    if (highlighted) flash(ref.current);
  }, [highlighted]);

  const openPeople = (anchor) => actions?.openPeople({ tasks: [task], anchor });
  return (
    <li
      ref={ref}
      id={cardId(task.id)}
      className={cardClasses({ done, dimmed, manage })}
      data-flip={`card:${task.id}`}
      data-open={done ? undefined : ''}
      onClick={(event) => {
        if (opensTask(event)) board.openTask(task, event.currentTarget);
      }}
      onDragStart={(event) => event.preventDefault()}
      {...fileDrop?.handlers}
    >
      <CardTop task={task} />
      <CardMain task={task} board={board} manage={manage} onTick={onTick} />
      {manage ? (
        <CardActions
          task={task}
          board={board}
          actions={actions}
          grip={gripProps ?? plainGrip(board, task)}
        />
      ) : null}
      <CardFiles task={task} />
      <CardFooter task={task} board={board} onPeople={manage && actions ? openPeople : undefined} />
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
