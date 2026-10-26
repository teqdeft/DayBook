// /summaries loading state: the top bar and the list card, the same sizes as the real page.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading your summaries</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={150} height={30} radius={8} />
          <Skeleton width={290} height={16} />
        </div>
        <Skeleton width={44} height={44} radius={10} className={styles.bell} />
      </div>
      <Card padding="none">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className={styles.row}>
            <Skeleton width={40} height={40} radius={12} />
            <div className={styles.stack}>
              <div className={styles.meta}>
                <Skeleton width={150} height={22} radius={11} />
                <Skeleton width={90} height={14} />
              </div>
              <Skeleton width="45%" height={18} />
              <Skeleton width="90%" height={14} />
            </div>
          </div>
        ))}
        <div className={styles.footer}>
          <Skeleton width={330} height={14} />
        </div>
      </Card>
    </div>
  );
}
