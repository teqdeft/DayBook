'use client';
// The bulk bar (CONTRACT 28, Table and bulk bar; Motion, Moments: Bulk bar): when the project's PM or
// an Admin selects rows it rises at the bottom of the window (`--shift-bar`, `--dur-in`) with "2
// selected", Assign to me, Give to…, Move to phase… and Clear; when the selection empties it fades
// out (`--dur-out`, inert meanwhile, still showing its last count). The pressed button turns busy
// and keeps its label while the others wait (`aria-disabled`). While it shows, toasts sit above it
// (`--toast-offset` on `<html>`, its height plus 12 px), so on a phone a toast never covers it.
import { useLayoutEffect, useRef } from 'react';
import { ArrowRight, LoaderCircle, UserPlus, Users } from 'lucide-react';
import Button from '@/components/Button';
import { DUR } from '@/lib/motion/tokens';
import { useHeldValue, usePresence } from '@/lib/motion/presence';
import busyStyles from '../../BusyButton.module.css';
import { selectedText } from './bulkView';
import { keepToastOffset } from './tableDom';
import styles from './BulkBar.module.css';

const ICON = { size: 16, strokeWidth: 1.8, 'aria-hidden': true };

/**
 * One of the bar's buttons, as BusyButton draws a button at work (the spinner in place of its
 * icon, the label kept, focus kept: never `disabled`): busy while its action waits, `aria-disabled`
 * while another one does. One element throughout, so the pressed button keeps the focus.
 */
function BarButton({ name, busy, icon, popup, onClick, children }) {
  const mine = busy === name;
  return (
    <Button
      variant="secondary"
      size="medium"
      className={[styles.action, mine ? styles.busy : null].filter(Boolean).join(' ')}
      icon={
        mine ? (
          <LoaderCircle className={busyStyles.spinner} size={18} strokeWidth={1.8} aria-hidden />
        ) : (
          icon
        )
      }
      aria-haspopup={popup ? 'dialog' : undefined}
      aria-disabled={busy ? true : undefined}
      aria-busy={mine || undefined}
      onClick={busy ? undefined : onClick}
    >
      {children}
    </Button>
  );
}

/**
 * @param {{ count: number, busy: 'take' | 'give' | 'move' | null, onTake: () => void,
 *   onGive: () => void, onMove: (origin: HTMLElement) => void, onClear: () => void }} props
 *   count: the rows selected (the bar shows from 1)
 */
export default function BulkBar({ count, busy, onTake, onGive, onMove, onClear }) {
  const open = count > 0;
  const ref = useRef(null);
  const { rendered, closing, onAnimationEnd } = usePresence(open, DUR.out);
  const shown = useHeldValue(open, count);
  useLayoutEffect(
    () => (rendered && !closing ? keepToastOffset(ref.current) : undefined),
    [rendered, closing],
  );
  if (!rendered) return null;
  return (
    <div
      ref={ref}
      className={styles.bar}
      role="region"
      aria-label="Selected tasks"
      data-closing={closing ? '' : undefined}
      inert={closing || undefined}
      onAnimationEnd={(event) => closing && onAnimationEnd(event)}
    >
      <b className={styles.count}>{selectedText(shown)}</b>
      <BarButton name="take" busy={busy} icon={<UserPlus {...ICON} />} onClick={onTake}>
        Assign to me
      </BarButton>
      <BarButton name="give" busy={busy} icon={<Users {...ICON} />} popup onClick={onGive}>
        Give to…
      </BarButton>
      <BarButton
        name="move"
        busy={busy}
        icon={<ArrowRight {...ICON} />}
        popup
        onClick={(event) => onMove(event.currentTarget)}
      >
        Move to phase…
      </BarButton>
      <button
        type="button"
        className={styles.clear}
        aria-disabled={busy ? true : undefined}
        onClick={busy ? undefined : onClear}
      >
        Clear
      </button>
    </div>
  );
}
