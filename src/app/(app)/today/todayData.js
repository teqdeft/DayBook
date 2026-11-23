// Loads and shapes everything the Today page shows. Server only (called from page.js). Today's
// to-do (CONTRACT 24) replaced "My tasks this week": its first state comes from todayTodo.js.
// CONTRACT 25: the person's day (holiday, own leave), the This week labels from todayDay.js, the
// "coming up" lines and the missing check-outs for the pop-up.
import {
  addDays,
  clockToMinutes,
  formatClockShort,
  formatDayShort,
  formatDuration,
  formatHours,
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
import { shortDuration } from './timerData';
import { comingUpLines, weekDayLabel } from './todayDay';
import { statusPill, stillWorkingNote } from './todayStatus';
import { loadTimerParts, pickerWithTasks, timerCard, timersShownFor } from './todayTimers';
import { loadTodo } from './todayTodo';
import { loadWfh } from './todayWfh';

// The "Priority tasks" card shows this many; "Show more" opens the rest.
const MAX_PRIORITY_TASKS = 6;

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

/**
 * Mon-Fri (the working weekdays) of this week: logged hours, today's present time, future "—".
 * A past or current holiday or full-leave day without hours reads "Holiday" / "Leave", faded
 * (CONTRACT 25; `dayOf(date)` is the person's day).
 */
function weekDays({ today, current, submitted, dayStatus, presentToday, dayOf }) {
  const { from, to } = weekRange(today);
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isWorkingDay(date, current.workingDays) || date === today) days.push(date);
  }
  return days.map((date) => {
    const label = formatDayShort(date).slice(0, 3);
    if (date > today) return { date, label, value: 0, display: null };
    const off = weekDayLabel(dayOf(date));
    if (date === today && dayStatus.status !== 'submitted') {
      return {
        date,
        label,
        value: presentToday,
        display: presentToday > 0 ? formatHours(presentToday) : off,
        highlight: true,
        faded: true,
      };
    }
    const minutes = Number(submitted[date]) || 0;
    return {
      date,
      label,
      value: minutes,
      display: minutes > 0 ? formatHours(minutes) : off,
      highlight: date === today,
      ...(minutes === 0 && off ? { faded: true } : {}),
    };
  });
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
    projectId: Number(task.projectId ?? task.project?.id) || null,
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

/**
 * The second "Your day" tile (CONTRACT 15): worked time (present minus breaks). With breaks the
 * label says so ("Worked so far · 45m break"); without, it stays "Present so far".
 */
function workedTile(row, mine) {
  const done = Boolean(row?.checkOutAt);
  const hasBreaks = (mine.breaks?.length ?? 0) > 0;
  const label = hasBreaks
    ? `${done ? 'Worked today' : 'Worked so far'} · ${shortDuration(mine.breakMinutes)} break`
    : done
      ? 'Present today'
      : 'Present so far';
  return { value: formatDuration(mine.workedMinutes ?? mine.presentMinutes), label };
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
  const [mine, calendar] = await Promise.all([
    attendance.getMyToday({ user, ip }),
    attendance.loadCalendar({ from: week.from, to: week.to, userIds: [user.id], withWfh: false }),
  ]);
  // Screen time is recorded only for tracked people, and only while the company has it on.
  const screenTracked =
    current.activityTrackingEnabled !== false &&
    can(user, 'activity.self') &&
    Boolean(user.tracksAttendance);
  // The picker and its priority tasks serve the timer form and the to-do: loaded once.
  const pickerParts =
    timersShownFor(user, current) || can(user, 'report.self')
      ? pickerWithTasks(user.id)
      : Promise.resolve({ picker: null, tasks: [] });
  const timerParts = loadTimerParts(user, current, pickerParts);
  const [dayStatus, submitted, urgent, pending, todayReports, screen, priority, cards] =
    await Promise.all([
      safe(reports.getDayStatus(user.id, today), { status: 'none', totalMinutes: 0 }),
      safe(reports.getSubmittedMinutesByDay(user.id, week.from, today), {}),
      safe(projects.listUrgentForMember(user.id), []),
      attendance.listCorrections({ status: 'pending', userId: user.id, limit: 10 }),
      safe(reports.listReports({ user, from: today, to: today, limit: 1 }), { rows: [] }),
      screenTracked ? safe(activity.getDay(user.id, today), null) : null,
      safe(projectTasks.listOpenForUser(user.id), []),
      Promise.all([
        timerParts,
        loadWfh({ user, mine, today, current }),
        loadTodo({ user, timerParts, pickerParts }),
      ]),
    ]);
  const [timerState, wfhParts, todo] = cards;
  const row = mine.row;
  const presentToday = mine.presentMinutes;
  // Today's bar shows worked time (present minus breaks, CONTRACT 15) until the report is in.
  const workedToday = mine.workedMinutes ?? presentToday;
  const days = weekDays({
    today,
    current,
    submitted,
    dayStatus,
    presentToday: workedToday,
    dayOf: (date) => calendar.dayFor(user, date),
  });
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
    // CONTRACT 17: Office from any network, and WFH only on days HR approved.
    officeAnywhere: Boolean(mine.officeAnywhere),
    wfh: wfhParts.wfh,
    wfhLinks: wfhParts.wfhLinks,
    presentToday,
    worked: workedTile(row, mine),
    onBreak: Boolean(row && mine.openBreak),
    pill: statusPill(row, tz, mine.openBreak),
    // After office hours, while still checked in (auto check-out, CONTRACT 19).
    stillWorking: stillWorkingNote({ row, settings: current, tz }),
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
    // The person's day (CONTRACT 25): holiday, own leave (type and pay, never HR's note), the
    // next leave and holiday, and the missing check-outs for the pop-up.
    day: mine.day,
    upcoming: mine.upcoming,
    missing: mine.missing,
    comingUp: comingUpLines({ upcoming: mine.upcoming, today }),
    screenTime: screenTracked ? screenTimeLine(screen) : null,
    priority: priorityRows(priority, user.id),
    timer: timerCard({ row, parts: timerState, breaks: mine.breaks, tz }),
    // Today's to-do (CONTRACT 24): { initialTodo, picker, priority }, null without report.self.
    todo,
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
