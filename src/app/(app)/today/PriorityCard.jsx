'use client';
// Today's "Priority tasks" card (CONTRACT section 13, not on the canvas): the person's open
// priority tasks, P1 first, in a table. The first few show; "Show N more" opens the rest in place,
// so every task can be seen from Today. CONTRACT 24: each row's Plus adds the task to today's
// to-do (its title, linked to it, in its project's group); a task a to-do line already links
// shows a muted check and "In to-do" instead.
import { useId, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import PriorityTag from '@/components/PriorityTag';
import ProjectLabel from '@/components/ProjectLabel';
import { plural } from '@/lib/text';
import { useTodo } from './TodoProvider';
import { isLocked, linkedTaskIds } from './todoModel';
import styles from './page.module.css';

const COLUMNS = [
  {
    key: 'priority',
    header: 'Priority',
    width: 96,
    // A phone shows rows as cards: the title goes beside the tag there (the Task cell hides).
    render: (row) => (
      <span className={styles.priorityCell}>
        <PriorityTag priority={row.priority} />
        <span className={`${styles.taskTitle} ${styles.phoneTitle}`}>{row.title}</span>
      </span>
    ),
  },
  {
    key: 'title',
    header: 'Task',
    hideOnMobile: true,
    render: (row) => <span className={styles.taskTitle}>{row.title}</span>,
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
 * The person's open priority tasks, P1 first (Today shows the card only when there are some).
 * The project's PM sets them; linking a report line to one is in the daily report.
 * @param {{ priority: { rows: Array<{ id, priority, title, projectId, project: { name, color },
 *   forYou: boolean }>, initial: number } }} props initial: how many show before "Show more"
 */
export default function PriorityCard({ priority }) {
  const { rows, initial } = priority;
  const todo = useTodo();
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
      <div id={tableId}>
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
