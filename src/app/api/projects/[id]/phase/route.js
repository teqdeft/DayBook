// PUT /api/projects/:id/phase { phase, from? } moves a project to a phase (the project's PM or Admin)
// and returns its plan. `from` is the phase the page showed: a 409 when the project moved since.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectPlan } from '@/modules/projectPlan';
import { projectPhaseSchema, routeId } from '@/modules/projectPlan/schemas';

export const PUT = withRoute(
  { permission: 'project.manage', body: projectPhaseSchema },
  async ({ user, params, body, ip }) => {
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    return projectPlan.movePhase({ user, projectId, phase: body.phase, from: body.from, ip });
  },
);
