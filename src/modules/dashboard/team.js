// Team dashboard (artboard 05): today's numbers, the attendance donut, "Urgent now" and the team
// board, plus hours by project for a date range. Each person's day decides who is expected
// (CONTRACT 25): someone on leave, on a holiday or on a day the company doesn't work is "Off
// today", never "Not checked in", and the board never says the leave type or pay.
import { formatClockShort, formatDuration } from '@/lib/time';
import { plural } from '@/lib/text';
import * as repo from './repo';
import { GROUPS, boardRow, labelsByReport, matchesFilter } from './teamBoard';
import { linesByReport, todoPostingOn } from './todo';
import { listReportLines, listTodoPostedAt } from './todoRepo';
import {
  checkedInKpi,
  holidayOn,
  hoursBars,
  loadContext,
  loadDashboardCalendar,
  nowSubtitle,
  people,
  percent,
  periodFor,
  reportDue,
  reportsKpi,
  showsAdmins,
  summarizeDay,
  totalMinutes,
  urgentItems,
  withPresence,
} from './shared';

export const BOARD_FILTERS = ['everyone', 'missing', 'late', 'no-todo'];

/** '26 minutes' as on the canvas; an hour or more reads '1h 37m'. */
function lateAverage(minutes) {
  if (minutes >= 60) return formatDuration(minutes);
  return `${minutes} ${plural(minutes, 'minute')}`;
}

function dayKpis(summary, ctx) {
  const { late } = summary;
  return [
    checkedInKpi(summary, 'Checked in'),
    {
      key: 'wfh',
      label: 'Working from home',
      value: String(summary.wfh),
      sub: `of ${summary.checkedIn} checked in`,
      percent: percent(summary.wfh, summary.checkedIn),
      color: 'violet',
    },
    {
      key: 'late',
      label: 'Late today',
      value: String(late.count),
      sub: late.count ? `average ${lateAverage(late.averageMinutes)}` : 'nobody so far',
      percent: percent(late.count, summary.checkedIn),
      color: 'marigold',
    },
    reportsKpi(summary, ctx),
  ];
}

/** Today's reads for the board, each one query; people come with their day and presence. */
async function loadToday(ctx, viewer) {
  const timersOff = ctx.settings.timersMode === 'off';
  const posting = todoPostingOn(ctx.settings);
  const [rows, calendar, labelRows, urgent, openBreaks, runningTimers, lineRows, postedAt] =
    await Promise.all([
      repo.listTrackedPeopleDay(ctx.today, { withAdmins: showsAdmins(viewer) }),
      loadDashboardCalendar({ from: ctx.today, to: ctx.today }),
      repo.listSubmittedReportProjects(ctx.today),
      repo.listUrgentProjects(),
      repo.listOpenBreaks(ctx.today),
      timersOff ? [] : repo.listRunningTimers(ctx.today),
      listReportLines({ date: ctx.today }),
      posting ? listTodoPostedAt({ date: ctx.today }) : new Map(),
    ]);
  const live = {
    breaks: new Map(openBreaks.map((item) => [item.userId, item.startedAt])),
    timers: new Map(runningTimers.map((item) => [item.userId, item])),
    lines: linesByReport(lineRows),
    posting,
    postedAt,
  };
  return {
    rows: withPresence(rows, { calendar, date: ctx.today, ctx }),
    holiday: holidayOn(calendar, ctx.today, ctx.settings.workingDays),
    labels: labelsByReport(labelRows),
    urgent,
    live,
  };
}

/** The attendance donut: office, WFH, not checked in and off today (CONTRACT 25). */
function attendanceDonut(summary) {
  return {
    total: summary.tracked,
    totalLabel: people(summary.tracked).replace(/^\d+ /, ''),
    segments: [
      { key: 'office', label: 'Office', value: summary.office, color: 'primary' },
      { key: 'wfh', label: 'Working from home', value: summary.wfh, color: 'violet' },
      { key: 'missing', label: 'Not checked in', value: summary.notCheckedIn, color: 'red' },
      { key: 'off', label: 'Off today', value: summary.off, color: 'teal' },
    ],
  };
}

/**
 * Everything the Team dashboard shows about today, for every active person who tracks
 * attendance and has joined (the whole team, as on the canvas and the Attendance screen).
 * Project managers and anyone else who doesn't track attendance never appear, and Admins appear
 * only to another Admin (company rule: their attendance is never shown to PMs or HR), in rows,
 * groups, counts, numbers and the donut alike. Each person's day (CONTRACT 25) decides the
 * group: someone on leave, on a holiday or on a day off without a check-in is in "Off today"
 * with a tag, never "Not checked in"; the payload never carries the leave type or pay.
 * @param {{ filter?: 'everyone'|'missing'|'late'|'no-todo', viewer?: { role: string } }}
 *   [options] filter picks the board rows; viewer is the signed-in person (none = a system read,
 *   sees everyone)
 * @returns {Promise<object>} { date, now, timezone, subtitle, holiday, dayStart, dayEnd, dayLabel,
 *   summary, kpis, attendance, urgent, reportDue: { label, before }, filter, counts: { everyone,
 *   missing, late, noTodo }, groups }; groups are office, wfh, not_checked_in and off; each board
 *   row's report is 'submitted' | 'draft' | 'due' | 'missing' | 'not_checked_in' | 'off' (see
 *   boardReportStatus; 'due' and 'draft' only before the report time, so the missing filter and
 *   its count are empty until then) with reportLabel ('Due 6:30 PM' | null), offTag ({ label,
 *   tone } | null), onBreak, breakSince (ISO | null) and workingOn ({ name, color, note } | null,
 *   the running timer; always null while timers are off, when running timers aren't read), todo
 *   (todoOf: { total, done, post, groups } | null) and noTodo (boolean). summary adds off; on a
 *   holiday the subtitle ends " · Holiday: <name>"
 */
export async function getTeamToday({ filter = 'everyone', viewer } = {}) {
  const loaded = await loadContext();
  const ctx = { ...loaded, due: reportDue(loaded) };
  const { rows, holiday, labels, urgent, live } = await loadToday(ctx, viewer);
  const summary = summarizeDay(rows);
  const board = rows.map((row) => boardRow(row, labels, ctx, live));
  const activeFilter = BOARD_FILTERS.includes(filter) ? filter : 'everyone';
  const shown = board.filter((row) => matchesFilter(row, activeFilter));
  const { officeStart, officeEnd } = ctx.settings;
  const subtitle = nowSubtitle(ctx);

  return {
    date: ctx.today,
    now: ctx.now.toISOString(),
    timezone: ctx.tz,
    subtitle: holiday ? `${subtitle} · Holiday: ${holiday.name}` : subtitle,
    holiday,
    dayStart: officeStart,
    dayEnd: officeEnd,
    dayLabel: `Day, ${formatClockShort(officeStart)} to ${formatClockShort(officeEnd)}`,
    summary,
    kpis: dayKpis(summary, ctx),
    attendance: attendanceDonut(summary),
    urgent: urgentItems(urgent, ctx, 'members'),
    reportDue: { label: ctx.due.label, before: ctx.due.before },
    filter: activeFilter,
    counts: {
      everyone: board.length,
      missing: board.filter((row) => matchesFilter(row, 'missing')).length,
      late: board.filter((row) => matchesFilter(row, 'late')).length,
      noTodo: board.filter((row) => matchesFilter(row, 'no-todo')).length,
    },
    groups: GROUPS.map((group) => {
      const groupRows = shown.filter((row) => row.group === group.key);
      return { ...group, count: groupRows.length, rows: groupRows };
    }),
  };
}

/**
 * Hours by project from submitted reports (build guide 7.10) for the week or month ending
 * today, ready for the "Hours logged by project" card.
 * @param {{ range?: 'week'|'month', scope?: 'team'|'company' }} [options]
 * @returns {Promise<{ range, from, to, subtitle, totalMinutes, bars, rows }>}
 */
export async function getHoursCard({ range = 'week', scope = 'team' } = {}) {
  const ctx = await loadContext();
  const period = periodFor(range, ctx.today);
  const rows = await repo.hoursByProject(period);
  const who = scope === 'company' ? 'whole company' : 'whole team';
  return {
    range: period.key,
    from: period.from,
    to: period.to,
    subtitle: `${period.key === 'month' ? 'This month' : 'This week'}, ${who}`,
    totalMinutes: totalMinutes(rows),
    bars: hoursBars(rows),
    rows,
  };
}

/**
 * Hours by project from submitted reports in a date range, largest first (GET
 * /api/stats/hours-by-project).
 * @param {{ from: string, to: string, userId?: number, limit?: number, offset?: number }} options
 * @returns {Promise<{ rows: { projectId, requestId, name, color, minutes, hours }[], total: number,
 *   totalMinutes: number }>}
 */
export async function getHoursByProject({ from, to, userId, limit = 100, offset = 0 }) {
  const rows = await repo.hoursByProject({ from, to, userId });
  return {
    rows: rows
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, hours: Math.round((row.minutes / 60) * 100) / 100 })),
    total: rows.length,
    totalMinutes: totalMinutes(rows),
  };
}
