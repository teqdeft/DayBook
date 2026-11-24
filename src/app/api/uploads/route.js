// Start of an upload (CONTRACT 27, Uploads): POST, JSON `uploadStartSchema` → 201
// { data: { key, pieceSize, offset: 0, name, size, expiresAt } } (`name`: the cleaned name).
// Managers of the project only (the service decides); 60 a minute per person. Errors: 400, 403,
// 404, 413 FILE_TOO_BIG, 429, 503 FILES_UNAVAILABLE or UPDATE_NEEDED, 507 FILES_SPACE_FULL or
// FILES_DISK_FULL.
import { withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { countRequest, readStartBody } from './uploadRoute';

export const runtime = 'nodejs';

export const POST = withRoute(
  { permission: 'signed_in', status: 201 },
  async ({ user, request }) => {
    countRequest('start', user);
    return projectFiles.startUpload({ user, input: await readStartBody(request) });
  },
);
