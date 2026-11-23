// GET /api/holidays?year= (attendance.view_all): the company holidays of a year, from last year to
// next year → { year, available, items, upcoming, today, firstYear, lastYear } (CONTRACT 25).
// POST /api/holidays (attendance.correct), body { date, name } → 201 the holiday. CONFLICT when
// the date has one, VALIDATION_FAILED, UPDATE_NEEDED before migration 018. RATE_LIMITED past 120
// reads or 60 writes a minute for one person (holidays and leave together).
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { holidayCreateSchema, holidayListQuerySchema } from '@/modules/attendance/calendarSchemas';
import { countRead, countWrite } from './calendarRoute';

export const GET = withRoute(
  { permission: 'attendance.view_all', query: holidayListQuerySchema },
  async ({ user, query }) => {
    countRead(user);
    return attendance.listHolidays({ year: query.year });
  },
);

export const POST = withRoute(
  { permission: 'attendance.correct', body: holidayCreateSchema, status: 201 },
  async ({ user, body, ip }) => {
    countWrite(user);
    return attendance.createHoliday({ actor: user, date: body.date, name: body.name, ip });
  },
);
