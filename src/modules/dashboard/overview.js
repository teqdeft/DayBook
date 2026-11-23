// Company overview (artboard 11, Admin): five numbers, hours by project, attendance this week,
// "Needs attention", team by department and urgent projects. Each person's day (CONTRACT 25)
// decides who was expected: holidays and leave are never "Not checked in", and hours are
// compared with the working days so far.
import {
  eachDay,
  formatHours,
  formatRelativeDay,
  localToUtc,
  monthOf,
  monthRange,
  weekRange,
} from '@/lib/time';
import { can } from '@/lib/permissions';
import { plural } from '@/lib/text';
import { attendance } from '@/modules/attendance';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import * as repo from './repo';
import { attendanceWeek } from './overviewWeek';
import { requestsKpi } from './requestsCard';
import {
  checkedInKpi,
  hoursBars,
  loadContext,
  loadDashboardCalendar,
  nowSubtitle,
  officeDayMinutes,
  percent,
  periodFor,
  reportDue,
  reportsKpi,
  summarizeDay,
  totalMinutes,
  urgentItems,
  withPresence,
} from './shared';

export { requestsHref, requestsKpi, requestsSub } from './requestsCard';

// Department bar colours in department order (the canvas: Development blue, SEO violet, Delivery
// teal, HR pink, Sales green, Leadership navy); later departments reuse them.
const DEPARTMENT_COLORS = ['blue', 'violet', 'teal', 'pink', 'green', 'navy'];

/**
 * "Hours this week": hours from submitted reports, Monday to today. The bar compares them with
 * the office hours each tracked person was expected on the working days so far (CONTRACT 25:
 * a holiday, full-day leave or a day before joining counts 0, a half day of leave half).
 */
function hoursKpi({ weekMinutes, people, calendar, ctx }) {
  const { from } = weekRange(ctx.today);
  const expectedDays = eachDay(from, ctx.today).reduce(
    (sum, date) =>
      sum + people.reduce((daySum, person) => daySum + calendar.dayFor(person, date).expected, 0),
    0,
  );
  return {
    key: 'hours',
    label: 'Hours this week',
    value: formatHours(weekMinutes),
    footer: 'Monday to today',
    percent: percent(weekMinutes, expectedDays * officeDayMinutes(ctx.settings)),
    color: 'teal',
  };
}

/**
 * The requests waiting for this viewer, counted as /requests and /attendance list them (never
 * their own report edit request), each kind only when the viewer may handle it, plus those
 * created since `since` and already handled, in the same scope (the card's bar).
 * @returns {Promise<{ edits, projects, corrections, editsHandled, projectsHandled,
 *   correctionsHandled }>} numbers
 */
async function requestCounts(viewer, since) {
  const corrections = can(viewer, 'attendance.correct');
  const edits = can(viewer, 'report.approve_edit') && (viewer.role === 'admin' ? 'all' : viewer.id);
  const [pendingEdits, pendingProjects, pendingCorrections, handled] = await Promise.all([
    reports.countPendingEditRequestsFor(viewer),
    projects.countPendingRequestsFor(viewer),
    corrections ? attendance.countPendingCorrections({ viewer }) : 0,
    repo.countHandledRequests(since, {
      edits,
      projects: can(viewer, 'project_request.handle'),
      corrections,
      selfId: viewer?.id,
      withAdmins: viewer?.role === 'admin',
    }),
  ]);
  return {
    edits: pendingEdits,
    projects: pendingProjects,
    corrections: pendingCorrections,
    ...handled,
  };
}

function missingCheckoutText(rows, ctx) {
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const text = `${count} missing ${plural(count, 'check-out')}`;
  if (rows.length !== 1) return text;
  const relative = formatRelativeDay(rows[0].workDate, ctx.today);
  const when = ['Today', 'Yesterday'].includes(relative) ? relative.toLowerCase() : relative;
  return `${text} from ${when}`;
}

/**
 * The "Needs attention" list: only items with something waiting, each linking to its screen.
 * Reports not submitted count as missing only from today's report time on; before it they are
 * still due, so they wait (Pending) and link to the whole board, as the board shows them.
 */
function needsAttention({ summary, counts, missing, ctx }) {
  const items = [];
  const notSubmitted = summary.reports.missing;
  const due = reportDue(ctx);
  if (notSubmitted > 0) {
    const reports = `${notSubmitted} ${plural(notSubmitted, 'report')}`;
    items.push(
      due.before
        ? {
            key: 'reports',
            status: 'pending',
            text: `${reports} due at ${due.label}`,
            href: '/team',
          }
        : {
            key: 'reports',
            status: 'missing',
            text: `${reports} not submitted yet`,
            href: '/team?filter=missing',
          },
    );
  }
  if (counts.edits > 0) {
    items.push({
      key: 'edits',
      status: 'pending',
      text: `${counts.edits} report edit ${plural(counts.edits, 'request')}`,
      href: '/requests',
    });
  }
  if (counts.projects > 0) {
    items.push({
      key: 'projects',
      status: 'pending',
      text: `${counts.projects} new project ${plural(counts.projects, 'request')}`,
      href: '/requests',
    });
  }
  if (counts.corrections > 0) {
    items.push({
      key: 'corrections',
      status: 'pending',
      text: `${counts.corrections} attendance correction ${plural(counts.corrections, 'request')}`,
      href: '/attendance',
    });
  }
  if (missing.length > 0) {
    items.push({
      key: 'checkouts',
      status: 'missing',
      text: missingCheckoutText(missing, ctx),
      href: '/attendance',
    });
  }
  return items;
}

function departmentBars(rows, ids) {
  return rows.map((row) => {
    const index = Math.max(0, ids.indexOf(row.id));
    return {
      key: row.id,
      label: row.name,
      value: row.count,
      display: String(row.count),
      color: DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length],
    };
  });
}

/** The Overview's reads, each one query (the calendar three), in parallel. */
async function loadOverview({ ctx, viewer, week, card }) {
  const monthStart = localToUtc(monthRange(monthOf(ctx.today)).from, '00:00', ctx.tz).toDate();
  const weekEnd = weekRange(ctx.today).to;
  const [rows, calendar, weekRows, cardRows, active, requests, missing, checkIns, ...rest] =
    await Promise.all([
      repo.listTrackedPeopleDay(ctx.today),
      loadDashboardCalendar({ from: week.from, to: weekEnd }),
      repo.hoursByProject(week),
      card.key === 'week' ? null : repo.hoursByProject(card),
      repo.countProjects(),
      requestCounts(viewer, monthStart),
      repo.countMissingCheckouts(),
      repo.listCheckInsBetween(week.from, ctx.today),
      repo.countPeopleByDepartment(),
      repo.listDepartmentIds(),
      repo.listUrgentProjects(),
    ]);
  const [departments, ids, urgent] = rest;
  const people = withPresence(rows, { calendar, date: ctx.today, ctx });
  return {
    people,
    calendar,
    weekRows,
    cardRows,
    active,
    requests,
    missing,
    checkIns,
    departments,
    ids,
    urgent,
  };
}

/**
 * Everything on the Company overview.
 * @param {{ viewer: object, range?: 'week'|'month' }} options viewer: the signed-in person
 *   ("Pending requests" and "Needs attention" count what waits for them, as /requests and
 *   /attendance list it); range: of the "Hours by project" card
 * @returns {Promise<object>} { date, subtitle, summary, kpis, pending, hours, attendanceWeek,
 *   needsAttention, departments, urgent }; summary adds off (CONTRACT 25), attendanceWeek days
 *   carry the Off segment and, on a holiday, faded and title
 */
export async function getOverview({ viewer, range = 'week' } = {}) {
  const ctx = await loadContext();
  const week = periodFor('week', ctx.today);
  const card = periodFor(range, ctx.today);
  const data = await loadOverview({ ctx, viewer, week, card });
  const { people, calendar, weekRows, active, requests } = data;
  const summary = summarizeDay(people);
  const hoursRows = data.cardRows ?? weekRows;
  return {
    date: ctx.today,
    now: ctx.now.toISOString(),
    timezone: ctx.tz,
    subtitle: nowSubtitle(ctx),
    summary,
    kpis: [
      checkedInKpi(summary, 'In today'),
      reportsKpi(summary, ctx),
      hoursKpi({ weekMinutes: totalMinutes(weekRows), people, calendar, ctx }),
      {
        key: 'projects',
        label: 'Active projects',
        value: String(active.active),
        sub: `${active.urgent} marked urgent`,
        percent: percent(active.urgent, active.active),
        color: 'marigold',
      },
      requestsKpi(requests, viewer),
    ],
    pending: requests,
    hours: {
      range: card.key,
      from: card.from,
      to: card.to,
      subtitle: `${card.key === 'month' ? 'This month' : 'This week'}, whole company`,
      totalMinutes: totalMinutes(hoursRows),
      bars: hoursBars(hoursRows),
      rows: hoursRows,
    },
    attendanceWeek: attendanceWeek({ checkIns: data.checkIns, people, calendar, ctx }),
    needsAttention: needsAttention({ summary, counts: requests, missing: data.missing, ctx }),
    departments: departmentBars(data.departments, data.ids),
    urgent: urgentItems(data.urgent, ctx, 'marker'),
  };
}
