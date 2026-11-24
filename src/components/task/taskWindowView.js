// What the task window shows (CONTRACT 27, Task window), as plain values: the header's phase, the
// facts (owner, "Added by"), the latest report line, the Files part and the footer for each mode.
// Pure and safe in the browser; TaskWindow.jsx draws it.
import { awayLabel, latestReportLabel } from '@/app/(app)/projects/[id]/phasesView';
import { picturesOf } from '@/components/files/FileThumbs';
import { dayjs, formatDayShort } from '@/lib/time';
import { phaseLabel } from '@/modules/projectPlan/phases';

export const NOT_AVAILABLE =
  "This task isn't available. It may have been deleted or given to someone else.";
export const NO_NOTE = 'No note.';
export const NO_FILES = 'No files on this task.';
export const NO_REPORT = 'No report on this task yet.';
export const ANYONE = 'Anyone on the project';

const MODES = ['manage', 'team', 'member', 'today'];

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

/**
 * The Owner fact: the person (with the away label: "Deactivated", "Not on the project") or Anyone.
 * @returns {{ anyone: true, name: string } | { anyone: false, person: object, name: string,
 *   away: string | null }}
 */
export function ownerFact(task) {
  const person = task?.assignee ?? null;
  if (!person) return { anyone: true, name: ANYONE };
  return { anyone: false, person, name: person.name, away: awayLabel(person) };
}

/** "Riya Kapoor on Mon, 23 Nov", or null when the task doesn't say who added it. */
export function addedByText(task) {
  const name = task?.createdBy?.name;
  if (!name) return null;
  const day = localDay(task.createdAt);
  return day ? `${name} on ${formatDayShort(day)}` : name;
}

/**
 * The latest report line ("Simran, Fri, 20 Nov: In progress"), split so the status gets its colour
 * (Blocked in red). latestReportLabel says "yesterday" and "today" for those days.
 * @param {{ status, userName, workDate } | null} latest
 * @param {string} today the company's date
 * @returns {{ lead: string, status: string, tone: 'red' | 'green' | 'primary' } | null}
 */
export function reportParts(latest, today) {
  const label = latestReportLabel(latest, today);
  if (!label) return null;
  const at = label.lastIndexOf(': ');
  const tone = { blocked: 'red', done: 'green' }[latest.status] ?? 'primary';
  return { lead: label.slice(0, at), status: label.slice(at + 2), tone };
}

/**
 * The Files part: shown only when the viewer may see the task's files (`canSeeFiles`); the file X
 * and "Add files" only in manage mode on a project page (the attach store is there), never in the
 * `today`, `member` or `team` modes, whatever `canManage` says.
 * @param {{ mode: string, task: object, canAttach?: boolean,
 *   isHidden?: (fileId: number) => boolean }} args canAttach: the page has the attach store
 * @returns {{ show: boolean, files: object[], pictures: object[], others: object[],
 *   count: number, canChange: boolean }}
 */
export function filesPart({ mode, task, canAttach = false, isHidden = () => false }) {
  const show = Boolean(task?.canSeeFiles);
  const files = show ? (task.files ?? []).filter((file) => !isHidden(file.id)) : [];
  const { pictures, others } = picturesOf(files);
  const canChange = show && modeOf(mode) === 'manage' && Boolean(task.canManage) && canAttach;
  return { show, files, pictures, others, count: files.length, canChange };
}

/**
 * The footer: `manage` (Delete, Edit, Mark done or Done and Reopen) for the project's PM and Admins
 * on a project page with the task editor; `today` (Open project, and the to-do button); `member`
 * (the to-do button while today's to-do takes lines); nothing for another PM.
 * @param {{ mode: string, task: object, hasEditor?: boolean, hasTodo?: boolean,
 *   todoOpen?: boolean }} args hasTodo: Today's to-do card is there (the person has
 *   `report.self`); todoOpen: on the member's project page, the person has `report.self` and
 *   today's to-do still takes lines (the report isn't in and hasn't locked, CONTRACT 24)
 * @returns {{ kind: 'manage' | 'today' | 'member' | 'none', done: boolean, todo: boolean }}
 *   todo: show "Add to to-do" (or "In to-do") on an open task
 */
export function footerFor({ mode, task, hasEditor = false, hasTodo = false, todoOpen = false }) {
  const done = task?.status === 'done';
  const shown = modeOf(mode);
  if (shown === 'manage') {
    const manages = Boolean(task?.canManage) && hasEditor;
    return { kind: manages ? 'manage' : 'none', done, todo: false };
  }
  if (shown === 'today') return { kind: 'today', done, todo: hasTodo && !done };
  if (shown === 'member') return { kind: 'member', done, todo: Boolean(todoOpen) && !done };
  return { kind: 'none', done, todo: false };
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
