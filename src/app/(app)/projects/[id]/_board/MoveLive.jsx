'use client';
// The one live region for every card move and the help text the grips point at (CONTRACT 28,
// Motion, Keyboard move and the live region). The Board renders <MoveLive /> from its first
// render, so screen readers know the region before anything happens. `say(text)` waits 100 ms
// (the last sentence wins), clears the region and writes the new sentence on the next frame, so
// the same sentence twice is read twice. It writes the region's text itself: nothing re-renders
// for an announcement. Polite, never assertive.
import { createContext, useContext, useEffect, useMemo } from 'react';
import { LIMITS } from '@/lib/motion/tokens';
import { MOVE_HELP } from './moveWords';

export const LIVE_ID = 'move-live';
export const HELP_ID = 'move-help';

/**
 * @param {{ doc?: Document, later?: Function, cancelLater?: Function, frame?: Function,
 *   cancelFrame?: Function }} [env] injected for tests
 * @returns {{ say: (text: string) => void, stop: () => void }}
 */
export function createAnnouncer(env = {}) {
  const doc = env.doc ?? globalThis.document;
  const later = env.later ?? ((cb, ms) => setTimeout(cb, ms));
  const cancelLater = env.cancelLater ?? ((id) => clearTimeout(id));
  const frame = env.frame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = env.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  let timer = null;
  let raf = null;
  const stop = () => {
    if (timer !== null) cancelLater(timer);
    if (raf !== null) cancelFrame(raf);
    timer = null;
    raf = null;
  };
  const say = (text) => {
    if (!text || !doc) return;
    stop();
    timer = later(() => {
      timer = null;
      const region = doc.getElementById(LIVE_ID);
      if (!region) return;
      region.textContent = '';
      raf = frame(() => {
        raf = null;
        region.textContent = text;
      });
    }, LIMITS.announceDebounce);
  };
  return { say, stop };
}

const SILENT = Object.freeze({ say() {} });
const AnnouncerContext = createContext(null);
let shared = null;
const sharedAnnouncer = () => {
  if (typeof document === 'undefined') return SILENT;
  shared ??= createAnnouncer();
  return shared;
};

/** Gives the board's parts `useAnnouncer()`. */
export function MoveLiveProvider({ children }) {
  const announcer = useMemo(
    () => (typeof document === 'undefined' ? SILENT : createAnnouncer()),
    [],
  );
  useEffect(() => () => announcer.stop?.(), [announcer]);
  const value = useMemo(() => ({ say: announcer.say }), [announcer]);
  return <AnnouncerContext.Provider value={value}>{children}</AnnouncerContext.Provider>;
}

const FALLBACK = Object.freeze({ say: (text) => sharedAnnouncer().say(text) });

/** @returns {{ say: (text: string) => void }} the provider's, else one shared by the page */
export function useAnnouncer() {
  return useContext(AnnouncerContext) ?? FALLBACK;
}

/** `#move-live` (polite status) and `#move-help`. */
export default function MoveLive() {
  return (
    <>
      <p id={LIVE_ID} role="status" aria-live="polite" className="visually-hidden" />
      <p id={HELP_ID} className="visually-hidden">
        {MOVE_HELP}
      </p>
    </>
  );
}
