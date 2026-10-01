// The attendance donut (Team dashboard): one small SVG ring with the total in the middle.
// Segments run clockwise from 12 o'clock. Server-safe.
import { resolveColor } from './chartColors';
import styles from './Donut.module.css';

const GAP = 1.5; // px of white between segments, as on the canvas

/**
 * @param {{
 *   segments: { label: string, value: number, color: string }[],
 *   centerValue?: import('react').ReactNode, centerLabel?: string,
 *   size?: number, thickness?: number, className?: string,
 * }} props
 */
export default function Donut({
  segments = [],
  centerValue,
  centerLabel,
  size = 132,
  thickness = 19,
  className = '',
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((s) => Number(s.value) > 0);
  const total = visible.reduce((sum, s) => sum + Number(s.value), 0);
  const gap = visible.length > 1 ? GAP : 0;
  const label = segments.map((s) => `${s.label} ${s.value}`).join(', ');

  const lengths = visible.map((segment) => (Number(segment.value) / total) * circumference);
  const arcs = visible.map((segment, index) => ({
    key: segment.label,
    color: resolveColor(segment.color),
    dash: `${Math.max(lengths[index] - gap, 0)} ${circumference}`,
    offset: -lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));

  return (
    <figure
      className={`${styles.donut} ${className}`}
      style={{ width: size, height: size }}
      aria-label={centerLabel ? `${centerValue ?? total} ${centerLabel}: ${label}` : label}
      role="img"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {total === 0 ? (
          <circle
            className={styles.track}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={thickness}
            fill="none"
          />
        ) : null}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={thickness}
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
            />
          ))}
        </g>
      </svg>
      {centerValue !== undefined || centerLabel ? (
        <figcaption className={styles.center}>
          {centerValue !== undefined ? <span className={styles.value}>{centerValue}</span> : null}
          {centerLabel ? <span className={styles.label}>{centerLabel}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
