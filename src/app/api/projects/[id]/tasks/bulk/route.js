// POST /api/projects/:id/tasks/bulk (CONTRACT 28, Bulk actions in the Table): the Table's bulk bar.
// Body { changes: [{ id, assigneeId } | { id, phase }] (1 to 100, one kind, each task once),
// shareConfirmed? } → 200 { tasks: [{ id, assigneeId, phase }], changed, told: { people, members } },
// all or nothing. The project's PM or Admin. Reads its own body: the rate limit counts the request
// first (30 a minute for one person), then a body over 16 KB is 413 PAYLOAD_TOO_LARGE, then it is
// parsed (VALIDATION_FAILED).
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { projectTasks } from '@/modules/projectTasks';
import { projectTaskBulkSchema, routeId } from '@/modules/projectTasks/schemas';
import { parseInput } from '@/modules/projectTasks/shared';

// Per person, not per IP: behind the office network everyone shares one address.
const PER_PERSON = { key: 'project-tasks-bulk', limit: 30, windowMs: 60_000 };
const ROUTE = '/api/projects/[id]/tasks/bulk';
const MAX_BODY_BYTES = 16 * 1024;

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * The body as JSON, refused before parsing when it is over 16 KB.
 * @param {Request} request
 * @returns {Promise<unknown>} {} for an empty body
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
async function readCappedJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw tooLarge();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}

export const POST = withRoute(
  { permission: 'project.manage' },
  async ({ user, params, request, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    const body = parseInput(projectTaskBulkSchema, await readCappedJson(request));
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND', { message: "We couldn't find that project." });
    return projectTasks.bulkUpdate({
      user,
      projectId,
      changes: body.changes,
      shareConfirmed: body.shareConfirmed,
      ip,
    });
  },
);
