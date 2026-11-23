// Missing check-outs while it loads: the top bar, the list card's head row and six 54 px rows.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './page.module.css';

const ROWS = [0, 1, 2, 3, 4, 5];

export default function MissingCheckoutsLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading missing check-outs</span>
      <div className={styles.skeletonTop}>
        <Skeleton width={190} height={14} />
        <Skeleton width={260} height={30} radius={8} />
        <Skeleton width={200} height={16} />
      </div>
      <Card padding="none" className={styles.list}>
        <div className={styles.skeletonHead}>
          <Skeleton width={110} height={20} />
          <Skeleton width={190} height={20} />
        </div>
        <div className={styles.skeletonTableHead} />
        {ROWS.map((i) => (
          <div key={i} className={styles.skeletonRow}>
            <Skeleton width={34} height={34} radius={17} />
            <Skeleton width={120} height={14} />
            <Skeleton width={80} height={14} />
            <Skeleton width={48} height={16} className={styles.skeletonWide} />
            <Skeleton width={120} height={40} radius={10} className={styles.skeletonWide} />
          </div>
        ))}
      </Card>
    </div>
  );
}
