'use client';
// Today's "Priority tasks" card (CONTRACT section 13, not on the canvas): the person's open
// priority tasks, P1 first, in the My tasks card's table. The first few show; "Show N more" opens
// the rest in place, so every task can be seen from Today.
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import PriorityTag from '@/components/PriorityTag';
import ProjectLabel from '@/components/ProjectLabel';
import { plural } from '@/lib/text';
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

/**
 * The person's open priority tasks, P1 first (Today shows the card only when there are some).
 * The project's PM sets them; linking a report line to one is in the daily report.
 * @param {{ priority: { rows: Array<{ id, priority, title, project: { name, color },
 *   forYou: boolean }>, initial: number } }} props initial: how many show before "Show more"
 */
export default function PriorityCard({ priority }) {
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
      <div id={tableId}>
        <DataTable columns={COLUMNS} rows={shown} dense caption="Priority tasks" />
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
