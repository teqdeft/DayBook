// People while it loads: title, department pills and the table's shape.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const PILLS = [72, 134, 76, 97, 67, 81, 113];
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

export default function PeopleLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading people</span>
      <div className={styles.topbar}>
        <div className={styles.heading}>
          <Skeleton width={120} height={30} radius={8} />
          <Skeleton width={170} height={16} />
        </div>
        <Skeleton width={150} height={44} radius={10} className={styles.action} />
      </div>
      <div className={styles.pills}>
        {PILLS.map((width, i) => (
          <Skeleton key={i} width={width} height={36} radius={18} />
        ))}
      </div>
      <Card padding="none">
        <div className={styles.tableHead} />
        {ROWS.map((i) => (
          <div key={i} className={styles.row}>
            <Skeleton width={34} height={34} radius={17} />
            <span className={styles.name}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="80%" height={12} />
            </span>
            <Skeleton width={120} height={14} className={styles.hideSmall} />
            <Skeleton width={90} height={14} className={styles.hideSmall} />
            <Skeleton width={78} height={26} radius={13} />
          </div>
        ))}
      </Card>
    </div>
  );
}
