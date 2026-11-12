// PUT /api/projects/:id/deadline { deadline } sets a project's deadline, null clears it (the
// project's PM or Admin), and returns its plan.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectPlan } from '@/modules/projectPlan';
import { projectDeadlineSchema, routeId } from '@/modules/projectPlan/schemas';

export const PUT = withRoute(
  { permission: 'project.manage', body: projectDeadlineSchema },
  async ({ user, params, body, ip }) => {
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    return projectPlan.setDeadline({ user, projectId, deadline: body.deadline, ip });
  },
);
