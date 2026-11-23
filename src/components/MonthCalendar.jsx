// Month attendance calendar (Employee detailed view, HR's person month): Mon–Fri columns of
// tinted day tiles and the legend. Server-safe.
import styles from './MonthCalendar.module.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TONE_LABELS = {
  office: 'Office',
  wfh: 'WFH',
  late: 'Late',
  missing: 'Not checked in',
  future: 'Upcoming',
  weekend: 'Day off',
  // CONTRACT 25: leave HR marked and company holidays, also on days to come
  leave: 'Leave',
  holiday: 'Holiday',
};

export const CALENDAR_LEGEND = [
  { tone: 'office', label: 'Office' },
  { tone: 'wfh', label: 'WFH' },
  { tone: 'late', label: 'Late' },
  { tone: 'missing', label: 'Not checked in' },
];

/** The two off tones (CONTRACT 25), to add to a legend: [...CALENDAR_LEGEND, ...OFF_LEGEND]. */
export const OFF_LEGEND = [
  { tone: 'leave', label: 'Leave' },
  { tone: 'holiday', label: 'Holiday' },
];

/**
 * @param {{
 *   weeks: { date?: string, day?: number|string, tone: 'office'|'wfh'|'late'|'missing'|'leave'|'holiday'|'future'|'empty'|'weekend', isToday?: boolean, title?: string }[][],
 *   weekdays?: string[], legend?: boolean, legendItems?: { tone: string, label: string }[],
 *   label?: string, className?: string,
 * }} props
 *   Each week is one row of five days (Monday to Friday). Use `tone: 'empty'` for days outside
 *   the month. `legendItems` replaces the legend (default CALENDAR_LEGEND); a tile's spoken
 *   status uses its legend word ("Absent" on HR's person month). `title` is a tile's tooltip
 *   ("Holiday: Diwali").
 */
export default function MonthCalendar({
  weeks = [],
  weekdays = WEEKDAYS,
  legend = true,
  legendItems = CALENDAR_LEGEND,
  label = 'Attendance calendar',
  className = '',
}) {
  const words = {
    ...TONE_LABELS,
    ...Object.fromEntries(legendItems.map((i) => [i.tone, i.label])),
  };
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
              <Day key={day.date ?? `${weekIndex}-${dayIndex}`} day={day} words={words} />
            ))}
          </div>
        ))}
      </div>
      {legend ? (
        <ul className={styles.legend}>
          {legendItems.map((item) => (
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

function Day({ day, words }) {
  if (!day || day.tone === 'empty' || day.day === undefined || day.day === null) {
    return <span className={styles.empty} role="cell" />;
  }
  const status = day.title ?? words[day.tone];
  const name = [day.date ?? String(day.day), status, day.isToday ? 'today' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <span
      className={`${styles.tile} ${styles[day.tone] ?? ''} ${day.isToday ? styles.today : ''}`}
      role="cell"
      aria-label={name}
      aria-current={day.isToday ? 'date' : undefined}
      title={day.title}
    >
      {day.day}
    </span>
  );
}
