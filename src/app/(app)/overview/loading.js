// Company overview skeleton: top bar, five number cards, the hours and attendance row, and the
// three list cards, the same sizes as the real page.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const BARS = [0, 1, 2, 3, 4, 5, 6];
const DAYS = [0, 1, 2, 3, 4];
const ROWS = [0, 1, 2, 3];

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the company overview</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={270} height={30} radius={8} />
          <Skeleton width={240} height={16} />
        </div>
        <Skeleton width={240} height={44} radius={10} className={styles.search} />
      </div>

      <div className={styles.kpis}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Card key={i} padding="compact" className={styles.kpi}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="70%" height={30} radius={8} />
            <Skeleton width="100%" height={8} radius={4} />
          </Card>
        ))}
      </div>

      <div className={styles.charts}>
        <Card className={styles.block}>
          <Skeleton width={180} height={20} />
          {BARS.map((i) => (
            <Skeleton key={i} width="100%" height={12} radius={6} />
          ))}
        </Card>
        <Card className={styles.block}>
          <Skeleton width={190} height={20} />
          <div className={styles.week}>
            {DAYS.map((i) => (
              <Skeleton key={i} width={44} height={150} radius={8} />
            ))}
          </div>
          <Skeleton width={150} height={14} />
          <Skeleton width={170} height={14} />
        </Card>
      </div>

      <div className={styles.lists}>
        {[0, 1, 2].map((card) => (
          <Card key={card} className={styles.block}>
            <Skeleton width={170} height={20} />
            {ROWS.map((i) => (
              <Skeleton key={i} width="100%" height={card === 2 ? 40 : 24} radius={8} />
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
