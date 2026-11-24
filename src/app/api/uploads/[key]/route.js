// Status and Cancel of the person's own upload (CONTRACT 27, Uploads).
// GET → { data: { key, offset, size, status, busy, expiresAt } }, `Cache-Control: no-store`
// (120 a minute per person). DELETE → { data: { cancelled: true } }; a `receiving` or `ready`
// upload's disk file goes at once; 409 CONFLICT "This file is already added." for an attached one
// (120 a minute). A malformed, unknown or someone else's key is 404.
import { withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { countRequest } from '../uploadRoute';

export const runtime = 'nodejs';

export const GET = withRoute({ permission: 'signed_in' }, async ({ user, params }) => {
  countRequest('status', user);
  const data = await projectFiles.uploadStatus({ user, key: params.key });
  return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
});

export const DELETE = withRoute({ permission: 'signed_in' }, async ({ user, params }) => {
  countRequest('cancel', user);
  return projectFiles.cancelUpload({ user, key: params.key });
});
