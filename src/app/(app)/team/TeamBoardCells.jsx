// Team board cells that show live status (CONTRACT 15). No hooks: rendered by TeamBoard.
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import { formatTimeAmPm } from '@/lib/time';
import styles from './TeamBoard.module.css';

/**
 * Check-in time with its "Late 38m" tag, and a marigold "On break" tag under it while the person
 * is on a break (hover shows since when).
 * @param {{ row: { checkIn: string|null, late: string|null, onBreak?: boolean,
 *   breakSince?: string|null }, tz: string }} props
 */
export function CheckInCell({ row, tz }) {
  if (!row.checkIn) return <span className={styles.dash}>—</span>;
  const time = (
    <span className={styles.checkIn}>
      <span className={styles.time}>{row.checkIn}</span>
      {row.late ? (
        <Tag tone="marigold" padX={8}>
          {row.late}
        </Tag>
      ) : null}
    </span>
  );
  if (!row.onBreak) return time;
  const since = row.breakSince ? formatTimeAmPm(row.breakSince, tz) : null;
  return (
    <span className={styles.checkInStack}>
      {time}
      <Tag tone="marigold" padX={8} dot title={since ? `On break since ${since}` : undefined}>
        On break
      </Tag>
    </span>
  );
}

/**
 * The projects on today's submitted report. While a timer runs, a "Now" tag and that project
 * come first (once: it isn't repeated from the report); hover shows the timer's note.
 * @param {{ row: { projects: { name: string, color: string }[], report: string,
 *   workingOn?: { name: string, color: string|null, note: string|null } | null } }} props
 */
export function ProjectsCell({ row }) {
  const current = row.workingOn ?? null;
  const others = current
    ? row.projects.filter((project) => project.name !== current.name)
    : row.projects;
  if (!current && others.length === 0) {
    return row.report === 'missing' ? <span className={styles.muted}>No report yet</span> : null;
  }
  return (
    <span className={styles.labels}>
      {current ? (
        <span
          className={styles.now}
          title={current.note ? `Now on ${current.name}: ${current.note}` : undefined}
        >
          <Tag tone="green" padX={8} dot>
            Now
          </Tag>
          <ProjectLabel project={current} />
        </span>
      ) : null}
      {others.map((project) => (
        <ProjectLabel key={project.name} project={project} />
      ))}
    </span>
  );
}
