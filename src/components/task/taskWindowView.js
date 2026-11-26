// What the task window shows (CONTRACT 27, Task window; CONTRACT 28, Task window), as plain values:
// the header's phase, the right rail's facts (who it is for, "Assign to me" and "Move to phase…"
// only in manage mode on an open task, the time from timers or the viewer's own time, who added
// it), the Updates lines and the latest report, the Files part (own and linked files) and the
// footer of each mode (`mine`, My tasks', included). Pure and safe in the browser; TaskWindow.jsx
// and its parts draw it.
import { awayLabel } from '@/app/(app)/projects/[id]/phasesView';
import { picturesOf } from '@/components/files/FileThumbs';
import { dayjs, formatDayShort, formatDuration } from '@/lib/time';
import { phaseLabel } from '@/modules/projectPlan/phases';

export const NOT_AVAILABLE =
  "This task isn't available. It may have been deleted or given to someone else.";
export const NO_NOTE = 'No note.';
export const NO_FILES = 'No files on this task.';
export const NO_REPORT = 'No report on this task yet.';
export const NO_UPDATES = 'No updates yet. They come from the daily reports.';
export const MORE_UPDATES = 'Showing the newest 10.';
export const NO_TIME = 'None yet';
export const ANYONE = 'Anyone on the project';
export const UPDATES_SHOWN = 10;

const MODES = ['manage', 'team', 'member', 'today', 'mine'];
const STATUS = {
  in_progress: { label: 'In progress', tone: 'primary' },
  blocked: { label: 'Blocked', tone: 'red' },
  done: { label: 'Done', tone: 'green' },
};

/** The window's mode, 'member' (the most careful) for anything not on the list. */
export function modeOf(mode) {
  return MODES.includes(mode) ? mode : 'member';
}

/** The task's phase as the header names it: "Development", or "No phase yet". */
export function phaseText(phase) {
  return phase ? phaseLabel(phase) : 'No phase yet';
}

/** True when the task sits in the project's current phase (the header's "Current" tag). */
export function isCurrentPhase(task, currentPhase) {
  return Boolean(task?.phase) && task.phase === currentPhase;
}

/** The browser's calendar date ('YYYY-MM-DD') of a moment, or null without one. */
export function localDay(at) {
  if (!at) return null;
  const day = dayjs(at);
  return day.isValid() ? day.format('YYYY-MM-DD') : null;
}

/** "#88": the task's number (its id, the same on every screen). */
export const taskNumber = (task) => `#${task.id}`;

/**
 * Whose minutes the window shows: viewers without `team.view` (employees and HR, in the `member`
 * and `today` modes) get only their own, so the rail says "Your time" for them.
 */
export function ownTimeOnly(mode, task) {
  const shown = modeOf(mode);
  return (shown === 'member' || shown === 'today') && !task?.canManage;
}

/** "5h 40m" (the number shown before " from timers"), or null at 0 ("None yet"). */
export function minutesText(minutes) {
  const value = Math.max(0, Math.floor(Number(minutes) || 0));
  return value > 0 ? formatDuration(value) : null;
}

/** "Riya Kapoor on Mon, 23 Nov", or null when the task doesn't say who added it. */
export function addedByText(task) {
  const name = task?.createdBy?.name;
  if (!name) return null;
  const day = localDay(task.createdAt);
  return day ? `${name} on ${formatDayShort(day)}` : name;
}

/**
 * Who the task is for, as the rail shows it: the person (with "(you)" after the viewer's own and
 * the away label: "Not on the project", "Deactivated"), or Anyone on the project.
 * @param {object} task TaskDetails
 * @param {{ viewerId?: number | null, mode?: string }} [viewer] in `member` and `today` the
 *   person of a task the viewer sees is always the viewer, so "(you)" shows without `viewerId`
 * @returns {{ anyone: true, name: string } | { anyone: false, person: object, name: string,
 *   you: boolean, away: string | null }}
 */
export function ownerFact(task, { viewerId = null, mode = 'manage' } = {}) {
  const person = task?.assignee ?? null;
  if (!person) return { anyone: true, name: ANYONE };
  const shown = modeOf(mode);
  const you =
    viewerId !== null && viewerId !== undefined
      ? Number(person.id) === Number(viewerId)
      : shown === 'member' || shown === 'today';
  return { anyone: false, person, name: person.name, you, away: awayLabel(person) };
}

/**
 * The rail's facts and the controls beside them: "Assign to me" (manage mode, an open task that
 * isn't the viewer's) and "Move to phase…" (manage mode, an open task); "Time spent" with
 * everyone's minutes, or "Your time" for a viewer who only gets their own.
 * @param {object} task TaskDetails
 * @param {{ mode: string, viewerId?: number | null, canAct?: boolean }} args canAct: the page's
 *   task actions are there (useTaskActions)
 */
export function railFacts(task, { mode, viewerId = null, canAct = true }) {
  const manage = modeOf(mode) === 'manage' && Boolean(task?.canManage) && canAct;
  const open = task?.status !== 'done';
  const owner = ownerFact(task, { viewerId, mode });
  const mine = !owner.anyone && viewerId !== null && Number(owner.person.id) === Number(viewerId);
  return {
    owner,
    manage,
    assignToMe: manage && open && !mine,
    moveToPhase: manage && open,
    timeLabel: ownTimeOnly(mode, task) ? 'Your time' : 'Time spent',
    time: minutesText(task?.minutes),
    critical: task?.priority === 'p1',
    phase: phaseText(task?.phase),
    addedBy: addedByText(task),
  };
}

/** A report line's status in words and its tone: In progress (primary), Blocked (red), Done. */
export const statusOf = (status) => STATUS[status] ?? STATUS.in_progress;

/**
 * One Updates line: "Simran Kaur · Mon, 23 Nov · In progress" (the status in its tone) and the
 * line's text.
 * @param {{ userName: string, workDate: string, status: string, title: string }} update
 */
export function updateLine(update) {
  const status = statusOf(update.status);
  return {
    lead: `${update.userName} · ${formatDayShort(update.workDate)} · `,
    status: status.label,
    tone: status.tone,
    text: update.title ?? '',
  };
}

/**
 * The Updates section: the newest 10 lines and whether there are more.
 * @param {object} task TaskDetails (`updates`, `updateCount`)
 */
export function updatesPart(task) {
  const updates = task?.updates ?? [];
  const count = Math.max(Number(task?.updateCount ?? 0), updates.length);
  return { count, shown: updates.slice(0, UPDATES_SHOWN), more: count > UPDATES_SHOWN };
}

/**
 * The latest report (the first update, the one rule of the status chip): "In progress · Mon, 23
 * Nov." in its tone, then "Simran Kaur: Found the cause …"; null without one.
 * @param {{ status: string, workDate: string, userName: string, title?: string } | null} latest
 */
export function latestParts(latest) {
  if (!latest) return null;
  const status = statusOf(latest.status);
  const head = `${status.label} · ${formatDayShort(latest.workDate)}.`;
  const text = latest.title ? `${latest.userName}: ${latest.title}` : latest.userName;
  return { head, tone: status.tone, text };
}

/**
 * The Files part: shown only when the viewer may see the task's files (`canSeeFiles`); the file X
 * and "Add files" only in manage mode on a project page (the attach store is there), never in the
 * `today`, `member`, `team` or `mine` modes, whatever `canManage` says. Own files and links whose
 * removal waits behind its Undo are hidden.
 * @param {{ mode: string, task: object, canAttach?: boolean,
 *   isHidden?: (fileId: number) => boolean,
 *   isLinkHidden?: (taskId: number, fileId: number) => boolean }} args canAttach: the page has
 *   the attach store
 * @returns {{ show: boolean, files: object[], pictures: object[], others: object[],
 *   count: number, canChange: boolean }}
 */
export function filesPart({ mode, task, canAttach = false, isHidden, isLinkHidden }) {
  const show = Boolean(task?.canSeeFiles);
  const hidden = (file) =>
    file.linked ? Boolean(isLinkHidden?.(task.id, file.id)) : Boolean(isHidden?.(file.id));
  const files = show ? (task.files ?? []).filter((file) => !hidden(file)) : [];
  const { pictures, others } = picturesOf(files);
  const canChange = show && modeOf(mode) === 'manage' && Boolean(task.canManage) && canAttach;
  return { show, files, pictures, others, count: files.length, canChange };
}

/**
 * The footer: `manage` (Delete, Edit, Mark done or Done and Reopen) for the project's PM and Admins
 * on a project page with the task editor; `today` (Open project, and the to-do button); `member`
 * (the to-do button while today's to-do takes lines); `mine` (Open project, and Mark done or
 * Reopen when the viewer manages that task's project); nothing for another PM.
 * @param {{ mode: string, task: object, hasEditor?: boolean, hasTodo?: boolean,
 *   todoOpen?: boolean }} args hasTodo: Today's to-do card is there (the person has
 *   `report.self`); todoOpen: on the member's project page, the person has `report.self` and
 *   today's to-do still takes lines (the report isn't in and hasn't locked, CONTRACT 24)
 * @returns {{ kind: 'manage' | 'today' | 'member' | 'mine' | 'none', done: boolean,
 *   todo: boolean, status: boolean }} todo: "Add to to-do" (or "In to-do") on an open task;
 *   status: Mark done or Reopen
 */
export function footerFor({ mode, task, hasEditor = false, hasTodo = false, todoOpen = false }) {
  const done = task?.status === 'done';
  const shown = modeOf(mode);
  if (shown === 'manage') {
    const manages = Boolean(task?.canManage) && hasEditor;
    return { kind: manages ? 'manage' : 'none', done, todo: false, status: manages };
  }
  if (shown === 'mine')
    return { kind: 'mine', done, todo: false, status: Boolean(task?.canManage) };
  if (shown === 'today') return { kind: 'today', done, todo: hasTodo && !done, status: false };
  if (shown === 'member') {
    return { kind: 'member', done, todo: Boolean(todoOpen) && !done, status: false };
  }
  return { kind: 'none', done, todo: false, status: false };
}

/**
 * Where focus goes when the window closes: the element that opened it while it is still on the
 * page, else what the opener names in its place (`returnFocus`), else nowhere.
 * @param {HTMLElement | null | undefined} origin
 * @param {(() => HTMLElement | null) | null | undefined} returnFocus
 * @returns {HTMLElement | null}
 */
export function returnTarget(origin, returnFocus) {
  if (origin?.isConnected) return origin;
  return returnFocus?.() ?? null;
}

/** Where "Open project" goes: the task on its project page. */
export function projectTaskHref(task) {
  return `/projects/${task.projectId}?task=${task.id}`;
}

/**
 * What the window says instead of the task: the error state for a task the viewer can't open (404)
 * or a task of another project (a hand-made `?task=`); the API's words for any other failure.
 * @param {{ error?: { status?: number, code?: string, message?: string } | null,
 *   task?: object | null, projectId?: number | null }} args
 * @returns {{ message: string, retry: boolean } | null}
 */
export function windowProblem({ error, task, projectId }) {
  if (error) {
    const gone = error.status === 404 || error.status === 403 || error.code === 'NOT_FOUND';
    return gone
      ? { message: NOT_AVAILABLE, retry: false }
      : { message: error.message, retry: true };
  }
  if (task && projectId && Number(task.projectId) !== Number(projectId)) {
    return { message: NOT_AVAILABLE, retry: false };
  }
  return null;
}
