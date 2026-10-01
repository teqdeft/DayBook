// GET /api/attendance/export?date= — the day as an Excel file.
import { xlsxResponse } from '@/lib/excel';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { dateQuerySchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'attendance.view_all', query: dateQuerySchema },
  async ({ query }) =>
    xlsxResponse(await attendance.exportDay(await attendance.resolveDate(query.date))),
);
