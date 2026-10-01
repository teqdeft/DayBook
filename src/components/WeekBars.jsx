// Column chart for one week: Today's "This week" (hours per day, today partly filled in a lighter
// primary, future days as an empty track) and Overview's stacked "Attendance this week".
// Server-safe.
import { fraction, resolveColor } from './chartColors';
import styles from './WeekBars.module.css';

/**
 * @param {{
 *   days: {
 *     label: string, value?: number | null, display?: string | null, max?: number,
 *     highlight?: boolean, faded?: boolean, color?: string,
 *     segments?: { value: number, color: string, label?: string }[],
 *   }[],
 *   height?: number, barWidth?: number, max?: number, showValues?: boolean, className?: string,
 * }} props
 *   `segments` stack from the bottom (first segment at the bottom). `highlight` marks today (bold
 *   label), `faded` draws the fill in the lighter primary (a day still in progress). `max` is the
 *   value of a full bar (defaults to the largest day). `showValues` defaults to true when any day
 *   has a `display` value.
 */
export default function WeekBars({
  days = [],
  height = 110,
  barWidth = 34,
  max,
  showValues,
  className = '',
}) {
  const totals = days.map((day) =>
    day.segments ? day.segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0) : day.value,
  );
  const top = max ?? Math.max(0, ...totals.map((v) => Number(v) || 0));
  const withValues = showValues ?? days.some((day) => day.display !== undefined);

  return (
    <div
      className={`${styles.chart} ${withValues ? styles.withValues : ''} ${className}`}
      style={{
        gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))`,
        '--bar-h': `${height}px`,
        '--bar-w': `${barWidth}px`,
      }}
    >
      {days.map((day, index) => {
        const dayMax = day.max ?? top;
        return (
          <div key={`${day.label}-${index}`} className={styles.day}>
            <div className={styles.track} role="img" aria-label={describe(day, totals[index])}>
              {day.segments ? (
                <Segments segments={day.segments} max={dayMax} />
              ) : fraction(day.value, dayMax) > 0 ? (
                <span
                  className={`${styles.fill} ${day.faded ? styles.faded : ''}`}
                  style={{
                    height: `${fraction(day.value, dayMax) * 100}%`,
                    ...(day.color ? { background: resolveColor(day.color) } : {}),
                  }}
                />
              ) : null}
            </div>
            <span className={`${styles.label} ${day.highlight ? styles.today : ''}`}>
              {day.label}
            </span>
            {withValues ? (
              <span className={`${styles.value} ${day.display ? '' : styles.none}`}>
                {day.display || '—'}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Segments({ segments, max }) {
  const shares = segments.map((segment) => fraction(segment.value, max));
  return segments.map((segment, index) => {
    const share = shares[index];
    const bottom = Math.min(
      1,
      shares.slice(0, index).reduce((sum, s) => sum + s, 0),
    );
    if (share <= 0 || bottom >= 1) return null;
    return (
      <span
        key={segment.label ?? index}
        className={styles.segment}
        style={{
          bottom: `${bottom * 100}%`,
          height: `${Math.min(share, 1 - bottom) * 100}%`,
          background: resolveColor(segment.color),
        }}
      />
    );
  });
}

function describe(day, total) {
  if (day.segments) {
    const parts = day.segments.map((s) => `${s.label ?? s.color} ${s.value}`).join(', ');
    return `${day.label}: ${parts}`;
  }
  return `${day.label}: ${day.display || (total ? String(total) : 'nothing yet')}`;
}
