// POST /api/project-requests/:id/decline { reason, moveEntriesToProjectId? }
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { projectRequestDeclineSchema, routeId } from '@/modules/projects/schemas';

export const POST = withRoute(
  { permission: 'project_request.handle', body: projectRequestDeclineSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projects.declineRequest({ user, id, input: body, ip });
  },
);
