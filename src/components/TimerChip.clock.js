// Timer clock helpers shared by the sidebar TimerChip and Today's Working on card (CONTRACT 15):
// the formats, the server's clock as this browser sees it (clock skew), one shared one-second tick
// so every timer on the page shows the same second, and the 'daybook:timers-changed' event.
// Client-safe: imports only @/lib/time and React.
import { useSyncExternalStore } from 'react';
import { dayjs, formatClock, formatClockShort, now } from '@/lib/time';

/** Fired on `window` after any timer or break change, so the chip and the card reload. */
export const TIMERS_CHANGED = 'daybook:timers-changed';

/**
 * Tells the rest of the page (the sidebar chip, Today's card) that timers or breaks changed.
 * @param {string} [source] who changed them, so a listener can skip its own changes
 */
export function announceTimersChanged(source) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TIMERS_CHANGED, { detail: { source: source ?? null } }));
}

const pad = (value) => String(value).padStart(2, '0');

/**
 * A running time: '1:24:10' from an hour, '12:03' (minutes and seconds) below it.
 * @param {number} seconds
 * @returns {string}
 */
export function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * How far the server's clock is ahead of this browser's, from a state's `serverNow` and when the
 * request went out and came back (browser ms). The server read its clock somewhere in between,
 * so the midpoint is the best guess and half the round trip is the error. Without `sentAt` (a
 * state rendered on the server) the error is unknown: Infinity.
 * @param {string} serverNow ISO
 * @param {number | null} sentAt browser ms
 * @param {number} receivedAt browser ms
 * @returns {{ skewMs: number, errorMs: number }}
 */
export function estimateSkew(serverNow, sentAt, receivedAt) {
  const server = dayjs(serverNow).valueOf();
  if (sentAt === null || sentAt === undefined) {
    return { skewMs: Math.round(server - receivedAt), errorMs: Infinity };
  }
  const start = Math.min(sentAt, receivedAt);
  return {
    skewMs: Math.round(server - (start + receivedAt) / 2),
    errorMs: (receivedAt - start) / 2,
  };
}

// A newer estimate wins unless it is clearly worse (the browser clock may be adjusted meanwhile).
const SKEW_TOLERANCE_MS = 100;

/**
 * The estimate to keep: the one with the smaller error, the newer one when they are about as good.
 * @param {{ skewMs: number, errorMs: number } | null} current
 * @param {{ skewMs: number, errorMs: number } | null} next
 */
export function betterSkew(current, next) {
  if (!next || !Number.isFinite(next.skewMs)) return current;
  if (!current) return next;
  return next.errorMs <= current.errorMs + SKEW_TOLERANCE_MS ? next : current;
}

/**
 * Whole seconds from `startedAt` to a moment on the server's clock, never negative.
 * @param {string} startedAt ISO
 * @param {number} serverMs
 */
export function elapsedSeconds(startedAt, serverMs) {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((serverMs - dayjs(startedAt).valueOf()) / 1000));
}

/**
 * Minutes of one entry at a moment on the server's clock: a running entry counts up, a finished
 * one keeps the server's count.
 * @param {{ minutes: number, startedAt: string, endedAt: string | null }} entry
 * @param {number | null} serverMs
 */
export function liveEntryMinutes(entry, serverMs) {
  if (entry.endedAt || serverMs === null || serverMs === undefined) {
    return Number(entry.minutes) || 0;
  }
  return Math.floor(elapsedSeconds(entry.startedAt, serverMs) / 60);
}

/**
 * Today's tracked minutes at a moment on the server's clock: the state's total (counted at its
 * serverNow) with the running entry counted up to `serverMs` instead.
 * @param {{ totalMinutes: number, running: object | null } | null} state
 * @param {number | null} serverMs
 */
export function liveTotalMinutes(state, serverMs) {
  const total = Number(state?.totalMinutes) || 0;
  const running = state?.running;
  if (!running || serverMs === null || serverMs === undefined) return total;
  const counted = Number(running.minutes) || 0;
  return Math.max(0, total - counted + liveEntryMinutes(running, serverMs));
}

/**
 * True when `next` is a newer timer state than `current` (its server read it later), so a page
 * refresh that started before an action never overwrites the action's answer.
 */
export function isNewerState(next, current) {
  if (!next) return false;
  if (!current) return true;
  return dayjs(next.serverNow).valueOf() >= dayjs(current.serverNow).valueOf();
}

/** '1:10–1:42 PM' when both are in the same half of the day, else '11:50 AM–12:20 PM'. */
export function clockRange(fromClock, toClock) {
  const from = formatClock(fromClock);
  const to = formatClock(toClock);
  if (from.slice(-2) === to.slice(-2)) return `${formatClockShort(fromClock)}–${to}`;
  return `${from}–${to}`;
}

/**
 * The away question (CONTRACT 15): "You were away 32 min (1:10–1:42 PM) while your acme-app
 * timer ran. Keep this time or remove it?"
 * @param {{ minutes: number, fromClock: string, toClock: string, projectName: string }} away
 */
export function awayQuestion(away) {
  const range = clockRange(away.fromClock, away.toClock);
  return `You were away ${away.minutes} min (${range}) while your ${away.projectName} timer ran. Keep this time or remove it?`;
}

/** One key per away span, so each span is asked about once. */
export function awayKey(away) {
  return away ? `${away.entryId}|${away.from}|${away.to}` : null;
}

/**
 * Which away spans the chip asks about on one page: each span once, so the question never shows
 * twice. The server only ever offers the earliest unanswered span, so a span left unanswered
 * would hide every later one: a question put away (Escape, ×) is asked again when the page is
 * shown again (`wake`), and one whose answer didn't go through on the next load (`retry`).
 * @returns {{ shouldAsk: (away: object | null) => boolean, dismiss: (away: object | null) => void,
 *   retry: (away: object | null) => void, wake: () => void }} shouldAsk: true when the chip
 *   should ask now (the span then counts as asked)
 */
export function createAwayAsks() {
  const asked = new Set();
  const dismissed = new Set();
  return {
    shouldAsk(away) {
      const key = awayKey(away);
      if (!key || asked.has(key)) return false;
      asked.add(key);
      dismissed.delete(key);
      return true;
    },
    dismiss(away) {
      const key = awayKey(away);
      if (key && asked.has(key)) dismissed.add(key);
    },
    retry(away) {
      const key = awayKey(away);
      if (key) asked.delete(key);
    },
    wake() {
      dismissed.forEach((key) => asked.delete(key));
      dismissed.clear();
    },
  };
}

// ---------- the shared tick ----------

const listeners = new Set();
let skew = null;
let snapshot = null;
let timeout = null;
let interval = null;

const serverNowMs = () => now().valueOf() + (skew?.skewMs ?? 0);

function tick() {
  snapshot = serverNowMs();
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = serverNowMs();
    // Ticks land on the server clock's whole seconds, so the digits change together.
    timeout = setTimeout(
      () => {
        tick();
        interval = setInterval(tick, 1000);
      },
      1000 - (snapshot % 1000),
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(timeout);
    clearInterval(interval);
    timeout = null;
    interval = null;
    snapshot = null;
  };
}

const getSnapshot = () => snapshot;
const getNothing = () => null;
const subscribeNowhere = () => () => {};

/**
 * Records what a timer state says about the server's clock. Call it with `sentAt` (browser ms,
 * `now().valueOf()` before the request) for an API answer; without it for a state rendered on the
 * server. The best estimate is kept for the whole page.
 * @param {string | null | undefined} serverNow ISO
 * @param {number | null} sentAt
 * @param {number} receivedAt browser ms
 */
export function noteServerTime(serverNow, sentAt, receivedAt) {
  if (!serverNow) return;
  const next = betterSkew(skew, estimateSkew(serverNow, sentAt, receivedAt));
  if (next === skew) return;
  skew = next;
  if (listeners.size > 0) tick();
}

/**
 * The server's clock now (ms), updated every second while `active`; null while not active, on
 * the server and during hydration (then fall back to the state's serverNow).
 * @param {boolean} active
 * @returns {number | null}
 */
export function useServerNow(active) {
  return useSyncExternalStore(
    active ? subscribe : subscribeNowhere,
    active ? getSnapshot : getNothing,
    getNothing,
  );
}
