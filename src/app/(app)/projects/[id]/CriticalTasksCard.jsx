// Critical tasks on the Overview: open P1s by due date, tasks without a date last, at most 5. Only the
// project's PM or Admin gets the checkbox. Server-safe.
import Button from '@/components/Button';
import Card from '@/components/Card';
import { phaseLabel } from '@/modules/projectPlan/phases';
import DueTag from './DueTag';
import { tabHref } from './ProjectTabs';
import TaskCheck from './TaskCheck';
import styles from './Overview.module.css';

const MAX_ROWS = 5;

/**
 * The open P1s, nearest due date first; tasks without a date come last and otherwise keep their
 * order.
 * @param {Array<{ priority: string, status: string, dueDate: string | null }>} tasks
 * @returns {object[]} all of them: the card shows the first 5 and counts the rest
 */
export function criticalTasks(tasks) {
  const rank = (task) => task.dueDate ?? '9999-99-99';
  return tasks
    .filter((task) => task.priority === 'p1' && task.status === 'open')
    .sort((a, b) => rank(a).localeCompare(rank(b)));
}

/** "Design · Riya Kapoor" */
function metaOf(task) {
  const phase = task.phase ? phaseLabel(task.phase) : 'No phase yet';
  return `${phase} · ${task.assignee?.name ?? 'Anyone on the project'}`;
}

/**
 * @param {{ projectId: number, tasks: object[], today: string, canManage: boolean }} props
 *   tasks: criticalTasks
 */
export default function CriticalTasksCard({ projectId, tasks, today, canManage }) {
  return (
    <Card
      as="section"
      padding="compact"
      aria-labelledby="overview-critical"
      className={`${styles.wideCard} ${styles.columnCard}`}
    >
      <div className={styles.titleRow}>
        <h2 id="overview-critical" className={styles.cardTitle}>
          Critical tasks
        </h2>
        <span className={styles.titleNote}>{tasks.length} open</span>
      </div>
      {tasks.length === 0 ? <p className={styles.noCritical}>No critical tasks open.</p> : null}
      <ul aria-label="Critical tasks" className={styles.criticalList}>
        {tasks.slice(0, MAX_ROWS).map((task) => (
          <li key={task.id} className={styles.criticalRow}>
            {canManage ? <TaskCheck taskId={task.id} title={task.title} /> : null}
            <span className={styles.criticalText}>
              <span className={styles.criticalTitle}>{task.title}</span>
              <span className={styles.criticalMeta}>{metaOf(task)}</span>
            </span>
            <DueTag dueDate={task.dueDate} today={today} />
          </li>
        ))}
      </ul>
      <div className={styles.seeAll}>
        <Button variant="text" size="compact" href={tabHref(projectId, 'phases')}>
          See all tasks
        </Button>
      </div>
    </Card>
  );
}
