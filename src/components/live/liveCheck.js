// One live check (CONTRACT 26): GET /api/notifications?after=<cursor> with plain fetch, never
// `api` (apiFetch sends the page to /login on a 401, and every waiting tab would follow as it takes
// the lock). It never touches window.location: a 401 or 403 only stops the loop. A check that
// hasn't answered in 20 s is aborted and counts as an error, so one stalled request (a dead
// keep-alive socket, a stuck host process, a captive portal) never holds the loop for good.
import { CHECK_TIMEOUT_MS } from './liveRules';

/** The fetch and the reading of its body; any failure is `{ retry: true }`. */
async function request(fetchFn, cursor, signal) {
  let response;
  try {
    response = await fetchFn(`/api/notifications?after=${cursor}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch {
    return { retry: true };
  }
  if (response.status === 401 || response.status === 403) return { stop: true };
  if (!response.ok) return { retry: true };
  const json = await response.json().catch(() => null);
  const data = json?.data;
  if (!data || !Array.isArray(data.items)) return { retry: true };
  return {
    ok: true,
    answer: {
      userId: Number(data.userId),
      items: data.items,
      more: data.more === true,
      unreadCount: Number.isFinite(data.unreadCount) ? data.unreadCount : null,
      latestId: Number.isFinite(data.latestId) ? data.latestId : null,
    },
  };
}

/**
 * @param {{ fetch: typeof fetch, after: number | null, signal?: AbortSignal,
 *   timeoutMs?: number, setTimer?: Function, clearTimer?: Function }} options `signal`: the
 *   caller's (the tab stopping aborts it); the time limit aborts the request too, and resolves
 *   `{ retry: true }` even when a fetch ignores its signal.
 * @returns {Promise<{ ok: true, answer: { userId: number, items: object[], more: boolean,
 *   unreadCount: number, latestId: number } } | { stop: true } | { retry: true }>}
 *   `stop`: signed out or deactivated (401, 403); `retry`: a network error, a check over the time
 *   limit, or any other answer that isn't 2xx, or a body that can't be read.
 */
export function checkOnce({
  fetch: fetchFn,
  after,
  signal,
  timeoutMs = CHECK_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const cursor = Number.isSafeInteger(after) && after > 0 ? after : 0;
  const inner = typeof AbortController === 'function' ? new AbortController() : null;
  const abort = () => inner?.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener?.('abort', abort);
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimer(() => {
      timer = null;
      abort();
      resolve({ retry: true });
    }, timeoutMs);
  });
  return Promise.race([request(fetchFn, cursor, inner?.signal ?? signal), late]).finally(() => {
    if (timer !== null) clearTimer(timer);
    signal?.removeEventListener?.('abort', abort);
  });
}
