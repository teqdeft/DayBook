// The "Screen time" card for a range (Employee detail: the selected range; My log: the month):
// total active, daily average, idle and locked, and a small bar per day (active at the bottom,
// then idle, then locked). Someone who isn't tracked gets a note instead. Server-safe (no hooks).
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { StateLegend } from './DayTimeline';
import styles from './ScreenTimeCard.module.css';

const ORDER = ['active', 'idle', 'locked'];

/** The stacked parts of one bar, bottom up, as percentages of the tallest bar. */
function partsOf(bar, max) {
  const parts = [];
  let bottom = 0;
  for (const state of ORDER) {
    const height = (bar[state] / max) * 100;
    if (height > 0) {
      parts.push({ state, bottom, height });
      bottom += height;
    }
  }
  return parts;
}

function Bars({ bars, max, weekly }) {
  return (
    <div
      className={styles.chart}
      style={{ '--cols': Math.max(bars.length, 1) }}
      role="group"
      aria-label={weekly ? 'Screen time per week' : 'Screen time per day'}
    >
      {bars.map((bar) => (
        <div key={bar.key} className={styles.col}>
          <div
            className={`${styles.track} ${bar.future ? styles.future : ''}`}
            role="img"
            aria-label={bar.title}
            title={bar.title}
          >
            {partsOf(bar, max).map((part) => (
              <span
                key={part.state}
                className={`${styles.part} ${styles[part.state]}`}
                style={{ bottom: `${part.bottom}%`, height: `${part.height}%` }}
              />
            ))}
          </div>
          <span
            className={`${styles.label} ${bar.minor ? styles.minor : ''} ${bar.today ? styles.today : ''}`}
            aria-hidden="true"
          >
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * @param {{
 *   subtitle?: string,
 *   summary?: ReturnType<typeof import('./screenTimeView').rangeSummary> | null,
 *   note?: { title: string, body: string } | null, emptyText?: string, footnote?: string | null,
 *   className?: string,
 * }} props  `note` (someone who isn't tracked) replaces the numbers and the chart.
 */
export default function ScreenTimeCard({
  subtitle,
  summary,
  note,
  emptyText = 'No screen time recorded in this range.',
  footnote,
  className = '',
}) {
  return (
    <Card as="section" className={`${styles.card} ${className}`} aria-label="Screen time">
      <CardHeader title="Screen time" subtitle={subtitle} />
      {note || !summary ? (
        <EmptyState
          compact
          title={note?.title ?? 'No screen time'}
          body={note?.body}
          className={styles.note}
        />
      ) : (
        <>
          {summary.hasData ? (
            <>
              <ul className={styles.stats}>
                {summary.stats.map((stat) => (
                  <li key={stat.key} className={styles.stat}>
                    <span className={styles.statValue}>{stat.value}</span>
                    <span className={styles.statLabel}>{stat.label}</span>
                  </li>
                ))}
              </ul>
              <Bars bars={summary.bars} max={summary.max} weekly={summary.weekly} />
              <StateLegend className={styles.legend} />
            </>
          ) : (
            <p className={styles.empty}>{emptyText}</p>
          )}
          {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
        </>
      )}
    </Card>
  );
}
