// The muted notice above the Attendance table on a day nobody is expected in (CONTRACT 25, item
// 6): a holiday ("Holiday: Guru Nanak Jayanti. Nobody is expected in, so there are no late marks
// or reminders.") or a weekday the company doesn't work ("Not a working day. Nobody is expected
// in."). Server Component; the page renders it only when the day isn't a working day. Also the
// one sentence the Holidays and Leave pages show before migration 018 (UpdateNeededNotice).
import { Info } from 'lucide-react';
import Card from '@/components/Card';
import styles from './DayNotice.module.css';

/** The notice's sentence for a day, or null on a working day. */
export function dayNoticeText(day) {
  if (!day || day.isWorkingDay) return null;
  if (day.holiday && day.weekday) {
    return `Holiday: ${day.holiday.name}. Nobody is expected in, so there are no late marks or reminders.`;
  }
  return 'Not a working day. Nobody is expected in.';
}

/**
 * @param {{ day: { date: string, weekday: boolean, isWorkingDay: boolean,
 *   holiday: { id: number, name: string } | null } }} props a holiday on a day the company
 *   doesn't work reads as "Not a working day" (it changes nothing there)
 */
export default function DayNotice({ day }) {
  const text = dayNoticeText(day);
  if (!text) return null;
  return (
    <Card padding="compact" className={styles.notice} role="status">
      <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.icon} />
      <p className={styles.text}>{text}</p>
    </Card>
  );
}

/** Before migration 018 (Holidays and Leave pages): the one sentence, with an Info icon. */
export function UpdateNeededNotice() {
  return (
    <Card padding="compact" className={styles.notice} role="status">
      <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.icon} />
      <p className={styles.text}>This needs the latest database update. Ask an Admin.</p>
    </Card>
  );
}
