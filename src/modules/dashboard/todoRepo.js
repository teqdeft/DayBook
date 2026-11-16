// Read model for today's to-do on the dashboards (CONTRACT 24): the task lines of one day's
// reports and when each to-do was posted to Slack. Part of the dashboard repo (CONTRACT section 4:
// read-only queries across tables), kept in its own file; one query for everyone on the board,
// never a query per person.
import { db } from '@/lib/db';
import { readWithTodoColumns } from './todoColumns';

/**
 * Every task line of the reports on one day (or one person's report that day), in report order
 * (projects as on the report, then their lines), with the project or project request and the day
 * of the line it was carried from. Entries without lines don't come back. A to-do line is a report
 * line (CONTRACT 24), so this is a draft's to-do and a submitted report's lines alike.
 * @param {{ date: string, userId?: number }} options
 * @returns {Promise<{ reportId: number, entryId: number, minutes: number, projectId: number|null,
 *   projectName: string|null, projectColor: string|null, requestId: number|null,
 *   requestName: string|null, id: number, title: string, status: string,
 *   timerNote: string|null, carriedFromDate: string|null }[]>}
 */
export function listReportLines({ date, userId }) {
  return db('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .leftJoin('reportTasks as st', 'st.id', 't.carriedFromTaskId')
    .leftJoin('reportEntries as se', 'se.id', 'st.entryId')
    .leftJoin('dailyReports as sr', 'sr.id', 'se.reportId')
    .where('r.workDate', date)
    .modify((q) => {
      if (userId) q.where('r.userId', userId);
    })
    .select(
      'e.reportId',
      'e.id as entryId',
      'e.minutes',
      'e.projectId',
      'p.name as projectName',
      'p.color as projectColor',
      'e.projectRequestId as requestId',
      'pr.name as requestName',
      't.id',
      't.title',
      't.status',
      't.timerNote',
      'sr.workDate as carriedFromDate',
    )
    .orderBy([
      { column: 'e.reportId' },
      { column: 'e.sortOrder' },
      { column: 'e.id' },
      { column: 't.sortOrder' },
      { column: 't.id' },
    ]);
}

/**
 * When the to-do of each report on one day (or one person's) was last posted to Slack
 * (daily_reports.todo_posted_at). Before migration 017 nothing can have been posted, so the
 * answer is empty (see readWithTodoColumns).
 * @param {{ date: string, userId?: number }} options
 * @returns {Promise<Map<number, Date>>} report id -> posted at; reports never posted are left out
 */
export async function listTodoPostedAt({ date, userId }) {
  const rows = await readWithTodoColumns((withColumns) =>
    withColumns
      ? db('dailyReports')
          .where('workDate', date)
          .whereNotNull('todoPostedAt')
          .modify((q) => {
            if (userId) q.where('userId', userId);
          })
          .select('id', 'todoPostedAt')
      : Promise.resolve([]),
  );
  return new Map(rows.map((row) => [row.id, row.todoPostedAt]));
}
