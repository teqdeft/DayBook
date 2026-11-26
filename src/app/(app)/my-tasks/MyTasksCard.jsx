'use client';
// The My tasks card on the PM's /team and the Admin's /overview (CONTRACT 28, My tasks: sidebar,
// page and home cards): "My tasks" and "8 open", then one list of the first 6 tasks by date under
// the headings of their groups ("Overdue 1" in red, "Today 1", …), and a foot with "2 more" and
// "See all my tasks (8)". Each title opens the task window in `mine` mode; a manager of the task's
// project ticks it done here (the row leaves, "Marked done." with Undo). A task taken on another
// page shows on the next load, without motion. Empty: one sentence and no foot.
import { Fragment, useId } from 'react';
import Link from 'next/link';
import Card from '@/components/Card';
import { TaskWindowProvider } from '@/components/task/TaskWindowProvider';
import { TaskUndoProvider } from '@/app/(app)/projects/[id]/TaskUndoProvider';
import MyTaskRow from './MyTaskRow';
import { CARD_ROWS, cardRows } from './myTasksView';
import { useMineTick } from './useMineTick';
import styles from './MyTasksCard.module.css';

/** The empty card's sentence (also the page's). */
export const NO_TASKS = 'No tasks for you. Use Assign to me on any task to see it here.';

function CardRows({ groups, today, onTick }) {
  return groups.map((group) => (
    <Fragment key={group.key}>
      <li
        className={[styles.group, group.tone === 'red' ? styles.red : null]
          .filter(Boolean)
          .join(' ')}
        data-flip={`mine-group:${group.key}`}
      >
        {group.label} <span className={styles.groupCount}>{group.count}</span>
      </li>
      {group.tasks.map((task) => (
        <MyTaskRow key={task.id} task={task} today={today} onTick={onTick} />
      ))}
    </Fragment>
  ));
}

function CardBody({ mine }) {
  const headingId = useId();
  const { tasks, tick } = useMineTick(mine.tasks);
  const { groups, total, more } = cardRows(tasks, CARD_ROWS, mine.today);
  return (
    <Card
      as="section"
      padding="none"
      aria-labelledby={headingId}
      className={styles.card}
      data-mine-root=""
    >
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          My tasks <span className={styles.open}>{total} open</span>
        </h2>
        <p className={styles.sub}>Tasks you took or were given, on all your projects</p>
      </div>
      {total > 0 ? (
        <>
          <ul className={styles.list} aria-label="My tasks by date" data-mine-list="" tabIndex={-1}>
            <CardRows groups={groups} today={mine.today} onTick={tick} />
          </ul>
          <div className={styles.foot} data-flip="mine-foot">
            <span>{more > 0 ? `${more} more` : ''}</span>
            <Link href="/my-tasks" className={styles.seeAll}>
              See all my tasks ({total})
            </Link>
          </div>
        </>
      ) : (
        <p className={styles.empty}>{NO_TASKS}</p>
      )}
    </Card>
  );
}

/**
 * @param {{ mine: { tasks: import('./myTasksData').MineRow[], today: string, viewerId: number } }}
 *   props mine: loadMyTasks' answer (myTasksData.js)
 */
export default function MyTasksCard({ mine }) {
  return (
    <TaskUndoProvider>
      <TaskWindowProvider mode="mine" viewerId={mine.viewerId} today={mine.today}>
        <CardBody mine={mine} />
      </TaskWindowProvider>
    </TaskUndoProvider>
  );
}
