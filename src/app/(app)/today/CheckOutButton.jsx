'use client';
// "Check out" in the Today top bar. Checking out ends the day (there is no second check-in), so it
// always asks first. When today's report isn't submitted the question is "Write your report"
// (primary, goes to /report) or "Check out anyway" (guide 7.3); otherwise it's a plain "Check out
// now?" with Cancel focused. The server still checks out either way and warns when present time
// and logged hours are far apart. With breaks (CONTRACT 15) the toast says how long the person
// worked; checking out also ends a break and stops a running timer, so the sidebar chip reloads.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { announceTimersChanged } from '@/components/TimerChip.clock';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatTimeAmPm, nowDate } from '@/lib/time';
import { checkOutBody } from './timerData';

/**
 * @param {{ reportSubmitted: boolean, dueText: string, tz: string }} props
 *   dueText: the report time as shown in sentences, for example '6:30 PM'
 */
export default function CheckOutButton({ reportSubmitted, dueText, tz }) {
  const router = useRouter();
  const toast = useToast();
  // null, or which question is open: 'confirm' (report submitted) or 'report' (report pending).
  const [asking, setAsking] = useState(null);
  // The time the day would end, taken when the question opens.
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);

  function ask() {
    setEndsAt(formatTimeAmPm(nowDate(), tz));
    setAsking(reportSubmitted ? 'confirm' : 'report');
  }

  function close() {
    if (!busy) setAsking(null);
  }

  async function checkOut() {
    setBusy(true);
    try {
      const { data } = await api.post('/api/attendance/check-out');
      setAsking(null);
      const at = formatTimeAmPm(data.row.checkOutAt, tz);
      // Nothing logged yet: the report reminder says it all. Otherwise warn about a big gap
      // between worked time and logged hours (guide 7.3.3; a warning, never a block).
      toast({ title: `Checked out at ${at}`, body: checkOutBody(data) });
      announceTimersChanged('checkout');
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't check you out", body: error.message, tone: 'error' });
      if (error.code === 'ALREADY_CHECKED_OUT' || error.code === 'NOT_CHECKED_IN') {
        setAsking(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={ask}>
        Check out
      </Button>
      <Dialog
        open={asking === 'confirm'}
        onClose={close}
        title="Check out now?"
        description={`This ends your day at ${endsAt}. You can't check in again today.`}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy} data-autofocus>
              Cancel
            </Button>
            <Button onClick={checkOut} loading={busy}>
              Check out
            </Button>
          </>
        }
      />
      <Dialog
        open={asking === 'report'}
        onClose={close}
        title="Your report isn't in yet"
        description={`Today's report is due at ${dueText}. Write it now, or check out and write it later today.`}
        footer={
          <>
            <Button variant="secondary" onClick={checkOut} loading={busy}>
              Check out anyway
            </Button>
            <Button href="/report" data-autofocus>
              Write your report
            </Button>
          </>
        }
      />
    </>
  );
}
