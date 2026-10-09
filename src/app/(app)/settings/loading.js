// Settings while it loads: title, the sub-navigation card and the first section cards.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const NAV = [72, 150, 64, 44, 88, 124, 96, 140];

function SectionSkeleton({ fields }) {
  return (
    <Card className={styles.section}>
      <Skeleton width={150} height={20} radius={6} />
      <Skeleton width={260} height={14} className={styles.subtitle} />
      <div className={styles.fields}>
        {Array.from({ length: fields }, (_, i) => (
          <span key={i} className={styles.field}>
            <Skeleton width={90} height={12} />
            <Skeleton height={44} radius={10} />
          </span>
        ))}
      </div>
    </Card>
  );
}

export default function SettingsLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading settings</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={140} height={30} radius={8} />
          <Skeleton width={220} height={16} />
        </div>
        <Skeleton width={130} height={44} radius={10} className={styles.action} />
      </div>
      <div className={styles.layout}>
        <Card className={styles.nav}>
          {NAV.map((width, i) => (
            <Skeleton key={i} width={width} height={14} className={styles.navItem} />
          ))}
        </Card>
        <div className={styles.sections}>
          <SectionSkeleton fields={2} />
          <SectionSkeleton fields={3} />
          <SectionSkeleton fields={1} />
        </div>
      </div>
    </div>
  );
}
