// One project or task file (CONTRACT 27, Downloads and Management).
// GET → the file as a download, any type: attachment, application/octet-stream, streamed, one
// Range (206, 416), If-Range, ETag and If-None-Match (304); 404 "We couldn't find that file." to
// anyone who may not see it, FILE_MISSING when its disk file is gone (plain text for a page). 600 a
// minute per person, one bucket with /view and /thumb.
// PATCH, body `fileUpdateSchema` ({ name?: base name, phase?, visibility? }) → { file }; DELETE →
// { id } (a soft delete). The project's PM and Admins only (the service decides: 404 to anyone who
// can't see the file, else 403); 120 a minute per person.
import { withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { answerFile, countRequest, fileIdOf, readEditBody } from '../fileRoute';

export const runtime = 'nodejs';

export const GET = withRoute({ permission: 'signed_in' }, (context) =>
  answerFile(context, 'download'),
);

export const PATCH = withRoute(
  { permission: 'signed_in' },
  async ({ user, params, ip, request }) => {
    countRequest('change', user);
    const id = fileIdOf(params);
    const input = await readEditBody(request);
    return { file: await projectFiles.updateFile({ user, id, input, ip }) };
  },
);

export const DELETE = withRoute({ permission: 'signed_in' }, async ({ user, params, ip }) => {
  countRequest('change', user);
  return projectFiles.removeFile({ user, id: fileIdOf(params), ip });
});
