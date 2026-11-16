// POST /api/me/todo/slack (CONTRACT 24): "Post to Slack", "Update post" and "Try again" on
// today's to-do → { queued: 'post' | 'update', todo }. CONFLICT "Slack posting is off." or "Add a
// task first.", REPORT_LOCKED once the report has locked, TODO_UNAVAILABLE (503) before migration
// 017, RATE_LIMITED past 6 posts a minute for one person.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { countSlackPost } from '../todoRoute';

// No body: the post is built from today's report.
export const POST = withRoute({ permission: 'report.self' }, async ({ user, ip }) => {
  countSlackPost(user);
  return reports.queueTodoPost({ user, ip });
});
