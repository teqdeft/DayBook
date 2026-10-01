// POST /api/project-tasks/:id/status { status: 'open' | 'done' }: mark done or reopen (the
// project's PM or Admin).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectTasks } from '@/modules/projectTasks';
import { projectTaskStatusSchema, routeId } from '@/modules/projectTasks/schemas';

export const POST = withRoute(
  { permission: 'project.manage', body: projectTaskStatusSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projectTasks.setStatus({ user, id, status: body.status, ip });
  },
);
