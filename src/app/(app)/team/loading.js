// Team dashboard skeleton: top bar, four number cards, the hours / donut / urgent row and the
// team board, the same sizes as the real page.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const ROWS = [0, 1, 2, 3, 4, 5];

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the team dashboard</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={250} height={30} radius={8} />
          <Skeleton width={240} height={16} />
        </div>
        <Skeleton width={280} height={44} radius={10} className={styles.search} />
      </div>
      <div className={styles.kpis}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} padding="compact" className={styles.kpi}>
            <Skeleton width="50%" height={14} />
            <Skeleton width="60%" height={30} radius={8} />
            <Skeleton width="100%" height={8} radius={4} />
          </Card>
        ))}
      </div>
      <div className={styles.row}>
        <Card className={styles.block}>
          <Skeleton width={200} height={20} />
          {ROWS.map((i) => (
            <Skeleton key={i} width="100%" height={14} radius={7} />
          ))}
        </Card>
        <Card className={styles.block}>
          <Skeleton width={150} height={20} />
          <Skeleton width={132} height={132} radius={66} className={styles.center} />
        </Card>
        <Card className={styles.block}>
          <Skeleton width={120} height={20} />
          <Skeleton width="100%" height={100} radius={12} />
          <Skeleton width="100%" height={100} radius={12} />
        </Card>
      </div>
      <Card padding="none">
        <div className={styles.boardHead}>
          <Skeleton width={110} height={20} />
          <Skeleton width={90} height={36} radius={18} />
          <Skeleton width={150} height={36} radius={18} />
        </div>
        {ROWS.map((i) => (
          <div key={i} className={styles.tableRow}>
            <Skeleton width={34} height={34} radius={17} />
            <Skeleton width="18%" height={14} />
            <Skeleton width="8%" height={14} />
            <Skeleton width="16%" height={10} radius={5} />
            <Skeleton width={120} height={34} radius={8} className={styles.cell} />
          </div>
        ))}
      </Card>
    </div>
  );
}
