// The Screen time table's pieces shared by both layouts: the state cell (Active green, Idle
// marigold, Locked line, Offline outlined grey) and, below 1280 px, the stacked person cards that
// replace the table (name and state, the day's numbers, the day bar with its hours). No hooks.
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import StatusCell from '@/components/StatusCell';
import DayTimeline from './DayTimeline';
import styles from './ScreenTimeCards.module.css';

const STATE_CELL = {
  active: { status: 'active', label: 'Active' },
  idle: { status: 'pending', label: 'Idle' },
  locked: { status: 'locked', label: 'Locked' },
  offline: { status: 'offline', label: 'Offline' },
};

/** The live state as the canvas's 30 px table cell (Attendance's "Where"). */
export function StateCell({ state, className = '' }) {
  const cell = STATE_CELL[state] ?? STATE_CELL.offline;
  return (
    <StatusCell
      status={cell.status}
      label={cell.label}
      size="cellCompact"
      as="span"
      className={`${styles.state} ${state === 'offline' ? styles.offline : ''} ${className}`}
    />
  );
}

/** A person's name (a link to their page) and designation, next to the avatar. */
export function PersonCell({ row }) {
  return (
    <span className={styles.person}>
      <Avatar user={row.user} size={34} />
      <span className={styles.personText}>
        <Link href={row.href} className={styles.personName}>
          {row.user.name}
        </Link>
        {row.user.designation ? (
          <span className={styles.personSub}>{row.user.designation}</span>
        ) : null}
      </span>
    </span>
  );
}

function metaText(row, isToday) {
  const parts = [];
  if (row.span) parts.push(`First to last active ${row.span}`);
  if (isToday && row.note) parts.push(row.note);
  if (!isToday && row.lastSeen) parts.push(`Last seen ${row.lastSeen}`);
  return parts.join(' · ');
}

/**
 * @param {{ rows: object[], isToday: boolean, ticks: object[], label: string,
 *   className?: string }} props
 */
export default function PersonCards({ rows, isToday, ticks, label, className = '' }) {
  return (
    <ul className={`${styles.cards} ${className}`} aria-label={label}>
      {rows.map((row) => {
        const meta = metaText(row, isToday);
        return (
          <li key={row.id} className={styles.card}>
            <div className={styles.top}>
              <PersonCell row={row} />
              {isToday ? <StateCell state={row.state} className={styles.cardState} /> : null}
            </div>
            <p className={styles.numbers}>
              {row.hasData ? (
                <>
                  <strong>{row.active}</strong> active · <strong>{row.idle}</strong> idle ·{' '}
                  <strong>{row.locked}</strong> locked
                </>
              ) : (
                'No screen time recorded'
              )}
            </p>
            {meta ? <p className={styles.meta}>{meta}</p> : null}
            <DayTimeline
              blocks={row.blocks}
              ticks={ticks}
              label={row.label}
              className={styles.timeline}
            />
          </li>
        );
      })}
    </ul>
  );
}
