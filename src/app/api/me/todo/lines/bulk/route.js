// POST /api/me/todo/lines/bulk (CONTRACT 24): the pasted list. Body { groups: [{ projectId |
// projectRequestId, lines: [{ title, status? }] }] } → { added, skipped, todo } (skipped: lines the
// project already had or the paste repeated). Reads its own body: the rate limit counts the
// request first (refused bodies count too), then a body over 128 KB is 413 PAYLOAD_TOO_LARGE,
// then it is parsed and handed to reports.addTodoLines (which validates it, all or nothing).
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { MAX_BULK_BYTES, countWrite, readCappedJson } from '../../todoRoute';

export const POST = withRoute({ permission: 'report.self' }, async ({ user, request }) => {
  countWrite(user);
  const body = await readCappedJson(request, MAX_BULK_BYTES);
  return reports.addTodoLines({ user, groups: body?.groups });
});
