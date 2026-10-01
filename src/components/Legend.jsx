import { toneColor } from './ProgressBar';
import styles from './Legend.module.css';

/**
 * Colour key for charts. `list`: one row per item with an optional value on the right
 * (My log's Attendance card). `inline`: items in a row (under the month calendar).
 */
export default function Legend({ items = [], layout = 'list', className, ...rest }) {
  const classes = [styles.legend, layout === 'inline' ? styles.inline : styles.list, className]
    .filter(Boolean)
    .join(' ');
  return (
    <ul className={classes} {...rest}>
      {items.map((item) => (
        <li key={item.key ?? item.label} className={styles.item}>
          <span
            className={styles.swatch}
            style={{ background: toneColor(item.color) }}
            aria-hidden="true"
          />
          <span className={styles.label}>{item.label}</span>
          {item.value !== undefined && item.value !== null ? (
            <span className={styles.value}>{item.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
