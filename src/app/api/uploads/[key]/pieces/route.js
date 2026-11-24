// One piece of an upload (CONTRACT 27, Uploads "Piece"): POST `?offset=N`, `multipart/form-data`
// with one part `piece`, optional `X-Piece-Sha256` → { data: { offset } }. No `body` option, so
// withRoute leaves the body to the service (it checks Content-Length before reading it). 300 a
// minute per person. UPLOAD_BUSY answers 429 with `Retry-After`; other errors: 400 PIECE_BAD, 404,
// 409 UPLOAD_OFFSET, 410 UPLOAD_GONE or UPLOAD_LOST, 411, 413, 422 PIECE_CHECKSUM, 503, 507.
import { withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { parseInput, pieceQuerySchema } from '@/modules/projectFiles/schemas';
import { answerBusy, countRequest } from '../../uploadRoute';

export const runtime = 'nodejs';

export const POST = withRoute(
  { permission: 'signed_in' },
  async ({ user, params, query, request, requestId }) => {
    countRequest('pieces', user);
    const { offset } = parseInput(pieceQuerySchema, query);
    return answerBusy(
      () => projectFiles.receivePiece({ user, key: params.key, offset, request }),
      requestId,
    );
  },
);
