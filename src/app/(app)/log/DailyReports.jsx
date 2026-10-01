'use client';
// My log's "Daily reports" table (artboard 03): one row per day, newest first. A row opens to its
// tasks with hours and status, and a line saying until when the report can change, with "Edit
// report" (still open) or "Request an edit" (locked). The first days show; the rest of the month
// is one click away.
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ProjectLabel from '@/components/ProjectLabel';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import RequestEditDialog from '../report/RequestEditDialog';
import styles from './DailyReports.module.css';

const FIRST_DAYS = 6;

const COLUMNS = [
  { key: 'date', label: 'Date', width: 136 },
  { key: 'times', label: 'Check-in to out', width: 108.67 },
  { key: 'present', label: 'Present', width: 85.33 },
  { key: 'logged', label: 'Logged', width: 70 },
  { key: 'projects', label: 'Projects' },
  { key: 'report', label: 'Report', width: 109 },
  { key: 'open', label: '', width: 63 },
];

function Dash() {
  return (
    <span className={styles.none} aria-label="None">
      —
    </span>
  );
}

function DayPanel({ row, onRequest }) {
  return (
    <div className={styles.panel}>
      {row.tasks.length ? (
        <ul className={styles.tasks}>
          {row.tasks.map((task) => (
            <li key={task.key} className={styles.task}>
              <span className={styles.taskProject}>
                {task.project ? (
                  <ProjectLabel project={task.project} className={styles.taskLabel} />
                ) : null}
              </span>
              <span
                className={task.title ? styles.taskTitle : `${styles.taskTitle} ${styles.muted}`}
              >
                {task.title ?? 'No tasks written'}
              </span>
              <span className={styles.taskHours}>{task.hours ?? ''}</span>
              <span className={styles.taskStatus}>
                {task.status ? <StatusCell status={task.status} size="cellCompact" /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={row.tasks.length ? styles.panelFooter : `${styles.panelFooter} ${styles.flush}`}
      >
        <p className={styles.note}>{row.note}</p>
        {row.action?.kind === 'link' ? (
          <Button variant="text" href={row.action.href} className={styles.action}>
            {row.action.label}
          </Button>
        ) : null}
        {row.action?.kind === 'request' ? (
          <Button variant="text" className={styles.action} onClick={() => onRequest(row.date)}>
            {row.action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @param {{ rows: object[], emptyText: string, emptyAction?: { href: string, label: string } | null }}
 *   props rows from dayRows() in logView.js; emptyAction is the one action of the empty state
 */
export default function DailyReports({ rows, emptyText, emptyAction = null }) {
  const [open, setOpen] = useState(() => new Set(rows.length ? [rows[0].date] : []));
  const [showAll, setShowAll] = useState(false);
  const [asking, setAsking] = useState(null);
  const shown = showAll ? rows : rows.slice(0, FIRST_DAYS);
  const hidden = rows.length - shown.length;

  function toggle(date) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        className={styles.empty}
        title={emptyText}
        action={
          emptyAction ? (
            <Button variant="secondary" size="compact" href={emptyAction.href}>
              {emptyAction.label}
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">Daily reports, newest first</caption>
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col">
                {column.label || <span className="visually-hidden">Open</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const isOpen = open.has(row.date);
            const panelId = `log-day-${row.date}`;
            const Chevron = isOpen ? ChevronUp : ChevronDown;
            return (
              <Fragment key={row.date}>
                <tr
                  className={`${styles.row} ${isOpen ? styles.isOpen : ''}`}
                  onClick={(event) => {
                    if (!event.target.closest('button, a')) toggle(row.date);
                  }}
                >
                  <td className={styles.dateCell}>
                    <span className={styles.date}>
                      <span className={styles.dateText}>{row.dateLabel}</span>
                      {row.isToday ? (
                        <Tag tone="blue" className={styles.dayTag}>
                          Today
                        </Tag>
                      ) : null}
                      {row.wfh ? (
                        <Tag tone="violet" className={styles.dayTag}>
                          WFH
                        </Tag>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="Check-in to out" className={styles.num}>
                    {row.times ?? <Dash />}
                  </td>
                  <td data-label="Present" className={styles.num}>
                    {row.present ?? <Dash />}
                  </td>
                  <td data-label="Logged">
                    {row.logged ? <span className={styles.logged}>{row.logged}</span> : <Dash />}
                  </td>
                  <td data-label="Projects">
                    {row.projects.length ? (
                      <span className={styles.labels}>
                        {row.projects.map((project) => (
                          <ProjectLabel key={project.key} project={project} />
                        ))}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td data-label="Report">
                    <StatusCell status={row.status} label={row.label} />
                  </td>
                  <td className={styles.openCell}>
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} the report for ${row.dateLabel}`}
                      onClick={() => toggle(row.date)}
                    >
                      <Chevron size={18} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className={styles.detailRow}>
                    <td colSpan={COLUMNS.length} id={panelId}>
                      <DayPanel row={row} onRequest={setAsking} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 ? (
        <div className={styles.footer}>
          <Button variant="text" size="compact" onClick={() => setShowAll(true)}>
            Show {hidden} more {hidden === 1 ? 'day' : 'days'}
          </Button>
        </div>
      ) : null}
      <RequestEditDialog
        key={asking ?? 'none'}
        open={Boolean(asking)}
        onClose={() => setAsking(null)}
        fixedDate={asking ?? undefined}
      />
    </div>
  );
}
