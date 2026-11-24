// The browser's side of the uploader in one object (CONTRACT 27, Uploads, Browser side), so
// uploadClient.js runs under test with a fake XHR, fetch and clock instead. Nothing here decides.
import { now } from '@/lib/time';
import { makeThumb } from './makeThumb';

/** An AbortError, as fetch rejects with. */
function aborted() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/** Resolves after `ms`, or rejects at once when the signal aborts. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves on the window's `online` event, or rejects when the signal aborts. */
function waitOnline(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onOnline = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      window.removeEventListener('online', onOnline);
      reject(aborted());
    };
    window.addEventListener('online', onOnline, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The real browser. `subtle` is null on a page that isn't a secure context (plain http), so no
 * `X-Piece-Sha256` is sent there.
 */
export function browserIo() {
  return {
    fetch: (url, options) => window.fetch(url, options),
    createXhr: () => new XMLHttpRequest(),
    createForm: () => new FormData(),
    createAbort: () => new AbortController(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer),
    sleep,
    now: () => now().valueOf(),
    random: () => Math.random(),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    waitOnline,
    subtle: globalThis.crypto?.subtle ?? null,
    makeThumb: (file) => makeThumb(file),
  };
}
