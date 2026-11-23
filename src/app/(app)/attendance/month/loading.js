// Attendance, Month while it loads: the top bar (Day / Month switch, the month switcher and the
// Excel button), the five number cards and eight 64 px rows, so nothing jumps.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';
import page from './page.module.css';

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

export default function AttendanceMonthLoading() {
  return (
    <div className={page.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the month</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={200} height={30} radius={8} />
          <Skeleton width={260} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={130} height={44} radius={10} />
          <Skeleton width={142} height={44} radius={10} />
          <Skeleton width={146} height={44} radius={10} />
        </div>
      </div>
      <section className={page.kpis}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Card key={i} padding="compact" className={styles.kpi}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="45%" height={30} radius={8} />
            <Skeleton height={8} radius={4} />
          </Card>
        ))}
      </section>
      <Card padding="none" className={page.everyone}>
        <div className={styles.cardHead}>
          <Skeleton width={200} height={20} />
          <Skeleton width={520} height={36} radius={999} className={styles.pills} />
        </div>
        <div className={styles.tableHead} />
        {ROWS.map((i) => (
          <div key={i} className={styles.row}>
            <Skeleton width={34} height={34} radius={17} />
            <Skeleton width={130} height={14} />
            <Skeleton width={48} height={16} />
            <Skeleton width={48} height={16} className={styles.wide} />
            <Skeleton width={60} height={16} className={styles.wide} />
            <Skeleton width={70} height={16} className={styles.wide} />
          </div>
        ))}
      </Card>
    </div>
  );
}
