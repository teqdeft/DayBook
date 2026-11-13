// The muted line under the Requests pills when attendance fixes wait (CONTRACT 23). They are
// handled on Attendance, so the line links there; the Company overview's "Pending requests" card
// counts them too.
import Link from 'next/link';
import { can } from '@/lib/permissions';
import { plural } from '@/lib/text';
import styles from './page.module.css';

/**
 * "1 attendance fix is waiting on Attendance. Open attendance". Nothing when the viewer can't
 * correct attendance or no fix waits.
 * @param {{ viewer: object, count: number }} props count: pending correction requests
 */
export default function AttendanceFixes({ viewer, count }) {
  if (!can(viewer, 'attendance.correct') || !(count > 0)) return null;
  const waiting = `${count} attendance ${plural(count, 'fix is', 'fixes are')} waiting on Attendance.`;
  return (
    <p className={styles.fixes}>
      {waiting}{' '}
      <Link href="/attendance" className={styles.fixesLink}>
        Open attendance
      </Link>
    </p>
  );
}
