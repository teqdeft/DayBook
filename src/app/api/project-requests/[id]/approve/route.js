// POST /api/project-requests/:id/approve with the New project fields: creates the project.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { projectCreateSchema, routeId } from '@/modules/projects/schemas';

export const POST = withRoute(
  { permission: 'project_request.handle', body: projectCreateSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projects.approveRequest({ user, id, input: body, ip });
  },
);
