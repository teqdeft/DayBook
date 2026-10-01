// Project report (CONTRACT section 12): everything about one project for PMs and Admin — who
// worked on it, hours per person and over time, every task with its status and dates, and a
// day-by-day log. Counts use submitted reports only (build guide 7.10).
import { AppError } from '@/lib/errors';
import { plural } from '@/lib/text';
import { dayjs, formatHours, workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import { projectReportBuckets, projectReportPeriod, shortDate } from './projectReportPeriods';
import { byPersonRows, dailyLog, personOf } from './projectReportRows';
import { PROJECT_REPORT_PAGE_SIZE } from './projectReportSchemas';
import { collapseTasks, countTasks } from './projectReportTasks';
import * as repo from './repo';
import { loadContext, percent } from './shared';

const STATUS_LABELS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };
const KPI_WHOLE_HOURS_FROM = 100 * 60;

function projectOf(project, ctx) {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    clientName: project.clientName,
    pmId: project.pmId,
    pmName: project.pmName,
    status: project.status,
    statusLabel: STATUS_LABELS[project.status] ?? project.status,
    isUrgent: project.isUrgent,
    urgentNote: project.urgentNote,
    createdOn: project.createdAt ? workDate(ctx.tz, project.createdAt) : null,
  };
}

/** 'today', 'yesterday' or '3 days ago' within a week, otherwise null. */
function agoLabel(date, today) {
  const days = dayjs(today, 'YYYY-MM-DD').diff(dayjs(date, 'YYYY-MM-DD'), 'day');
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return null;
}

async function lastUpdateOf(projectId, lastOn, today) {
  if (!lastOn) return null;
  const rows = await repo.listProjectReportersOn(projectId, lastOn);
  const seen = new Map();
  for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, { id: row.id, name: row.name });
  const [first, ...rest] = [...seen.values()];
  return {
    workDate: lastOn,
    dateLabel: shortDate(lastOn, today),
    ago: agoLabel(lastOn, today),
    user: first ?? null,
    others: rest.length,
  };
}

function kpisOf({ totals, period, lastUpdate }) {
  const { tasksDone, tasksInProgress, tasksBlocked } = totals;
  const allTasks = tasksDone + tasksInProgress + tasksBlocked;
  const open = tasksInProgress + tasksBlocked;
  const by = lastUpdate?.user
    ? `by ${lastUpdate.user.name}${lastUpdate.others ? ` and ${lastUpdate.others} ${plural(lastUpdate.others, 'other')}` : ''}`
    : 'No reports on this project yet';
  return [
    {
      key: 'hours',
      label: 'Hours logged',
      // Whole hours from 100h, like Overview's "Hours this week", so a big all-time total fits the
      // card on a phone ('709h'); the exact total is in "Hours by person" and the Excel file.
      value: formatHours(totals.minutes, totals.minutes >= KPI_WHOLE_HOURS_FROM ? 0 : 2),
      sub: period.sub,
      footer: totals.days
        ? `Across ${totals.days} ${plural(totals.days, 'day')}`
        : `No hours ${period.when}`,
    },
    {
      key: 'people',
      label: 'People',
      value: String(totals.people),
      sub: 'logged hours',
      footer: totals.members
        ? `${totals.members} ${plural(totals.members, 'member')} on the project`
        : 'No members yet',
    },
    {
      key: 'done',
      label: 'Tasks done',
      value: String(tasksDone),
      sub: `of ${allTasks} ${plural(allTasks, 'task')}`,
      percent: percent(tasksDone, allTasks),
      color: 'green',
    },
    {
      key: 'open',
      label: 'Tasks open',
      value: String(open),
      sub: tasksBlocked ? `${tasksBlocked} blocked` : 'none blocked',
      percent: percent(tasksBlocked, open),
      color: 'red',
    },
    {
      key: 'lastUpdate',
      label: 'Last update',
      value: lastUpdate ? lastUpdate.dateLabel : '—',
      sub: lastUpdate?.ago ?? null,
      footer: by,
    },
  ];
}

/**
 * The range key: the one asked for, else custom when both dates are given (the CONTRACT
 * signature is getProjectReport({ projectId, from, to })), else all time.
 */
function rangeKeyOf({ range, from, to }) {
  return range ?? (from && to ? 'custom' : 'all');
}

/** A task line with the priority task it is linked to (CONTRACT section 13), if any. */
function withPriority(row, link) {
  return {
    ...row,
    projectTaskId: link?.projectTaskId ?? null,
    priority: link?.priority ?? null,
    projectTaskTitle: link?.title ?? null,
  };
}

/** Loads the project, its range and the submitted entries and tasks in it. */
async function loadReport({ projectId, range, from, to }) {
  const ctx = await loadContext();
  const found = await projects.findById(projectId);
  if (!found) throw new AppError('NOT_FOUND', { message: "We couldn't find that project." });
  const project = projectOf(found, ctx);
  const span = await repo.projectReportSpan(project.id);
  const period = projectReportPeriod(
    { range: rangeKeyOf({ range, from, to }), from, to },
    { today: ctx.today, firstOn: span.firstOn, createdOn: project.createdOn },
  );
  const [entryRows, allTaskRows, links] = await Promise.all([
    repo.listProjectEntries(project.id, period.from, period.to),
    repo.listProjectTasks(project.id, period.from, period.to),
    reports.getPriorityLinks({ projectId: project.id, from: period.from, to: period.to }),
  ]);
  // The reads are not one snapshot: a report submitted or re-saved in between could bring
  // tasks whose entry (and person) the first read never saw. Keep only tasks of known entries.
  const entryIds = new Set(entryRows.map((row) => row.entryId));
  const taskRows = allTaskRows
    .filter((row) => entryIds.has(row.entryId))
    .map((row) => withPriority(row, links[row.id]));
  const people = new Map();
  for (const row of entryRows) if (!people.has(row.userId)) people.set(row.userId, personOf(row));
  return { ctx, project, span, period, entryRows, taskRows, people };
}

function page(rows, limit, offset) {
  return {
    rows: rows.slice(offset, offset + limit),
    page: { limit, offset, total: rows.length },
  };
}

function exportHrefOf(project, period) {
  const query = new URLSearchParams({ range: period.key });
  if (period.key === 'custom') {
    query.set('from', period.from);
    query.set('to', period.to);
  }
  return `/api/projects/${project.id}/report/export?${query}`;
}

/**
 * The project report.
 * @param {{ projectId: number, range?: 'week'|'month'|'all'|'custom', from?: string,
 *   to?: string, limit?: number, offset?: number }} options without `range`, from + to mean a
 *   custom range and nothing means all time; custom needs from <= to (checked by the schema);
 *   limit/offset page the daily log (`entries`), limit Infinity returns all of it
 * @returns {Promise<object>} { project, range, totals, lastUpdate, kpis, byPerson, byPeriod,
 *   periodUnit, tasks, entries, entriesPage, today, exportHref }
 * @throws NOT_FOUND when the project doesn't exist
 */
export async function getProjectReport({
  projectId,
  range,
  from,
  to,
  limit = PROJECT_REPORT_PAGE_SIZE,
  offset = 0,
}) {
  const loaded = await loadReport({ projectId, range, from, to });
  const { ctx, project, span, period, entryRows, taskRows, people } = loaded;
  const [memberRows, lastUpdate] = await Promise.all([
    repo.listProjectMembers(project.id),
    lastUpdateOf(project.id, span.lastOn, ctx.today),
  ]);
  // Members who can log hours: active and tracked (PMs and untracked Admins never write reports,
  // so they would only ever show "No hours yet"). Anyone with hours is listed from the entries.
  const members = memberRows.filter(
    (member) => member.status === 'active' && member.tracksAttendance,
  );
  const memberIds = new Set(memberRows.map((member) => member.id));
  for (const member of members) if (!people.has(member.id)) people.set(member.id, personOf(member));

  const minutesByEntry = new Map(entryRows.map((row) => [row.entryId, Number(row.minutes)]));
  const tasks = collapseTasks(taskRows, minutesByEntry, (userId) => people.get(userId));
  const counts = countTasks(tasks);
  const totalMinutes = entryRows.reduce((sum, row) => sum + Number(row.minutes), 0);
  const days = [...new Set(entryRows.map((row) => row.workDate))].sort();
  const byPerson = byPersonRows({ entryRows, tasks, members, memberIds, people, totalMinutes });
  const totals = {
    minutes: totalMinutes,
    hours: formatHours(totalMinutes),
    people: byPerson.filter((row) => row.minutes > 0).length,
    members: members.length,
    days: days.length,
    tasks: tasks.length,
    tasksDone: counts.done,
    tasksInProgress: counts.inProgress,
    tasksBlocked: counts.blocked,
    firstReportOn: days[0] ?? null,
    lastReportOn: days[days.length - 1] ?? null,
  };
  const { unit, buckets } = projectReportBuckets(period, entryRows, ctx.today);
  const log = page(dailyLog(entryRows, taskRows, people), limit, offset);

  return {
    today: ctx.today,
    project,
    range: period,
    totals,
    lastUpdate,
    kpis: kpisOf({ totals, period, lastUpdate }),
    byPerson,
    byPeriod: buckets,
    periodUnit: unit,
    tasks,
    entries: log.rows,
    entriesPage: log.page,
    exportHref: exportHrefOf(project, period),
  };
}

/**
 * One page of the daily log only ("Show more").
 * @param {{ projectId: number, range?: string, from?: string, to?: string, limit?: number,
 *   offset?: number }} options
 * @returns {Promise<{ entries: object[], entriesPage: { limit, offset, total } }>}
 * @throws NOT_FOUND when the project doesn't exist
 */
export async function getProjectReportEntries({
  projectId,
  range,
  from,
  to,
  limit = PROJECT_REPORT_PAGE_SIZE,
  offset = 0,
}) {
  const { entryRows, taskRows, people } = await loadReport({ projectId, range, from, to });
  const log = page(dailyLog(entryRows, taskRows, people), limit, offset);
  return { entries: log.rows, entriesPage: log.page };
}
