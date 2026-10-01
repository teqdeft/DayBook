'use client';

// "Daily log" on the project report: each person's submitted work on the project, one row per
// person per day, newest first. The page renders the first 20; "Show more" asks the API for the
// next page of the same range.
import { useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import Tag from '@/components/Tag';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { plural } from '@/lib/text';
import styles from './DailyLog.module.css';

const STATUS = {
  done: { tone: 'green', label: 'Done' },
  in_progress: { tone: 'primary', label: 'In progress' },
  blocked: { tone: 'red', label: 'Blocked' },
};

const COLUMNS = [
  {
    key: 'date',
    header: 'Date',
    width: '14%',
    render: (row) => <span className={styles.date}>{row.dateLabel}</span>,
  },
  {
    key: 'person',
    header: 'Person',
    width: '22%',
    render: (row) => (
      <div className={styles.person}>
        <Avatar user={row.user} size={30} />
        <Link href={row.user.href} className={styles.name}>
          {row.user.name}
        </Link>
      </div>
    ),
  },
  {
    key: 'hours',
    header: 'Hours',
    width: '9%',
    render: (row) => <span className={styles.hours}>{row.hours}</span>,
  },
  {
    key: 'tasks',
    header: 'Tasks',
    className: styles.tasksCell,
    render: (row) =>
      row.tasks.length ? (
        <ul className={styles.tasks}>
          {row.tasks.map((task) => {
            const status = STATUS[task.status] ?? { tone: 'neutral', label: task.status };
            return (
              <li key={task.id} className={styles.taskRow}>
                <Tag tone={status.tone} className={styles.status}>
                  {status.label}
                </Tag>
                <span className={styles.taskTitle}>{task.title}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className={styles.noTasks}>No tasks written</span>
      ),
  },
];

/**
 * @param {{ projectId: number, range: { key: string, from: string, to: string },
 *   initialEntries: object[], initialPage: { limit: number, offset: number, total: number } }} props
 */
export default function DailyLog({ projectId, range, initialEntries, initialPage }) {
  const toast = useToast();
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialPage.total);
  const [loading, setLoading] = useState(false);
  // A new server render (navigating to the same range again, router.refresh()) brings fresh rows:
  // start over from them instead of keeping the pages loaded before.
  const [source, setSource] = useState(initialEntries);
  if (source !== initialEntries) {
    setSource(initialEntries);
    setEntries(initialEntries);
    setTotal(initialPage.total);
  }
  const left = Math.max(0, total - entries.length);

  async function showMore() {
    const query = new URLSearchParams({
      range: range.key,
      section: 'entries',
      limit: String(initialPage.limit),
      offset: String(entries.length),
    });
    if (range.key === 'custom') {
      query.set('from', range.from);
      query.set('to', range.to);
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/api/projects/${projectId}/report?${query}`);
      setEntries((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...data.entries.filter((row) => !seen.has(row.id))];
      });
      setTotal(data.entriesPage.total);
    } catch (error) {
      toast({ title: "Couldn't load more days", body: error.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card padding="none" className={styles.card}>
      <CardHeader
        title="Daily log"
        actions={
          total ? `${total} ${plural(total, 'report')}, newest first` : 'Submitted reports only'
        }
        divider
      />
      <DataTable
        caption="Daily log"
        columns={COLUMNS}
        rows={entries}
        empty={
          <EmptyState
            title={`No reports ${range.when ?? 'in this range'}.`}
            body="Each submitted report that logs time on this project shows here."
          />
        }
      />
      {left > 0 ? (
        <div className={styles.more}>
          <Button variant="text" size="compact" loading={loading} onClick={showMore}>
            {`Show ${Math.min(initialPage.limit, left)} more`}
          </Button>
          <span className={styles.moreNote}>
            Showing {entries.length} of {total}
          </span>
        </div>
      ) : null}
    </Card>
  );
}
