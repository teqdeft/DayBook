'use client';
// The My tasks list (CONTRACT 28, My tasks: sidebar, page and home cards) in the Table's look: one
// table, "My tasks", with a group row per group ("Overdue 1" with the word in red, "Today 1", … or
// one per project) and the columns tick (a manager of that task's project; hidden header "Done"),
// #, Task, Project (with "On hold"), Phase, Due, Priority and Files. On a phone (640 px and below)
// the same groups as headings over a card list of rows (MyTaskRow). A row that leaves after a tick
// hands the focus to the next row's title, else the previous one's, else the list.
import PriorityTag from '@/components/PriorityTag';
import DueTag from '@/app/(app)/projects/[id]/DueTag';
import MyTaskRow, {
  MineClip,
  MinePhase,
  MineProject,
  MineTick,
  MineTitle,
  openFromRow,
} from './MyTaskRow';
import styles from './MyTasks.module.css';

const COLUMNS = 8;

/** One task as a table row. */
function TableRow({ task, today, onTick }) {
  return (
    <tr className={styles.row} data-flip={`mine:${task.id}`} onClick={openFromRow}>
      <td className={styles.tickCell}>
        {task.canManage ? <MineTick task={task} onTick={onTick} /> : null}
      </td>
      <td className={styles.fit}>
        <span className={styles.number}>#{task.id}</span>
      </td>
      <td>
        <MineTitle task={task} className={styles.title} />
      </td>
      <td className={styles.fit}>
        <MineProject task={task} />
      </td>
      <td className={styles.fit}>
        <MinePhase task={task} className={styles.phase} />
      </td>
      <td className={styles.fit}>
        <DueTag dueDate={task.dueDate} today={today} />
      </td>
      <td className={styles.fit}>
        <PriorityTag priority={task.priority} />
      </td>
      <td className={styles.fit}>
        <MineClip count={task.fileCount} />
      </td>
    </tr>
  );
}

/** A group's words: its label (red for Overdue) and how many tasks it holds. */
function GroupWords({ group }) {
  return (
    <>
      <span className={group.tone === 'red' ? styles.red : undefined}>{group.label}</span>{' '}
      <span className={styles.groupCount}>{group.tasks.length}</span>
    </>
  );
}

function Table({ groups, today, onTick }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="My tasks" tabIndex={-1} data-mine-list="">
        <thead>
          <tr>
            <th scope="col" className={styles.tickCell}>
              <span className="visually-hidden">Done</span>
            </th>
            <th scope="col" className={styles.fit}>
              #
            </th>
            <th scope="col">Task</th>
            {['Project', 'Phase', 'Due', 'Priority', 'Files'].map((name) => (
              <th key={name} scope="col" className={styles.fit}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr className={styles.groupRow} data-flip={`mine-group:${group.key}`}>
              <th scope="rowgroup" colSpan={COLUMNS}>
                <GroupWords group={group} />
              </th>
            </tr>
            {group.tasks.map((task) => (
              <TableRow key={task.id} task={task} today={today} onTick={onTick} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PhoneList({ groups, today, onTick }) {
  return (
    <div className={styles.stack} data-mine-list="" tabIndex={-1}>
      {groups.map((group) => (
        <section key={group.key} className={styles.stackGroup}>
          <h3 className={styles.stackHead} data-flip={`mine-group:${group.key}`}>
            <GroupWords group={group} />
          </h3>
          <ul className={styles.stackList}>
            {group.tasks.map((task) => (
              <MyTaskRow key={task.id} task={task} today={today} onTick={onTick} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * @param {{ groups: Array<{ key: string, label: string, tone: 'red' | null, tasks: object[] }>,
 *   today: string, onTick: Function }} props groups: myTasksView.groupsFor
 */
export default function MyTasksTable({ groups, today, onTick }) {
  return (
    <>
      <Table groups={groups} today={today} onTick={onTick} />
      <PhoneList groups={groups} today={today} onTick={onTick} />
    </>
  );
}
