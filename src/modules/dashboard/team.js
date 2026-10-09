// Team dashboard (artboard 05): today's numbers, the attendance donut, "Urgent now" and the team
// board, plus hours by project for a date range.
import { formatClockShort, formatDuration, formatTime } from '@/lib/time';
import { initials } from '@/lib/text';
import * as repo from './repo';
import {
  checkedInKpi,
  hoursBars,
  isoOrNull,
  loadContext,
  nowSubtitle,
  people,
  percent,
  periodFor,
  reportsKpi,
  summarizeDay,
  totalMinutes,
  urgentItems,
} from './shared';

export const BOARD_FILTERS = ['everyone', 'missing', 'late'];

const GROUPS = [
  { key: 'office', title: 'In office', tone: 'primary' },
  { key: 'wfh', title: 'Working from home', tone: 'violet' },
  { key: 'not_checked_in', title: 'Not checked in', tone: 'red' },
];

function groupOf(row) {
  if (!row.attendanceId) return 'not_checked_in';
  return row.location === 'wfh' ? 'wfh' : 'office';
}

/**
 * One team board row. Report: Submitted when today's report is submitted; Missing when the person
 * checked in without a submitted report (a draft counts as missing, like the "Report missing"
 * filter and the "Reports submitted" number); Not checked in otherwise. Logged is the submitted
 * report's total. onBreak, breakSince and workingOn are the live status (CONTRACT 15).
 */
function boardRow(row, labels, ctx, live) {
  const checkedIn = Boolean(row.attendanceId);
  const submitted = row.reportStatus === 'submitted';
  const lateMinutes = Number(row.lateMinutes ?? 0);
  let report = 'not_checked_in';
  if (submitted) report = 'submitted';
  else if (checkedIn) report = 'missing';
  return {
    id: row.id,
    name: row.name,
    initials: initials(row.name),
    designation: row.designation,
    role: row.role,
    avatarUrl: row.avatarUrl,
    href: `/team/${row.id}`,
    group: groupOf(row),
    checkInAt: isoOrNull(row.checkInAt),
    checkOutAt: isoOrNull(row.checkOutAt),
    checkIn: checkedIn ? formatTime(row.checkInAt, ctx.tz) : null,
    officeVerified: checkedIn ? Boolean(row.officeVerified) : null,
    lateMinutes,
    late: lateMinutes > 0 ? `Late ${formatDuration(lateMinutes)}` : null,
    loggedMinutes: submitted ? Number(row.totalMinutes ?? 0) : 0,
    logged: submitted ? formatDuration(row.totalMinutes) : checkedIn ? formatDuration(0) : '—',
    report,
    projects: submitted ? (labels.get(row.reportId) ?? []) : [],
    ...liveStatus(row.id, live),
  };
}

/** On break since when, and the running timer's project (CONTRACT 15). */
function liveStatus(userId, live) {
  const breakSince = live.breaks.get(userId) ?? null;
  const timer = live.timers.get(userId);
  return {
    onBreak: Boolean(breakSince),
    breakSince: isoOrNull(breakSince),
    workingOn: timer ? { name: timer.name, color: timer.color, note: timer.note ?? null } : null,
  };
}

function matchesFilter(row, filter) {
  if (filter === 'missing') return row.report === 'missing';
  if (filter === 'late') return row.lateMinutes > 0;
  return true;
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
      sub: late.count
        ? `average ${late.averageMinutes} ${late.averageMinutes === 1 ? 'minute' : 'minutes'}`
        : 'nobody so far',
      percent: percent(late.count, summary.checkedIn),
      color: 'marigold',
    },
    reportsKpi(summary, ctx),
  ];
}

function labelsByReport(rows) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.reportId) ?? [];
    if (!list.some((item) => item.name === row.name))
      list.push({ name: row.name, color: row.color });
    map.set(row.reportId, list);
  }
  return map;
}

/**
 * Everything the Team dashboard shows about today, for every active person who tracks
 * attendance and has joined (the whole team, as on the canvas and the Attendance screen).
 * Project managers and anyone else who doesn't track attendance never appear.
 * @param {{ filter?: 'everyone'|'missing'|'late' }} [options] filters the board rows
 * @returns {Promise<object>} { date, now, timezone, subtitle, dayStart, dayEnd, dayLabel, summary,
 *   kpis, attendance, urgent, filter, counts, groups }; each board row also has onBreak,
 *   breakSince (ISO | null) and workingOn ({ name, color, note } | null, the running timer;
 *   always null while timers are off, when running timers aren't read)
 */
export async function getTeamToday({ filter = 'everyone' } = {}) {
  const ctx = await loadContext();
  const timersOff = ctx.settings.timersMode === 'off';
  const [rows, labelRows, urgent, openBreaks, runningTimers] = await Promise.all([
    repo.listTrackedPeopleDay(ctx.today),
    repo.listSubmittedReportProjects(ctx.today),
    repo.listUrgentProjects(),
    repo.listOpenBreaks(ctx.today),
    timersOff ? [] : repo.listRunningTimers(ctx.today),
  ]);
  const summary = summarizeDay(rows);
  const labels = labelsByReport(labelRows);
  const live = {
    breaks: new Map(openBreaks.map((item) => [item.userId, item.startedAt])),
    timers: new Map(runningTimers.map((item) => [item.userId, item])),
  };
  const board = rows.map((row) => boardRow(row, labels, ctx, live));
  const activeFilter = BOARD_FILTERS.includes(filter) ? filter : 'everyone';
  const shown = board.filter((row) => matchesFilter(row, activeFilter));
  const { officeStart, officeEnd } = ctx.settings;

  return {
    date: ctx.today,
    now: ctx.now.toISOString(),
    timezone: ctx.tz,
    subtitle: nowSubtitle(ctx),
    dayStart: officeStart,
    dayEnd: officeEnd,
    dayLabel: `Day, ${formatClockShort(officeStart)} to ${formatClockShort(officeEnd)}`,
    summary,
    kpis: dayKpis(summary, ctx),
    attendance: {
      total: summary.tracked,
      totalLabel: people(summary.tracked).replace(/^\d+ /, ''),
      segments: [
        { key: 'office', label: 'Office', value: summary.office, color: 'primary' },
        { key: 'wfh', label: 'Working from home', value: summary.wfh, color: 'violet' },
        { key: 'missing', label: 'Not checked in', value: summary.notCheckedIn, color: 'red' },
      ],
    },
    urgent: urgentItems(urgent, ctx, 'members'),
    filter: activeFilter,
    counts: {
      everyone: board.length,
      missing: board.filter((row) => matchesFilter(row, 'missing')).length,
      late: board.filter((row) => matchesFilter(row, 'late')).length,
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
