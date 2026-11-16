'use client';
// Today's "Working on" card (CONTRACT 15): the running timer (project, task or note, a ticking
// 1:24:10, Stop and Switch project), the start form when nothing runs, "Timer paused for your
// break" on a break, then today's entries with Add time and "Tracked today 5h 45m". After every
// change it dispatches 'daybook:timers-changed' and refreshes the page. CONTRACT 24: the start
// form offers the picked project's to-do lines as the note; picking one starts the timer through
// the line (POST /api/me/todo/lines/:id/timer), so the line's report task gets the timer.
import { useCallback, useEffect, useRef, useState } from 'react';
import Card, { CardHeader } from '@/components/Card';
import {
  elapsedSeconds,
  isNewerState,
  liveTotalMinutes,
  noteServerTime,
  useServerNow,
} from '@/components/TimerChip.clock';
import { api } from '@/lib/apiClient';
import { dayjs, now, toLocal } from '@/lib/time';
import { addTimeDefaults, pausedEntry, shortDuration, timerAnnouncement } from './timerData';
import TimerEntries from './TimerEntries';
import { Paused, Running } from './TimerNow';
import TimerStartForm from './TimerStartForm';
import { useTodo } from './TodoProvider';
import { useTimerActions } from './useTimerActions';
import styles from './TimerCard.module.css';

const BLOCKED_TEXT = {
  checked_out: "You've checked out. You can still fix today's times below.",
  not_checked_in: 'Check in to start a timer.',
  off: 'Timers are turned off for your company.',
  not_allowed: 'Timers are for people who check in and write reports.',
};

function viewOf(state) {
  if (state.running) return 'running';
  if (state.onBreak) return 'break';
  return state.blocked === null ? 'idle' : 'blocked';
}

/**
 * @param {{ initialState: object, picker: object, tasks: Record<string, object[]>, tz: string,
 *   checkInClock: string, breaks?: Array<{ startClock: string, endClock: string | null }>,
 *   className?: string }}
 *   props initialState: timers.getState; tasks: open priority tasks by project id;
 *   checkInClock: 'HH:mm' (where Add time starts when nothing is tracked yet); breaks: today's
 *   breaks as clocks (Add time's defaults stay clear of them)
 */
export default function TimerCard({
  initialState,
  picker,
  tasks,
  tz,
  checkInClock,
  breaks = [],
  className = '',
}) {
  const [state, setState] = useState(initialState);
  const [lastProp, setLastProp] = useState(initialState);
  const [switching, setSwitching] = useState(false);
  const stopRef = useRef(null);
  const switchRef = useRef(null);
  const projectRef = useRef(null);
  const focusNext = useRef(null);
  const { run, busy, working } = useTimerActions(setState);
  const todo = useTodo();

  // A page refresh brings a new state; an older one never replaces an action's answer.
  if (initialState !== lastProp) {
    setLastProp(initialState);
    if (isNewerState(initialState, state)) setState(initialState);
  }

  useEffect(() => {
    noteServerTime(initialState.serverNow, null, now().valueOf());
  }, [initialState.serverNow]);

  const view = viewOf(state);
  const ticking = Boolean(state.running) || state.onBreak;
  const serverMs = useServerNow(ticking) ?? dayjs(state.serverNow).valueOf();

  // After Start, focus goes to Stop; after Stop (or Cancel), back to where the person was.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const element = { stop: stopRef, switch: switchRef, project: projectRef }[target]?.current;
    element?.focus();
  });

  const start = useCallback(
    async (input) => {
      const data = await run('start', () => api.post('/api/timers/start', input), {
        failTitle: "Couldn't start the timer",
        withFields: true,
      });
      if (data?.running) {
        focusNext.current = 'stop';
        setSwitching(false);
      }
      return data;
    },
    [run],
  );

  // A to-do line picked as the note: the line's timer route answers the to-do and the timer. The
  // to-do takes the answer like one of its own writes (never over a newer one).
  const startLine = useCallback(
    async (lineId) => {
      const data = await run(
        'start',
        async () => {
          const send = () => api.post(`/api/me/todo/lines/${lineId}/timer`);
          const { data: answer } = await (todo ? todo.track(send) : send());
          return { data: answer?.timerState ?? null };
        },
        { failTitle: "Couldn't start the timer" },
      );
      if (data?.running) {
        focusNext.current = 'stop';
        setSwitching(false);
      }
      return data;
    },
    [run, todo],
  );

  async function stop() {
    const data = await run('stop', () => api.post('/api/timers/stop'), {
      failTitle: "Couldn't stop the timer",
    });
    if (data && !data.running) focusNext.current = 'project';
  }

  const save = (entry, body) =>
    run(
      'entry',
      () =>
        entry
          ? api.patch(`/api/timers/entries/${entry.id}`, body)
          : api.post('/api/timers/entries', body),
      {
        failTitle: entry ? "Couldn't save the time" : "Couldn't add the time",
        withFields: true,
        done: () => ({ title: entry ? 'Time updated' : 'Time added' }),
      },
    );

  const remove = (entry) =>
    run('delete', () => api.delete(`/api/timers/entries/${entry.id}`), {
      failTitle: "Couldn't delete the time",
      done: () => ({ title: 'Time deleted' }),
    });

  // The card's state may be newer than the page's breaks: its open break counts too.
  const addDefaults = () =>
    addTimeDefaults({
      entries: state.entries,
      breaks:
        state.onBreak && state.breakStartedAt
          ? [...breaks, { startClock: toLocal(state.breakStartedAt, tz).format('HH:mm') }]
          : breaks,
      checkInClock,
      nowClock: toLocal(serverMs, tz).format('HH:mm'),
    });

  const showForm = view === 'idle' || (view === 'running' && switching);
  return (
    <Card as="section" aria-label="Working on" className={`${styles.card} ${className}`}>
      <CardHeader
        title="Working on"
        actions={
          <span className={styles.total}>
            Tracked today{' '}
            <span className={styles.totalValue}>
              {shortDuration(liveTotalMinutes(state, serverMs))}
            </span>
          </span>
        }
      />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {timerAnnouncement(state)}
      </p>
      <div className={styles.now}>
        {view === 'running' && !switching ? (
          <Running
            entry={state.running}
            serverMs={serverMs}
            canSwitch={state.blocked === null}
            busy={busy}
            stopping={working === 'stop'}
            onSwitch={() => setSwitching(true)}
            onStop={stop}
            stopRef={stopRef}
            switchRef={switchRef}
          />
        ) : null}
        {showForm ? (
          <TimerStartForm
            picker={picker}
            tasks={tasks}
            busy={busy}
            starting={working === 'start'}
            switching={switching}
            onStart={start}
            todoGroups={todo?.todo.groups}
            onStartLine={startLine}
            onCancel={() => {
              focusNext.current = 'switch';
              setSwitching(false);
            }}
            projectRef={projectRef}
          />
        ) : null}
        {view === 'break' ? (
          <Paused
            entry={pausedEntry(state)}
            seconds={elapsedSeconds(state.breakStartedAt, serverMs)}
          />
        ) : null}
        {view === 'blocked' ? (
          <p className={styles.message}>{BLOCKED_TEXT[state.blocked] ?? BLOCKED_TEXT.off}</p>
        ) : null}
      </div>
      <TimerEntries
        entries={state.entries}
        serverMs={serverMs}
        busy={busy}
        deleting={working === 'delete'}
        picker={picker}
        tasks={tasks}
        addDefaults={addDefaults}
        onSave={save}
        onDelete={remove}
      />
    </Card>
  );
}
