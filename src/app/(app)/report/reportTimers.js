// Pure helpers for project timers in the daily report (CONTRACT 15, browser side): "Fill report
// from timers", the hours a card takes from timers in required mode, and what the
// "From your timers" card lists. `timers` is { mode, required, summary } from
// reports.timersForReport (the page's data.timers, or a fresher copy from
// GET /api/reports/:id/timers). A summary's `roundedMinutes` is the project's timer time in whole
// minutes (no 15-minute rounding since the company asked for exact minutes): 2h 5m fills 2h 5m.
import { entryMinutes, parseHours, timeText } from './reportHours';
import { newKey, newTask, projectKey } from './reportState';

/**
 * How far report hours may be off the timers in required mode, as the submit allows it (the same
 * number as reports/timerCheck.js): a running timer counts on between the page's last read of the
 * timers and the submit.
 */
export const TIMER_TOLERANCE_MINUTES = 2;

/** Lower case without outer spaces, to compare task titles. */
function normalTitle(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase();
}

/** The title a timer task line gets: its note, else the priority task's title. */
function timerTitle(task) {
  return String(task.note ?? task.projectTaskTitle ?? '').trim();
}

/** Whether the shown hours already equal these minutes (so '2.5' and '2h 30m' are the same). */
function sameHours(text, minutes) {
  const parsed = parseHours(text);
  return 'minutes' in parsed && parsed.minutes === minutes;
}

/** A card's hours for timer minutes: 125 -> { hours: '2h 5m', savedMinutes: 125 }. */
export function hoursFromMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return { hours: timeText(value), savedMinutes: value };
}

/** A task line for one timer task (status In progress), reusing `base` (key, id) when given. */
function lineFromTimer(task, base = newTask()) {
  const linked = Boolean(task.projectTaskId);
  return {
    ...base,
    title: timerTitle(task),
    status: 'in_progress',
    carried: false,
    projectTaskId: linked ? task.projectTaskId : null,
    priority: linked ? (task.priority ?? null) : null,
    projectTaskTitle: linked ? (task.projectTaskTitle ?? null) : null,
  };
}

/** A line already says this: the same priority task, else the same title (any case). */
function hasLine(lines, task) {
  const title = normalTitle(timerTitle(task));
  return lines.some(
    (line) =>
      (task.projectTaskId && Number(line.projectTaskId) === Number(task.projectTaskId)) ||
      normalTitle(line.title) === title,
  );
}

/** The card's only line is empty (nothing typed, no priority task): timer lines replace it. */
function loneEmptyLine(lines) {
  const [only] = lines;
  return lines.length === 1 && !only.title.trim() && !only.projectTaskId ? only : null;
}

/**
 * A card's lines with the timer's missing lines added at the end (nothing is removed). The lone
 * empty line of a card becomes the first added line (it keeps its key and id).
 * @returns {object[]} the same array when nothing was added
 */
export function mergeTimerTasks(lines, timerTasks) {
  let next = lines;
  let lone = loneEmptyLine(lines);
  for (const task of timerTasks ?? []) {
    if (!timerTitle(task) || hasLine(next, task)) continue;
    if (lone) {
      next = [lineFromTimer(task, lone)];
      lone = null;
    } else {
      next = [...next, lineFromTimer(task)];
    }
  }
  return next;
}

/** A new card for a timer project the report doesn't have yet. */
function entryFromTimer(project) {
  return {
    key: newKey('e'),
    id: null,
    projectId: project.projectId,
    projectRequestId: null,
    projectName: project.projectName,
    projectColor: project.projectColor ?? null,
    isUrgent: Boolean(project.isUrgent),
    waitingForApproval: false,
    ...hoursFromMinutes(project.roundedMinutes),
    tasks: mergeTimerTasks([newTask()], project.tasks),
  };
}

/**
 * "Fill report from timers" (CONTRACT 15): merges the day's timer summary into the editor rows.
 * Cards match timer projects by project ('p<id>'); their hours become the timer time (to the
 * minute) and missing task lines are added (In progress; matched by priority task, else by title
 * in any case; the lone empty line of a card is replaced). Projects with 0 minutes are skipped,
 * nothing is removed, and timer projects the report doesn't have are added at the end in the
 * summary's order (biggest first), except those timed for TIMER_TOLERANCE_MINUTES or less (a
 * misclick: required mode doesn't ask for them, and their card would only block the submit with
 * no tasks). `hoursOnly` (required mode, on load) only changes the hours of cards already in the
 * report.
 * @param {object[]} entries editor rows (reportState.js)
 * @param {{ projects: Array<{ projectId: number, projectName: string, projectColor: string,
 *   isUrgent: boolean, roundedMinutes: number, tasks: Array<{ note: string | null,
 *   projectTaskId: number | null, priority: string | null,
 *   projectTaskTitle: string | null }> }> } | null} summary timers.getDaySummary()
 * @param {{ hoursOnly?: boolean }} [options]
 * @returns {object[]} the same array when nothing changes
 */
export function mergeTimerSummary(entries, summary, { hoursOnly = false } = {}) {
  const projects = (summary?.projects ?? []).filter((project) => project.roundedMinutes > 0);
  if (projects.length === 0) return entries;
  const byKey = new Map(projects.map((project) => [`p${project.projectId}`, project]));
  const merged = new Set();
  let changed = false;
  const next = entries.map((entry) => {
    const key = projectKey(entry);
    const project = key ? byKey.get(key) : null;
    // A project shown twice (refused on submit) is filled once, on its first card.
    if (!project || merged.has(key)) return entry;
    merged.add(key);
    const keepHours = sameHours(entry.hours, project.roundedMinutes);
    const tasks = hoursOnly ? entry.tasks : mergeTimerTasks(entry.tasks, project.tasks);
    if (keepHours && tasks === entry.tasks) return entry;
    changed = true;
    return {
      ...entry,
      ...(keepHours ? null : hoursFromMinutes(project.roundedMinutes)),
      tasks,
    };
  });
  const added = hoursOnly
    ? []
    : projects
        .filter(
          (project) =>
            project.roundedMinutes > TIMER_TOLERANCE_MINUTES &&
            !merged.has(`p${project.projectId}`),
        )
        .map(entryFromTimer);
  return changed || added.length ? [...next, ...added] : entries;
}

/**
 * Required mode: a draft's hours follow the timers, and a running timer moves them every minute.
 * They show at once, but a follow saves at most once per FOLLOW_SAVE_MS (the others go out with
 * that save, the next edit or the submit). So a draft isn't saved every minute, and a second open
 * copy of the report isn't made stale (CONFLICT) every minute, only about as often as with the old
 * 15-minute rounding.
 */
export const FOLLOW_SAVE_MS = 15 * 60_000;

/**
 * Whether a follow may save now: the first one (on load), then once per FOLLOW_SAVE_MS.
 * @param {number | null} lastAt when a follow last could save (ms), null before the first
 * @param {number} at now (ms)
 * @returns {boolean}
 */
export function followSaves(lastAt, at) {
  return lastAt === null || at - lastAt >= FOLLOW_SAVE_MS;
}

/**
 * Required mode, a draft: the rows with their hours following the timers (mergeTimerSummary,
 * hoursOnly). When the follow doesn't save (`save` false, followSaves), changed hours count as
 * `unsaved`; the next follow that saves sends them even when the timers haven't moved since (a
 * new array, so the change is saved).
 * @param {object[]} entries editor rows
 * @param {object} summary timers.getDaySummary()
 * @param {{ save: boolean, unsaved: boolean }} follow whether this follow saves, and whether hours
 *   were shown since the last one that did without being saved
 * @returns {{ rows: object[], unsaved: boolean }} rows is `entries` itself when nothing changes
 */
export function followTimerHours(entries, summary, { save, unsaved }) {
  const rows = mergeTimerSummary(entries, summary, { hoursOnly: true });
  if (!save) return { rows, unsaved: unsaved || rows !== entries };
  return { rows: unsaved && rows === entries ? [...entries] : rows, unsaved: false };
}

/**
 * Whether the report takes project hours from timers: required mode on a day the submit checks
 * (`required` from the server; an earlier day nobody timed keeps typed hours).
 * @param {{ mode: string, required?: boolean, summary: object } | null} timers
 */
export function hoursComeFromTimers(timers) {
  return Boolean(timers?.required);
}

/**
 * Required mode: whether the submit would refuse the rows now (a card's hours are more than
 * TIMER_TOLERANCE_MINUTES off its timers, or a project timed for longer is missing), so the
 * report should be filled from timers again. For a submitted report, which never changes on its
 * own; a timer still running after the submit only counts once it is past the tolerance.
 * @param {object[]} entries editor rows
 * @param {{ required?: boolean, summary: object } | null} timers
 * @returns {boolean}
 */
export function timersChangedSince(entries, timers) {
  if (!hoursComeFromTimers(timers)) return false;
  const timed = new Map(
    (timers.summary?.projects ?? [])
      .filter((project) => project.roundedMinutes > 0)
      .map((project) => [`p${project.projectId}`, project.roundedMinutes]),
  );
  const shown = new Set();
  for (const entry of entries) {
    const key = projectKey(entry);
    if (!timed.has(key) || shown.has(key)) continue;
    shown.add(key);
    if (Math.abs(entryMinutes(entry) - timed.get(key)) > TIMER_TOLERANCE_MINUTES) return true;
  }
  return [...timed].some(([key, minutes]) => !shown.has(key) && minutes > TIMER_TOLERANCE_MINUTES);
}

/**
 * In required mode, a card that moves to (or starts on) a real project takes that project's
 * timer time ('' when it has none); otherwise nothing changes.
 * @param {{ mode: string, required?: boolean, summary: object } | null} timers the report's
 *   timers (useReport().timers)
 * @param {{ projectId?: number | null }} pick
 * @returns {{ hours: string, savedMinutes: number } | null}
 */
export function timerHoursFor(timers, pick) {
  if (!hoursComeFromTimers(timers) || !pick?.projectId) return null;
  const project = timers.summary?.projects?.find(
    (item) => Number(item.projectId) === Number(pick.projectId),
  );
  return hoursFromMinutes(project?.roundedMinutes ?? 0);
}

/**
 * The "From your timers" card's rows: each timer project with its minutes and the task
 * lines a fill would bring ('Login page, Fix the build'), and their total. Empty when nothing was
 * tracked (no card).
 * @returns {{ rows: Array<{ projectId, projectName, projectColor, roundedMinutes, notes }>,
 *   totalMinutes: number }}
 */
export function timerCardRows(timers) {
  const rows = (timers?.summary?.projects ?? []).map((project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
    projectColor: project.projectColor ?? null,
    roundedMinutes: Number(project.roundedMinutes) || 0,
    notes: (project.tasks ?? []).map(timerTitle).filter(Boolean).join(', '),
  }));
  return { rows, totalMinutes: rows.reduce((sum, row) => sum + row.roundedMinutes, 0) };
}

/** Errors a fill can fix: hours errors on cards and the report-wide ones ('total', ...). */
export function clearTimerErrors(errors) {
  const entries = Object.fromEntries(
    Object.entries(errors.entries).map(([key, value]) => {
      const rest = { ...value };
      delete rest.hours;
      return [key, rest];
    }),
  );
  return { general: [], entries, tasks: errors.tasks };
}
