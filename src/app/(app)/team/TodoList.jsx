// Someone's to-do for today, read-only (CONTRACT 24): per project, each line with a filled green
// check (done) or an empty circle (red while blocked), then its tags as on Today ("From
// Wednesday", "Blocked", "Now"). The Team board's popover uses the compact look, the Employee
// detail's "Today's to-do" card the card look. No hooks, so Server Components can render it.
import { Circle, CircleCheck } from 'lucide-react';
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import styles from './TodoList.module.css';

/**
 * The Employee detail card's subtitle: '2 of 5 done · Posted at 9:41 AM', '2 of 5 done · Not
 * posted' (the Slack part only while to-dos are posted, `post` not null), null without lines.
 * @param {{ total: number, done: number, post: { postedAt: string|null, at: string|null } | null }}
 *   todo
 */
export function todoCardSubtitle(todo) {
  if (!todo?.total) return null;
  const done = `${todo.done} of ${todo.total} done`;
  if (!todo.post) return done;
  const posted = todo.post.postedAt && todo.post.at ? `Posted at ${todo.post.at}` : 'Not posted';
  return `${done} · ${posted}`;
}

/** What a screen reader hears before the title (the icon is hidden from it). */
function stateWords(line) {
  if (line.done) return 'Done: ';
  if (line.status === 'blocked') return 'Blocked: ';
  return 'Not done yet: ';
}

function LineIcon({ line, size }) {
  if (line.done) {
    return (
      <CircleCheck className={styles.iconDone} size={size} strokeWidth={1.8} aria-hidden="true" />
    );
  }
  const tone = line.status === 'blocked' ? styles.iconBlocked : styles.iconOpen;
  return <Circle className={tone} size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function LineTags({ line, padX }) {
  return (
    <>
      {line.carriedFrom?.dayLabel ? (
        <Tag tone="neutral" padX={padX} className={styles.tag}>
          {line.carriedFrom.dayLabel}
        </Tag>
      ) : null}
      {line.status === 'blocked' ? (
        <Tag tone="red" padX={padX} className={styles.tag}>
          Blocked
        </Tag>
      ) : null}
      {line.now ? (
        <Tag tone="green" padX={padX} dot className={styles.tag}>
          Now
        </Tag>
      ) : null}
    </>
  );
}

/**
 * @param {{
 *   groups: { entryId?: number, project?: { id: number, name: string, color: string|null },
 *     request?: { id: number, name: string }, lines: { id: number, title: string,
 *     status: 'done'|'in_progress'|'blocked', done: boolean, now?: boolean,
 *     carriedFrom?: { workDate: string, dayLabel: string|null } | null }[] }[],
 *   variant?: 'popover'|'card', className?: string,
 * }} props groups as dashboard todoOf() gives them (getTeamToday row.todo.groups,
 *   getEmployeeDetail todoToday.groups); a project request shows its name on a plain label
 */
export default function TodoList({ groups, variant = 'popover', className = '' }) {
  const card = variant === 'card';
  return (
    <div className={`${styles.list} ${card ? styles.card : styles.popover} ${className}`}>
      {groups.map((group, index) => {
        const project = group.project ?? { name: group.request?.name ?? '', color: null };
        return (
          <section
            key={group.entryId ?? `${project.name}-${index}`}
            className={styles.group}
            aria-label={project.name}
          >
            <ProjectLabel project={project} size={card ? 'md' : 'sm'} />
            <ul className={styles.lines}>
              {group.lines.map((line) => (
                <li key={line.id} className={styles.line}>
                  <span className={styles.icon}>
                    <LineIcon line={line} size={card ? 17 : 16} />
                  </span>
                  <span className={styles.text}>
                    <span className="visually-hidden">{stateWords(line)}</span>
                    {line.title}
                    <LineTags line={line} padX={card ? 8 : 7} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
