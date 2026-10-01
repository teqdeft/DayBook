// GET /api/projects/:id/tasks?status=&limit=&offset= (members of the project, PMs and Admin) and
// POST /api/projects/:id/tasks (the project's PM or Admin): its priority tasks.
import { AppError } from '@/lib/errors';
import { listResult, withRoute } from '@/lib/route';
import { projectTasks } from '@/modules/projectTasks';
import {
  projectTaskCreateSchema,
  projectTaskListQuerySchema,
  routeId,
} from '@/modules/projectTasks/schemas';

export const GET = withRoute(
  { permission: 'signed_in', query: projectTaskListQuerySchema },
  async ({ user, params, query }) => {
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    const { status, limit, offset } = query;
    const { rows, total } = await projectTasks.pageForProject({
      viewer: user,
      projectId,
      status,
      limit,
      offset,
    });
    return listResult(rows, { limit, offset, total });
  },
);

export const POST = withRoute(
  { permission: 'project.manage', body: projectTaskCreateSchema, status: 201 },
  async ({ user, params, body, ip }) => {
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    return projectTasks.create({ user, projectId, input: body, ip });
  },
);
