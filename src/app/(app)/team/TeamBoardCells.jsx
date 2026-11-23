// Team board cells that show live status (CONTRACT 15), today's to-do (CONTRACT 24) and why
// someone is off today (CONTRACT 25). No hooks: rendered by TeamBoard.
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import { formatTimeAmPm } from '@/lib/time';
import TodoPopover from './TodoPopover';
import styles from './TeamBoard.module.css';

/**
 * Check-in time with its "Late 38m" tag, and a marigold "On break" tag under it while the person
 * is on a break (hover shows since when). Someone off today shows their tag instead (CONTRACT
 * 25): "On leave" or "On leave, first half" teal, "Holiday" green, "Day off" neutral.
 * @param {{ row: { checkIn: string|null, late: string|null, onBreak?: boolean,
 *   breakSince?: string|null, offTag?: { label: string, tone: string } | null }, tz: string }}
 *   props
 */
export function CheckInCell({ row, tz }) {
  if (!row.checkIn && row.offTag) {
    return (
      <Tag tone={row.offTag.tone} padX={8}>
        {row.offTag.label}
      </Tag>
    );
  }
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
 * "Projects today" (CONTRACT 15 and 24). Before submit only the running timer's project shows
 * (green "Now" and its label; hover shows the timer's note), so planned projects never read as
 * worked; after submit the submitted projects with hours follow it (the timer's project isn't
 * repeated). Under them the to-do button "To-do: 2 of 5 done" with its popover, or muted
 * "No to-do yet" for someone checked in whose report isn't submitted and has no lines.
 * @param {{ row: { name: string, href: string, projects: { name: string, color: string }[],
 *   workingOn?: { name: string, color: string|null, note: string|null } | null,
 *   todo?: object | null, noTodo?: boolean } }} props
 */
export function ProjectsCell({ row }) {
  const current = row.workingOn ?? null;
  const others = current
    ? row.projects.filter((project) => project.name !== current.name)
    : row.projects;
  const labels =
    current || others.length ? (
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
    ) : null;
  const todo = row.todo ? (
    <TodoPopover todo={row.todo} person={{ name: row.name, href: row.href }} />
  ) : row.noTodo ? (
    <span className={styles.noTodo}>No to-do yet</span>
  ) : null;
  if (!labels && !todo) return null;
  return (
    <span className={styles.projects}>
      {labels}
      {todo}
    </span>
  );
}
