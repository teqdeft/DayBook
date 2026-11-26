'use client';
// One task on My tasks (CONTRACT 28, My tasks: sidebar, page and home cards), and the parts the
// page's table rows share with it: the round tick (only for a manager of the task's project), the
// title button that opens the task window in `mine` mode, the project label with "On hold", the
// phase, the due tag, the P tag and the paperclip. The row itself (`data-flip="mine:<id>"`) is the
// home card's and the phone's: 52 px, the tick, the title, and the rest at the right (under the
// title on a phone). A click on a row anywhere but a control opens its task, as its title does.
import { Paperclip } from 'lucide-react';
import PriorityTag from '@/components/PriorityTag';
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import { useTaskWindow } from '@/components/task/TaskWindowProvider';
import { plural } from '@/lib/text';
import DueTag from '@/app/(app)/projects/[id]/DueTag';
import TaskCheck from '@/app/(app)/projects/[id]/TaskCheck';
import tickStyles from '@/app/(app)/projects/[id]/_board/TaskTick.module.css';
import { phaseName } from './myTasksView';
import styles from './MyTaskRow.module.css';

/** The paperclip and count ("2 files" to screen readers); nothing at 0. */
export function MineClip({ count }) {
  if (!(count > 0)) return null;
  const words = `${count} ${plural(count, 'file')}`;
  return (
    <span className={styles.clip} role="img" aria-label={words} title={words}>
      <Paperclip size={14} strokeWidth={1.8} aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

/**
 * The round tick ("Done: …"), for a manager of the task's project; the drawn check and the leave
 * come from `onTick` (useMineTick). Others get an empty 36 px cell.
 */
export function MineTick({ task, onTick }) {
  if (!task.canManage) return <span className={styles.noTick} />;
  return (
    <TaskCheck
      taskId={task.id}
      title={task.title}
      done={Boolean(task.ticking)}
      className={tickStyles.tick}
      onChange={(next, saved, options) => onTick?.(task, next, saved, options)}
    />
  );
}

/** The title, a button that opens the task window (`mine`). */
export function MineTitle({ task, className }) {
  const taskWindow = useTaskWindow();
  return (
    <button
      type="button"
      className={[styles.title, className].filter(Boolean).join(' ')}
      data-mine-title
      onClick={(event) => {
        const list = event.currentTarget.closest('[data-mine-list]');
        taskWindow?.open(task.id, {
          origin: event.currentTarget,
          title: task.title,
          returnFocus: () => (list?.isConnected ? list : null),
        });
      }}
    >
      {task.title}
    </button>
  );
}

/** The project's label, with the neutral "On hold" tag for an On hold project. */
export function MineProject({ task }) {
  return (
    <span className={styles.project}>
      <ProjectLabel project={task.project} size="sm" />
      {task.project?.status === 'on_hold' ? <Tag tone="neutral">On hold</Tag> : null}
    </span>
  );
}

/** The phase's name, muted. */
export function MinePhase({ task, className }) {
  return (
    <span className={[styles.phase, className].filter(Boolean).join(' ')}>
      {phaseName(task.phase)}
    </span>
  );
}

/** A click on a row (not on a control) opens its task, as its title does (a mouse shortcut). */
export function openFromRow(event) {
  const { target } = event;
  if (!(target instanceof Element) || target.closest('button, a, input, label, select')) return;
  target.closest('[data-flip^="mine:"]')?.querySelector('[data-mine-title]')?.click();
}

/**
 * The home card's and the phone's row.
 * @param {{ task: import('./myTasksData').MineRow & { ticking?: boolean }, today: string,
 *   onTick: Function }} props
 */
export default function MyTaskRow({ task, today, onTick }) {
  return (
    <li className={styles.row} data-flip={`mine:${task.id}`} onClick={openFromRow}>
      <MineTick task={task} onTick={onTick} />
      <MineTitle task={task} className={styles.rowTitle} />
      <span className={styles.meta}>
        <MineProject task={task} />
        <MinePhase task={task} className={styles.rowPhase} />
        <DueTag dueDate={task.dueDate} today={today} />
        <PriorityTag priority={task.priority} />
        <span className={styles.rowClip}>
          <MineClip count={task.fileCount} />
        </span>
      </span>
    </li>
  );
}
