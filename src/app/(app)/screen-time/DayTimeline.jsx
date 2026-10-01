// One person's day on the Screen time table: a compact bar with active (primary), idle (marigold)
// and locked (muted) blocks on a light hour grid; gaps (no data) stay empty. TimelineScale is the
// hour labels, shown in the column header (and under each bar on phones). No hooks, so it renders
// inside the client table and on the server alike.
import styles from './DayTimeline.module.css';

const STATE_CLASS = { active: styles.active, idle: styles.idle, locked: styles.locked };

/**
 * @param {{ ticks: { minute: number, pct: number, label: string|null, align: string }[],
 *   className?: string }} props
 */
export function TimelineScale({ ticks = [], className = '' }) {
  return (
    <span className={`${styles.scale} ${className}`} aria-hidden="true">
      {ticks
        .filter((tick) => tick.label)
        .map((tick, index) => (
          <span
            key={tick.minute}
            className={`${styles.tick} ${styles[tick.align] ?? ''} ${index % 2 ? styles.odd : ''}`}
            style={tick.align === 'end' ? undefined : { left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
    </span>
  );
}

const LEGEND = [
  { state: 'active', label: 'Active' },
  { state: 'idle', label: 'Idle' },
  { state: 'locked', label: 'Locked' },
];

/** The three colours (Active, Idle, Locked) in a row, for the bars and the day timeline. */
export function StateLegend({ className = '' }) {
  return (
    <ul className={`${styles.legend} ${className}`} aria-label="Colours">
      {LEGEND.map((item) => (
        <li key={item.state} className={styles.legendItem}>
          <span className={`${styles.swatch} ${STATE_CLASS[item.state]}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {{
 *   blocks: { state: 'active'|'idle'|'locked', left: number, width: number }[],
 *   ticks: { minute: number, pct: number, label: string|null, align: string }[],
 *   label: string, className?: string,
 * }} props  `label` describes the day for screen readers.
 */
export default function DayTimeline({ blocks = [], ticks = [], label, className = '' }) {
  return (
    <span className={`${styles.timeline} ${className}`}>
      <span className={styles.track} role="img" aria-label={label} title={label}>
        {ticks.map((tick) =>
          tick.pct > 0 && tick.pct < 100 ? (
            <span key={tick.minute} className={styles.hour} style={{ left: `${tick.pct}%` }} />
          ) : null,
        )}
        {blocks.map((block) => (
          <span
            key={`${block.state}-${block.left}`}
            className={`${styles.block} ${STATE_CLASS[block.state] ?? ''}`}
            style={{ left: `${block.left}%`, width: `${block.width}%` }}
          />
        ))}
      </span>
      <TimelineScale ticks={ticks} className={styles.phoneScale} />
    </span>
  );
}
