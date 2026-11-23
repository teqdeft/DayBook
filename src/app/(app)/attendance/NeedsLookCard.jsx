// "Needs a look this month" side card on Attendance (CONTRACT 25, item 10), HR and Admins only,
// whatever day is shown: up to 6 people whose payroll month so far reached late_alert_days late
// days, short days or missing reports, each a link to their month with the reasons as tags.
// Server Component.
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Card, { CardHeader } from '@/components/Card';
import Tag from '@/components/Tag';
import { plural } from '@/lib/text';
import styles from './NeedsLookCard.module.css';

const SHOWN = 6;
const TONES = { late: 'marigold', short: 'marigold', reports: 'red' };

/** "Listed at 4 late days, short days or missing reports." */
function footOf(threshold) {
  const words = ['late day', 'short day', 'missing report'].map((one) => plural(threshold, one));
  return `Listed at ${threshold} ${words[0]}, ${words[1]} or ${words[2]}.`;
}

/** @param {{ data: object | null }} props data = attendance.getNeedsLook() */
export default function NeedsLookCard({ data }) {
  if (!data?.period) return null;
  const items = data.items.slice(0, SHOWN);
  const more = data.total - items.length;
  return (
    <Card className={styles.card}>
      <CardHeader title="Needs a look this month" subtitle={data.period.subtitle} />
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing stands out this month.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.user.id} className={styles.item}>
              <Avatar user={item.user} size={30} className={styles.avatar} />
              <span className={styles.text}>
                <Link href={item.href} className={styles.name}>
                  {item.user.name}
                </Link>
                <span className={styles.tags}>
                  {item.reasons.map((reason) => (
                    <Tag key={reason.key} tone={TONES[reason.key] ?? 'marigold'}>
                      {reason.label}
                    </Tag>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.foot}>{footOf(data.threshold)}</p>
      {more > 0 ? (
        <Link href={data.period.monthHref} className={styles.more}>
          {more} more in the month view.
        </Link>
      ) : null}
    </Card>
  );
}
