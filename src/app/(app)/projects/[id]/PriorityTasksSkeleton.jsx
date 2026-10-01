// The "Priority tasks" card's shape while it loads (the page streams it in behind this, and the
// route's loading.js shows it too): header, then three rows.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './PriorityTasksCard.module.css';

const ROWS = [0, 1, 2];

/** The card's shape while it loads: header, then three rows. */
export default function PriorityTasksSkeleton() {
  return (
    <Card padding="none" className={styles.card} id="priority" aria-busy="true">
      <span className="visually-hidden">Loading priority tasks</span>
      <div className={styles.header}>
        <div className={styles.heading}>
          <Skeleton width={140} height={20} />
          <Skeleton width={260} height={14} className={styles.skeletonSub} />
        </div>
        <Skeleton width={170} height={40} radius={10} />
      </div>
      <ul className={styles.list} aria-hidden="true">
        {ROWS.map((row) => (
          <li key={row} className={styles.row}>
            <Skeleton width={34} height={26} radius={6} className={styles.tagCell} />
            <div className={styles.main}>
              <Skeleton width="55%" height={16} />
            </div>
            <div className={styles.assignee}>
              <Skeleton width={28} height={28} radius={14} />
              <Skeleton width={110} height={14} />
            </div>
            <div className={styles.latest}>
              <Skeleton width={150} height={14} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
