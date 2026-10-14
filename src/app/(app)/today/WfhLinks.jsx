'use client';
// Under Today's correction links, for people who need HR's approval to work from home (CONTRACT
// 17): "Working from home another day? Ask HR", then one line per request still waiting for HR or
// approved and not over yet, each with Cancel. A cancelled line goes away on the refresh, which
// would drop a keyboard user's focus: it comes back to Ask HR.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import WfhCancelDialog from './WfhCancelDialog';
import WfhRequestDialog from './WfhRequestDialog';
import styles from './page.module.css';

/**
 * @param {{ today: string, nextDay: string, lines: Array<{ id: number, status: string,
 *   days: string, started: boolean, text: string }> }} props nextDay: the From the dialog opens
 *   with; lines: wfhLines() in wfhOptions.js
 */
export default function WfhLinks({ today, nextDay, lines = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [refreshing, startRefresh] = useTransition();
  const askRef = useRef(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (refreshing || !refocus.current) return;
    refocus.current = false;
    const focused = document.activeElement;
    // Only when the focus was dropped, not when the person has moved on meanwhile.
    if (!focused || focused === document.body) askRef.current?.focus();
  }, [refreshing, lines]);

  function refresh() {
    refocus.current = true;
    startRefresh(() => router.refresh());
  }

  return (
    <>
      <p className={styles.helpText}>
        Working from home another day?{' '}
        <Button ref={askRef} variant="text" size="small" onClick={() => setOpen(true)}>
          Ask HR
        </Button>
      </p>
      {lines.map((line) => (
        <p key={line.id} className={styles.helpText}>
          <span>{line.text}</span>
          <Button
            variant="text"
            size="small"
            onClick={() => setCancelling(line)}
            aria-label={`Cancel working from home on ${line.days}`}
          >
            Cancel
          </Button>
        </p>
      ))}
      <WfhRequestDialog
        open={open}
        onClose={() => setOpen(false)}
        today={today}
        fromDate={nextDay}
      />
      <WfhCancelDialog line={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
    </>
  );
}
