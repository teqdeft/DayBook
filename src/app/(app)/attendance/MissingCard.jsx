// The "Missing check-outs" side card of Attendance (artboard 09; CONTRACT 25, item 7): the
// newest five rows still to fix ("Priya Sharma, Fri 13 Nov", "Marked at midnight", the
// suggestion and the reminder line), one Fix per row (RowAction prefilled with the suggestion),
// "Asked HR for 7:10 PM" when the person already asked, and "See all 12" for the full list. The
// suggestion, the reminders and the pending marks are for HR and Admins only (the data has them
// only for them).
import Link from 'next/link';
import Badge from '@/components/Badge';
import Card, { CardHeader } from '@/components/Card';
import { dayjs, formatClock, formatTimeAmPm, now } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import ReminderNote from './ReminderNote';
import RowAction from './RowAction';
import styles from './MissingCard.module.css';

/** When HR can remind again: 30 minutes after the last reminder, while that hasn't passed. */
function nextAtOf(reminded) {
  if (!reminded?.sentAt) return null;
  const next = dayjs(reminded.sentAt).add(attendance.REMIND_EVERY_MINUTES ?? 30, 'minute');
  return next.isAfter(now()) ? next.toDate() : null;
}

function MissingItem({ item, tz }) {
  const suggested = item.suggestedAt ? formatTimeAmPm(item.suggestedAt, tz) : null;
  const pending = item.pendingCorrection?.checkOutClock;
  return (
    <li className={styles.missingItem}>
      <span className={styles.missingText}>
        <span className={styles.missingTitle}>{item.title}</span>
        <span className={styles.missingSub}>Marked at midnight</span>
        {suggested ? <span className={styles.missingSub}>Suggested {suggested}</span> : null}
        {item.reminded ? (
          <ReminderNote reminded={item.reminded} nextAt={nextAtOf(item.reminded)} tz={tz} />
        ) : null}
      </span>
      {pending ? (
        <span className={styles.missingAsked}>Asked HR for {formatClock(pending)}</span>
      ) : item.action ? (
        <RowAction
          kind="fix"
          row={{ ...item.action.row, suggestedText: suggested }}
          className={styles.fix}
        />
      ) : null}
    </li>
  );
}

/**
 * @param {{ missing: { total: number, items: Array<{ id: number, title: string,
 *   suggestedAt: Date | null, pendingCorrection: { id: number, checkOutClock: string } | null,
 *   reminded: { sentAt: Date, sentBy: { id: number, name: string } | null } | null,
 *   action: { kind: 'fix', row: object } | null }> } }} props from attendanceData.js
 */
export default async function MissingCard({ missing }) {
  const { timezone: tz } = await settings.getAll();
  const total = missing.total;
  return (
    <Card className={styles.missingCard}>
      <CardHeader
        title="Missing check-outs"
        actions={total > 0 ? <Badge label={`${total} to fix`}>{total} to fix</Badge> : null}
      />
      {missing.items.length === 0 ? (
        <p className={styles.sideEmpty}>None right now.</p>
      ) : (
        <ul className={styles.missingList}>
          {missing.items.map((item) => (
            <MissingItem key={item.id} item={item} tz={tz} />
          ))}
        </ul>
      )}
      {total > 0 ? (
        <Link href="/attendance/missing" className={styles.seeAll}>
          See all {total}
        </Link>
      ) : null}
    </Card>
  );
}
