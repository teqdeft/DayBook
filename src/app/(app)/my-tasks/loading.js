// My tasks skeleton: the top bar, the toolbar and the table's header, a group row and six rows, the
// same sizes as the real page (CONTRACT 28, My tasks).
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const ROWS = [0, 1, 2, 3, 4, 5];

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading your tasks</span>
      <div className={styles.heading}>
        <Skeleton width={150} height={30} radius={8} />
        <Skeleton width={320} height={16} />
      </div>
      <div className={styles.toolbar}>
        <Skeleton width={190} height={40} radius={10} />
        <Skeleton width={200} height={40} radius={10} className={styles.wide} />
        <Skeleton width={260} height={40} radius={10} className={styles.wide} />
      </div>
      <div className={styles.table}>
        <div className={styles.head} />
        <div className={styles.group}>
          <Skeleton width={90} height={14} />
        </div>
        {ROWS.map((row) => (
          <div key={row} className={styles.row}>
            <Skeleton width={20} height={20} radius={10} />
            <Skeleton width="34%" height={14} className={styles.grow} />
            <Skeleton width={90} height={22} radius={6} />
            <Skeleton width={80} height={22} radius={11} className={styles.cell} />
            <Skeleton width={30} height={22} radius={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
