// Daily report loading state: the top bar, two project cards, the add box and the Slack preview,
// the same size as the real page.
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

function CardSkeleton() {
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <Skeleton width={20} height={20} radius={6} />
        <Skeleton width={140} height={40} radius={10} />
        <Skeleton width={60} height={26} radius={13} />
        <span className={styles.spacer} />
        <Skeleton width={40} height={16} />
        <Skeleton width={72} height={40} radius={10} />
      </div>
      <div className={styles.thead} />
      <div className={styles.row}>
        <Skeleton width="38%" height={16} />
        <Skeleton width={190} height={38} radius={8} />
      </div>
      <div className={styles.add}>
        <Skeleton width={80} height={16} />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the daily report</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={180} height={30} radius={8} />
          <Skeleton width={190} height={16} />
        </div>
        <div className={styles.actions}>
          <div className={styles.totals}>
            <Skeleton width={112} height={24} radius={6} />
            <Skeleton width={126} height={13} />
          </div>
          <Skeleton width={154} height={47} radius={10} />
        </div>
      </div>
      <div className={styles.layout}>
        <div className={styles.main}>
          <CardSkeleton />
          <CardSkeleton />
          <div className={styles.dashed} />
        </div>
        <div className={styles.side}>
          <div className={styles.sideHead}>
            <Skeleton width={126} height={20} radius={6} />
            <Skeleton width={220} height={13} />
          </div>
          <div className={styles.sideBody}>
            <Skeleton width={36} height={36} radius={8} />
            <div className={styles.lines}>
              {[70, 60, 55, 0, 75, 40, 30, 85].map((width, index) => (
                <Skeleton key={index} width={`${width}%`} height={width ? 14 : 8} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
