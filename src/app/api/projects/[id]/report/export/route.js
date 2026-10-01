// GET /api/projects/:id/report/export?range=&from=&to= — the project report as an Excel file.
import { AppError } from '@/lib/errors';
import { xlsxResponse } from '@/lib/excel';
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import {
  projectIdParamSchema,
  projectReportRangeSchema,
} from '@/modules/dashboard/projectReportSchemas';

export const GET = withRoute(
  { permission: 'team.view', query: projectReportRangeSchema },
  async ({ params, query }) => {
    const id = projectIdParamSchema.safeParse(params.id);
    if (!id.success) throw new AppError('NOT_FOUND', { message: "We couldn't find that project." });
    return xlsxResponse(await dashboard.buildProjectReportExport({ projectId: id.data, ...query }));
  },
);
