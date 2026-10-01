'use client';
// "Report history" on the Employee detailed view: one row per day, newest first. Opening a day
// shows its tasks and its edit history (every submit, who made it, when and why). The latest few
// days show first; "Show N more days" reveals the rest of the range.
import { Fragment, useState } from 'react';
import ProjectLabel from '@/components/ProjectLabel';
import StatusCell from '@/components/StatusCell';
import styles from './ReportHistory.module.css';

const FIRST_DAYS = 5;

const COLUMNS = [
  { key: 'date', label: 'Date', width: 184 },
  { key: 'where', label: 'Where', width: 124 },
  { key: 'in', label: 'In', width: 99 },
  { key: 'out', label: 'Out', width: 100 },
  { key: 'present', label: 'Present', width: 112 },
  { key: 'logged', label: 'Logged', width: 100 },
  { key: 'projects', label: 'Projects' },
  { key: 'report', label: 'Report', width: 160 },
];

/**
 * @param {{ rows: object[], emptyText?: string }} props rows from dashboard.getEmployeeDetail().history
 */
export default function ReportHistory({ rows, emptyText = 'No working days in this range yet.' }) {
  const [open, setOpen] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, FIRST_DAYS);
  const hidden = rows.length - shown.length;

  const toggle = (date) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  if (rows.length === 0) return <p className={styles.empty}>{emptyText}</p>;

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">Report history</caption>
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const isOpen = open.has(row.date);
            const detailId = `history-${row.date}`;
            return (
              <Fragment key={row.date}>
                <tr
                  className={`${styles.row} ${isOpen ? styles.isOpen : ''}`}
                  onClick={(event) => {
                    // The date button handles its own click (and the keyboard).
                    if (!event.target.closest('button, a')) toggle(row.date);
                  }}
                >
                  <td data-label="Date">
                    <button
                      type="button"
                      className={styles.date}
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      onClick={() => toggle(row.date)}
                    >
                      {row.dateLabel}
                      <span className="visually-hidden">
                        {isOpen ? ', hide tasks and edit history' : ', show tasks and edit history'}
                      </span>
                    </button>
                  </td>
                  <td data-label="Where">
                    {row.where ? (
                      <StatusCell status={row.where} size="cellCompact" className={styles.where} />
                    ) : (
                      <span className={styles.none}>—</span>
                    )}
                  </td>
                  <td data-label="In" className={styles.num}>
                    {row.in}
                  </td>
                  <td data-label="Out" className={styles.num}>
                    {row.out}
                  </td>
                  <td data-label="Present" className={styles.num}>
                    {row.present}
                  </td>
                  <td data-label="Logged" className={styles.num}>
                    {row.logged}
                  </td>
                  <td data-label="Projects">
                    {row.projects.length ? (
                      <span className={styles.labels}>
                        {row.projects.map((project) => (
                          <ProjectLabel key={project.name} project={project} />
                        ))}
                      </span>
                    ) : null}
                  </td>
                  <td data-label="Report" className={styles.reportCell}>
                    <StatusCell status={row.report} />
                  </td>
                </tr>
                {isOpen ? (
                  <tr className={styles.detailRow}>
                    <td colSpan={COLUMNS.length} id={detailId}>
                      <DayDetail row={row} />
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
          <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
            Show {hidden} more {hidden === 1 ? 'day' : 'days'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DayDetail({ row }) {
  const hasTasks = row.entries.some((entry) => entry.tasks.length > 0);
  return (
    <div className={styles.detail}>
      <section className={styles.detailBlock} aria-label={`Tasks on ${row.dateLabel}`}>
        <h3 className={styles.detailTitle}>Tasks</h3>
        {row.reportStatus === 'draft' ? (
          <p className={styles.note}>This report is a draft and hasn&apos;t been submitted.</p>
        ) : null}
        {hasTasks ? (
          <ul className={styles.tasks}>
            {row.entries.flatMap((entry) =>
              entry.tasks.map((task, index) => (
                <li key={task.id} className={styles.task}>
                  <span className={styles.taskProject}>
                    {index === 0 ? <ProjectLabel project={entry.project} /> : null}
                  </span>
                  <span className={styles.taskTitle}>{task.title}</span>
                  <span className={styles.taskHours}>{index === 0 ? entry.hours : ''}</span>
                  <StatusCell
                    status={task.status}
                    size="cellCompact"
                    className={styles.taskStatus}
                  />
                </li>
              )),
            )}
          </ul>
        ) : (
          <p className={styles.note}>
            {row.reportStatus ? 'No tasks in this report.' : 'No report for this day.'}
          </p>
        )}
      </section>
      <section className={styles.detailBlock} aria-label={`Edit history of ${row.dateLabel}`}>
        <h3 className={styles.detailTitle}>Edit history</h3>
        {row.revisions.length || row.requests.length ? (
          <ol className={styles.revisions}>
            {row.revisions.map((revision) => (
              <li key={`r${revision.revision}`} className={styles.revision}>
                <p className={styles.revisionHead}>
                  <span className={styles.revisionLabel}>{revision.label}</span>
                  {revision.total ? (
                    <span className={styles.revisionMeta}>{revision.total}</span>
                  ) : null}
                </p>
                <p className={styles.revisionMeta}>
                  {revision.when}, by {revision.by}
                </p>
                {revision.reason ? <p className={styles.reason}>{revision.reason}</p> : null}
              </li>
            ))}
            {row.requests.map((request) => (
              <li key={`q${request.id}`} className={`${styles.revision} ${styles.request}`}>
                <p className={styles.revisionHead}>
                  <span className={styles.revisionLabel}>{request.label}</span>
                  {request.status === 'pending' ? (
                    <span className={styles.revisionMeta}>waiting for approval</span>
                  ) : null}
                </p>
                <p className={styles.revisionMeta}>
                  {request.when}, by {request.by}
                </p>
                {request.reason ? <p className={styles.reason}>{request.reason}</p> : null}
                {request.declineReason ? (
                  <p className={styles.reason}>Declined: {request.declineReason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.note}>
            {row.reportStatus ? 'Not submitted yet.' : 'Nothing was submitted for this day.'}
          </p>
        )}
      </section>
    </div>
  );
}
