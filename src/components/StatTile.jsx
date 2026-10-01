import styles from './StatTile.module.css';

/** Grey box with a big number over a short label ("9:32 / Checked in" on Today). */
export default function StatTile({ value, label, className, ...rest }) {
  return (
    <div className={[styles.tile, className].filter(Boolean).join(' ')} {...rest}>
      <p className={styles.value}>{value}</p>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
