'use client';
// The share confirm (CONTRACT 28, Linking and the share confirm; New task and Edit task; "From
// project files" picker; The people window): the line Daybook shows, in place of a window's
// footer, before a save lets someone who isn't a manager open an "Only PM and Admins" file through
// a task. Lock 18 in a --marigold-soft box, the sentence (shareText, or the people window's
// words), "Back" and the confirm button ("Attach and share", "Add task and share", "Save and
// share", "Give and share"), which takes the focus when the line shows. `role="status"`, so a
// screen reader reads the sentence; the confirm button stays focusable while it works
// (BusyButton).
import { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import Button from '@/components/Button';
import BusyButton from '@/app/(app)/projects/[id]/BusyButton';
import styles from './ShareConfirm.module.css';

/**
 * @param {{ text: string, confirmLabel: string, onBack: () => void, onConfirm: () => void,
 *   busy?: boolean, className?: string }} props busy: the save runs (the confirm spins, Back
 *   waits)
 */
export default function ShareConfirm({
  text,
  confirmLabel,
  onBack,
  onConfirm,
  busy = false,
  className = '',
}) {
  const confirmRef = useRef(null);
  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className={`${styles.ask} ${className}`} role="status" data-share-confirm="">
      <Lock size={18} strokeWidth={1.8} aria-hidden="true" />
      <p className={styles.text}>{text}</p>
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          size="medium"
          className={styles.button}
          aria-disabled={busy || undefined}
          onClick={busy ? undefined : onBack}
        >
          Back
        </Button>
        <BusyButton
          ref={confirmRef}
          size="medium"
          className={styles.button}
          busy={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </BusyButton>
      </div>
    </div>
  );
}
