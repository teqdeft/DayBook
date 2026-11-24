// One file on its way in (CONTRACT 27, Uploads, Browser side), without React: Start, the pieces
// with XMLHttpRequest (upload progress within a piece), the thumbnail, Finish, Cancel. The piece
// size always comes from the Start answer. Every request follows the same rules (uploadRetry.js):
// Status before each try again (a lost answer moves on without sending anything twice), 409
// UPLOAD_OFFSET goes on from the server's offset, UPLOAD_BUSY waits without counting, a file that
// keeps failing is Paused until Retry. Finish is safe to repeat. Cancel aborts the running request
// first, then cancels on the server (with keepalive when the page is leaving).
import { browserIo } from './uploadIo';
import { classify, failureOf, fetchAnswer, isNotReadable, LONG_TIMEOUT_MS } from './uploadHttp';
import { toHex, xhrAnswer } from './uploadHttp';
import { createRetrier } from './uploadRetry';
import { cancelOnServer } from './uploadCancel';
import { wantsThumb } from './makeThumb';

export { cancelOnServer };

const STOPPED = new Set(['done', 'error', 'cancelled']);

/** Thrown inside a run to end it; never leaves this file. */
class End {
  constructor(kind, failure = null) {
    this.kind = kind; // 'pause' | 'stop' | 'cancel'
    this.failure = failure;
  }
}

const uploadUrl = (key) => `/api/uploads/${key}`;
const unreadable = () => new End('stop', { code: 'NOT_READABLE', status: 0, fields: {} });

/**
 * @typedef {{ phase: 'waiting' | 'uploading' | 'retrying' | 'paused' | 'error' | 'done' |
 *   'cancelled', key: string | null, size: number, offset: number, sent: number,
 *   percent: number, failure: object | null, result: object | null }} UploadSnapshot
 *   phase 'waiting' also while the server is busy (UPLOAD_BUSY, TOO_MANY_UPLOADS, a 429);
 *   'retrying' after a lost connection or a 5xx; sent: the bytes the server has plus the part of
 *   the running piece on its way; failure: `{ code, status, message, fields, canRetry, reason? }`
 *   (code HOST_REFUSED for a host's own 4xx page, NOT_READABLE for a file that moved; reason
 *   'cancelled' or 'expired' for UPLOAD_GONE when Status could tell); result: the Finish answer's
 *   `file` (a project file) or `upload` (a held task upload, `{ key, status: 'ready', ... }`)
 */

/**
 * @param {{ file: File, request: { projectId: number, target: 'project' | 'task',
 *   taskId?: number | null, phase?: string | null, visibility?: 'everyone' | 'managers' },
 *   io?: object, onChange?: (snapshot: UploadSnapshot) => void }} options request: the Start
 *   body without the name and size
 */
export function createFileUpload({ file, request, io = browserIo(), onChange = () => {} }) {
  const retrier = createRetrier({ now: io.now, random: io.random });
  const state = { phase: 'waiting', key: null, size: file.size, offset: 0, sent: 0 };
  Object.assign(state, { pieceSize: 0, failure: null, result: null });
  let controller = null;
  let cancelled = false;
  let leftPage = false;
  let thumb; // undefined until made: a Blob, or null for none

  function snapshot() {
    const { phase, key, size, offset, sent, failure, result } = state;
    const percent = size > 0 ? Math.min(100, Math.floor((sent / size) * 100)) : 0;
    return { phase, key, size, offset, sent, percent, failure, result };
  }

  function emit(changes = {}) {
    Object.assign(state, changes);
    onChange(snapshot());
  }

  async function online() {
    if (io.isOnline()) return;
    emit({ phase: 'retrying' });
    await io.waitOnline(controller.signal);
  }

  /** Waits, showing why ('waiting' or 'retrying'), then waits for the network if it is gone. */
  async function wait(ms, phase) {
    if (phase !== state.phase) emit({ phase });
    if (ms > 0) await io.sleep(ms, controller.signal);
    await online();
  }

  /** The next step after a failed answer, or the End it means. */
  function stepAfter(kind, answer) {
    const step = retrier.after(kind, answer.retryAfter);
    if (step.pause) throw new End('pause');
    if (step.stop) throw new End('stop', failureOf(answer));
    return step;
  }

  /** One request through the rules; `onRetry` runs before each try again (it asks Status). */
  async function call(send, { onRetry, tooMany = false } = {}) {
    for (;;) {
      if (cancelled) throw new End('cancel');
      await online();
      const answer = await send();
      const kind = classify(answer);
      if (kind === 'ok') return answer;
      if (kind === 'aborted' || cancelled) throw new End('cancel');
      if (kind === 'stop' || (kind === 'tooMany' && !tooMany)) {
        throw new End('stop', failureOf(answer));
      }
      const step = stepAfter(kind, answer);
      if (step.again) continue;
      await wait(step.waitMs, step.state);
      if (step.resync && onRetry && (await onRetry(step))) return null;
    }
  }

  /** Status: takes the server's offset. `unknown` when Status itself didn't answer. */
  async function status() {
    const answer = await fetchAnswer(io, uploadUrl(state.key), { signal: controller.signal });
    const kind = classify(answer);
    if (kind === 'aborted' || cancelled) throw new End('cancel');
    if (kind === 'stop') throw new End('stop', failureOf(answer));
    if (kind !== 'ok') return { unknown: true, kind, answer };
    const { offset, status: now, busy } = answer.data;
    if (now === 'cancelled' || now === 'expired') {
      throw new End('stop', { code: 'UPLOAD_GONE', status: 410, reason: now, fields: {} });
    }
    if (now !== 'receiving') emit({ offset: state.size, sent: state.size });
    else if (Number.isSafeInteger(offset) && offset >= 0) emit({ offset, sent: offset });
    return { busy: busy === true, finished: now !== 'receiving' };
  }

  /** Status until it answers (a failed Status is a failed try too). */
  async function statusSure() {
    for (;;) {
      const seen = await status();
      if (!seen.unknown) return seen;
      const step = stepAfter(seen.kind, seen.answer);
      if (!step.again) await wait(step.waitMs, step.state);
    }
  }

  /**
   * Start. Its request is never aborted: when the file is cancelled while Start is on its way,
   * the answer's key is cancelled on the server here, so no upload is left holding space.
   */
  async function start() {
    const json = { ...request, name: file.name, size: file.size, lastModified: file.lastModified };
    const answer = await call(() => fetchAnswer(io, '/api/uploads', { method: 'POST', json }), {
      tooMany: true,
    });
    const { key, pieceSize, offset } = answer.data;
    state.key = key;
    if (cancelled) {
      await cancelOnServer(io, key, { leaving: leftPage });
      throw new End('cancel');
    }
    retrier.reset();
    emit({ key, pieceSize: Number(pieceSize), offset: Number(offset) || 0, sent: 0 });
  }

  async function digest(piece) {
    if (!io.subtle) return null;
    try {
      return toHex(await io.subtle.digest('SHA-256', await piece.arrayBuffer()));
    } catch (error) {
      if (isNotReadable(error)) throw unreadable();
      return null;
    }
  }

  /** After a lost connection: a file that moved or changed on the computer stops the upload. */
  async function checkReadable(piece) {
    try {
      await piece.slice(0, 1).arrayBuffer();
    } catch (error) {
      if (isNotReadable(error)) throw unreadable();
    }
  }

  async function sendPiece() {
    const { offset, pieceSize, size } = state;
    const piece = file.slice(offset, Math.min(offset + pieceSize, size));
    const sha = await digest(piece);
    const form = io.createForm();
    form.append('piece', piece, 'piece');
    emit({ phase: 'uploading' });
    const answer = await xhrAnswer(io, `${uploadUrl(state.key)}/pieces?offset=${offset}`, {
      form,
      headers: sha ? { 'X-Piece-Sha256': sha } : {},
      signal: controller.signal,
      onProgress: (loaded, total) => {
        const sent = offset + Math.floor(piece.size * Math.min(1, total > 0 ? loaded / total : 0));
        const moved = Math.floor((sent / size) * 100) !== Math.floor((state.sent / size) * 100);
        if (moved) emit({ sent });
        else state.sent = sent;
      },
    });
    if (answer.network || answer.timeout) await checkReadable(piece);
    return answer;
  }

  /** Before a piece is sent again: true when Status shows the server already has it. */
  async function retryPiece(first) {
    const at = state.offset;
    let step = first;
    for (;;) {
      const seen = await statusSure();
      if (seen.finished || state.offset !== at) return true;
      if (!step.busy || !seen.busy) return false;
      step = retrier.after('busy', null);
      if (step.pause) throw new End('pause');
      await wait(step.waitMs, step.state);
      if (!step.busy) return false; // 3 minutes of busy: tries count from here
    }
  }

  async function sendPieces() {
    while (state.offset < state.size) {
      const answer = await call(sendPiece, { onRetry: retryPiece });
      if (!answer) continue; // Status moved the offset on: the piece had arrived
      retrier.reset();
      const next = Number(answer.data?.offset);
      if (Number.isSafeInteger(next) && next > state.offset) emit({ offset: next, sent: next });
      else await statusSure();
    }
  }

  /** Before Finish is sent again: Status, and any bytes the server is missing go first. */
  async function retryFinish() {
    await statusSure();
    if (state.offset < state.size) await sendPieces();
    return false;
  }

  async function finish() {
    if (thumb === undefined) thumb = wantsThumb(file) ? await io.makeThumb(file) : null;
    const send = () => {
      let form;
      if (thumb) {
        form = io.createForm();
        form.append('thumb', thumb, 'thumb.jpg');
      }
      emit({ phase: 'uploading', sent: state.size });
      const signal = controller.signal;
      return fetchAnswer(io, `${uploadUrl(state.key)}/finish`, {
        method: 'POST',
        form,
        timeoutMs: LONG_TIMEOUT_MS,
        signal,
      });
    };
    const answer = await call(send, { onRetry: retryFinish });
    return answer.data.file ?? answer.data.upload;
  }

  /** UPLOAD_GONE says "stopped" or "left too long": Status tells which, when it can. */
  async function goneReason(failure) {
    if (failure?.code !== 'UPLOAD_GONE' || failure.reason || !state.key) return failure;
    const answer = await fetchAnswer(io, uploadUrl(state.key), {});
    const reason = answer.data?.status === 'cancelled' ? 'cancelled' : 'expired';
    return { ...failure, reason };
  }

  async function ended(error) {
    if (cancelled || (error instanceof End && error.kind === 'cancel')) {
      emit({ phase: 'cancelled' });
      return { status: 'cancelled' };
    }
    if (error instanceof End && error.kind === 'pause') {
      emit({ phase: 'paused' });
      return { status: 'paused' };
    }
    const known = error instanceof End ? error.failure : null;
    const failure = await goneReason(known ?? { code: 'INTERNAL', status: 0, fields: {} });
    emit({ phase: 'error', failure });
    return { status: 'error', failure };
  }

  return {
    get snapshot() {
      return snapshot();
    },

    /**
     * The file's turn in the tab's queue: everything it can do now. A run after a pause or a
     * 401 asks Status first and sends nothing twice.
     * @returns {Promise<{ status: 'done' | 'paused' | 'error' | 'cancelled', result?: object,
     *   failure?: object }>}
     */
    async run() {
      const again = state.phase === 'error' && state.failure?.canRetry;
      if (STOPPED.has(state.phase) && !again) return { status: state.phase, result: state.result };
      controller = io.createAbort();
      retrier.reset();
      emit({ phase: 'uploading', failure: null });
      try {
        if (!state.key) await start();
        else await statusSure();
        await sendPieces();
        const result = await finish();
        emit({ phase: 'done', result, offset: state.size, sent: state.size });
        return { status: 'done', result };
      } catch (error) {
        return ended(error);
      } finally {
        controller = null;
      }
    },

    /**
     * Stops the file: aborts the running request, then cancels it on the server (a running,
     * paused, failed or held upload; a finished project file stays). With `leaving` the Cancel
     * goes with keepalive and isn't tried again.
     * @param {{ leaving?: boolean }} [options]
     * @returns {Promise<'cancelled' | 'kept'>} kept: the server had already added the file (409)
     */
    async cancel({ leaving = false } = {}) {
      const added = state.phase === 'done' && request.target !== 'task';
      if (cancelled || added || state.phase === 'cancelled') return 'cancelled';
      cancelled = true;
      leftPage = leaving;
      controller?.abort();
      if (state.phase !== 'error') emit({ phase: 'cancelled' });
      if (!state.key) return 'cancelled'; // a Start on its way cancels its own key (start)
      return cancelOnServer(io, state.key, { leaving });
    },
  };
}
