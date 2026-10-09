// Today while it loads: the same blocks as the page (Your day, This week, the Working on card of
// project timers, tasks, report strip).
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import page from './page.module.css';
import styles from './loading.module.css';

export default function TodayLoading() {
  return (
    <div className={page.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading Today</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={300} height={30} radius={8} />
          <Skeleton width={180} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={190} height={40} radius={999} />
          <Skeleton width={108} height={44} radius={10} />
          <Skeleton width={44} height={44} radius={10} />
        </div>
      </div>
      <section className={page.rowDay}>
        <Card className={`${page.yourDay} ${styles.day}`}>
          <div className={styles.cardHead}>
            <Skeleton width={90} height={20} />
            <Skeleton width={160} height={30} radius={999} />
          </div>
          <Skeleton height={18} radius={999} className={styles.bar} />
          <div className={page.tiles}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={80} radius={12} />
            ))}
          </div>
        </Card>
        <Card className={page.week}>
          <Skeleton width={100} height={20} />
          <Skeleton width={140} height={14} className={styles.sub} />
          <div className={styles.bars}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width={34} height={110} radius={10} />
            ))}
          </div>
        </Card>
      </section>
      <Card className={styles.timer}>
        <div className={styles.cardHead}>
          <Skeleton width={110} height={20} />
          <Skeleton width={120} height={14} />
        </div>
        <Skeleton height={72} radius={12} className={styles.timerBox} />
        {[0, 1].map((i) => (
          <div key={i} className={styles.timerRow}>
            <Skeleton width={84} height={14} />
            <Skeleton width={90} height={26} radius={6} />
            <Skeleton width="30%" height={14} />
          </div>
        ))}
      </Card>
      <section className={page.rowTasks}>
        <Card className={styles.urgent}>
          <Skeleton width={180} height={28} radius={999} />
          <Skeleton width="80%" height={24} className={styles.sub} />
          <Skeleton width="60%" height={24} />
        </Card>
        <Card padding="none">
          <div className={styles.tableHead}>
            <Skeleton width={170} height={20} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.row}>
              <Skeleton width="30%" height={14} />
              <Skeleton width={90} height={26} radius={6} />
              <Skeleton width={133} height={34} radius={8} />
            </div>
          ))}
        </Card>
      </section>
      <Skeleton height={90} radius={16} />
    </div>
  );
}
