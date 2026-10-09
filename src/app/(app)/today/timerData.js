// Pure helpers for Today's Working on card (CONTRACT 15). No server imports: the server loader
// (todayTimers.js), the client components and the unit tests all use them.
import { dayjs, formatClockShort, formatDuration, minutesBetween } from '@/lib/time';

const PRIORITY_LABELS = { p1: 'P1', p2: 'P2', p3: 'P3' };

/**
 * Open priority tasks by project id, for the task select: `{ [projectId]: [{ id, title,
 * priority }] }`, each list in the order given (P1 first). Rows without a project are skipped.
 * @param {Array<{ id: number, title: string, priority: string, projectId?: number,
 *   project?: { id: number } }>} rows
 * @returns {Record<string, Array<{ id: number, title: string, priority: string }>>}
 */
export function tasksByProject(rows) {
  const byProject = {};
  for (const row of rows ?? []) {
    const projectId = Number(row.projectId ?? row.project?.id);
    if (!projectId) continue;
    (byProject[projectId] ??= []).push({
      id: Number(row.id),
      title: row.title,
      priority: row.priority,
    });
  }
  return byProject;
}

/**
 * The task select's options for one project: "No priority task", then its open tasks, plus the
 * task an entry already links when it is no longer open (so editing keeps it).
 * @param {Array<{ id, title, priority }>} tasks the project's open tasks
 * @param {{ projectTaskId?: number | null, priority?: string | null,
 *   projectTaskTitle?: string | null } | null} [linked]
 * @returns {Array<{ value: string, label: string }>} empty when there is nothing to pick
 */
export function taskOptions(tasks, linked = null) {
  const list = [...(tasks ?? [])];
  const linkedId = Number(linked?.projectTaskId) || null;
  if (linkedId && !list.some((task) => Number(task.id) === linkedId)) {
    list.push({
      id: linkedId,
      title: linked.projectTaskTitle ?? 'Linked task',
      priority: linked.priority,
    });
  }
  if (list.length === 0) return [];
  return [
    { value: '', label: 'No priority task' },
    ...list.map((task) => ({
      value: String(task.id),
      label: `${PRIORITY_LABELS[task.priority] ?? 'P3'} · ${task.title}`,
    })),
  ];
}

/** The project picker's lists for timers: real projects only (no pending project requests). */
export function timerPicker(picker) {
  return {
    urgent: picker?.urgent ?? [],
    mine: picker?.mine ?? [],
    others: picker?.others ?? [],
    requests: [],
  };
}

/** A project from the picker lists by id, or null. */
export function findProject(picker, projectId) {
  const id = Number(projectId);
  if (!id) return null;
  const lists = [picker?.urgent, picker?.mine, picker?.others];
  for (const list of lists) {
    const found = (list ?? []).find((item) => Number(item.id) === id);
    if (found) return found;
  }
  return null;
}

/** '9:30–10:15', or '10:15–now' while it runs. */
export function entryRange(entry) {
  const start = formatClockShort(entry.startClock);
  return entry.endClock ? `${start}–${formatClockShort(entry.endClock)}` : `${start}–now`;
}

/** Minutes for a list or a toast: '45m', '1h 5m', and '0m' (not '0h') under a minute. */
export function shortDuration(minutes) {
  return minutes > 0 ? formatDuration(minutes) : '0m';
}

/**
 * The entry the running break paused: the last one stopped for a break when the break started.
 * @param {{ onBreak: boolean, breakStartedAt: string | null, entries: object[] }} state
 * @returns {object | null}
 */
export function pausedEntry(state) {
  if (!state?.onBreak || !state.breakStartedAt) return null;
  const started = dayjs(state.breakStartedAt).valueOf();
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index];
    if (entry.stopReason !== 'break' || !entry.endedAt) continue;
    return Math.abs(dayjs(entry.endedAt).valueOf() - started) < 2000 ? entry : null;
  }
  return null;
}

/**
 * The times an "Add time" dialog starts with: the latest free stretch of today, so the defaults
 * never overlap a timer or a break (the server refuses overlaps, to the minute). To is now, or
 * the start of whatever still runs (the timer, an open break: both last until now). From is the
 * latest end of a finished entry or break up to To, else the check-in; it stays empty when it
 * would not be before To (nothing free right before it).
 * @param {{ entries: Array<{ startClock: string, endClock: string | null }>,
 *   breaks?: Array<{ startClock: string, endClock: string | null }>,
 *   checkInClock: string | null, nowClock: string }} input clocks 'HH:mm'; entries and breaks
 *   are today's, a running one without endClock
 * @returns {{ startClock: string, endClock: string }}
 */
export function addTimeDefaults({ entries, breaks = [], checkInClock, nowClock }) {
  const stretches = [...(entries ?? []), ...(breaks ?? [])].filter((item) => item?.startClock);
  const to = stretches
    .filter((item) => !item.endClock)
    .reduce((end, item) => (item.startClock < end ? item.startClock : end), nowClock);
  const ends = stretches.map((item) => item.endClock).filter((end) => end && end <= to);
  const from = ends.length > 0 ? ends.sort().at(-1) : (checkInClock ?? '');
  return { startClock: from && from < to ? from : '', endClock: to };
}

/**
 * What the card's live region says, so a screen reader hears the timer start, stop or pause
 * (never the ticking digits).
 */
export function timerAnnouncement(state) {
  if (!state) return '';
  if (state.running) return `Timer running on ${state.running.projectName}.`;
  if (state.onBreak) {
    return pausedEntry(state) ? 'Timer paused for your break.' : "You're on a break.";
  }
  return 'No timer running.';
}

/** The toast after a break ends: "Break ended · 25m", and how far over the allowance it went. */
export function breakEndedToast(data) {
  const ended = data?.break;
  const minutes = ended?.endedAt ? minutesBetween(ended.startedAt, ended.endedAt) : 0;
  const over = Number(data?.overAllowanceMinutes) || 0;
  return {
    title: `Break ended · ${shortDuration(minutes)}`,
    body: over > 0 ? `Over your daily allowance by ${formatDuration(over)}` : undefined,
  };
}

/**
 * The check-out toast's body: the gap warning (worked time against logged hours, guide 7.3.3),
 * else the worked time when there were breaks, else a reminder when the report is still to do.
 * @param {{ gapWarning: boolean, loggedMinutes: number, presentMinutes: number,
 *   workedMinutes?: number, breakMinutes?: number, reportPending: boolean }} data
 * @returns {string | undefined}
 */
export function checkOutBody(data) {
  const breaks = Number(data.breakMinutes) || 0;
  const worked = formatDuration(data.workedMinutes ?? data.presentMinutes);
  const workedText = `You worked ${worked} (${formatDuration(breaks)} of breaks)`;
  if (data.gapWarning && data.loggedMinutes > 0) {
    const next = data.reportPending
      ? 'Add any missing hours, then submit your report.'
      : 'Add any missing hours to your report.';
    const here = breaks > 0 ? workedText : `You were here ${formatDuration(data.presentMinutes)}`;
    return `${here} and logged ${formatDuration(data.loggedMinutes)}. ${next}`;
  }
  if (breaks > 0) {
    return `${workedText}.${data.reportPending ? " Don't forget today's report." : ''}`;
  }
  return data.reportPending ? "Don't forget today's report." : undefined;
}
