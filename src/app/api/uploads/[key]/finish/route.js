// Finish of an upload (CONTRACT 27, Uploads "Finish"), safe to repeat: POST, no body or
// `multipart/form-data` with one part `thumb` (a picture's JPEG). Target project → 201
// { data: { file: ProjectFile } }; target task → 200 { data: { upload: { key, status: 'ready',
// name, size, ext, isPicture, expiresAt } } }. 60 a minute per person. UPLOAD_BUSY answers 429
// with `Retry-After`; other errors: 403 (no longer manages), 404, 409 UPLOAD_INCOMPLETE, 410, 507.
import { withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { answerBusy, countRequest, readThumb } from '../../uploadRoute';

export const runtime = 'nodejs';

export const POST = withRoute(
  { permission: 'signed_in' },
  async ({ user, params, request, requestId }) => {
    countRequest('finish', user);
    return answerBusy(async () => {
      const thumb = await readThumb(request);
      const data = await projectFiles.finishUpload({ user, key: params.key, thumb });
      return Response.json({ data }, { status: data.file ? 201 : 200 });
    }, requestId);
  },
);
