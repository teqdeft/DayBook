// How uploadClient.js talks to the upload routes (CONTRACT 27, Uploads, Browser side): plain fetch
// and XMLHttpRequest, never `api` from @/lib/apiClient, so a 401 never sends the page to sign in
// (as live/liveCheck.js). Every request ends as one "answer" and never throws for an HTTP status;
// `classify` sorts the answer into what the uploader does next. No React, no browser globals
// except through `io`, so the rules run under test with fakes.

/** Waits before trying again after a failed try: about 1, 2, 4, 8, 16 and 30 s (±20%). */
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000, 8000, 16000, 30000]);
export const JITTER = 0.2;
/** A piece that hasn't answered in 2 minutes counts as a lost connection. */
export const PIECE_TIMEOUT_MS = 120_000;
/** Finish and the attach call wait up to 3 minutes (the sync of a big file under the host's limit). */
export const LONG_TIMEOUT_MS = 180_000;
/** Start, Status and Cancel. */
export const SHORT_TIMEOUT_MS = 30_000;
/** UPLOAD_BUSY doesn't count as a failed try for up to 3 minutes (longer than a stopped lease). */
export const BUSY_LIMIT_MS = 180_000;
/** TOO_MANY_UPLOADS (other tabs): Start is tried again every 10 s. */
export const TOO_MANY_WAIT_MS = 10_000;
/** A piece that fails its checksum is sent again at most 3 times. */
export const CHECKSUM_TRIES = 3;

/** Daybook's own 5xx codes that are never tried again (the person or an Admin must act). */
const STOP_5XX = new Set([
  'UPDATE_NEEDED',
  'FILES_UNAVAILABLE',
  'FILES_SPACE_FULL',
  'FILES_DISK_FULL',
]);

/**
 * @typedef {{ status: number, data?: any, error?: { code: string, message?: string,
 *   fields?: Record<string, string> } | null, daybook: boolean, retryAfter: number | null,
 *   network?: boolean, timeout?: boolean, aborted?: boolean }} Answer
 *   daybook: the body is Daybook's JSON (`{ data }` or `{ error: { code } }`); retryAfter: the
 *   `Retry-After` header in seconds; network, timeout, aborted: no HTTP answer at all
 */

/** `Retry-After` as whole seconds (only the number form; a date is ignored). */
export function parseRetryAfter(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  return Number(text);
}

/** The answer from a status, a header reader and the body text. */
export function answerOf(status, header, text) {
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const isObject = json !== null && typeof json === 'object' && !Array.isArray(json);
  const ok = status >= 200 && status < 300;
  const error = isObject && json.error && typeof json.error.code === 'string' ? json.error : null;
  const daybook = ok ? isObject && 'data' in json : error !== null;
  return {
    status,
    data: ok && daybook ? json.data : undefined,
    error: ok ? null : error,
    daybook,
    retryAfter: parseRetryAfter(header('Retry-After')),
  };
}

/**
 * What the uploader does with an answer.
 * @param {Answer} answer
 * @returns {'ok' | 'aborted' | 'connection' | 'limited' | 'busy' | 'tooMany' | 'offset' |
 *   'incomplete' | 'checksum' | 'stop'} connection: a network error, a time-out, 408, any 5xx
 *   (Daybook's or the host's, an HTML 508 too) except Daybook's own four, or a 2xx that isn't
 *   Daybook's JSON; limited: any other 429; stop: everything that is never tried again
 */
export function classify(answer) {
  if (answer.aborted) return 'aborted';
  if (answer.network || answer.timeout) return 'connection';
  const { status } = answer;
  const code = answer.daybook ? answer.error?.code : null;
  if (status >= 200 && status < 300) return answer.daybook ? 'ok' : 'connection';
  if (status === 408) return 'connection';
  if (status === 429) {
    if (code === 'UPLOAD_BUSY') return 'busy';
    if (code === 'TOO_MANY_UPLOADS') return 'tooMany';
    return 'limited';
  }
  if (status >= 500) return code && STOP_5XX.has(code) ? 'stop' : 'connection';
  if (code === 'UPLOAD_OFFSET') return 'offset';
  if (code === 'UPLOAD_INCOMPLETE') return 'incomplete';
  if (code === 'PIECE_CHECKSUM') return 'checksum';
  return 'stop';
}

/**
 * Why a file stopped, for fileMessages: Daybook's code, or HOST_REFUSED for a 4xx whose body
 * isn't Daybook's JSON (the host's firewall: 403, 406, 413, 501 and so on).
 * @param {Answer} answer
 * @returns {{ code: string, status: number, message: string | null,
 *   fields: Record<string, string>, canRetry: boolean }} canRetry: signed out (401), so Retry
 *   carries on once the person has signed in again
 */
export function failureOf(answer) {
  const daybook = answer.daybook && answer.error;
  return {
    code: daybook ? answer.error.code : 'HOST_REFUSED',
    status: answer.status,
    message: daybook ? (answer.error.message ?? null) : null,
    fields: (daybook && answer.error.fields) || {},
    canRetry: answer.status === 401,
  };
}

/** One request with fetch; an answer, never a throw. */
export async function fetchAnswer(io, url, options = {}) {
  const { method = 'GET', json, form, keepalive = false, signal } = options;
  const timeoutMs = options.timeoutMs ?? SHORT_TIMEOUT_MS;
  const inner = new AbortController();
  const onAbort = () => inner.abort();
  if (signal?.aborted) inner.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = io.setTimer(() => {
    timedOut = true;
    inner.abort();
  }, timeoutMs);
  try {
    const response = await io.fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive,
      signal: inner.signal,
      headers: json === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: json !== undefined ? JSON.stringify(json) : form,
    });
    const text = await response.text().catch(() => '');
    return answerOf(response.status, (name) => response.headers.get(name), text);
  } catch {
    if (signal?.aborted) return { status: 0, daybook: false, retryAfter: null, aborted: true };
    if (timedOut) return { status: 0, daybook: false, retryAfter: null, timeout: true };
    return { status: 0, daybook: false, retryAfter: null, network: true };
  } finally {
    io.clearTimer(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * One piece with XMLHttpRequest (fetch has no upload progress). Listeners are set before
 * `send()`; the signal aborts the request.
 * @param {object} io
 * @param {string} url
 * @param {{ form: FormData, headers?: Record<string, string>, signal?: AbortSignal,
 *   onProgress?: (loaded: number, total: number) => void }} options
 * @returns {Promise<Answer>}
 */
export function xhrAnswer(io, url, { form, headers = {}, signal, onProgress }) {
  return new Promise((resolve) => {
    const xhr = io.createXhr();
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(answer);
    };
    const onAbort = () => xhr.abort();
    xhr.open('POST', url);
    xhr.timeout = PIECE_TIMEOUT_MS;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () =>
      done(answerOf(xhr.status, (name) => xhr.getResponseHeader(name), xhr.responseText));
    xhr.onerror = () => done({ status: 0, daybook: false, retryAfter: null, network: true });
    xhr.ontimeout = () => done({ status: 0, daybook: false, retryAfter: null, timeout: true });
    xhr.onabort = () => done({ status: 0, daybook: false, retryAfter: null, aborted: true });
    if (signal?.aborted) {
      done({ status: 0, daybook: false, retryAfter: null, aborted: true });
      return;
    }
    signal?.addEventListener('abort', onAbort);
    xhr.send(form);
  });
}

/** The file changed or moved on the computer after it was picked (File API snapshot state). */
export function isNotReadable(error) {
  return error?.name === 'NotReadableError' || error?.name === 'NotFoundError';
}

/** A SHA-256 as 64 lower-case hex characters. */
export function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
