// My log loading state: the top bar, four number cards, the day table and the right column
// (hours, edit requests, attendance and screen time), the same sizes as the real page.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const ROWS = [74, 54, 54, 74, 54, 54];

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading your log</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={110} height={30} radius={8} />
          <Skeleton width={236} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={216} height={44} radius={10} />
          <Skeleton width={146} height={44} radius={10} />
        </div>
      </div>
      <div className={styles.kpis}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className={styles.kpi}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="65%" height={30} radius={8} />
            <Skeleton width="100%" height={8} radius={4} />
          </Card>
        ))}
      </div>
      <div className={styles.layout}>
        <Card padding="none" className={styles.table}>
          <div className={styles.tableHead}>
            <Skeleton width={120} height={20} radius={6} />
            <Skeleton width={190} height={13} />
          </div>
          <div className={styles.columns} />
          {ROWS.map((height, i) => (
            <div key={i} className={styles.row} style={{ height }}>
              <Skeleton width={80} height={15} />
              <Skeleton width={84} height={15} />
              <Skeleton width={50} height={15} />
              <Skeleton width={30} height={15} />
              <Skeleton width={96} height={26} radius={6} />
              <Skeleton width={93} height={34} radius={8} />
            </div>
          ))}
        </Card>
        <div className={styles.side}>
          <Card className={styles.sideCard}>
            <Skeleton width={150} height={20} radius={6} />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={12} radius={6} />
            ))}
          </Card>
          <Card className={styles.sideCard}>
            <Skeleton width={120} height={20} radius={6} />
            <Skeleton width="100%" height={111} radius={12} />
            <Skeleton width="100%" height={44} radius={10} />
          </Card>
          <Card className={styles.sideCard}>
            <Skeleton width={110} height={20} radius={6} />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={14} />
            ))}
          </Card>
          <Card className={styles.sideCard}>
            <Skeleton width={120} height={20} radius={6} />
            <div className={styles.screenTiles}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} width="100%" height={60} radius={12} />
              ))}
            </div>
            <Skeleton width="100%" height={84} radius={8} />
          </Card>
        </div>
      </div>
    </div>
  );
}
