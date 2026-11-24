// When and how long an upload waits before it tries again (CONTRACT 27, Uploads, Browser side).
// Counted tries: a lost connection, a time-out, 408, any 5xx and a plain 429 wait about 1, 2, 4,
// 8, 16 and 30 s (±20%, never sooner than `Retry-After`); after the sixth try again the file is
// Paused. Not counted: UPLOAD_BUSY (the server is busy with other files: Status every 2 s, growing
// to 10, for up to 3 minutes; only after that do tries count), TOO_MANY_UPLOADS (other tabs: Start
// again every 10 s) and a 409 UPLOAD_OFFSET (Status, then go on from the server's offset). A piece
// that fails its checksum is sent again at once, at most 3 times. Pure: the clock and the dice come
// in, so tests pin both.
import {
  BUSY_LIMIT_MS,
  CHECKSUM_TRIES,
  JITTER,
  RETRY_DELAYS_MS,
  TOO_MANY_WAIT_MS,
} from './uploadHttp';

/** More offset conflicts in a row than this count as a failed try (a server that never agrees). */
const OFFSET_CONFLICTS = 3;
const BUSY_STEP_S = 2;
const BUSY_MAX_S = 10;

/**
 * The wait before try number `tries` again (1 = the first try again), with jitter.
 * @param {number} tries 1 to 6
 * @param {() => number} random 0 up to 1
 */
export function backoffMs(tries, random = Math.random) {
  const base = RETRY_DELAYS_MS[Math.min(Math.max(tries, 1), RETRY_DELAYS_MS.length) - 1];
  return Math.round(base * (1 + (random() * 2 - 1) * JITTER));
}

/**
 * @param {{ now: () => number, random?: () => number }} clock
 * @returns {{ reset: () => void, after: (kind: string, retryAfter?: number | null) => object,
 *   readonly tries: number }} after: the step for a failed answer of this kind (classify):
 *   `{ pause: true }` (Paused, Retry), `{ stop: true }` (a checksum that never matched),
 *   `{ again: true }` (send again at once), or `{ waitMs, state, resync }` (wait, showing
 *   'waiting' or 'retrying', then ask Status first when `resync`)
 */
export function createRetrier({ now, random = Math.random }) {
  let tries = 0;
  let busySince = null;
  let busyStep = 0;
  let checks = 0;
  let conflicts = 0;

  function counted(state, retryAfter) {
    tries += 1;
    if (tries > RETRY_DELAYS_MS.length) return { pause: true };
    const floor = retryAfter ? retryAfter * 1000 : 0;
    return { waitMs: Math.max(backoffMs(tries, random), floor), state, resync: true };
  }

  return {
    get tries() {
      return tries;
    },

    /** A piece, Start or Finish went through: every count starts again. */
    reset() {
      tries = 0;
      busySince = null;
      busyStep = 0;
      checks = 0;
      conflicts = 0;
    },

    after(kind, retryAfter = null) {
      switch (kind) {
        case 'connection':
          return counted('retrying', retryAfter);
        case 'limited':
          return counted('waiting', retryAfter);
        case 'busy': {
          const at = now();
          if (busySince === null) busySince = at;
          if (at - busySince >= BUSY_LIMIT_MS) return counted('waiting', retryAfter);
          busyStep = Math.min(BUSY_MAX_S, busyStep + BUSY_STEP_S);
          const seconds = Math.min(BUSY_MAX_S, Math.max(busyStep, retryAfter ?? 0));
          return { waitMs: seconds * 1000, state: 'waiting', resync: true, busy: true };
        }
        case 'tooMany':
          return { waitMs: TOO_MANY_WAIT_MS, state: 'waiting', resync: false };
        case 'checksum':
          checks += 1;
          return checks > CHECKSUM_TRIES ? { stop: true } : { again: true };
        case 'offset':
        case 'incomplete':
          conflicts += 1;
          if (conflicts > OFFSET_CONFLICTS) return counted('retrying', retryAfter);
          return { waitMs: 0, state: 'uploading', resync: true };
        default:
          return { stop: true };
      }
    },

    /** The server took a piece: offset conflicts start again, the other counts stay. */
    progressed() {
      conflicts = 0;
      checks = 0;
    },
  };
}
