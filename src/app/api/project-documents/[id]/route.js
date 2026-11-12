// One file or note (CONTRACT 22). GET returns it with its text; anyone who can't manage its project
// gets NOT_FOUND, employees too, so GET only asks for a signed-in person and the service decides.
// PATCH { title?, text? } edits a note and DELETE removes a file or note: the project's PM or Admin.
// A body over 1 MB is refused with 413 before it is parsed.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { routeId } from '@/modules/projectPlan/schemas';
import { projectSummaries } from '@/modules/projectSummaries';
import { readLimitedJson } from '@/modules/projectSummaries/readBody';

function documentId(params) {
  const id = routeId(params);
  if (!id) throw new AppError('NOT_FOUND');
  return id;
}

export const GET = withRoute({ permission: 'signed_in' }, async ({ user, params }) =>
  projectSummaries.getDocument({ user, id: documentId(params) }),
);

export const PATCH = withRoute(
  { permission: 'project.manage' },
  async ({ user, params, ip, request }) => {
    const id = documentId(params);
    const input = await readLimitedJson(request);
    return projectSummaries.updateDocument({ user, id, input, ip });
  },
);

export const DELETE = withRoute({ permission: 'project.manage' }, async ({ user, params, ip }) =>
  projectSummaries.removeDocument({ user, id: documentId(params), ip }),
);
