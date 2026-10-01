'use client';
// The line under the report strip: "I came earlier" (after today's check-in) and "Request a
// correction" for any other day, plus the person's requests still waiting for HR.
import { useState } from 'react';
import Button from '@/components/Button';
import CorrectionDialog from './CorrectionDialog';
import styles from './page.module.css';

/**
 * @param {{ today: string, yesterday: string, checkInClock?: string | null,
 *   canSayEarlier: boolean, pending: { id: number, text: string }[] }} props
 */
export default function CorrectionLinks({
  today,
  yesterday,
  checkInClock,
  canSayEarlier,
  pending,
}) {
  const [open, setOpen] = useState(null);
  return (
    <div className={styles.help}>
      <p className={styles.helpText}>
        {canSayEarlier ? (
          <>
            Arrived before you checked in?{' '}
            <Button variant="text" size="small" onClick={() => setOpen('earlier')}>
              I came earlier
            </Button>
            <span aria-hidden="true" className={styles.helpDot}>
              ·
            </span>
          </>
        ) : null}
        Forgot to check out or missed a day?{' '}
        <Button variant="text" size="small" onClick={() => setOpen('other')}>
          Request a correction
        </Button>
      </p>
      {pending.length > 0 ? (
        <p className={styles.helpText}>
          Waiting for HR: {pending.map((item) => item.text).join(', ')}.
        </p>
      ) : null}
      <CorrectionDialog
        open={open === 'earlier'}
        onClose={() => setOpen(null)}
        earlier
        today={today}
        yesterday={yesterday}
        checkInClock={checkInClock}
      />
      <CorrectionDialog
        open={open === 'other'}
        onClose={() => setOpen(null)}
        today={today}
        yesterday={yesterday}
      />
    </div>
  );
}
