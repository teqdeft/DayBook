'use client';

// "Tasks" on the project report: every task, carried-over days collapsed into one row, with its
// latest status, the priority of the priority task it is linked to (CONTRACT section 13), and when
// it was first and last reported. Filter by status and person in the browser; long lists show 25
// rows at a time.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import PriorityTag from '@/components/PriorityTag';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import Select from '@/components/Select';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import { plural } from '@/lib/text';
import { formatDayShort } from '@/lib/time';
import styles from './TasksCard.module.css';

const STEP = 25;
const STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
];

const daysLabel = (days) => `${days} ${plural(days, 'day')}`;

/** 'Tue, 29 Sep to Thu, 1 Oct, 3 days' (the phone card's one line for the three columns). */
function reportedLine(task) {
  const first = formatDayShort(task.firstReportedOn);
  const last = formatDayShort(task.lastReportedOn);
  const span = first === last ? first : `${first} to ${last}`;
  return `${span}, ${daysLabel(task.daysReported)}`;
}

/** "Linked to the P1 task Fix login timeout" (the tag's tooltip). */
function linkedTitle(task) {
  const label = task.priority.toUpperCase();
  return task.projectTaskTitle
    ? `Linked to the ${label} task ${task.projectTaskTitle}`
    : `Linked to a ${label} task`;
}

const COLUMNS = [
  {
    key: 'title',
    header: 'Task',
    width: '30%',
    render: (task) => (
      <div className={styles.task}>
        <span className={styles.title}>{task.title}</span>
        {task.carried || task.priority ? (
          <span className={styles.tags}>
            {/* On a phone the Priority column is hidden: the tag shows here instead. */}
            {task.priority ? (
              <PriorityTag
                priority={task.priority}
                className={styles.phoneOnlyFlex}
                title={linkedTitle(task)}
              />
            ) : null}
            {task.carried ? (
              <Tag tone="neutral" className={styles.carried}>
                Carried over
              </Tag>
            ) : null}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    key: 'priority',
    header: 'Priority',
    width: '8%',
    hideOnMobile: true,
    render: (task) =>
      task.priority ? (
        <PriorityTag priority={task.priority} title={linkedTitle(task)} />
      ) : (
        <span className={styles.none}>
          <span aria-hidden="true">—</span>
          <span className="visually-hidden">None</span>
        </span>
      ),
  },
  {
    key: 'person',
    header: 'Person',
    width: '18%',
    render: (task) =>
      task.user ? (
        <div className={styles.person}>
          <Avatar user={task.user} size={30} />
          <Link href={task.user.href} className={styles.name}>
            {task.user.name}
          </Link>
        </div>
      ) : (
        '—'
      ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '13%',
    render: (task) => <StatusCell status={task.status} />,
  },
  {
    key: 'first',
    header: 'First reported',
    label: 'Reported',
    width: '12%',
    render: (task) => (
      <>
        <span className={`${styles.text} ${styles.desktopOnly}`}>
          {formatDayShort(task.firstReportedOn)}
        </span>
        <span className={`${styles.text} ${styles.phoneOnly}`}>{reportedLine(task)}</span>
      </>
    ),
  },
  {
    key: 'last',
    header: 'Last reported',
    width: '12%',
    hideOnMobile: true,
    render: (task) => <span className={styles.text}>{formatDayShort(task.lastReportedOn)}</span>,
  },
  {
    key: 'days',
    header: 'Days',
    label: 'Days reported',
    width: '8%',
    hideOnMobile: true,
    className: styles.lastHidden,
    render: (task) => <span className={styles.num}>{daysLabel(task.daysReported)}</span>,
  },
];

function peopleOf(tasks) {
  const people = new Map();
  for (const task of tasks) if (task.user) people.set(task.user.id, task.user.name);
  return [...people.entries()]
    .map(([id, name]) => ({ value: String(id), label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function countByStatus(tasks) {
  const result = { all: tasks.length, done: 0, in_progress: 0, blocked: 0 };
  for (const task of tasks) result[task.status] = (result[task.status] ?? 0) + 1;
  return result;
}

/**
 * @param {{ tasks: object[], rangeLabel: string, when?: string }} props tasks: the report's
 *   collapsed tasks; when: 'yet' (all time) or 'in this range', for the empty state
 */
export default function TasksCard({ tasks, rangeLabel, when = 'in this range' }) {
  const [status, setStatus] = useState('all');
  const [picked, setPerson] = useState('all');
  const [shown, setShown] = useState(STEP);
  const people = useMemo(() => peopleOf(tasks), [tasks]);
  // After a refresh the picked person may have no tasks left: show everyone then.
  const person = people.some((option) => option.value === picked) ? picked : 'all';
  const byPerson = useMemo(
    () => (person === 'all' ? tasks : tasks.filter((task) => String(task.user?.id) === person)),
    [tasks, person],
  );
  const counts = useMemo(() => countByStatus(byPerson), [byPerson]);
  const rows = status === 'all' ? byPerson : byPerson.filter((task) => task.status === status);
  const visible = rows.slice(0, shown);
  const left = rows.length - visible.length;

  const pickStatus = (value) => {
    setStatus(value);
    setShown(STEP);
  };
  const pickPerson = (event) => {
    setPerson(event.target.value);
    setShown(STEP);
  };

  return (
    <Card padding="none" className={styles.card}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.cardTitle}>Tasks</h2>
          <p className={styles.subtitle}>
            {tasks.length
              ? `${tasks.length} ${plural(tasks.length, 'task')}. A task carried over to later days counts once.`
              : rangeLabel}
          </p>
        </div>
        {tasks.length ? (
          <div className={styles.filters}>
            <FilterPills
              label="Task status"
              value={status}
              onChange={pickStatus}
              items={STATUSES.map((item) => ({
                value: item.value,
                label: `${item.label} (${counts[item.value] ?? 0})`,
              }))}
            />
            <label className="visually-hidden" htmlFor="project-task-person">
              Person
            </label>
            <Select
              id="project-task-person"
              compact
              className={styles.personSelect}
              value={person}
              onChange={pickPerson}
              options={[{ value: 'all', label: 'Everyone' }, ...people]}
            />
          </div>
        ) : null}
      </div>
      {tasks.length ? (
        // Tells screen reader users what a filter change did.
        <p className="visually-hidden" aria-live="polite">
          {`Tasks matching: ${rows.length}`}
        </p>
      ) : null}
      <DataTable
        caption="Tasks"
        columns={COLUMNS}
        rows={visible}
        empty={
          tasks.length ? (
            <EmptyState
              compact
              title="No tasks match these filters."
              body="Pick another status or person."
            />
          ) : (
            <EmptyState
              title={`No tasks reported ${when}.`}
              body="Tasks show here once reports on this project are submitted."
            />
          )
        }
      />
      {left > 0 ? (
        <div className={styles.more}>
          <Button variant="text" size="compact" onClick={() => setShown(shown + STEP)}>
            {`Show ${Math.min(STEP, left)} more`}
          </Button>
          <span className={styles.moreNote}>
            Showing {visible.length} of {rows.length}
          </span>
        </div>
      ) : null}
    </Card>
  );
}
