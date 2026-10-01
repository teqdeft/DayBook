// POST /api/projects/:id/urgent { note } marks a project urgent; DELETE clears it.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { projectUrgentSchema, routeId } from '@/modules/projects/schemas';

export const POST = withRoute(
  { permission: 'project.manage', body: projectUrgentSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projects.markUrgent({ user, id, note: body.note, ip });
  },
);

export const DELETE = withRoute({ permission: 'project.manage' }, async ({ user, params, ip }) => {
  const id = routeId(params);
  if (!id) throw new AppError('NOT_FOUND');
  return projects.clearUrgent({ user, id, ip });
});
