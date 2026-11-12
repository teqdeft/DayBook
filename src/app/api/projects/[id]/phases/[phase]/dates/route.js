// PUT /api/projects/:id/phases/:phase/dates { plannedStart, plannedEnd } sets a phase's planned
// dates, null empties one (the project's PM or Admin), and returns the project's plan.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectPlan } from '@/modules/projectPlan';
import { phaseDatesSchema, routeId, routePhase } from '@/modules/projectPlan/schemas';

export const PUT = withRoute(
  { permission: 'project.manage', body: phaseDatesSchema },
  async ({ user, params, body, ip }) => {
    const projectId = routeId(params);
    const phase = routePhase(params);
    if (!projectId || !phase) throw new AppError('NOT_FOUND');
    const { plannedStart, plannedEnd } = body;
    return projectPlan.setPhaseDates({ user, projectId, phase, plannedStart, plannedEnd, ip });
  },
);
