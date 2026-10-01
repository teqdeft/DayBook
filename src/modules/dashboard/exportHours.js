// The hours export (GET /api/exports/hours): every report entry in a date range, one sheet of
// rows and one summary sheet by person and project.
import { AppError } from '@/lib/errors';
import { dayjs } from '@/lib/time';
import * as repo from './repo';
import { loadContext, periodFor } from './shared';

const TASK_STATUS = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' };

function reportStatusLabel(status, revision) {
  if (status === 'submitted') return revision > 1 ? 'Edited' : 'Submitted';
  if (status === 'draft') return 'Draft';
  return 'Missing';
}

const hoursOf = (minutes) => Math.round((Number(minutes ?? 0) / 60) * 100) / 100;
// exceljs writes a JS Date as that UTC calendar day, so dates go in as UTC midnight.
const excelDate = (date) => dayjs.utc(date, 'YYYY-MM-DD').toDate();

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function detailRows(entries, tasks, withoutReport) {
  const tasksByEntry = new Map();
  for (const task of tasks) {
    const list = tasksByEntry.get(task.entryId) ?? [];
    list.push(`${task.title} (${TASK_STATUS[task.status] ?? task.status})`);
    tasksByEntry.set(task.entryId, list);
  }
  const rows = entries.map((row) => ({
    workDate: row.workDate,
    date: excelDate(row.workDate),
    person: row.personName,
    department: row.departmentName ?? '',
    project: row.entryId ? (row.projectName ?? `${row.requestName} (requested)`) : '',
    hours: row.entryId ? hoursOf(row.minutes) : 0,
    tasks: (tasksByEntry.get(row.entryId) ?? []).join('; '),
    status: reportStatusLabel(row.status, row.revision),
  }));
  for (const row of withoutReport) {
    rows.push({
      workDate: row.workDate,
      date: excelDate(row.workDate),
      person: row.personName,
      department: row.departmentName ?? '',
      project: '',
      hours: 0,
      tasks: '',
      status: 'Missing',
    });
  }
  return rows.sort(
    (a, b) => a.workDate.localeCompare(b.workDate) || a.person.localeCompare(b.person),
  );
}

/** Submitted hours per person and project, people A to Z, their biggest project first. */
function summaryRows(entries) {
  const totals = new Map();
  for (const row of entries) {
    if (row.status !== 'submitted' || !row.entryId) continue;
    const project = row.projectName ?? `${row.requestName} (requested)`;
    const key = `${row.userId}|${project}`;
    const current = totals.get(key) ?? {
      person: row.personName,
      department: row.departmentName ?? '',
      project,
      minutes: 0,
    };
    current.minutes += Number(row.minutes ?? 0);
    totals.set(key, current);
  }
  return [...totals.values()]
    .map(({ minutes, ...row }) => ({ ...row, hours: hoursOf(minutes) }))
    .sort((a, b) => a.person.localeCompare(b.person) || b.hours - a.hours);
}

/**
 * Builds the hours workbook for xlsxResponse. Defaults to this week (Monday to today).
 * Rows: every report entry (drafts included, marked Draft) and every check-in day without a report
 * (marked Missing). Summary: hours from submitted reports only (build guide 7.10).
 * @param {{ from?: string, to?: string, userId?: number }} options
 * @returns {Promise<{ filename: string, sheets: object[] }>}
 * @throws NOT_FOUND when userId is not a person
 */
export async function buildHoursExport({ from, to, userId } = {}) {
  const ctx = await loadContext();
  const week = periodFor('week', ctx.today);
  const range = { from: from ?? week.from, to: to ?? week.to, userId };
  let person = null;
  if (userId) {
    person = await repo.findPerson(userId);
    if (!person) throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
  }
  const [entries, tasks, withoutReport] = await Promise.all([
    repo.listExportEntries(range),
    repo.listExportTasks(range),
    repo.listExportDaysWithoutReport(range),
  ]);
  const who = person ? `-${slug(person.name) || person.id}` : '';
  return {
    filename: `daybook-hours${who}-${range.from}-to-${range.to}.xlsx`,
    sheets: [
      {
        name: 'Hours',
        columns: [
          { header: 'Date', key: 'date', width: 13, numFmt: 'yyyy-mm-dd' },
          { header: 'Person', key: 'person', width: 24 },
          { header: 'Department', key: 'department', width: 16 },
          { header: 'Project', key: 'project', width: 24 },
          { header: 'Hours', key: 'hours', width: 9, numFmt: '0.00' },
          { header: 'Tasks', key: 'tasks', width: 70 },
          { header: 'Report status', key: 'status', width: 15 },
        ],
        rows: detailRows(entries, tasks, withoutReport),
      },
      {
        name: 'Summary',
        columns: [
          { header: 'Person', key: 'person', width: 24 },
          { header: 'Department', key: 'department', width: 16 },
          { header: 'Project', key: 'project', width: 24 },
          { header: 'Hours (submitted)', key: 'hours', width: 18, numFmt: '0.00' },
        ],
        rows: summaryRows(entries),
      },
    ],
  };
}
