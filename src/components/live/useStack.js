'use client';
// The preview stack's state (CONTRACT 26 "Timing", "Keyboard and screen readers"): the entries
// on screen, newest first; each hides itself 6 s after it appears; every entry's time stops while
// the pointer or focus is on the stack or while a modal or list hides it, and resumes with at
// least 2 s; a leaving entry plays its animation, then goes; focus moves to the next card, or back
// to where it came from (never scrolling the page). The source of truth is a ref (the flush plans
// against it synchronously); React state mirrors it for rendering.
import { useCallback, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { CARD_MS, QUEUE_MAX_AGE_MS, RESUME_MIN_MS } from './liveRules';

// A leaving card goes on its own animationend (live-out, --dur-toast-out); this is the safety net
// if that event never comes. With reduced motion the card goes at once (CONTRACT 28, Motion).
const LEAVE_SAFETY_MS = 250;

/**
 * @param {{ now: () => number, bellButton: () => HTMLElement | null,
 *   onIdle: () => void }} options `onIdle`: the stack emptied or stopped pausing (the provider
 *   releases its queue)
 * @returns {{ entries: object[], hidden: boolean, api: object, sectionRef: object,
 *   forget: () => void }}
 */
export function useStack({ now, bellButton, onIdle }) {
  const [entries, setEntries] = useState([]);
  const [hidden, setHidden] = useState(false);
  const list = useRef([]);
  const meta = useRef(new Map()); // key -> { remaining, startedAt, timer, safety, closeOnBlur }
  const elements = useRef(new Map()); // key -> <li>
  const holds = useRef(new Set()); // 'pointer' | 'focus'
  const blockedAt = useRef(null); // when a modal or list hid the stack
  const origin = useRef(null); // where focus was before it entered the stack
  const swapping = useRef(false); // a summary's See them is moving focus to its first card
  const section = useRef(null);
  const read = useRef(new Set());
  const opts = useRef({ now, bellButton, onIdle });
  opts.current = { now, bellButton, onIdle };

  const api = useMemo(() => {
    const commit = (next) => {
      list.current = next;
      setEntries(next);
    };
    const live = () => list.current.filter((entry) => !entry.leaving);
    const paused = () => holds.current.size > 0 || blockedAt.current !== null;
    const stopTimer = (m) => {
      if (!m?.timer) return;
      clearTimeout(m.timer);
      m.timer = null;
      m.remaining = Math.max(0, m.remaining - (opts.current.now() - m.startedAt));
    };
    const startTimer = (key) => {
      const m = meta.current.get(key);
      const entry = list.current.find((e) => e.key === key);
      if (!m || !entry || entry.leaving || paused()) return;
      clearTimeout(m.timer);
      m.startedAt = opts.current.now();
      m.timer = setTimeout(() => leave(key), m.remaining);
    };
    const resumeAll = () => {
      for (const entry of live()) {
        const m = meta.current.get(entry.key);
        if (!m) continue;
        m.remaining = Math.max(m.remaining, RESUME_MIN_MS);
        startTimer(entry.key);
      }
    };
    const hasFocus = (key) => elements.current.get(key)?.contains(document.activeElement) === true;
    const focusFirst = (key) => elements.current.get(key)?.querySelector('a, button')?.focus();

    /**
     * Focus back where it was before the stack, else on the bell, else on main, without scrolling:
     * a card closed with the mouse or a tap on a page scrolled down never jumps it to the bell.
     */
    function restoreFocus() {
      const from = origin.current;
      origin.current = null;
      holds.current.delete('focus');
      const still = { preventScroll: true };
      if (from?.isConnected && !section.current?.contains(from)) from.focus(still);
      else if (opts.current.bellButton()) opts.current.bellButton().focus(still);
      else document.getElementById('main')?.focus(still);
    }

    function moveFocusFrom(key) {
      const others = live().filter((entry) => entry.key !== key);
      const index = list.current.findIndex((entry) => entry.key === key);
      const next = others.find((entry) => list.current.indexOf(entry) > index) ?? others[0] ?? null;
      if (next) focusFirst(next.key);
      else restoreFocus();
    }

    /** Takes an entry out (its timers and element too); true when it was on the stack. */
    function drop(key) {
      const m = meta.current.get(key);
      clearTimeout(m?.timer);
      clearTimeout(m?.safety);
      meta.current.delete(key);
      elements.current.delete(key);
      if (!list.current.some((entry) => entry.key === key)) return false;
      commit(list.current.filter((entry) => entry.key !== key));
      return true;
    }

    /** An entry goes; the last one resets the stack (no pause, no origin) and lets the queue out. */
    function remove(key) {
      if (!drop(key) || list.current.length > 0) return;
      holds.current.clear();
      origin.current = null;
      blockedAt.current = null; // the next cards are planned afresh (a modal makes them wait)
      setHidden(false);
      opts.current.onIdle();
    }

    function leave(key, { focusNext = true } = {}) {
      const entry = list.current.find((e) => e.key === key);
      if (!entry || entry.leaving) return;
      const m = meta.current.get(key);
      clearTimeout(m?.timer);
      const focused = hasFocus(key);
      commit(list.current.map((e) => (e.key === key ? { ...e, leaving: true } : e)));
      if (focused && focusNext) moveFocusFrom(key);
      if (prefersReducedMotion()) remove(key);
      else if (m) m.safety = setTimeout(() => remove(key), LEAVE_SAFETY_MS);
    }

    /** New entries on top (fresh 6 s each); entries past the limit leave. */
    function show(added, removed = []) {
      const keys = new Set(added.map((entry) => entry.key));
      for (const entry of list.current) if (keys.has(entry.key)) drop(entry.key);
      for (const entry of added) meta.current.set(entry.key, { remaining: CARD_MS });
      commit([...added.map((entry) => ({ ...entry, leaving: false })), ...list.current]);
      for (const entry of removed) leave(entry.key, { focusNext: false });
      for (const entry of added) startTimer(entry.key);
    }

    function hold(reason, on, relatedTarget = null) {
      // See them's own focus move (the summary's button goes, then the top card takes focus)
      // neither ends the focus pause nor replaces where focus came from.
      if (reason === 'focus' && swapping.current) return;
      const was = paused();
      if (on && reason === 'focus' && !holds.current.has('focus')) {
        origin.current =
          relatedTarget && !section.current?.contains(relatedTarget) ? relatedTarget : null;
      }
      if (on) holds.current.add(reason);
      else holds.current.delete(reason);
      if (!on && reason === 'focus') {
        for (const entry of live()) if (meta.current.get(entry.key)?.closeOnBlur) leave(entry.key);
      }
      if (paused() && !was) list.current.forEach((entry) => stopTimer(meta.current.get(entry.key)));
      if (!paused() && was) resumeAll();
      if (!on && holds.current.size === 0) opts.current.onIdle();
    }

    /**
     * A summary's "See them" without a bell: its newest items not read meanwhile, as single cards
     * (at most `limit`), take its place in one step. The pause, the focus origin and the queue are
     * kept (the pointer that pressed it is still there); other cards past `limit` leave. With no
     * unread item left the summary just leaves.
     */
    function replace(key, singles, limit = Infinity) {
      const unread = singles
        .filter((entry) => entry.items.every((item) => !read.current.has(item.id)))
        .slice(0, Math.max(1, limit));
      if (unread.length === 0) {
        leave(key);
        return;
      }
      const focused = hasFocus(key);
      swapping.current = focused;
      drop(key);
      const keys = new Set(unread.map((entry) => entry.key));
      const others = live().filter((entry) => !keys.has(entry.key));
      show(unread, others.slice(Math.max(0, limit - unread.length)));
      if (!focused) return;
      requestAnimationFrame(() => {
        swapping.current = false;
        focusFirst(unread[0].key);
        if (!section.current?.contains(document.activeElement)) hold('focus', false);
      });
    }

    return {
      remove,
      leave,
      restoreFocus,
      /** The stack's own element (the section), for focus and Escape. */
      element: () => section.current,
      register(key, element) {
        if (element) elements.current.set(key, element);
      },
      liveEntries: live,
      count: () => list.current.length,
      isPaused: () => holds.current.size > 0,
      ids: () => new Set(list.current.flatMap((entry) => entry.items.map((item) => item.id))),
      show,
      /** Every card goes (not marked read); `now`: at once, without the leave animation. */
      closeAll({ now: immediate = false } = {}) {
        const focused = section.current?.contains(document.activeElement) === true;
        for (const entry of [...list.current]) {
          if (immediate) remove(entry.key);
          else leave(entry.key, { focusNext: false });
        }
        if (focused && !immediate) restoreFocus();
      },
      /** Read here or elsewhere: those cards go (a summary when all its items are read). */
      closeFor(ids) {
        const all = ids === 'all';
        if (!all) for (const id of ids) read.current.add(id);
        for (const entry of live()) {
          const done = all || entry.items.every((item) => read.current.has(item.id));
          if (!done) continue;
          if (hasFocus(entry.key)) meta.current.get(entry.key).closeOnBlur = true;
          else leave(entry.key);
        }
      },
      replace,
      hold,
      /** A modal or list of suggestions opened (`on`) or closed: hide, then show with at least 2 s. */
      setBlocked(on) {
        if (on && blockedAt.current === null) {
          list.current.forEach((entry) => stopTimer(meta.current.get(entry.key)));
          blockedAt.current = opts.current.now();
          setHidden(true);
        } else if (!on && blockedAt.current !== null) {
          const hiddenFor = opts.current.now() - blockedAt.current;
          blockedAt.current = null;
          setHidden(false);
          if (hiddenFor > QUEUE_MAX_AGE_MS)
            for (const entry of [...list.current]) remove(entry.key);
          else if (holds.current.size === 0) resumeAll();
        }
      },
    };
  }, []);

  const forget = useCallback(() => {
    meta.current.forEach((m) => {
      clearTimeout(m.timer);
      clearTimeout(m.safety);
    });
  }, []);

  // `api` is stable (its methods read refs, never during render); `entries` and `hidden` render.
  return { entries, hidden, api, sectionRef: section, forget };
}
