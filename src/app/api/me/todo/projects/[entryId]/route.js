// DELETE /api/me/todo/projects/:entryId (CONTRACT 24): removes a project of today's to-do with its
// lines → the new to-do. 409 CONFLICT "This project has hours in your report. Remove it in the
// report." when it has minutes; NOT_FOUND for anything but the person's own project in today's
// report; REPORT_LOCKED after submit; RATE_LIMITED past 60 to-do writes a minute for one person.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { countWrite, entryIdOf } from '../../todoRoute';

export const DELETE = withRoute({ permission: 'report.self' }, async ({ user, params }) => {
  countWrite(user);
  return reports.removeTodoProject({ user, entryId: entryIdOf(params) });
});
