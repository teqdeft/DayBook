// Hours as an Excel file: ?from=&to=&userId= (defaults to this week, everyone).
import { xlsxResponse } from '@/lib/excel';
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { hoursExportQuerySchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'export.hours', query: hoursExportQuerySchema },
  async ({ query }) => xlsxResponse(await dashboard.buildHoursExport(query)),
);
