// One note or text (CONTRACT 22 and 27). GET returns it with its text to the project's PM and Admins,
// and to members for an Everyone note or text-only document; anyone else gets NOT_FOUND, so GET only
// asks for a signed-in person and the service decides. PATCH { title?, text?, phase?, visibility? }
// edits a note or a text-only document (a file's text follows its file: 400) and DELETE removes a
// note or a text (a file's text only: the file stays): the project's PM or Admin. A body over 1 MB is
// refused with 413 before it is parsed.
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
