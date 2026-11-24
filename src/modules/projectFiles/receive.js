// One piece of an upload (CONTRACT 27, Uploads "Piece"), cheapest checks first: at most 2 pieces
// at once per process, the person's own receiving upload, the size header before the body is
// read, a lease claimed in one statement, then the body (`request.formData()`, one `piece` part of
// exactly the expected size), a positional write with an optional SHA-256, and the new offset.
import { now, nowDate } from '@/lib/time';
import { removeQuietly, sizeOnDisk, truncateTo, writeAt } from './disk';
import { fileError, uploadBusy } from './errors';
import { guard019Write } from './migration019';
import { expectedPieceBytes, wholePiecesOffset } from './pieces';
import { ensureReady, partPath } from './storage';
import * as uploadRepo from './uploadRepo';
import { RECEIVING_HOURS, ownUpload, storageFailure } from './uploads';

/** 2 pieces read or written at once per web process (Hosting and cost); the rest wait. */
const MAX_AT_ONCE = 2;
const PIECE_LEASE_MS = 2 * 60_000;
/** A piece request may carry this much besides the piece (the multipart framing). */
const FRAMING_BYTES = 65_536;
const SHA256 = /^[0-9a-f]{64}$/;

// Shared by every copy of this module in the process (the dev server may load it twice).
const slots = globalThis.__daybookPieceSlots ?? { running: 0 };
globalThis.__daybookPieceSlots = slots;

/** Seconds until a lease ends, 1 to 120 (Retry-After). */
export function secondsUntil(until) {
  const seconds = Math.ceil((new Date(until).getTime() - nowDate().getTime()) / 1000);
  return Math.min(120, Math.max(1, seconds));
}

/** Step 3: the upload can still take pieces. */
async function assertReceiving(row) {
  if (row.status === 'cancelled' || row.status === 'expired') throw fileError('UPLOAD_GONE');
  if (row.status === 'ready' || row.status === 'attached') throw fileError('UPLOAD_OFFSET');
  if (new Date(row.expiresAt) <= nowDate()) {
    await uploadRepo.setStatus({ id: row.id, status: 'expired', from: ['receiving'] });
    throw fileError('UPLOAD_GONE');
  }
}

/** Step 4: `Content-Length` there and at most a piece plus 64 KiB, before the body is read. */
function assertLength(request, row) {
  const header = request.headers.get('content-length');
  if (header === null || header === '' || !/^\d+$/.test(header)) {
    throw fileError('LENGTH_REQUIRED');
  }
  if (Number(header) > Number(row.pieceBytes) + FRAMING_BYTES) {
    throw fileError('PAYLOAD_TOO_LARGE');
  }
}

/** Step 5: the lease, or why not (another part of the file, or another request on it). */
async function claimLease(user, row, offset) {
  const at = nowDate();
  const until = new Date(at.getTime() + PIECE_LEASE_MS);
  const claimed = await uploadRepo.claimPieceLease({
    id: row.id,
    userId: user.id,
    offset,
    until,
    at,
  });
  if (claimed) return;
  const fresh = await uploadRepo.findByKey(row.uploadKey);
  if (!fresh) throw fileError('UPLOAD_GONE');
  await assertReceiving(fresh);
  if (Number(fresh.receivedBytes) !== offset) throw fileError('UPLOAD_OFFSET');
  throw uploadBusy(fresh.busyUntil ? secondsUntil(fresh.busyUntil) : 2);
}

/** Step 6: exactly one field, `piece`, a file of exactly the expected size. */
async function readPiece(request, expected) {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw fileError('PIECE_BAD');
  }
  const keys = [...form.keys()];
  const piece = form.get('piece');
  if (keys.length !== 1 || keys[0] !== 'piece' || typeof piece === 'string' || !piece) {
    throw fileError('PIECE_BAD');
  }
  if (piece.size !== expected) throw fileError('PIECE_BAD');
  return piece;
}

/**
 * The `.part` before a write: gone (a host scanner moved it) is UPLOAD_LOST; shorter than the
 * offset (the machine lost data) sets the offset back to its last whole piece: UPLOAD_OFFSET.
 */
async function checkPart(part, row) {
  const size = await sizeOnDisk(part);
  if (size === null) {
    await uploadRepo.setStatus({ id: row.id, status: 'cancelled', from: ['receiving'] });
    throw fileError('UPLOAD_LOST');
  }
  if (size < Number(row.receivedBytes)) {
    const receivedBytes = wholePiecesOffset(size, Number(row.pieceBytes));
    await uploadRepo.setReceived({ id: row.id, receivedBytes });
    throw fileError('UPLOAD_OFFSET');
  }
}

/** Step 7: the write; a disk error stops the upload where Storage says so. */
async function writePiece(part, row, offset, piece, sha256) {
  let written;
  try {
    written = await writeAt(part, offset, piece.stream(), { hash: Boolean(sha256) });
  } catch (error) {
    const failure = await storageFailure(error, { uploadId: row.id });
    if (failure.code === 'FILES_DISK_FULL') {
      await uploadRepo.setStatus({ id: row.id, status: 'cancelled', from: ['receiving'] });
      await removeQuietly(part);
    } else if (error?.code === 'ENOENT') {
      await uploadRepo.setStatus({ id: row.id, status: 'cancelled', from: ['receiving'] });
      throw fileError('UPLOAD_LOST');
    } else {
      await truncateTo(part, offset).catch(() => {});
    }
    throw failure;
  }
  if (written.bytes !== piece.size) {
    await truncateTo(part, offset);
    throw fileError('PIECE_BAD');
  }
  if (sha256 && written.sha256 !== sha256) {
    await truncateTo(part, offset);
    throw fileError('PIECE_CHECKSUM');
  }
  return offset + written.bytes;
}

/** Steps 3 to 8 for one piece, inside a slot. */
async function receive({ user, key, offset, request }) {
  const root = await ensureReady();
  if (!Number.isSafeInteger(offset) || offset < 0) throw fileError('UPLOAD_OFFSET');
  const row = await ownUpload(user, key);
  await assertReceiving(row);
  assertLength(request, row);
  const sha256 = request.headers.get('x-piece-sha256');
  if (sha256 !== null && !SHA256.test(sha256)) throw fileError('PIECE_BAD');
  await claimLease(user, row, offset);
  let released = false;
  try {
    const expected = expectedPieceBytes(Number(row.sizeBytes), Number(row.pieceBytes), offset);
    if (expected === null) throw fileError('UPLOAD_OFFSET');
    const part = partPath(root, row.uploadKey);
    await checkPart(part, row);
    const piece = await readPiece(request, expected);
    const receivedBytes = await writePiece(part, row, offset, piece, sha256);
    const expiresAt = now().add(RECEIVING_HOURS, 'hour').toDate();
    const saved = await uploadRepo.savePiece({ id: row.id, receivedBytes, expiresAt });
    released = true;
    if (!saved) throw fileError('UPLOAD_GONE'); // cancelled while the piece was written
    return { offset: receivedBytes };
  } finally {
    if (!released) await uploadRepo.releaseLease(row.id).catch(() => {});
  }
}

/**
 * One piece (`POST /api/uploads/[key]/pieces?offset=N`), written at the offset under a lease.
 * @param {{ user: object, key: string, offset: number, request: Request }} args request: its body
 *   is `multipart/form-data` with one part `piece`; an `X-Piece-Sha256` header (64 lower hex) is
 *   checked against the bytes written
 * @returns {Promise<{ offset: number }>} the new offset
 * @throws NOT_FOUND, PIECE_BAD (400), UPLOAD_OFFSET (409), UPLOAD_GONE (410), UPLOAD_LOST (410),
 *   LENGTH_REQUIRED (411), PAYLOAD_TOO_LARGE (413), PIECE_CHECKSUM (422), UPLOAD_BUSY (429, with
 *   `retryAfter` seconds), FILES_UNAVAILABLE (503), UPDATE_NEEDED (503), FILES_DISK_FULL (507)
 */
export async function receivePiece({ user, key, offset, request }) {
  if (slots.running >= MAX_AT_ONCE) throw uploadBusy(2);
  slots.running += 1;
  try {
    return await guard019Write('files', () =>
      receive({ user, key, offset: Number(offset), request }),
    );
  } finally {
    slots.running -= 1;
  }
}
