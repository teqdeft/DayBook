'use client';
// "Start break" / "End break" next to Check out on Today (CONTRACT 15). A break pauses the
// running timer; ending it starts that timer again. Worked time is present time minus breaks.
// The button is busy (so disabled) while the request runs, which drops a keyboard user's focus:
// it comes back to the same button, now with the other label, once the page has refreshed.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import { announceTimersChanged } from '@/components/TimerChip.clock';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { breakEndedToast } from './timerData';

// Errors that mean the page is out of date (another tab, a check-out): refresh it.
const STALE = new Set([
  'ALREADY_ON_BREAK',
  'NOT_ON_BREAK',
  'NOT_CHECKED_IN',
  'ALREADY_CHECKED_OUT',
  'CONFLICT',
]);

/** @param {{ onBreak: boolean }} props */
export default function BreakButton({ onBreak }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const buttonRef = useRef(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (busy || refreshing || !refocus.current) return;
    refocus.current = false;
    const focused = document.activeElement;
    // Only when the focus was dropped, not when the person has moved on meanwhile.
    if (!focused || focused === document.body) buttonRef.current?.focus();
  }, [busy, refreshing, onBreak]);

  async function toggle() {
    // Until the refresh brings the new label, another click would hit the old action.
    if (busy || refreshing) return;
    refocus.current = document.activeElement === buttonRef.current;
    setBusy(true);
    try {
      if (onBreak) {
        const { data } = await api.post('/api/attendance/break/end');
        toast(breakEndedToast(data));
      } else {
        const { data } = await api.post('/api/attendance/break/start');
        toast({
          title: 'Break started',
          body: data?.pausedEntryId ? 'Your timer is paused until you end your break.' : undefined,
        });
      }
      announceTimersChanged('break');
      startRefresh(() => router.refresh());
    } catch (error) {
      toast({
        title: onBreak ? "Couldn't end your break" : "Couldn't start your break",
        body: error.message,
        tone: 'error',
      });
      if (STALE.has(error.code)) startRefresh(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  // One <button> for both labels (same element type and place), so the focus can come back.
  return onBreak ? (
    <Button
      ref={buttonRef}
      onClick={toggle}
      loading={busy}
      aria-busy={busy || refreshing || undefined}
    >
      End break
    </Button>
  ) : (
    <Button
      ref={buttonRef}
      variant="secondary"
      onClick={toggle}
      loading={busy}
      aria-busy={busy || refreshing || undefined}
    >
      Start break
    </Button>
  );
}
