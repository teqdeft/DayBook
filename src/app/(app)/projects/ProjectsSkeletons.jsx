// Loading shapes for /projects: the card grid (My projects) and the table (Projects).
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './ProjectsSkeletons.module.css';

function TopBarSkeleton({ subtitle = 200, actions = [168] }) {
  return (
    <div className={styles.topbar}>
      <div className={styles.heading}>
        <Skeleton width={150} height={30} radius={8} />
        <Skeleton width={subtitle} height={16} />
      </div>
      <div className={styles.actions}>
        {actions.map((width, index) => (
          <Skeleton key={index} width={width} height={44} radius={10} />
        ))}
      </div>
    </div>
  );
}

function PillsSkeleton({ widths }) {
  return (
    <div className={styles.pills}>
      {widths.map((width, index) => (
        <Skeleton key={index} width={width} height={36} radius={18} />
      ))}
    </div>
  );
}

export function MyProjectsSkeleton() {
  return (
    <div className={styles.page} aria-busy="true">
      <span className="visually-hidden">Loading projects</span>
      <TopBarSkeleton subtitle={186} actions={[183]} />
      <PillsSkeleton widths={[88, 114]} />
      <div className={styles.grid}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Card key={index} className={styles.card}>
            <div className={styles.cardHead}>
              <Skeleton width={42} height={42} radius={10} />
              <div className={styles.cardTitle}>
                <Skeleton width="60%" height={18} />
                <Skeleton width="40%" height={13} />
              </div>
            </div>
            <div className={styles.cardStats}>
              <Skeleton width="45%" height={13} />
              <Skeleton width="30%" height={26} radius={8} />
            </div>
            <div className={styles.cardFoot}>
              <Skeleton width="40%" height={14} />
              <Skeleton width={56} height={30} radius={15} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ManageProjectsSkeleton() {
  return (
    <div className={styles.page} aria-busy="true">
      <span className="visually-hidden">Loading projects</span>
      <TopBarSkeleton subtitle={150} actions={[240, 150]} />
      <PillsSkeleton widths={[94, 94, 122]} />
      <Card padding="none">
        <div className={styles.tableHead} />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <div key={index} className={styles.row}>
            <Skeleton width={34} height={34} radius={9} />
            <Skeleton width="18%" height={15} />
            <Skeleton width="12%" height={15} className={styles.hideSmall} />
            <Skeleton width="12%" height={15} className={styles.hideSmall} />
            <Skeleton width={64} height={30} radius={15} className={styles.hideSmall} />
            <Skeleton width={110} height={34} radius={8} className={styles.push} />
          </div>
        ))}
      </Card>
    </div>
  );
}
