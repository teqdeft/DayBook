// PATCH /api/projects/:id: edit a project (fields, members, status, urgent) — its PM or Admin.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { projectUpdateSchema, routeId } from '@/modules/projects/schemas';

export const PATCH = withRoute(
  { permission: 'project.manage', body: projectUpdateSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projects.update({ user, id, input: body, ip });
  },
);
