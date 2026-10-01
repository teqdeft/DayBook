// Project report skeleton: breadcrumb and title, five numbers, the priority tasks card, the two
// hours cards and the people, tasks and daily log tables, at the same sizes as the page.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import PriorityTasksSkeleton from './PriorityTasksSkeleton';
import styles from './loading.module.css';

const KPIS = [0, 1, 2, 3, 4];
const BARS = [0, 1, 2, 3, 4];
const COLUMNS = [0, 1, 2, 3, 4, 5, 6];
const ROWS = [0, 1, 2, 3];

function TableBlock({ title }) {
  return (
    <Card padding="none">
      <div className={styles.tableHead}>
        <Skeleton width={title} height={20} />
      </div>
      {ROWS.map((row) => (
        <div key={row} className={styles.tableRow}>
          <Skeleton width={34} height={34} radius={17} />
          <Skeleton width="18%" height={14} />
          <Skeleton width="12%" height={14} />
          <Skeleton width="8%" height={14} />
          <Skeleton width={110} height={34} radius={8} className={styles.cell} />
        </div>
      ))}
    </Card>
  );
}

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the project report</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={150} height={14} />
          <div className={styles.titleRow}>
            <Skeleton width={36} height={36} radius={9} />
            <Skeleton width={220} height={30} radius={8} />
          </div>
          <Skeleton width={300} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={330} height={40} radius={10} />
          <Skeleton width={150} height={44} radius={10} />
        </div>
      </div>

      <div className={styles.kpis}>
        {KPIS.map((kpi) => (
          <Card key={kpi} className={styles.kpi}>
            <Skeleton width={100} height={14} />
            <Skeleton width={90} height={32} radius={8} />
            <Skeleton width="100%" height={8} radius={4} />
          </Card>
        ))}
      </div>

      <PriorityTasksSkeleton />

      <div className={styles.charts}>
        <Card className={styles.block}>
          <Skeleton width={160} height={20} />
          {BARS.map((bar) => (
            <Skeleton key={bar} width="100%" height={12} radius={6} />
          ))}
        </Card>
        <Card className={styles.block}>
          <Skeleton width={160} height={20} />
          <div className={styles.columns}>
            {COLUMNS.map((column) => (
              <Skeleton key={column} width={34} height={150} radius={8} />
            ))}
          </div>
        </Card>
      </div>

      <TableBlock title={200} />
      <TableBlock title={90} />
      <TableBlock title={110} />
    </div>
  );
}
