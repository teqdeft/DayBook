// One person's month while it loads: the top bar, the profile card, ten day rows, and the
// calendar (46 px tiles) and changes in the right column, so nothing jumps.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';
import page from './page.module.css';

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const WEEKS = [0, 1, 2, 3, 4];
const DAYS = [0, 1, 2, 3, 4];

export default function PersonMonthLoading() {
  return (
    <div className={page.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the month</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={180} height={14} />
          <Skeleton width={200} height={30} radius={8} />
          <Skeleton width={280} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={142} height={44} radius={10} />
          <Skeleton width={146} height={44} radius={10} />
        </div>
      </div>
      <Card className={styles.profile}>
        <Skeleton width={64} height={64} radius={32} />
        <div className={styles.lines}>
          <Skeleton width={220} height={16} />
          <Skeleton width={180} height={14} />
        </div>
        <Skeleton height={52} radius={10} className={styles.stats} />
      </Card>
      <div className={page.grid}>
        <Card padding="none" className={page.days}>
          <div className={styles.cardHead}>
            <Skeleton width={120} height={20} />
          </div>
          <div className={styles.tableHead} />
          {ROWS.map((i) => (
            <div key={i} className={styles.row}>
              <Skeleton width={80} height={14} />
              <Skeleton width={90} height={30} radius={8} />
              <Skeleton width={48} height={16} />
              <Skeleton width={48} height={14} className={styles.wide} />
              <Skeleton width={60} height={14} className={styles.wide} />
            </div>
          ))}
        </Card>
        <div className={page.right}>
          <Card className={page.calendar}>
            <Skeleton width={120} height={20} />
            <div className={styles.calendar}>
              {WEEKS.map((week) => (
                <div key={week} className={styles.week}>
                  {DAYS.map((day) => (
                    <Skeleton key={day} height={46} radius={10} />
                  ))}
                </div>
              ))}
            </div>
          </Card>
          <Card className={page.changes}>
            <Skeleton width={180} height={20} />
            <Skeleton width="80%" height={14} className={styles.change} />
            <Skeleton width="60%" height={14} className={styles.change} />
          </Card>
        </div>
      </div>
    </div>
  );
}
