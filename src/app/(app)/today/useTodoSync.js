'use client';
// Today's to-do as the page holds it (CONTRACT 24): the server's to-do (reports.getTodo, first from
// the page, then from each answer and each page refresh) with the changes it may not hold yet put
// on top again (todoSync.js), and the one way every change reaches the server: shown at once, its
// answer taken unless an answer to a later request is already in, an error toasting the API's
// message and taking only that change back. A page refresh (AutoRefresh's router.refresh) is taken
// while no write is on its way. While a Slack post is sending, GET /api/me/todo every 5 s, for up
// to a minute.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import {
  answered,
  applied,
  failed,
  inFlight,
  refreshed,
  shownOf,
  started,
  syncOf,
  writingCount,
} from './todoSync';

export const POLL_MS = 5000;
export const POLL_TIMES = 12;

// Codes after which the page's picture of the day is out of date.
const STALE = new Set([
  'CONFLICT',
  'REPORT_LOCKED',
  'NOT_FOUND',
  'PROJECT_NOT_ACTIVE',
  'TIMERS_OFF',
  'NOT_CHECKED_IN',
  'ALREADY_CHECKED_OUT',
  'ALREADY_ON_BREAK',
]);

/** The to-do in an answer: the routes answer the to-do itself, or { todo } beside other fields. */
export function todoOf(data) {
  if (data?.groups) return data;
  return data?.todo?.groups ? data.todo : null;
}

let counter = 0;
/** A number for each write and read of the card. */
function nextId() {
  counter += 1;
  return counter;
}

/** GET /api/me/todo every 5 s while a post is sending, up to 12 times. */
function usePostPoll(sending, read) {
  useEffect(() => {
    if (!sending) return undefined;
    let left = POLL_TIMES;
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) clearInterval(timer);
      read();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sending, read]);
}

/**
 * The write every change goes through. `show` changes the to-do at once; it stays on top of any
 * to-do that may not hold it yet, and goes if the write fails.
 */
function useWrite(setSync) {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    async ({ request, show = null, failTitle, done }) => {
      const id = nextId();
      setSync((current) => started(current, { id, show }));
      try {
        const { data } = await request();
        setSync((current) => answered(current, { id, todo: todoOf(data) }));
        done?.(data ?? {});
        router.refresh();
        return data ?? {};
      } catch (error) {
        setSync((current) => failed(current, id));
        toast({ title: failTitle, body: error?.message, tone: 'error' });
        if (STALE.has(error?.code)) router.refresh();
        return null;
      }
    },
    [router, setSync, toast],
  );
}

/**
 * @param {object} initialTodo reports.getTodo, from the page (a new one on every refresh)
 * @returns {{ todo: object, writing: number, write: Function, track: Function, apply: Function }}
 *   todo: as it stands (rows waiting on Undo still in it); track(request): a request made
 *   elsewhere whose answer holds the to-do (the timer form's Play), taken like a write's
 */
export function useTodoSync(initialTodo) {
  const [sync, setSync] = useState(() => syncOf(initialTodo));
  const [lastProp, setLastProp] = useState(initialTodo);

  // A refresh brings the server's to-do; a write on its way wins (its answer comes after).
  if (initialTodo !== lastProp) {
    setLastProp(initialTodo);
    setSync((current) => refreshed(current, { todo: initialTodo, take: !inFlight(current) }));
  }

  const write = useWrite(setSync);

  const track = useCallback(async (request) => {
    const id = nextId();
    setSync((current) => started(current, { id }));
    try {
      const result = await request();
      setSync((current) => answered(current, { id, todo: todoOf(result?.data) }));
      return result;
    } catch (error) {
      setSync((current) => failed(current, id));
      throw error;
    }
  }, []);

  const read = useCallback(async () => {
    const id = nextId();
    setSync((current) => started(current, { id, read: true }));
    try {
      const { data } = await api.get('/api/me/todo');
      setSync((current) => answered(current, { id, todo: todoOf(data) }));
    } catch {
      // The next poll (or the page's refresh) tries again.
      setSync((current) => failed(current, id));
    }
  }, []);

  const apply = useCallback((data) => {
    const next = todoOf(data);
    if (next) setSync((current) => applied(current, next));
  }, []);

  const todo = useMemo(() => shownOf(sync), [sync]);
  usePostPoll(todo.post?.state === 'sending', read);
  return { todo, writing: writingCount(sync), write, track, apply };
}
