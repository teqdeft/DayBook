// Timer time on three acme-store tasks (CONTRACT 28, Task number, status chip, time and updates per
// viewer), so the cards, the Table's Time column and the task window show minutes: Simran's
// "Checkout fix before client demo" 5h 40m and "Product image zoom" (an Anyone task) 1h 50m, and
// Vishal's "Payment settings page" 3h 15m. A member sees only their own time, the PM everyone's.
//
// Each entry is a finished timer on a working day before the anchor, so Today, the timer chip and
// "Fill report from timers" are as before (hrTimers.js keeps the 1.10 rows; these come after them).
// It starts 15 minutes after both the check-in and the moment the task was added, on the latest
// day it fits before check-out, and counts as asked about up to its end (no away question).
const STORE = 'store';

/** Who timed which task, for how many minutes, and the timer note (a report line's title). */
export const TASK_TIMERS = [
  { person: 'simran', task: 'Checkout fix before client demo', minutes: 340, note: 'Checkout QA' },
  { person: 'vishal', task: 'Payment settings page', minutes: 195, note: 'Payment settings page' },
  { person: 'simran', task: 'Product image zoom', minutes: 110, note: 'Product image zoom' },
];

/** The working days looked at, newest first (1 = the working day before the anchor). */
const OFFSETS = [1, 2, 3, 4, 5];
const LEAD_MINUTES = 15;

const later = (a, b) => (a > b ? a : b);
const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);

/** The first day (newest first) the person was in and the entry fits; days taken are skipped. */
function placeOf(timer, ctx, task, taken) {
  for (const offset of OFFSETS) {
    const day = ctx.index.attendance.get(`${timer.person}|${offset}`);
    if (!day?.checkOutAt || taken.has(`${timer.person}|${offset}`)) continue;
    const startedAt = addMinutes(later(day.checkInAt, task.createdAt), LEAD_MINUTES);
    const endedAt = addMinutes(startedAt, timer.minutes);
    if (endedAt <= day.checkOutAt) return { offset, day, startedAt, endedAt };
  }
  throw new Error(`Demo data: no day for ${timer.person}'s timer on "${timer.task}"`);
}

/**
 * time_entries rows for the TASK_TIMERS, with ids after the 1.10 rows. One entry a person a day.
 * @param {{ users: Map<string, { id: number }>, projects: Map<string, { id: number }>,
 *   index: { attendance: Map<string, { workDate: string, checkInAt: Date, checkOutAt: Date |
 *   null }> }, tasks: Array<{ id: number, projectId: number, title: string, createdAt: Date }>,
 *   firstId: number }} ctx tasks: the project_tasks rows about to go in
 * @returns {object[]}
 */
export function buildTaskTimers(ctx) {
  const projectId = ctx.projects.get(STORE).id;
  const taken = new Set();
  return TASK_TIMERS.map((timer, i) => {
    const task = ctx.tasks.find((row) => row.projectId === projectId && row.title === timer.task);
    if (!task) throw new Error(`Demo data: acme-store has no task "${timer.task}"`);
    const { offset, day, startedAt, endedAt } = placeOf(timer, ctx, task, taken);
    taken.add(`${timer.person}|${offset}`);
    return {
      id: ctx.firstId + i,
      userId: ctx.users.get(timer.person).id,
      workDate: day.workDate,
      projectId,
      projectTaskId: task.id,
      note: timer.note,
      startedAt,
      endedAt,
      source: 'timer',
      stopReason: 'stopped',
      awayCheckedUntil: endedAt,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
  });
}
