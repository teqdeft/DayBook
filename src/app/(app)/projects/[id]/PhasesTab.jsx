// The Phases tab (CONTRACT 22): loads the project's tasks, open and done, with their phase, due date
// and latest reported status, and hands them to the board. Who a task can be for and the files and
// notes are only loaded for the project's PM or Admin, so another PM's page has no documents in its
// props or stream.
import { workDate } from '@/lib/time';
import { projectSummaries } from '@/modules/projectSummaries';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';
import PhasesBoard from './PhasesBoard';
import { toBoardTask } from './phasesView';

/** The files and notes without their text, with the company dates they were added and changed. */
async function loadDocuments(user, projectId) {
  const [documents, { timezone }] = await Promise.all([
    projectSummaries.listDocuments({ user, projectId }),
    settings.getAll(),
  ]);
  return documents.map((document) => ({
    ...document,
    addedOn: workDate(timezone, document.createdAt),
    updatedOn: workDate(timezone, document.updatedAt ?? document.createdAt),
  }));
}

/**
 * @param {{ user: object, project: object, plan: object, forecast: object, today: string,
 *   canManage: boolean }} props see loadProjectHead
 */
export default async function PhasesTab({ user, project, plan, today, canManage }) {
  const [tasks, owners, documents] = await Promise.all([
    projectTasks.listForProject({ viewer: user, projectId: project.id }),
    canManage ? projectTasks.listAssigneeOptions({ viewer: user, projectId: project.id }) : [],
    canManage ? loadDocuments(user, project.id) : null,
  ]);
  return (
    <PhasesBoard
      project={{
        id: project.id,
        name: project.name,
        pmName: project.pmName,
        status: project.status,
      }}
      plan={plan}
      tasks={tasks.map((task) => toBoardTask(task, today))}
      owners={owners.map((owner) => ({ id: owner.id, name: owner.name }))}
      documents={documents ?? undefined}
      today={today}
      canManage={canManage}
    />
  );
}
