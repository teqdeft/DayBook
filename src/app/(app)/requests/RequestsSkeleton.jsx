// Loading shape for /requests: top bar, filter pills, request cards and the side column.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './RequestsSkeleton.module.css';

export default function RequestsSkeleton() {
  return (
    <div className={styles.page} aria-busy="true">
      <span className="visually-hidden">Loading requests</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={160} height={30} radius={8} />
          <Skeleton width={130} height={16} />
        </div>
        <Skeleton width={44} height={44} radius={10} className={styles.bell} />
      </div>
      <div className={styles.pills}>
        {[64, 120, 126].map((width) => (
          <Skeleton key={width} width={width} height={36} radius={18} />
        ))}
      </div>
      <div className={styles.layout}>
        <div className={styles.column}>
          {[0, 1, 2].map((index) => (
            <Card key={index} className={styles.card}>
              <div className={styles.row}>
                <Skeleton width={34} height={34} radius={17} />
                <div className={styles.stack}>
                  <Skeleton width={120} height={15} />
                  <Skeleton width={96} height={13} />
                </div>
                <Skeleton width={84} height={26} radius={13} className={styles.push} />
              </div>
              <Skeleton width="55%" height={20} />
              <Skeleton width="100%" height={46} radius={10} />
              <div className={styles.row}>
                <Skeleton width={120} height={13} />
                <Skeleton width={88} height={38} radius={10} className={styles.push} />
                <Skeleton width={124} height={38} radius={10} />
              </div>
            </Card>
          ))}
        </div>
        <div className={styles.column}>
          <Card className={styles.card}>
            <Skeleton width={160} height={20} />
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={styles.row}>
                <Skeleton width={30} height={30} radius={15} />
                <Skeleton width="55%" height={15} />
                <Skeleton width={78} height={29} radius={8} className={styles.push} />
              </div>
            ))}
          </Card>
          <Card className={styles.card}>
            <Skeleton width={140} height={18} />
            <Skeleton width="100%" height={14} />
            <Skeleton width="80%" height={14} />
          </Card>
        </div>
      </div>
    </div>
  );
}
