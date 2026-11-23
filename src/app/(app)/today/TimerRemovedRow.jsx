'use client';
// Removed time in Today's entry list (CONTRACT 25 A): a muted row for an away break, "1:00–1:45
// Away, removed from your acme-app timer 45m" with a "Put back" text button (named "Put back 1:00
// to 1:45 PM on your timer"; a 44 px hit area on phones). Shown after check-out too.
import Button from '@/components/Button';
import { removedView, shortDuration } from './timerData';
import styles from './TimerEntries.module.css';

/**
 * @param {{ item: { breakId: number, fromClock: string, toClock: string, minutes: number,
 *   projectName: string | null }, busy: boolean, loading: boolean,
 *   onPutBack: (item: object) => void }} props
 */
export default function TimerRemovedRow({ item, busy, loading, onPutBack }) {
  const view = removedView(item);
  return (
    <li className={`${styles.row} ${styles.removed}`}>
      <span className={styles.range}>{view.range}</span>
      <span className={`${styles.what} ${styles.removedWhat}`}>
        <span>{view.text}</span>
        <Button
          variant="text"
          size="compact"
          className={styles.putBack}
          aria-label={view.label}
          loading={loading}
          disabled={busy && !loading}
          onClick={() => onPutBack(item)}
        >
          Put back
        </Button>
      </span>
      <span className={styles.minutes}>{shortDuration(item.minutes)}</span>
    </li>
  );
}
