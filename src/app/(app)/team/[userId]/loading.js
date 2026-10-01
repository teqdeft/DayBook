// Employee detailed view skeleton: breadcrumb and title, the profile card with five numbers, the
// month calendar and screen time beside hours and tasks, and the report history, the same sizes
// as the page.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const WEEKS = [0, 1, 2, 3, 4];
const DAYS = [0, 1, 2, 3, 4];
const ROWS = [0, 1, 2, 3, 4];

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading this person&apos;s details</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={120} height={14} />
          <Skeleton width={220} height={30} radius={8} />
          <Skeleton width={280} height={16} />
        </div>
        <div className={styles.actions}>
          <Skeleton width={250} height={40} radius={10} />
          <Skeleton width={150} height={44} radius={10} />
        </div>
      </div>

      <Card className={styles.profile}>
        <div className={styles.identity}>
          <Skeleton width={64} height={64} radius={32} />
          <div className={styles.lines}>
            <Skeleton width={180} height={15} />
            <Skeleton width={140} height={13} />
            <Skeleton width={160} height={13} />
          </div>
        </div>
        <div className={styles.stats}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.stat}>
              <Skeleton width={70} height={28} radius={8} />
              <Skeleton width={96} height={13} />
            </div>
          ))}
        </div>
      </Card>

      <div className={styles.grid}>
        <div className={styles.side}>
          <Card className={styles.block}>
            <Skeleton width={200} height={20} />
            <div className={styles.calendar}>
              {WEEKS.map((week) =>
                DAYS.map((day) => (
                  <Skeleton key={`${week}-${day}`} width="100%" height={38} radius={8} />
                )),
              )}
            </div>
          </Card>
          <Card className={styles.block}>
            <Skeleton width={130} height={20} />
            <div className={styles.screenTiles}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} width="100%" height={60} radius={12} />
              ))}
            </div>
            <Skeleton width="100%" height={84} radius={8} />
          </Card>
        </div>
        <div className={styles.side}>
          <Card className={styles.block}>
            <Skeleton width={160} height={20} />
            <Skeleton width="100%" height={12} radius={6} />
            <Skeleton width="100%" height={12} radius={6} />
            <Skeleton width="100%" height={12} radius={6} />
          </Card>
          <Card className={styles.block}>
            <Skeleton width={140} height={20} />
            <Skeleton width="100%" height={72} radius={12} />
            <Skeleton width="100%" height={72} radius={12} />
          </Card>
        </div>
      </div>

      <Card padding="none">
        <div className={styles.historyHead}>
          <Skeleton width={140} height={20} />
        </div>
        {ROWS.map((i) => (
          <div key={i} className={styles.tableRow}>
            <Skeleton width={110} height={14} />
            <Skeleton width={90} height={30} radius={8} />
            <Skeleton width="10%" height={14} />
            <Skeleton width="10%" height={14} />
            <Skeleton width="16%" height={24} radius={6} />
            <Skeleton width={130} height={34} radius={8} className={styles.cell} />
          </div>
        ))}
      </Card>
    </div>
  );
}
