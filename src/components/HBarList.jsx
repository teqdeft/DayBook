// Horizontal bar list: label, a bar on a track, and the value ("Hours by project", "Team by
// department"). Plain CSS bars; server-safe.
import Link from 'next/link';
import { fraction, resolveColor } from './chartColors';
import styles from './HBarList.module.css';

/**
 * @param {{
 *   rows: { key?: string|number, label: string, value: number, display?: string, color?: string, href?: string }[],
 *   max?: number, barHeight?: number, labelWidth?: number, empty?: import('react').ReactNode,
 *   className?: string,
 * }} props
 *   `max` defaults to the largest value. `labelWidth` is the label column in px (144 on the
 *   dashboards, narrower in side cards).
 */
export default function HBarList({
  rows = [],
  max,
  barHeight = 12,
  labelWidth = 144,
  empty = null,
  className = '',
}) {
  if (rows.length === 0) return empty;
  const top = max ?? Math.max(0, ...rows.map((row) => Number(row.value) || 0));
  return (
    <ul
      className={`${styles.list} ${className}`}
      style={{ '--label-w': `${labelWidth}px`, '--bar-h': `${barHeight}px` }}
    >
      {rows.map((row, index) => {
        const share = fraction(row.value, top);
        const label = row.href ? (
          <Link href={row.href} className={styles.link}>
            {row.label}
          </Link>
        ) : (
          row.label
        );
        return (
          <li key={row.key ?? `${row.label}-${index}`} className={styles.row}>
            <span className={styles.label} title={row.label}>
              {label}
            </span>
            <span className={styles.track} aria-hidden="true">
              {share > 0 ? (
                <span
                  className={styles.fill}
                  style={{ width: `${share * 100}%`, background: resolveColor(row.color) }}
                />
              ) : null}
            </span>
            <span className={styles.value}>{row.display ?? row.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
