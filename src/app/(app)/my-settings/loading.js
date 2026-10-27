// My settings while it loads, like Settings': title, the section list card and the first cards
// with their rows (a label, a help line and a switch).
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const NAV = [92, 24, 98, 86];

function SectionSkeleton({ rows, choice = false }) {
  return (
    <Card className={styles.section}>
      <Skeleton width={130} height={20} radius={6} />
      <div className={styles.rows}>
        {choice ? (
          <span className={styles.choiceRow}>
            <Skeleton width={120} height={14} />
            <Skeleton width={300} height={12} />
            <Skeleton width={340} height={40} radius={10} className={styles.choice} />
          </span>
        ) : null}
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className={styles.row}>
            <span className={styles.rowText}>
              <Skeleton width={i % 2 ? 180 : 260} height={14} />
              <Skeleton width={i % 2 ? 240 : 320} height={12} />
            </span>
            <Skeleton width={44} height={26} radius={13} className={styles.switch} />
          </span>
        ))}
      </div>
    </Card>
  );
}

export default function MySettingsLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading my settings</span>
      <div className={styles.heading}>
        <Skeleton width={170} height={30} radius={8} />
        <Skeleton width={260} height={16} />
      </div>
      <div className={styles.layout}>
        <Card className={styles.nav}>
          {NAV.map((width, i) => (
            <Skeleton key={i} width={width} height={14} />
          ))}
        </Card>
        <div className={styles.sections}>
          <SectionSkeleton rows={2} choice />
          <SectionSkeleton rows={2} />
          <SectionSkeleton rows={1} />
        </div>
      </div>
    </div>
  );
}
