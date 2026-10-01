// Screen time while it loads: the top bar, four number cards and the table card with its head,
// rows and footer. Rows sit on the table's columns (person, now, active, idle, locked, first to
// last active, day bar); below 1280 px they take the stacked person-card shape the page uses.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import page from './page.module.css';
import styles from './loading.module.css';

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

export default function ScreenTimeLoading() {
  return (
    <div className={page.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading screen time</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={190} height={30} radius={8} />
          <Skeleton width={260} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={142} height={44} radius={10} />
          <Skeleton width={146} height={44} radius={10} />
        </div>
      </div>
      <section className={page.kpis}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} padding="compact" className={styles.kpi}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="45%" height={30} radius={8} />
            <Skeleton height={8} radius={4} />
          </Card>
        ))}
      </section>
      <Card padding="none">
        <div className={styles.cardHead}>
          <Skeleton width={150} height={20} className={styles.title} />
          <Skeleton width={470} height={36} radius={999} className={styles.pills} />
          <Skeleton width={220} height={40} radius={10} className={styles.search} />
        </div>
        <div className={styles.tableHead} />
        {ROWS.map((i) => (
          <div key={i} className={styles.row}>
            <span className={styles.person}>
              <Skeleton width={34} height={34} radius={17} />
              <Skeleton width={110} height={14} />
            </span>
            <Skeleton height={30} radius={8} className={styles.state} />
            <Skeleton width={46} height={14} className={styles.num} />
            <Skeleton width={34} height={14} className={styles.num} />
            <Skeleton width={40} height={14} className={styles.num} />
            <Skeleton width={92} height={14} className={styles.num} />
            <Skeleton width="62%" height={14} className={styles.line} />
            <Skeleton height={12} radius={6} className={styles.bar} />
          </div>
        ))}
        <div className={styles.foot}>
          <Skeleton width="55%" height={14} />
        </div>
      </Card>
    </div>
  );
}
