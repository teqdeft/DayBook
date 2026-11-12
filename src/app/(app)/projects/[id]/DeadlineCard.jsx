// Deadline on the Overview: the date, how far off it is, and for the project's PM or Admin the
// button that changes it. Server-safe.
import Card from '@/components/Card';
import DeadlineButton from './DeadlineButton';
import { dayCount, daysBetween, longDate } from './planFormat';
import styles from './Overview.module.css';

/** '46 days left', 'Due today', '5 days ago' */
export function deadlineLeft(deadline, today) {
  const left = daysBetween(today, deadline);
  if (left > 0) return `${dayCount(left)} left`;
  return left === 0 ? 'Due today' : `${dayCount(-left)} ago`;
}

/**
 * @param {{ projectId: number, deadline: string | null, today: string, canManage: boolean }} props
 */
export default function DeadlineCard({ projectId, deadline, today, canManage }) {
  return (
    <Card
      as="section"
      padding="compact"
      aria-labelledby="overview-deadline"
      className={`${styles.smallCard} ${styles.columnCard}`}
    >
      <h2 id="overview-deadline" className={styles.cardTitle}>
        Deadline
      </h2>
      <div className={styles.deadlineBody}>
        <div className={deadline ? styles.deadlineDate : styles.deadlineNone}>
          {deadline ? longDate(deadline) : 'No deadline'}
        </div>
        {deadline ? (
          <div className={styles.deadlineLeft}>{deadlineLeft(deadline, today)}</div>
        ) : null}
        {canManage ? <DeadlineButton projectId={projectId} deadline={deadline} /> : null}
      </div>
    </Card>
  );
}
