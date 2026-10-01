// PATCH /api/project-tasks/:id (title, details, priority, assignee) and DELETE: the project's PM
// or Admin.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectTasks } from '@/modules/projectTasks';
import { projectTaskUpdateSchema, routeId } from '@/modules/projectTasks/schemas';

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
