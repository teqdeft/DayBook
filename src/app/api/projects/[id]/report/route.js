// GET /api/projects/:id/report?range=&from=&to=&limit=&offset=&section= — the project report
// (PM and Admin, every project). limit/offset page the daily log; section=entries returns only
// that page ("Show more").
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import {
  projectIdParamSchema,
  projectReportQuerySchema,
} from '@/modules/dashboard/projectReportSchemas';

export const GET = withRoute(
  { permission: 'team.view', query: projectReportQuerySchema },
  async ({ params, query }) => {
    const id = projectIdParamSchema.safeParse(params.id);
    if (!id.success) throw new AppError('NOT_FOUND', { message: "We couldn't find that project." });
    const { section, ...options } = query;
    if (section === 'entries') {
      return dashboard.getProjectReportEntries({ projectId: id.data, ...options });
    }
    return dashboard.getProjectReport({ projectId: id.data, ...options });
  },
);
