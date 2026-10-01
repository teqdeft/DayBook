// GET /api/me/log?month=YYYY-MM (report.self): My log for a month, own data only.
// &format=xlsx returns the Excel download.
import { xlsxResponse } from '@/lib/excel';
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { monthLogQuerySchema } from '@/modules/reports/schemas';

export const GET = withRoute(
  { permission: 'report.self', query: monthLogQuerySchema },
  async ({ user, query }) => {
    const log = await reports.getMonthLog({ user, month: query.month });
    if (query.format === 'xlsx') return xlsxResponse(reports.monthLogWorkbook(log));
    return log;
  },
);
