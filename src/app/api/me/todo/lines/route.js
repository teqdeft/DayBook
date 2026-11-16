// POST /api/me/todo/lines (CONTRACT 24): adds one line to a project of today's to-do, creating
// today's draft and the project's card when needed. Body { projectId | projectRequestId, title,
// projectTaskId?, carriedFromTaskId? } → the new to-do plus `added` (false: the project already
// had that title, so nothing was added) and `lineId`. REPORT_LOCKED after submit, VALIDATION_FAILED
// (title, project, priority task, the report's limits), PROJECT_NOT_ACTIVE, RATE_LIMITED past 60
// to-do writes a minute for one person.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { todoLineCreateSchema } from '@/modules/reports/todoSchemas';
import { countWrite } from '../todoRoute';

export const POST = withRoute(
  { permission: 'report.self', body: todoLineCreateSchema },
  async ({ user, body }) => {
    countWrite(user);
    return reports.addTodoLine({ user, ...body });
  },
);
