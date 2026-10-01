// The day bar. `large` is Today's "Your day" bar: an 18 px track filled from check-in to now (or
// check-out), a thin "now" marker, a marigold marker at report time and the time labels.
// `compact` is the Team board's 10 px bar, coloured per group. Server-safe.
import { dayjs, clockToMinutes, formatClockShort, formatTime, toLocal } from '@/lib/time';
import { resolveColor } from './chartColors';
import styles from './DayBar.module.css';

/**
 * @param {{
 *   checkInAt?: Date|string|null, checkOutAt?: Date|string|null, now: Date|string,
 *   start?: string, end?: string, tz: string, variant?: 'large'|'compact', color?: string,
 *   labels?: boolean | { at: string, text: string, strong?: boolean }[], reportAt?: string,
 *   className?: string,
 * }} props
 *   `start`, `end` and `reportAt` are 'HH:mm' clocks in the company time zone (`reportAt`
 *   defaults to `end`). Custom `labels` take `at` as a clock.
 */
export default function DayBar({
  checkInAt,
  checkOutAt,
  now,
  start = '09:30',
  end = '18:30',
  tz,
  variant = 'large',
  color = 'primary',
  labels = true,
  reportAt,
  className = '',
}) {
  const scale = makeScale({ checkInAt, now, start, end, tz });
  const inAt = checkInAt ? scale.minutesOf(checkInAt) : null;
  const outAt = checkOutAt ? scale.minutesOf(checkOutAt) : null;
  const nowAt = scale.minutesOf(now);
  const fillFrom = inAt === null ? null : scale.pct(inAt);
  const fillTo = inAt === null ? null : scale.pct(outAt ?? nowAt);
  const fill =
    fillFrom !== null && fillTo > fillFrom ? { left: fillFrom, width: fillTo - fillFrom } : null;
  const aria = describe({ checkInAt, checkOutAt, now, start, end, tz });

  if (variant === 'compact') {
    return (
      <div className={`${styles.compact} ${className}`} role="img" aria-label={aria}>
        {fill ? (
          <span
            className={styles.fill}
            style={{
              left: `${fill.left}%`,
              width: `${fill.width}%`,
              background: resolveColor(color),
            }}
          />
        ) : null}
      </div>
    );
  }

  const nowPct = scale.pct(nowAt);
  const showNow = inAt !== null && outAt === null;
  const reportPct = scale.pct(clockToMinutes(reportAt ?? end));
  const labelList = Array.isArray(labels)
    ? labels.map((l) => ({ ...l, pct: scale.pct(clockToMinutes(l.at)) }))
    : labels
      ? autoLabels({ scale, start, end, reportAt, nowPct, showNow, now, outAt, checkOutAt, tz })
      : [];

  return (
    <div className={`${styles.large} ${className}`}>
      <div className={styles.bar} role="img" aria-label={aria}>
        <div className={styles.track}>
          {fill ? (
            <span
              className={styles.fill}
              style={{
                left: `${fill.left}%`,
                width: `${fill.width}%`,
                background: resolveColor(color),
              }}
            />
          ) : null}
        </div>
        {showNow ? (
          <span className={styles.nowMark} style={{ left: `min(${nowPct}%, 100% - 2px)` }} />
        ) : null}
        <span
          className={styles.reportMark}
          style={{ left: `calc(${reportPct}% - ${(reportPct / 100) * 6}px)` }}
        />
      </div>
      {labelList.length > 0 ? (
        <div className={styles.labels} aria-hidden="true">
          {labelList.map((label) => (
            <span
              key={`${label.text}-${label.pct}`}
              className={`${styles.label} ${label.strong ? styles.strong : ''} ${styles[label.align ?? 'center']}`}
              style={label.align === 'end' ? undefined : { left: `${label.pct}%` }}
            >
              {label.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Positions on the bar: minutes after the start of the day the bar shows, as a percentage. */
function makeScale({ checkInAt, now, start, end, tz }) {
  const base = toLocal(checkInAt ?? now, tz).startOf('day');
  const startMin = clockToMinutes(start);
  const endMin = Math.max(clockToMinutes(end), startMin + 1);
  return {
    minutesOf: (at) => dayjs(at).diff(base, 'second') / 60,
    pct: (minutes) =>
      Math.min(100, Math.max(0, ((minutes - startMin) / (endMin - startMin)) * 100)),
  };
}

// Start time, 12:00 when it fits, "Now 3:10" (or "Out 6:34") and "6:30 report". Labels that would
// collide with the moving one are dropped.
function autoLabels({ scale, start, end, reportAt, nowPct, showNow, now, outAt, checkOutAt, tz }) {
  const moving = showNow
    ? { text: `Now ${formatTime(now, tz)}`, pct: nowPct, strong: true }
    : outAt !== null
      ? { text: `Out ${formatTime(checkOutAt, tz)}`, pct: scale.pct(outAt), strong: true }
      : null;
  const endText =
    (reportAt ?? end) === end ? `${formatClockShort(end)} report` : formatClockShort(end);
  const list = [
    { text: formatClockShort(start), pct: 0, align: 'start' },
    { text: endText, pct: 100, align: 'end' },
  ];
  const noon = scale.pct(12 * 60);
  if (noon > 0 && noon < 100) list.push({ text: '12:00', pct: noon });
  if (!moving) return list;
  const kept = list.filter((label) => Math.abs(label.pct - moving.pct) >= (label.align ? 14 : 12));
  const align = moving.pct < 7 ? 'start' : moving.pct > 93 ? 'end' : 'center';
  return [...kept, { ...moving, align }];
}

function describe({ checkInAt, checkOutAt, now, start, end, tz }) {
  const day = `Day ${formatClockShort(start)} to ${formatClockShort(end)}`;
  if (!checkInAt) return `${day}, not checked in`;
  const parts = [`${day}, checked in ${formatTime(checkInAt, tz)}`];
  parts.push(
    checkOutAt ? `checked out ${formatTime(checkOutAt, tz)}` : `now ${formatTime(now, tz)}`,
  );
  return parts.join(', ');
}
