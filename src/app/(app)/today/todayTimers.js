// Server only (called from todayData.js): what Today's Working on card needs (CONTRACT 15) —
// the person's timer state (the one the sidebar's chip got in this request), the project picker,
// the open priority tasks they can link on each of its projects and today's breaks.
import { timerStateFor } from '@/components/AppFrame';
import { toLocal } from '@/lib/time';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { timers } from '@/modules/timers';
import { tasksByProject, timerPicker } from './timerData';

async function safe(promise, fallback) {
  try {
    return (await promise) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Whether Today loads the card at all: timers aren't off and the person may use them.
 * @param {object} user the session user
 * @param {{ timersMode: string }} current settings
 */
export function timersShownFor(user, current) {
  return current.timersMode !== 'off' && timers.canUse(user);
}

/**
 * The picker and, for every project in it, the open priority tasks the person can link (the
 * server's check: projectTasks.findOpenForPicker, so "Other projects" offer their tasks for
 * anyone too). The tasks are left out if they can't be read.
 * @returns {Promise<{ picker: object | null, tasks: object[] }>}
 */
async function pickerWithTasks(userId) {
  const picker = await safe(projects.getPickerFor(userId), null);
  if (!picker) return { picker: null, tasks: [] };
  const { urgent, mine, others } = timerPicker(picker);
  const projectIds = [...urgent, ...mine, ...others].map((project) => Number(project.id));
  const byProject = await safe(projectTasks.findOpenForPickerByProject({ userId, projectIds }), {});
  return { picker, tasks: Object.values(byProject).flat() };
}

/**
 * The timer state, the picker and its tasks, loaded together (null and none when the card isn't
 * shown).
 * @returns {Promise<{ state: object | null, picker: object | null, tasks: object[] }>}
 */
export async function loadTimerParts(user, current) {
  if (!timersShownFor(user, current)) return { state: null, picker: null, tasks: [] };
  const [state, { picker, tasks }] = await Promise.all([
    safe(timerStateFor(user), null),
    pickerWithTasks(user.id),
  ]);
  return { state, picker, tasks };
}

const clockOf = (value, tz) => (value ? toLocal(value, tz).format('HH:mm') : null);

/**
 * The Working on card's props, or null when it doesn't show: timers off, someone who can't use
 * them, no check-in today, or the state couldn't be read.
 * @param {{ row: object | null, parts: { state: object | null, picker: object | null,
 *   tasks: object[] }, breaks?: Array<{ startedAt: Date | string, endedAt: Date | string | null }>,
 *   tz: string }} input breaks: today's (attendance.getMyToday)
 * @returns {{ initialState: object, picker: object, tasks: object, tz: string,
 *   checkInClock: string, breaks: Array<{ startClock: string, endClock: string | null }> }
 *   | null}
 */
export function timerCard({ row, parts, breaks = [], tz }) {
  const { state, picker, tasks = [] } = parts;
  if (!row || !state || state.mode === 'off' || !state.canUse) return null;
  return {
    initialState: state,
    picker: timerPicker(picker),
    tasks: tasksByProject(tasks),
    tz,
    checkInClock: clockOf(row.checkInAt, tz),
    breaks: (breaks ?? []).map((item) => ({
      startClock: clockOf(item.startedAt, tz),
      endClock: clockOf(item.endedAt, tz),
    })),
  };
}
