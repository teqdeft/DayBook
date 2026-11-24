// The Board tab (CONTRACT 27, Board tab), a server component: the band, then the project's tasks as
// phase columns. It loads the tasks the viewer may read (a member gets only theirs and Anyone tasks)
// and the file counts of the files the viewer may see; nothing about files is loaded for a viewer
// with no file rights (another PM who isn't on the project). A member's band counts every task of
// the project per phase, without their names.
import { logger } from '@/lib/logger';
import { getSessionUser } from '@/lib/session';
import { projectFiles } from '@/modules/projectFiles';
import { projectTasks } from '@/modules/projectTasks';
import Board from './_board/Board';
import { countByPhase } from './_board/bandView';
import { toBoardTask } from './phasesView';

/** The files on each task this viewer may see; {} when they may see none or the read fails. */
async function fileCountsFor(viewer, tasks, filesAccess) {
  if (filesAccess === 'none' || tasks.length === 0) return {};
  try {
    return (await projectFiles.countsForTasks({ viewer, tasks })) ?? {};
  } catch (error) {
    logger.warn({ err: error }, 'Board: file counts failed; the cards show no paperclips');
    return {};
  }
}

/**
 * @param {{ head: object }} props head: loadProjectHead (`project`, `plan`, `today`, `forecast`
 *   (not for a member), `access` ('manage' | 'team' | 'member'), `filesAccess`, `hoursThisMonth`)
 */
export default async function BoardTab({ head }) {
  const { project, plan, today, access, filesAccess } = head;
  const viewer = await getSessionUser();
  const member = access === 'member';
  const [rows, phaseCounts] = await Promise.all([
    projectTasks.listForProject({ viewer, projectId: project.id }),
    member ? projectTasks.countsByPhase(project.id) : null,
  ]);
  const fileCounts = await fileCountsFor(viewer, rows, filesAccess);
  const tasks = rows.map((task) => toBoardTask(task, today, fileCounts[task.id]));
  return (
    <Board
      projectId={project.id}
      access={access}
      filesAccess={filesAccess}
      tasks={tasks}
      counts={phaseCounts ?? countByPhase(tasks)}
      plan={plan}
      today={today}
      status={project.status}
      pmName={project.pmName ?? null}
      hoursThisMonth={member ? (head.hoursThisMonth ?? null) : null}
      forecast={member ? null : (head.forecast ?? null)}
    />
  );
}
