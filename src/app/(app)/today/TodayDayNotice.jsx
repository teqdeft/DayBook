// Today's holiday or leave notice (CONTRACT 25, items 6 and 9), in the "Still working?" slot under
// the top bar (that line shows under it when both apply): a compact card with a CalendarDays icon
// and role="status", and for leave a muted second line with the person's own type and pay and who
// marked it (never HR's note). Server Component; nothing on an ordinary day.
import { CalendarDays } from 'lucide-react';
import Card from '@/components/Card';
import { dayNotice } from './todayDay';
import styles from './TodayDayNotice.module.css';

/**
 * @param {{ day: PersonDay | null, upcoming: { leave: object | null,
 *   holiday: { date: string, name: string } | null, todayLeave: object | null } | null }} props
 */
export default function TodayDayNotice({ day, upcoming }) {
  const notice = dayNotice(day, upcoming);
  if (!notice) return null;
  return (
    <Card padding="compact" className={styles.notice} role="status">
      <CalendarDays size={18} strokeWidth={1.8} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.text}>{notice.text}</p>
        {notice.more ? <p className={styles.more}>{notice.more}</p> : null}
      </div>
    </Card>
  );
}
