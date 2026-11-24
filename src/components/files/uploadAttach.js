// The attach call of the attach store (CONTRACT 27, Task files): `POST
// /api/project-tasks/[id]/files { uploadKeys }` once a batch is done, through the same rules as
// the uploads (uploadClient.js): a lost connection, a time-out, 408, a 429 and any 5xx are tried
// again (about 1 to 30 s); it waits up to 3 minutes for an answer. When an answer was lost and the
// next try is refused (the first one had attached the files), Status tells: every key `attached`
// means the files are on the task.
import { browserIo } from './uploadIo';
import { classify, failureOf, fetchAnswer, LONG_TIMEOUT_MS } from './uploadHttp';
import { createRetrier } from './uploadRetry';

const NETWORK = Object.freeze({ code: 'NETWORK', status: 0, message: null, fields: {} });

/** Whether every held upload is now on the task (its Status says `attached`). */
async function allAttached(io, uploadKeys) {
  for (const key of uploadKeys) {
    const answer = await fetchAnswer(io, `/api/uploads/${key}`, {});
    if (classify(answer) !== 'ok' || answer.data?.status !== 'attached') return false;
  }
  return true;
}

/**
 * @param {{ taskId: number, uploadKeys: string[], io?: object }} options
 * @returns {Promise<{ ok: true, data: { files: object[], told: 'person' | 'members' | null,
 *   toldName: string | null } } | { ok: false, failure: { code: string, status: number,
 *   message: string | null, fields: Record<string, string> } }>} failure code NETWORK when
 *   every try was lost
 */
export async function sendAttach({ taskId, uploadKeys, io = browserIo() }) {
  const retrier = createRetrier({ now: io.now, random: io.random });
  let retried = false;
  for (;;) {
    if (!io.isOnline()) await io.waitOnline();
    const answer = await fetchAnswer(io, `/api/project-tasks/${taskId}/files`, {
      method: 'POST',
      json: { uploadKeys },
      timeoutMs: LONG_TIMEOUT_MS,
    });
    const kind = classify(answer);
    if (kind === 'ok') return { ok: true, data: answer.data };
    const refused = answer.status >= 400 && answer.status < 500 && kind === 'stop';
    if (refused && retried && (await allAttached(io, uploadKeys))) {
      return { ok: true, data: { files: [], told: null, toldName: null } };
    }
    if (kind === 'stop' || kind === 'aborted') return { ok: false, failure: failureOf(answer) };
    const step = retrier.after(kind === 'connection' ? 'connection' : 'limited', answer.retryAfter);
    if (step.pause || step.stop) return { ok: false, failure: NETWORK };
    retried = true;
    await io.sleep(step.waitMs);
  }
}
