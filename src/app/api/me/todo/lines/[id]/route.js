// PATCH /api/me/todo/lines/:id { title?, done? } renames and/or ticks a line of today's to-do;
// DELETE /api/me/todo/lines/:id removes it (CONTRACT 24). Both → the new to-do. NOT_FOUND for
// anything but the person's own line in today's report, REPORT_LOCKED after submit, RATE_LIMITED
// past 60 to-do writes a minute for one person.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { todoLineUpdateSchema } from '@/modules/reports/todoSchemas';
import { countWrite, lineIdOf } from '../../todoRoute';

export const PATCH = withRoute(
  { permission: 'report.self', body: todoLineUpdateSchema },
  async ({ user, params, body }) => {
    countWrite(user);
    return reports.updateTodoLine({ user, id: lineIdOf(params), ...body });
  },
);

export const DELETE = withRoute({ permission: 'report.self' }, async ({ user, params }) => {
  countWrite(user);
  return reports.removeTodoLine({ user, id: lineIdOf(params) });
});
