// Loads and shapes everything the Today page shows. Server only (called from page.js).
import {
  addDays,
  clockToMinutes,
  formatClockShort,
  formatDayMonthShort,
  formatDayShort,
  formatDuration,
  formatHours,
  formatRelativeDay,
  formatTime,
  formatTimeAmPm,
  isWorkingDay,
  localToUtc,
  locksAtFor,
  minutesBetween,
  now,
  toLocal,
  weekRange,
  workDate as localDate,
} from '@/lib/time';
import { can } from '@/lib/permissions';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';

const OPEN_TASK = new Set(['in_progress', 'blocked']);
// The artboard's card holds four rows, level with the urgent card beside it; the full list is in
// My log.
const MAX_TASKS = 4;
const STATUS_ORDER = { in_progress: 0, blocked: 1, done: 2 };
// The "Priority tasks" card shows this many; "Show more" opens the rest.
const MAX_PRIORITY_TASKS = 6;

/** The status pill next to "Check out": "In office since 9:32", WFH, unverified or checked out. */
function statusPill(row, tz) {
  if (!row) return null;
  const since = formatTime(row.checkInAt, tz);
  if (row.checkOutAt) {
    return { tone: 'neutral', text: `Checked out at ${formatTime(row.checkOutAt, tz)}` };
  }
  if (row.checkoutStatus !== 'open') return { tone: 'neutral', text: 'Checked out' };
  if (row.location === 'wfh') return { tone: 'violet', text: `Working from home since ${since}` };
  if (!row.officeVerified) {
    return { tone: 'marigold', text: `In office since ${since}, unverified` };
  }
  return { tone: 'green', text: `In office since ${since}` };
}

/**
 * Day bar labels for phones, where the bar is too short for all four: the start, the moving
 * "Now" / "Out" label and the report time, dropping the ones the moving label would cover.
 */
function phoneLabels({ row, current, tz }) {
  if (!row) return [];
  const startMin = clockToMinutes(current.officeStart);
  const endMin = Math.max(clockToMinutes(current.reportReminderAt), startMin + 1);
  const moment = row.checkOutAt ?? now();
  const clock = toLocal(moment, tz).format('HH:mm');
  const pct = ((clockToMinutes(clock) - startMin) / (endMin - startMin)) * 100;
  const text = row.checkOutAt
    ? `Out ${formatTime(row.checkOutAt, tz)}`
    : `Now ${formatTime(moment, tz)}`;
  const align = pct < 20 ? 'start' : pct > 80 ? 'end' : 'center';
  const labels = [];
  if (pct > 30)
    labels.push({
      at: current.officeStart,
      text: formatClockShort(current.officeStart),
      align: 'start',
    });
  labels.push({ at: clock, text, strong: true, align });
  if (pct < 62) {
    labels.push({
      at: current.reportReminderAt,
      text: `${formatClockShort(current.reportReminderAt)} report`,
      align: 'end',
    });
  }
  return labels;
}

/** "Report due in 3h 20m", "Report overdue" or "Report submitted". */
function reportTag(dayStatus, dueAt) {
  if (dayStatus.status === 'submitted') return { tone: 'green', text: 'Report submitted' };
  const left = minutesBetween(now(), dueAt);
  if (left <= 0) return { tone: 'red', text: 'Report overdue' };
  return { tone: 'marigold', text: `Report due in ${formatDuration(left)}` };
}

/** Mon-Fri (the working days) of this week: logged hours, today's present time, future "—". */
function weekDays({ today, current, submitted, dayStatus, presentToday }) {
  const { from, to } = weekRange(today);
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isWorkingDay(date, current.workingDays) || date === today) days.push(date);
  }
  return days.map((date) => {
    const label = formatDayShort(date).slice(0, 3);
    if (date > today) return { date, label, value: 0, display: null };
    if (date === today && dayStatus.status !== 'submitted') {
      return {
        date,
        label,
        value: presentToday,
        display: presentToday > 0 ? formatHours(presentToday, 1) : null,
        highlight: true,
        faded: true,
      };
    }
    const minutes = Number(submitted[date]) || 0;
    return {
      date,
      label,
      value: minutes,
      display: minutes > 0 ? formatHours(minutes, 1) : null,
      highlight: date === today,
    };
  });
}

/** 'Today', 'Since Monday' (an open task first reported earlier), 'Friday', 'Yesterday'. */
function updatedLabel(task, today) {
  const first = task.firstReportedOn;
  if (task.status === 'in_progress' && first && first < task.workDate) {
    const since = formatRelativeDay(first, today);
    if (since === 'Yesterday') return 'Since yesterday';
    return /^\d/.test(since) ? `Since ${formatDayMonthShort(first)}` : `Since ${since}`;
  }
  return formatRelativeDay(task.workDate, today);
}

/**
 * This week's tasks plus tasks still open from the week before: in progress first, then blocked,
 * then done, each newest first (the order the artboard shows).
 */
function taskRows(tasks, { from, today }) {
  return tasks
    .filter((task) => task.workDate >= from || OPEN_TASK.has(task.status))
    .map((task, index) => ({ task, index }))
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.task.status] ?? 3) - (STATUS_ORDER[b.task.status] ?? 3) ||
        a.index - b.index,
    )
    .slice(0, MAX_TASKS)
    .map(({ task }) => task)
    .map((task) => ({
      id: task.taskId,
      title: task.title,
      status: task.status,
      project: { name: task.projectName, color: task.projectColor },
      updated: updatedLabel(task, today),
    }));
}

/**
 * The "Priority tasks" card (CONTRACT section 13): every open priority task of the person, P1
 * first (the order listOpenForUser gives); the card shows the first MAX_PRIORITY_TASKS and opens
 * the rest with "Show more".
 * @returns {{ rows: Array<{ id, priority, title, project, forYou }>, initial: number }}
 */
function priorityRows(tasks, userId) {
  const rows = tasks.map((task) => ({
    id: task.id,
    priority: task.priority,
    title: task.title,
    project: { name: task.project?.name ?? '', color: task.project?.color ?? null },
    forYou: Number(task.assigneeId ?? task.assignee?.id) === Number(userId),
  }));
  return { rows, initial: MAX_PRIORITY_TASKS };
}

/**
 * The quiet "Screen time today" line in Your day (docs/CONTRACT.md section 11), or null when the
 * day couldn't be read.
 */
function screenTimeLine(day) {
  if (!day) return null;
  const active = Number(day.activeMinutes) || 0;
  const idle = Number(day.idleMinutes) || 0;
  const locked = Number(day.lockedMinutes) || 0;
  if (active + idle + locked === 0) return 'Screen time today: nothing recorded yet';
  return `Screen time today: active ${formatDuration(active)} · idle ${formatDuration(idle)}`;
}

async function safe(promise, fallback) {
  try {
    return (await promise) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Everything on Today for one person.
 * @param {{ user: object, ip: string | null }} input
 */
export async function loadToday({ user, ip }) {
  const current = await settings.getAll();
  const tz = current.timezone;
  const today = localDate(tz);
  const week = weekRange(today);
  const mine = await attendance.getMyToday({ user, ip });
  // Screen time is recorded only for tracked people, and only while the company has it on.
  const screenTracked =
    current.activityTrackingEnabled !== false &&
    can(user, 'activity.self') &&
    Boolean(user.tracksAttendance);
  const [dayStatus, submitted, tasks, urgent, pending, todayReports, screen, priority] =
    await Promise.all([
      safe(reports.getDayStatus(user.id, today), { status: 'none', totalMinutes: 0 }),
      safe(reports.getSubmittedMinutesByDay(user.id, week.from, today), {}),
      safe(reports.listRecentTasks(user.id, addDays(week.from, -7), today), []),
      safe(projects.listUrgentForMember(user.id), []),
      attendance.listCorrections({ status: 'pending', userId: user.id, limit: 10 }),
      safe(reports.listReports({ user, from: today, to: today, limit: 1 }), { rows: [] }),
      screenTracked ? safe(activity.getDay(user.id, today), null) : null,
      safe(projectTasks.listOpenForUser(user.id), []),
    ]);
  const row = mine.row;
  const presentToday = mine.presentMinutes;
  const days = weekDays({ today, current, submitted, dayStatus, presentToday });
  const loggedSoFar = days.reduce((sum, day) => sum + (Number(day.value) || 0), 0);
  const dueAt = localToUtc(today, current.reportReminderAt, tz);
  const locksAt = locksAtFor(today, current.reportLock, tz);
  const lockDay = localDate(tz, locksAt) === today ? 'today' : 'tomorrow';
  // "Projects today" = the entries (projects) in today's report, draft or submitted.
  const projectsToday = todayReports.rows?.[0]?.entries?.length ?? 0;
  return {
    tz,
    today,
    now: now().toDate(),
    settings: current,
    row,
    onOfficeNetwork: mine.onOfficeNetwork,
    presentToday,
    pill: statusPill(row, tz),
    phoneLabels: phoneLabels({ row, current, tz }),
    reportStatus: dayStatus.status,
    locksText: `${formatTimeAmPm(locksAt, tz)} ${lockDay}`,
    reportTag: reportTag(dayStatus, dueAt),
    week: {
      days,
      max: Math.max(clockToMinutes(current.officeEnd) - clockToMinutes(current.officeStart), 60),
      subtitle: `${formatDuration(loggedSoFar)} logged so far`,
    },
    projectsToday,
    screenTime: screenTracked ? screenTimeLine(screen) : null,
    tasks: taskRows(tasks, { from: week.from, today }),
    priority: priorityRows(priority, user.id),
    urgent,
    pending: pending.items.map((item) => ({
      id: item.id,
      text: `${TYPE_LABELS[item.type]} on ${formatDayShort(item.workDate)}`,
    })),
    hasPendingEarlier: pending.items.some(
      (item) => item.type === 'check_in' && item.workDate === today,
    ),
  };
}

const TYPE_LABELS = {
  check_in: 'Check-in time',
  check_out: 'Check-out time',
  missing_day: 'Missing day',
};
