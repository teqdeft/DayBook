'use client';
// Runs one timer request for Today's Working on card (CONTRACT 15): the answer (the new timer
// state) replaces the card's state, the server clock is noted, the sidebar chip hears
// 'daybook:timers-changed' and the page refreshes. Errors that mean the page is out of date
// (another tab, check-out, timers turned off) toast and refresh; field errors go back to the form.
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { announceTimersChanged, noteServerTime } from '@/components/TimerChip.clock';
import { now } from '@/lib/time';

// Codes after which the card's picture of the day is stale.
const STALE = new Set([
  'CONFLICT',
  'TIMERS_OFF',
  'NOT_CHECKED_IN',
  'ALREADY_CHECKED_OUT',
  'ALREADY_ON_BREAK',
  'NOT_ON_BREAK',
  'NOT_FOUND',
  'BAD_REQUEST',
  'PROJECT_NOT_ACTIVE',
]);

/**
 * @param {(state: object) => void} onState receives every new timer state
 * @returns {{ run: (name: string, request: () => Promise<{ data: object }>, options?: {
 *   failTitle?: string, done?: (state: object) => { title: string, body?: string } | null,
 *   withFields?: boolean }) => Promise<object | null>, busy: boolean, working: string | null }}
 *   busy while a request is out; working: its name
 *   run resolves to the new state, or null after an error it handled; with `withFields` an error
 *   that names fields is thrown back for the form to show under them
 */
export function useTimerActions(onState) {
  const router = useRouter();
  const toast = useToast();
  const [working, setWorking] = useState(null);

  // The answer is already on screen, so buttons don't wait for the refresh (a disabled button
  // couldn't take the focus the card moves to it).
  const refresh = useCallback(() => {
    announceTimersChanged('card');
    router.refresh();
  }, [router]);

  const run = useCallback(
    async (name, request, { failTitle = "Couldn't change your timer", done, withFields } = {}) => {
      setWorking(name);
      try {
        const sentAt = now().valueOf();
        const { data } = await request();
        noteServerTime(data?.serverNow, sentAt, now().valueOf());
        if (data) onState(data);
        const message = done?.(data);
        if (message) toast(message);
        refresh();
        return data;
      } catch (error) {
        const fields = Object.keys(error?.fields ?? {});
        if (withFields && fields.length > 0) throw error;
        toast({ title: failTitle, body: error?.message, tone: 'error' });
        if (STALE.has(error?.code)) refresh();
        return null;
      } finally {
        setWorking(null);
      }
    },
    [onState, refresh, toast],
  );

  return { run, busy: working !== null, working };
}
