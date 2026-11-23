// Leave while it loads: the top bar, the Person filter, the card's header bar and six 54 px rows
// (CONTRACT 25, item 9), so nothing jumps when the page loads.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './page.module.css';

const ROWS = [0, 1, 2, 3, 4, 5];

export default function LeaveLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading leave</span>
      <div className={styles.skeletonTop}>
        <div className={styles.skeletonHeading}>
          <Skeleton width={110} height={14} />
          <Skeleton width={120} height={30} radius={8} />
          <Skeleton width={460} height={16} />
        </div>
        <div className={styles.skeletonActions}>
          <Skeleton width={176} height={44} radius={10} />
          <Skeleton width={135} height={44} radius={10} />
        </div>
      </div>
      <div className={styles.filter}>
        <div className={`${styles.filterField} ${styles.skeletonField}`}>
          <Skeleton width={56} height={14} />
          <Skeleton height={44} radius={10} />
        </div>
      </div>
      <Card padding="none">
        <div className={styles.skeletonHead}>
          <Skeleton width={150} height={20} />
          <Skeleton width={170} height={14} />
        </div>
        <div className={styles.skeletonTableHead} />
        {ROWS.map((row) => (
          <div key={row} className={styles.skeletonRow}>
            <Skeleton width={34} height={34} radius={17} />
            <Skeleton width={120} height={16} />
            <Skeleton width={150} height={16} />
            <Skeleton width={60} height={16} />
          </div>
        ))}
      </Card>
    </div>
  );
}
