// What My tasks shows (CONTRACT 28, My tasks: sidebar, page and home cards), loaded on the server
// for the /my-tasks page and the home cards of /team (PMs) and /overview (Admins): the viewer's
// open tasks on their Active and On hold projects (projectTasks.listMine), each with the files on
// it they may see (the paperclip; own files and links), and the company's date for the groups and
// the due tags. Server only. Nothing here goes to Slack or the AI.
import { workDate } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';

/**
 * @typedef {{ id: number, title: string, priority: 'p1' | 'p2' | 'p3', phase: string | null,
 *   dueDate: string | null, project: { id: number, name: string, color: string,
 *   status: 'active' | 'on_hold' }, canManage: boolean, fileCount: number }} MineRow
 */

/** The files on each task this viewer may see; {} when they can't be read (before 019). */
async function fileCounts(viewer, tasks) {
  if (tasks.length === 0) return {};
  try {
    return (await projectFiles.countsForTasks({ viewer, tasks })) ?? {};
  } catch {
    return {};
  }
}

/**
 * A MineTask as the page draws it: only what a row shows (no assignee, no ids of other people).
 * @param {object} task projectTasks' MineTask
 * @param {Record<number, number>} counts
 * @returns {MineRow}
 */
export function toMineRow(task, counts = {}) {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    phase: task.phase ?? null,
    dueDate: task.dueDate ?? null,
    project: {
      id: task.project.id,
      name: task.project.name,
      color: task.project.color,
      status: task.project.status,
    },
    canManage: Boolean(task.canManage),
    fileCount: Number(counts?.[task.id]) || 0,
  };
}

/**
 * The viewer's My tasks.
 * @param {{ user: object }} args
 * @returns {Promise<{ tasks: MineRow[], more: boolean, today: string, viewerId: number }>} tasks:
 *   by due date (none last), then P1 to P3, then oldest; more: there are over 200; nothing for
 *   anyone but a PM or an Admin; viewerId: the person's own id (the task window's "(you)")
 */
export async function loadMyTasks({ user }) {
  const { timezone } = await settings.getAll();
  const today = workDate(timezone);
  const { tasks, more } = await projectTasks.listMine({ viewer: user, today });
  const counts = await fileCounts(user, tasks);
  return {
    tasks: tasks.map((task) => toMineRow(task, counts)),
    more: Boolean(more),
    today,
    viewerId: Number(user.id),
  };
}

/**
 * The home card's data, or null when it can't be read (the dashboard then shows without it).
 * @param {{ user: object }} args
 */
export async function loadMyTasksCard({ user }) {
  try {
    return await loadMyTasks({ user });
  } catch {
    return null;
  }
}
