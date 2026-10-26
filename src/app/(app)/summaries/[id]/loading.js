// /summaries/[id] loading state: breadcrumb, title, subtitle and the summary card.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const LINES = ['92%', '60%', '84%', '70%', '88%', '52%', '76%'];

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the summary</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={170} height={14} />
          <div className={styles.titleRow}>
            <Skeleton width={36} height={36} radius={12} />
            <Skeleton width={380} height={30} radius={8} />
          </div>
          <Skeleton width={300} height={16} />
        </div>
        <Skeleton width={44} height={44} radius={10} className={styles.bell} />
      </div>
      <Card className={styles.card}>
        <div className={styles.lines}>
          {LINES.map((width, index) => (
            <Skeleton key={index} width={width} height={15} />
          ))}
        </div>
        <Skeleton width={330} height={14} />
      </Card>
    </div>
  );
}
