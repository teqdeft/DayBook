'use client';
// The sidebar's timer chip (CONTRACT 15): above the signed-in person on every page, only while a
// timer runs ("● acme-app 1:24:10 ■") or the person is on a break ("On break 12:03"). The name
// links to Today and ■ stops the timer. It loads GET /api/timers/current on mount (while a timer
// runs or a break is on: the clock and the away question), every 60 s while the page is visible,
// when the page becomes visible again and on 'daybook:timers-changed'. When the state has away
// time and the page is visible it asks about it, once per span (only the chip asks, so the
// question never shows twice); see createAwayAsks for when a span is asked again.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Square } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { dayjs, now } from '@/lib/time';
import { useAppShell } from './AppShell';
import TimerAwayDialog from './TimerAwayDialog';
import {
  TIMERS_CHANGED,
  announceTimersChanged,
  awayKey,
  createAwayAsks,
  elapsedSeconds,
  formatElapsed,
  isNewerState,
  noteServerTime,
  useServerNow,
} from './TimerChip.clock';
import { useToast } from './ToastProvider';
import { focusableIn } from './useModal';
import styles from './TimerChip.module.css';

const POLL_MS = 60 * 1000;
const isVisible = () => document.visibilityState === 'visible';

/** The first control after `element` in tab order (outside it), else the main area. */
function focusableAfter(element) {
  if (!element) return null;
  const next = focusableIn(document.body).find(
    (item) =>
      !element.contains(item) &&
      Boolean(element.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  return next ?? document.getElementById('main');
}

/**
 * @param {{ initialState: object }} props timers.getState for the signed-in person
 */
export default function TimerChip({ initialState }) {
  const router = useRouter();
  const toast = useToast();
  const shell = useAppShell();
  const [state, setState] = useState(initialState);
  const [lastProp, setLastProp] = useState(initialState);
  const [asking, setAsking] = useState(null);
  // The answer being sent: { key (the span's), decision }.
  const [answering, setAnswering] = useState(null);
  const [stopping, setStopping] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // Nothing to show or ask while no timer runs: the first load waits for the poll then.
  const [loadOnMount] = useState(() => Boolean(initialState?.running || initialState?.onBreak));
  // Away spans asked about on this page.
  const [asks] = useState(createAwayAsks);
  const chipRef = useRef(null);
  const stopRef = useRef(null);

  // A page refresh brings a new state from the layout; an older one never wins.
  if (initialState !== lastProp) {
    setLastProp(initialState);
    if (isNewerState(initialState, state)) setState(initialState);
  }

  /** Takes a state from the API and asks about away time it hasn't asked about yet. */
  const take = useCallback(
    (data, sentAt) => {
      if (!data) return;
      noteServerTime(data.serverNow, sentAt, now().valueOf());
      setState((current) => (isNewerState(data, current) ? data : current));
      if (isVisible() && asks.shouldAsk(data.away)) setAsking(data.away);
    },
    [asks],
  );

  const load = useCallback(async () => {
    try {
      const sentAt = now().valueOf();
      const { data } = await api.get('/api/timers/current');
      take(data, sentAt);
    } catch {
      // Keep showing the last state; the next poll tries again.
    }
  }, [take]);

  useEffect(() => {
    const first = loadOnMount ? setTimeout(load, 0) : null;
    const poll = setInterval(() => {
      if (isVisible()) load();
    }, POLL_MS);
    const onVisibility = () => {
      if (!isVisible()) return;
      // Back on the page: a question put away unanswered is asked again.
      asks.wake();
      load();
    };
    const onChanged = (event) => {
      if (event.detail?.source !== 'chip') load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(TIMERS_CHANGED, onChanged);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(TIMERS_CHANGED, onChanged);
    };
  }, [load, loadOnMount, asks]);

  /**
   * Runs one change, then tells Today's card and refreshes the page.
   * @returns {Promise<object | null>} the new state, or null after an error (toasted)
   */
  async function change(request, { failTitle, done }) {
    try {
      const sentAt = now().valueOf();
      const { data } = await request();
      take(data, sentAt);
      if (done) toast(done);
      announceTimersChanged('chip');
      startRefresh(() => router.refresh());
      return data ?? null;
    } catch (error) {
      toast({ title: failTitle, body: error.message, tone: 'error' });
      return null;
    }
  }

  async function stop() {
    // aria-disabled, not disabled, while it works: disabling the focused button drops the focus.
    if (stopping || refreshing) return;
    const button = stopRef.current;
    // The chip goes away once nothing runs: focus moves on to what follows it (the account
    // menu) instead of dropping to the page.
    const next =
      button && document.activeElement === button ? focusableAfter(chipRef.current) : null;
    setStopping(true);
    const data = await change(() => api.post('/api/timers/stop'), {
      failTitle: "Couldn't stop the timer",
      done: { title: 'Timer stopped' },
    });
    setStopping(false);
    if (!data) {
      load();
      return;
    }
    const focused = document.activeElement;
    if (next?.isConnected && !data.running && !data.onBreak) {
      if (!focused || focused === document.body || focused === button) next.focus();
    }
  }

  async function answer(decision) {
    const away = asking;
    if (!away || answering) return;
    const key = awayKey(away);
    setAnswering({ key, decision });
    const body = { entryId: away.entryId, from: away.from, to: away.to, decision };
    const data = await change(() => api.post('/api/timers/away', body), {
      failTitle: "Couldn't save your answer",
      done:
        decision === 'remove'
          ? {
              title: 'Away time removed',
              body: `${away.minutes} min came off your ${away.projectName} timer.`,
            }
          : { title: 'Away time kept' },
    });
    setAnswering(null);
    // The answer's state may already ask about the next span (take opened it): close only this.
    setAsking((current) => (awayKey(current) === key ? null : current));
    if (!data) {
      // Not saved: ask again if the state still has it.
      asks.retry(away);
      load();
    }
  }

  function dismiss() {
    asks.dismiss(asking);
    setAsking(null);
  }

  const running = state?.running ?? null;
  const onBreak = !running && Boolean(state?.onBreak);
  const active = Boolean(running) || onBreak;
  const serverMs = useServerNow(active) ?? dayjs(state?.serverNow).valueOf();
  // One dialog per span, so the next span opens fresh (Keep focused, not busy with the answer
  // that brought it) right after an answer.
  const askingKey = awayKey(asking);
  const dialog = (
    <TimerAwayDialog
      key={askingKey ?? 'none'}
      away={asking}
      busy={answering?.key === askingKey ? answering.decision : null}
      onAnswer={answer}
      onClose={dismiss}
    />
  );
  if (!active) return dialog;

  const since = onBreak ? state.breakStartedAt : running.startedAt;
  const busy = stopping || refreshing;
  return (
    <>
      <div
        ref={chipRef}
        className={`${styles.chip} ${onBreak ? styles.onBreak : ''}`}
        role="group"
        aria-label={onBreak ? 'Your break' : 'Your timer'}
      >
        <span className={styles.dot} aria-hidden="true" />
        <Link
          href="/today"
          className={styles.name}
          title={onBreak ? undefined : running.projectName}
          onClick={() => shell?.closeSidebar()}
        >
          <span className={styles.nameText}>{onBreak ? 'On break' : running.projectName}</span>
        </Link>
        <span className={styles.time} role="timer">
          {formatElapsed(elapsedSeconds(since, serverMs))}
        </span>
        {onBreak ? null : (
          <button
            ref={stopRef}
            type="button"
            className={styles.stop}
            aria-label={`Stop the ${running.projectName} timer`}
            title="Stop"
            onClick={stop}
            aria-disabled={busy || undefined}
          >
            <Square size={12} strokeWidth={1.8} fill="currentColor" aria-hidden="true" />
          </button>
        )}
      </div>
      {dialog}
    </>
  );
}
