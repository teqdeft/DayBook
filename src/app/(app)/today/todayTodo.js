// Server only (called from todayData.js): what Today's to-do card starts with (CONTRACT 24), so it
// shows without a loading flash: the to-do (reports.getTodo, with the timer state the page already
// read, for "Now" and Play), the report's project picker with the person's pending project
// requests, and the open priority tasks offered while a task is typed. Only for people who write
// daily reports (`report.self`).
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { reports } from '@/modules/reports';

/**
 * The open priority tasks by project id, as "Add a task" offers them (the report's shape).
 * @param {object[]} rows projectTasks.findOpenForPicker rows of every project in the picker
 * @param {number} userId
 * @returns {Record<string, Array<{ id: number, title: string, priority: string,
 *   forYou: boolean }>>}
 */
export function priorityByProject(rows, userId) {
  const byProject = {};
  for (const row of rows ?? []) {
    const projectId = Number(row.projectId ?? row.project?.id);
    if (!projectId) continue;
    (byProject[projectId] ??= []).push({
      id: Number(row.id),
      title: row.title,
      priority: row.priority,
      forYou: Number(row.assigneeId) === Number(userId),
    });
  }
  return byProject;
}

/**
 * The card's props, or null when it doesn't show (no `report.self`, or the to-do can't be read:
 * Today still opens).
 * @param {{ user: object, timerParts: Promise<{ state: object | null }>,
 *   pickerParts: Promise<{ picker: object | null, tasks: object[] }> }} input
 * @returns {Promise<{ initialTodo: object, picker: object, priority: object } | null>}
 */
export async function loadTodo({ user, timerParts, pickerParts }) {
  if (!can(user, 'report.self')) return null;
  try {
    const [{ state }, { picker, tasks }] = await Promise.all([timerParts, pickerParts]);
    const initialTodo = await reports.getTodo({ user, timerState: state ?? undefined });
    return {
      initialTodo,
      picker: picker ?? { urgent: [], mine: [], others: [], requests: [] },
      priority: priorityByProject(tasks, user.id),
    };
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, "could not read today's to-do");
    return null;
  }
}
