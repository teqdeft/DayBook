// Roles and permissions while it loads: the four role cards and the two tables.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const ROWS = [0, 1, 2, 3, 4, 5, 6];

function TableSkeleton({ title, action }) {
  return (
    <Card padding="none">
      <div className={styles.cardHead}>
        <Skeleton width={title} height={20} radius={6} />
        {action ? <Skeleton width={200} height={44} radius={10} /> : null}
      </div>
      <div className={styles.tableHead} />
      {ROWS.map((i) => (
        <div key={i} className={styles.row}>
          <Skeleton width="45%" height={14} />
          <Skeleton width={action ? 137 : 120} height={action ? 40 : 14} radius={action ? 10 : 6} />
        </div>
      ))}
    </Card>
  );
}

export default function RolesLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading roles</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={280} height={30} radius={8} />
          <Skeleton width={190} height={16} />
        </div>
        <Skeleton width={130} height={44} radius={10} className={styles.action} />
      </div>
      <div className={styles.cards}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className={styles.card}>
            <span className={styles.cardTop}>
              <Skeleton width={90} height={28} radius={14} />
              <Skeleton width={24} height={28} radius={6} />
            </span>
            <Skeleton width="80%" height={14} />
          </Card>
        ))}
      </div>
      <div className={styles.bottom}>
        <TableSkeleton title={160} action />
        <TableSkeleton title={200} />
      </div>
    </div>
  );
}
