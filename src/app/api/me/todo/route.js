// GET /api/me/todo (CONTRACT 24): the signed-in person's to-do for today with its suggestions
// (reports.getTodo; it never creates the draft). The Today card asks it every 5 seconds while a
// Slack post is sending. RATE_LIMITED past 120 a minute for one person.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { countRead } from './todoRoute';

export const GET = withRoute({ permission: 'report.self' }, async ({ user }) => {
  countRead(user);
  return reports.getTodo({ user });
});
