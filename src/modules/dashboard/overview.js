// Company overview (artboard 11, Admin): five numbers, hours by project, attendance this week,
// "Needs attention", team by department and urgent projects.
import {
  addDays,
  eachDay,
  formatHours,
  formatRelativeDay,
  isoWeekday,
  isWorkingDay,
  localToUtc,
  monthOf,
  monthRange,
  weekRange,
} from '@/lib/time';
import { plural } from '@/lib/text';
import * as repo from './repo';
import {
  checkedInKpi,
  hoursBars,
  loadContext,
  nowSubtitle,
  officeDayMinutes,
  percent,
  periodFor,
  reportsKpi,
  summarizeDay,
  totalMinutes,
  urgentItems,
} from './shared';

// Department bar colours in department order (the canvas: Development blue, SEO violet, Delivery
// teal, HR pink, Sales green, Leadership navy); later departments reuse them.
const DEPARTMENT_COLORS = ['blue', 'violet', 'teal', 'pink', 'green', 'navy'];
const WEEKDAY = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

/**
 * "Hours this week": hours from submitted reports, Monday to today. The bar compares them with
 * the office hours of every tracked person on the working days so far.
 */
function hoursKpi({ weekMinutes, summary, ctx }) {
  const { from } = weekRange(ctx.today);
  const daysSoFar = eachDay(from, ctx.today).filter((d) =>
    isWorkingDay(d, ctx.settings.workingDays),
  ).length;
  const officeMinutes = officeDayMinutes(ctx.settings);
  return {
    key: 'hours',
    label: 'Hours this week',
    value: formatHours(weekMinutes, 0),
    footer: 'Monday to today',
    percent: percent(weekMinutes, summary.tracked * daysSoFar * officeMinutes),
    color: 'teal',
  };
}

/**
 * "Pending requests": report edits, project requests and attendance fixes waiting for a
 * decision. The bar is the share of this month's requests still waiting.
 */
function requestsKpi(counts) {
  const pending = counts.edits + counts.projects + counts.corrections;
  const handled = counts.editsHandled + counts.projectsHandled + counts.correctionsHandled;
  return {
    key: 'requests',
    label: 'Pending requests',
    value: String(pending),
    sub: 'edits, projects, fixes',
    percent: percent(pending, pending + handled),
    color: 'violet',
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

/** The "Needs attention" list: only items with something waiting, each linking to its screen. */
function needsAttention({ summary, counts, missing, ctx }) {
  const items = [];
  const notSubmitted = summary.reports.missing;
  if (notSubmitted > 0) {
    items.push({
      key: 'reports',
      status: 'missing',
      text: `${notSubmitted} ${plural(notSubmitted, 'report')} not submitted yet`,
      href: '/team?filter=missing',
    });
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

/**
 * Office, WFH and not checked in per working day of this week; days to come stay empty. The
 * people expected on a day are today's tracked people who had joined by then (as on the
 * Attendance screen), so "not checked in" is those of them without a check-in.
 */
function attendanceWeek({ rows, people, ctx }) {
  const { from } = weekRange(ctx.today);
  const days = [...ctx.settings.workingDays].sort((a, b) => a - b).map((w) => addDays(from, w - 1));
  const onDay = (date) => rows.filter((row) => row.workDate === date);
  const count = (date, location) =>
    onDay(date).find((row) => row.location === location)?.count ?? 0;
  const expected = (date) =>
    people.filter((person) => !person.joinedOn || person.joinedOn <= date).length;
  const checkedInJoined = (date) => onDay(date).reduce((sum, row) => sum + row.joined, 0);
  return {
    max: people.length,
    days: days.map((date) => {
      const label = WEEKDAY[isoWeekday(date)];
      if (date > ctx.today) return { date, label, highlight: false, segments: [] };
      const office = count(date, 'office');
      const wfh = count(date, 'wfh');
      const missing = Math.max(0, expected(date) - checkedInJoined(date));
      return {
        date,
        label,
        highlight: date === ctx.today,
        segments: [
          { label: 'Office', value: office, color: 'primary' },
          { label: 'Working from home', value: wfh, color: 'violet' },
          { label: 'Not checked in', value: missing, color: 'red' },
        ],
      };
    }),
  };
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

/**
 * Everything on the Company overview.
 * @param {{ range?: 'week'|'month' }} [options] range of the "Hours by project" card
 * @returns {Promise<object>} { date, subtitle, summary, kpis, hours, attendanceWeek,
 *   needsAttention, departments, urgent }
 */
export async function getOverview({ range = 'week' } = {}) {
  const ctx = await loadContext();
  const week = periodFor('week', ctx.today);
  const card = periodFor(range, ctx.today);
  const monthStart = localToUtc(monthRange(monthOf(ctx.today)).from, '00:00', ctx.tz).toDate();
  const [people, weekRows, cardRows, projects, requests, missing, byDay, departments, ids, urgent] =
    await Promise.all([
      repo.listTrackedPeopleDay(ctx.today),
      repo.hoursByProject(week),
      card.key === 'week' ? null : repo.hoursByProject(card),
      repo.countProjects(),
      repo.countRequests(monthStart),
      repo.countMissingCheckouts(),
      repo.countAttendanceByDay(week.from, weekRange(ctx.today).to),
      repo.countPeopleByDepartment(),
      repo.listDepartmentIds(),
      repo.listUrgentProjects(),
    ]);
  const summary = summarizeDay(people);
  const hoursRows = cardRows ?? weekRows;
  return {
    date: ctx.today,
    now: ctx.now.toISOString(),
    timezone: ctx.tz,
    subtitle: nowSubtitle(ctx),
    summary,
    kpis: [
      checkedInKpi(summary, 'In today'),
      reportsKpi(summary, ctx),
      hoursKpi({ weekMinutes: totalMinutes(weekRows), summary, ctx }),
      {
        key: 'projects',
        label: 'Active projects',
        value: String(projects.active),
        sub: `${projects.urgent} marked urgent`,
        percent: percent(projects.urgent, projects.active),
        color: 'marigold',
      },
      requestsKpi(requests),
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
    attendanceWeek: attendanceWeek({ rows: byDay, people, ctx }),
    needsAttention: needsAttention({ summary, counts: requests, missing, ctx }),
    departments: departmentBars(departments, ids),
    urgent: urgentItems(urgent, ctx, 'marker'),
  };
}
