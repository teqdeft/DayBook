// GET /api/project-tasks/:id (the task window: PMs and Admin any task, members their own and
// Anyone tasks, CONTRACT 27; with updates, minutes and links, CONTRACT 28), PATCH (title, details,
// priority, assignee, phase, due date, files and links: `addLinkFileIds`, `removeLinkFileIds`,
// `shareConfirmed`, `shareWith`; Assign to me is `{ assigneeId: <the viewer's id> }`) answering the
// task plus `told`, `toldName` and `toldEarlierName`, and DELETE: the project's PM or Admin.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectTasks } from '@/modules/projectTasks';
import { projectTaskUpdateSchema, routeId } from '@/modules/projectTasks/schemas';

export const GET = withRoute({ permission: 'signed_in' }, async ({ user, params }) => {
  const id = routeId(params);
  if (!id) throw new AppError('NOT_FOUND', { message: "We couldn't find that task." });
  return projectTasks.getForViewer({ viewer: user, id });
});

export const PATCH = withRoute(
  { permission: 'project.manage', body: projectTaskUpdateSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projectTasks.update({ user, id, input: body, ip });
  },
);

export const DELETE = withRoute({ permission: 'project.manage' }, async ({ user, params, ip }) => {
  const id = routeId(params);
  if (!id) throw new AppError('NOT_FOUND');
  return projectTasks.remove({ user, id, ip });
});
