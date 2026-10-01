// Month attendance calendar (Employee detailed view): Mon–Fri columns of tinted day tiles and the
// legend. Server-safe.
import styles from './MonthCalendar.module.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TONE_LABELS = {
  office: 'Office',
  wfh: 'WFH',
  late: 'Late',
  missing: 'Not checked in',
  future: 'Upcoming',
  weekend: 'Day off',
};

export const CALENDAR_LEGEND = [
  { tone: 'office', label: 'Office' },
  { tone: 'wfh', label: 'WFH' },
  { tone: 'late', label: 'Late' },
  { tone: 'missing', label: 'Not checked in' },
];

/**
 * @param {{
 *   weeks: { date?: string, day?: number|string, tone: 'office'|'wfh'|'late'|'missing'|'future'|'empty'|'weekend', isToday?: boolean }[][],
 *   weekdays?: string[], legend?: boolean, label?: string, className?: string,
 * }} props
 *   Each week is one row of five days (Monday to Friday). Use `tone: 'empty'` for days outside
 *   the month.
 */
export default function MonthCalendar({
  weeks = [],
  weekdays = WEEKDAYS,
  legend = true,
  label = 'Attendance calendar',
  className = '',
}) {
  return (
    <div className={`${styles.calendar} ${className}`}>
      <div className={styles.grid} role="table" aria-label={label}>
        <div className={styles.row} role="row">
          {weekdays.map((name) => (
            <span key={name} className={styles.weekday} role="columnheader">
              {name}
            </span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={week.find((d) => d.date)?.date ?? weekIndex} className={styles.row} role="row">
            {week.map((day, dayIndex) => (
              <Day key={day.date ?? `${weekIndex}-${dayIndex}`} day={day} />
            ))}
          </div>
        ))}
      </div>
      {legend ? (
        <ul className={styles.legend}>
          {CALENDAR_LEGEND.map((item) => (
            <li key={item.tone} className={styles.legendItem}>
              <span className={`${styles.dot} ${styles[`dot-${item.tone}`]}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Day({ day }) {
  if (!day || day.tone === 'empty' || day.day === undefined || day.day === null) {
    return <span className={styles.empty} role="cell" />;
  }
  const status = TONE_LABELS[day.tone];
  const name = [day.date ?? String(day.day), status, day.isToday ? 'today' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <span
      className={`${styles.tile} ${styles[day.tone] ?? ''} ${day.isToday ? styles.today : ''}`}
      role="cell"
      aria-label={name}
      aria-current={day.isToday ? 'date' : undefined}
    >
      {day.day}
    </span>
  );
}
