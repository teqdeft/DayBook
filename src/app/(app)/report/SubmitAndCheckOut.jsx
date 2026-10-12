'use client';
// "Submit and check out" beside Submit report (a company request), on today's draft while the
// person is still checked in. One question (Cancel focused), then the usual submit; only when
// that went through, the same check-out as Today's button, and the person lands on Today (also
// when the check-out fails: Today's Check out is the retry). While both run, the question says
// which step it is on and keeps the focus. A submit that is refused (a wrong field, required
// timers) closes the question and shows its errors like Submit report does, and nobody is
// checked out.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { announceTimersChanged } from '@/components/TimerChip.clock';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatTimeAmPm, nowDate } from '@/lib/time';
import { useReport } from './ReportProvider';
import {
  checkOutFailedToast,
  submitAndCheckOutQuestion,
  submittedAndCheckedOutToast,
} from './reportCheckOut';
import styles from './SubmitAndCheckOut.module.css';

export default function SubmitAndCheckOut() {
  const router = useRouter();
  const toast = useToast();
  const { data, report, submit, submitting } = useReport();
  const [open, setOpen] = useState(false);
  // The time the day would end, taken when the question opens.
  const [endsAt, setEndsAt] = useState('');
  // null, or the step running: 'submit' then 'checkOut'.
  const [step, setStep] = useState(null);
  const busy = step !== null;
  const statusRef = useRef(null);
  const question = submitAndCheckOutQuestion(endsAt);

  // The busy buttons are disabled, which would drop the focus out of the question: keep it on
  // the status line, which also tells screen readers what is happening.
  useEffect(() => {
    if (busy) statusRef.current?.focus();
  }, [busy]);

  function ask() {
    setEndsAt(formatTimeAmPm(nowDate(), data.tz));
    setOpen(true);
  }

  function close() {
    if (!busy) setOpen(false);
  }

  async function checkOut() {
    try {
      const { data: result } = await api.post('/api/attendance/check-out');
      toast(submittedAndCheckedOutToast(result, data.tz));
      // Checking out ends a break and stops a running timer: the sidebar chip reloads.
      announceTimersChanged('checkout');
      router.push('/today');
    } catch (error) {
      toast(checkOutFailedToast(error));
      router.push('/today');
    }
  }

  async function confirm() {
    if (busy) return;
    setStep('submit');
    try {
      const submitted = await submit({ quiet: true });
      if (submitted) {
        setStep('checkOut');
        await checkOut();
      }
    } finally {
      setStep(null);
      setOpen(false);
    }
  }

  // The button is for a draft; it stays while both steps run (the submit turns the draft into a
  // submitted report before the check-out).
  return (
    <>
      {report.status === 'draft' || busy ? (
        <Button size="large" variant="secondary" disabled={submitting || busy} onClick={ask}>
          Submit and check out
        </Button>
      ) : null}
      <Dialog
        open={open}
        onClose={close}
        title={question.title}
        description={question.description}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy} data-autofocus>
              Cancel
            </Button>
            <Button onClick={confirm} loading={busy}>
              Submit and check out
            </Button>
          </>
        }
      >
        {busy ? (
          <p ref={statusRef} className={styles.status} role="status" tabIndex={-1}>
            {step === 'submit' ? 'Submitting your report…' : 'Checking you out…'}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
