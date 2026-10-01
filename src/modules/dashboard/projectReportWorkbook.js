// The project report as an Excel file (GET /api/projects/:id/report/export): sheets Summary,
// People, Tasks and Daily log. Dates are real dates, hours are numbers, and text people typed is
// guarded so a spreadsheet never runs it as a formula.
import { dayjs } from '@/lib/time';
import { getProjectReport } from './projectReport';
import { safeText } from '@/lib/excel';

const TASK_STATUS = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' };
const PRIORITY = { p1: 'P1', p2: 'P2', p3: 'P3' };
const DATE_FORMAT = 'yyyy-mm-dd';

const hoursOf = (minutes) => Math.round((Number(minutes ?? 0) / 60) * 100) / 100;
// exceljs writes a JS Date as that UTC calendar day, so dates go in as UTC midnight.
const excelDate = (date) => (date ? dayjs.utc(date, 'YYYY-MM-DD').toDate() : null);

/**
 * Text a person typed, safe to put in a cell: a leading =, +, -, @, tab or carriage return would
 * make a spreadsheet treat it as a formula, so it gets a leading apostrophe.
 * @param {unknown} value
 * @returns {string}
 */

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function summaryRows(report) {
  const { project, range, totals, lastUpdate } = report;
  const text = (label, value) => ({ label, value: safeText(value) });
  const date = (label, value) => ({ label, value: excelDate(value) ?? '' });
  const number = (label, value) => ({ label, value });
  return [
    text('Project', project.name),
    text('Client', project.clientName ?? ''),
    text('Project manager', project.pmName ?? ''),
    text('Status', project.isUrgent ? `${project.statusLabel}, urgent` : project.statusLabel),
    ...(project.isUrgent && project.urgentNote ? [text('Urgent note', project.urgentNote)] : []),
    text('Range', range.label),
    date('From', range.from),
    date('To', range.to),
    number('Hours logged', hoursOf(totals.minutes)),
    number('People who logged hours', totals.people),
    number('Members', totals.members),
    number('Days with reports', totals.days),
    number('Tasks', totals.tasks),
    number('Tasks done', totals.tasksDone),
    number('Tasks in progress', totals.tasksInProgress),
    number('Tasks blocked', totals.tasksBlocked),
    date('First report in range', totals.firstReportOn),
    date('Last report in range', totals.lastReportOn),
    date('Last update', lastUpdate?.workDate),
    text('Last update by', lastUpdate?.user?.name ?? ''),
  ];
}

function peopleRows(report) {
  return report.byPerson.map((row) => ({
    person: safeText(row.user.name),
    designation: safeText(row.user.designation ?? ''),
    member: row.isMember ? 'Yes' : 'No',
    hours: hoursOf(row.minutes),
    days: row.days,
    firstOn: excelDate(row.firstOn) ?? '',
    lastOn: excelDate(row.lastOn) ?? '',
    done: row.tasksDone,
    inProgress: row.tasksInProgress,
    blocked: row.tasksBlocked,
  }));
}

function taskRows(report) {
  return report.tasks.map((task) => ({
    task: safeText(task.title),
    priority: PRIORITY[task.priority] ?? '',
    person: safeText(task.user?.name ?? ''),
    status: TASK_STATUS[task.status] ?? task.status,
    firstOn: excelDate(task.firstReportedOn) ?? '',
    lastOn: excelDate(task.lastReportedOn) ?? '',
    days: task.daysReported,
    hours: hoursOf(task.minutesOnDays),
  }));
}

function logRows(report) {
  return report.entries.map((entry) => ({
    date: excelDate(entry.workDate),
    person: safeText(entry.user?.name ?? ''),
    hours: hoursOf(entry.minutes),
    tasks: safeText(
      entry.tasks
        .map((task) => `${task.title} (${TASK_STATUS[task.status] ?? task.status})`)
        .join('; '),
    ),
  }));
}

/**
 * The workbook spec for xlsxResponse() from a getProjectReport() result that holds the whole
 * daily log (limit Infinity).
 * @param {object} report getProjectReport() result
 * @returns {{ filename: string, sheets: object[] }}
 */
export function projectReportWorkbook(report) {
  const { project, range } = report;
  const name = slug(project.name) || String(project.id);
  return {
    filename: `daybook-project-${name}-${range.from}-to-${range.to}.xlsx`,
    sheets: [
      {
        name: 'Summary',
        columns: [
          { header: 'Item', key: 'label', width: 26 },
          { header: 'Value', key: 'value', width: 40 },
        ],
        rows: summaryRows(report),
      },
      {
        name: 'People',
        columns: [
          { header: 'Person', key: 'person', width: 24 },
          { header: 'Designation', key: 'designation', width: 24 },
          { header: 'Member', key: 'member', width: 9 },
          { header: 'Hours', key: 'hours', width: 9, numFmt: '0.00' },
          { header: 'Days worked', key: 'days', width: 12 },
          { header: 'First report', key: 'firstOn', width: 13, numFmt: DATE_FORMAT },
          { header: 'Last report', key: 'lastOn', width: 13, numFmt: DATE_FORMAT },
          { header: 'Done', key: 'done', width: 8 },
          { header: 'In progress', key: 'inProgress', width: 11 },
          { header: 'Blocked', key: 'blocked', width: 9 },
        ],
        rows: peopleRows(report),
      },
      {
        name: 'Tasks',
        columns: [
          { header: 'Task', key: 'task', width: 60 },
          { header: 'Priority', key: 'priority', width: 9 },
          { header: 'Person', key: 'person', width: 24 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'First reported', key: 'firstOn', width: 14, numFmt: DATE_FORMAT },
          { header: 'Last reported', key: 'lastOn', width: 14, numFmt: DATE_FORMAT },
          { header: 'Days reported', key: 'days', width: 13 },
          { header: 'Project hours on those days', key: 'hours', width: 16, numFmt: '0.00' },
        ],
        rows: taskRows(report),
      },
      {
        name: 'Daily log',
        columns: [
          { header: 'Date', key: 'date', width: 13, numFmt: DATE_FORMAT },
          { header: 'Person', key: 'person', width: 24 },
          { header: 'Hours', key: 'hours', width: 9, numFmt: '0.00' },
          { header: 'Tasks', key: 'tasks', width: 80 },
        ],
        rows: logRows(report),
      },
    ],
  };
}

/**
 * Loads the whole report (every daily log row) and builds its workbook.
 * @param {{ projectId: number, range?: 'week'|'month'|'all'|'custom', from?: string,
 *   to?: string }} options
 * @returns {Promise<{ filename: string, sheets: object[] }>} input for xlsxResponse()
 * @throws NOT_FOUND when the project doesn't exist
 */
export async function buildProjectReportExport({ projectId, range, from, to }) {
  const report = await getProjectReport({ projectId, range, from, to, limit: Infinity });
  return projectReportWorkbook(report);
}

// Kept for callers of the earlier export; the guard now lives in @/lib/excel.
export { safeText };
