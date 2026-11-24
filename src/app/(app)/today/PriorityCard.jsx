'use client';
// Today's "Priority tasks" card (CONTRACT section 13, not on the canvas): the person's open
// priority tasks, P1 first, in a table. The first few show; "Show N more" opens the rest in place,
// so every task can be seen from Today. CONTRACT 24: each row's Plus adds the task to today's
// to-do (its title, linked to it, in its project's group); a task a to-do line already links
// shows a muted check and "In to-do" instead. CONTRACT 27: a paperclip and count after the title
// when the task has files this person may see; the title is a button, and a click on it or
// anywhere on the row except the To-do cell opens the task window (mode `today`, with "Open
// project" and the to-do button).
import { useId, useState } from 'react';
import { Check, ChevronDown, Paperclip, Plus } from 'lucide-react';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import PriorityTag from '@/components/PriorityTag';
import ProjectLabel from '@/components/ProjectLabel';
import { TaskWindowProvider, useTaskWindow } from '@/components/task/TaskWindowProvider';
import { plural } from '@/lib/text';
import { useTodo } from './TodoProvider';
import { isLocked, linkedTaskIds } from './todoModel';
import styles from './PriorityCard.module.css';

/** The paperclip and count ("2 files" to screen readers), when the task has files. */
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

/** The title as a button that opens the task window, and its paperclip. */
function TitleButton({ row, className = '' }) {
  const taskWindow = useTaskWindow();
  return (
    <span className={`${styles.titleLine} ${className}`}>
      <button
        type="button"
        className={styles.titleButton}
        data-open-task
        onClick={(event) =>
          taskWindow?.open(row.id, { origin: event.currentTarget, title: row.title })
        }
      >
        {row.title}
      </button>
      <Clip count={row.fileCount} />
    </span>
  );
}

const COLUMNS = [
  {
    key: 'priority',
    header: 'Priority',
    width: 96,
    // A phone shows rows as cards: the title goes beside the tag there (the Task cell hides).
    render: (row) => (
      <span className={styles.priorityCell}>
        <PriorityTag priority={row.priority} />
        <TitleButton row={row} className={styles.phoneTitle} />
      </span>
    ),
  },
  {
    key: 'title',
    header: 'Task',
    hideOnMobile: true,
    render: (row) => <TitleButton row={row} />,
  },
  {
    key: 'project',
    header: 'Project',
    width: 220,
    render: (row) => <ProjectLabel project={row.project} />,
  },
  {
    key: 'for',
    header: 'For',
    width: 220,
    render: (row) => (
      <span className={row.forYou ? styles.forYou : styles.muted}>
        {row.forYou ? 'For you' : 'Anyone on the project'}
      </span>
    ),
  },
];

/** The To-do cell: "In to-do" when a line links the task, else Plus while the to-do takes lines. */
function TodoCell({ row, todo, linked, locked }) {
  if (linked.has(Number(row.id))) {
    return (
      <span className={styles.inTodo}>
        <Check size={15} strokeWidth={1.8} aria-hidden="true" className={styles.inTodoIcon} />
        In to-do
      </span>
    );
  }
  if (locked || !row.projectId) return null;
  const project = { id: row.projectId, name: row.project.name, color: row.project.color };
  return (
    <button
      type="button"
      className={styles.todoAdd}
      aria-label={`Add to to-do: ${row.title}`}
      title="Add to to-do"
      onClick={() =>
        todo.addLine(
          { project },
          { title: row.title, projectTaskId: row.id, added: 'Added to your to-do.' },
        )
      }
    >
      <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** The table's columns, with the To-do one while the page has a to-do (`report.self`). */
function columnsFor(todo) {
  if (!todo) return COLUMNS;
  const linked = linkedTaskIds(todo.todo);
  const locked = isLocked(todo.todo);
  return [
    ...COLUMNS,
    {
      key: 'todo',
      header: 'To-do',
      width: 84,
      align: 'right',
      render: (row) => <TodoCell row={row} todo={todo} linked={linked} locked={locked} />,
    },
  ];
}

/**
 * Today's to-do card as the task window uses it: "In to-do" for a task a line links, and its own
 * addLine ("Added to your to-do."); no adding once the report is in. Null without a to-do.
 */
export function todoForWindow(todo) {
  if (!todo) return null;
  const linked = linkedTaskIds(todo.todo);
  const add = (task) =>
    todo.addLine(
      { project: { id: task.projectId, name: task.project?.name, color: task.project?.color } },
      { title: task.title, projectTaskId: task.id, added: 'Added to your to-do.' },
    );
  return { has: (taskId) => linked.has(Number(taskId)), add: isLocked(todo.todo) ? null : add };
}

/** A click on a row (not on a button, a link or the To-do cell) opens its task, as its title. */
function openFromRow(event) {
  const { target } = event;
  if (!(target instanceof Element) || target.closest('button, a, input, [data-label="To-do"]')) {
    return;
  }
  const buttons = target.closest('tr')?.querySelectorAll('[data-open-task]') ?? [];
  [...buttons].find((button) => button.offsetParent !== null)?.click();
}

/**
 * The person's open priority tasks, P1 first (Today shows the card only when there are some).
 * The project's PM sets them; linking a report line to one is in the daily report.
 * @param {{ priority: { rows: Array<{ id, priority, title, projectId, project: { name, color },
 *   forYou: boolean, fileCount?: number }>, initial: number, today?: string } }} props initial:
 *   how many show before "Show more"; today: the company's date, for the task window
 */
export default function PriorityCard({ priority }) {
  const todo = useTodo();
  return (
    <TaskWindowProvider mode="today" today={priority.today ?? undefined} todo={todoForWindow(todo)}>
      <PriorityTable priority={priority} todo={todo} />
    </TaskWindowProvider>
  );
}

function PriorityTable({ priority, todo }) {
  const { rows, initial } = priority;
  const [expanded, setExpanded] = useState(false);
  const tableId = useId();
  const hidden = Math.max(rows.length - initial, 0);
  const shown = expanded || hidden === 0 ? rows : rows.slice(0, initial);
  return (
    <Card padding="none" as="section" aria-label="Priority tasks" className={styles.priority}>
      <CardHeader
        title="Priority tasks"
        actions="From your project managers"
        divider
        className={styles.tasksHead}
      />
      {/* A row click is a mouse shortcut: the title button is the keyboard's way in. */}
      <div id={tableId} className={styles.priorityRows} onClick={openFromRow}>
        <DataTable columns={columnsFor(todo)} rows={shown} dense caption="Priority tasks" />
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          className={styles.priorityMore}
          aria-expanded={expanded}
          aria-controls={tableId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more priority ${plural(hidden, 'task')}`}
          <ChevronDown
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className={`${styles.moreChevron} ${expanded ? styles.moreChevronOpen : ''}`}
          />
        </button>
      ) : null}
    </Card>
  );
}
