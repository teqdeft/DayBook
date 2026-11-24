// Cancel on the server (CONTRACT 27, Uploads, "Cancel"): `DELETE /api/uploads/[key]` for a
// running, paused, failed or held upload. A 409 means the file made it (it stays in the list or on
// the task). While the page stays, a lost connection is tried again a few times; when the page is
// leaving (pagehide, an uploader unmounting) it goes once with keepalive, as undoQueue does for
// deletes (Origin is sent, so withRoute accepts it).
import { classify, fetchAnswer } from './uploadHttp';
import { createRetrier } from './uploadRetry';

const uploadUrl = (key) => `/api/uploads/${key}`;

/**
 * `DELETE /api/uploads/[key]` (Cancel). A 409 means the file made it: it stays where it went. A
 * lost connection is tried again a few times; with `leaving` it goes once, with keepalive.
 * @returns {Promise<'cancelled' | 'kept'>}
 */
export async function cancelOnServer(io, key, { leaving = false } = {}) {
  if (leaving) {
    // Sent at once, inside the pagehide handler: a page that is going away runs no later task.
    try {
      io.fetch(uploadUrl(key), {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      })?.catch?.(() => undefined);
    } catch {
      // the page is already gone: the upload expires on its own
    }
    return 'cancelled';
  }
  const retrier = createRetrier({ now: io.now, random: io.random });
  for (;;) {
    const answer = await fetchAnswer(io, uploadUrl(key), { method: 'DELETE' });
    if (answer.status === 409) return 'kept';
    const kind = classify(answer);
    if (kind !== 'connection' && kind !== 'limited' && kind !== 'busy') return 'cancelled';
    const step = retrier.after(kind === 'busy' ? 'limited' : kind, answer.retryAfter);
    if (step.pause || retrier.tries > 3) return 'cancelled';
    await io.sleep(step.waitMs).catch(() => undefined);
  }
}
