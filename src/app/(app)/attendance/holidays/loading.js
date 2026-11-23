// Holidays while it loads: the top bar, the card's header bar and four 54 px rows (CONTRACT 25,
// item 6), so nothing jumps when the page loads.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './page.module.css';

const ROWS = [0, 1, 2, 3];

export default function HolidaysLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading holidays</span>
      <div className={styles.skeletonTop}>
        <div className={styles.skeletonHeading}>
          <Skeleton width={110} height={14} />
          <Skeleton width={180} height={30} radius={8} />
          <Skeleton width={420} height={16} />
        </div>
        <div className={styles.skeletonActions}>
          <Skeleton width={136} height={44} radius={10} />
          <Skeleton width={143} height={44} radius={10} />
        </div>
      </div>
      <Card padding="none">
        <div className={styles.skeletonHead}>
          <Skeleton width={60} height={20} />
          <Skeleton width={150} height={14} />
        </div>
        <div className={styles.skeletonTableHead} />
        {ROWS.map((row) => (
          <div key={row} className={styles.skeletonRow}>
            <Skeleton width={96} height={16} />
            <Skeleton width={180} height={16} />
          </div>
        ))}
      </Card>
    </div>
  );
}
