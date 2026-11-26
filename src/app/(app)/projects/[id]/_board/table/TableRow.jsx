'use client';
// One task in the Table (CONTRACT 28, Table and bulk bar), 54 px: for the project's PM and Admins
// the select box and the tick (the check draws and the row leaves as a card does), then "#", the
// title (a button that opens the task window, with the newest report line under an open task's
// title), the phase while the rows are sorted, the person, P tag, due date, status, files and time,
// as the viewer's columns say. A click anywhere else on the row opens the task too. The row carries
// what the motion reads: `data-flip="row:<id>"`, and its person and phase (`data-person`,
// `data-phase`), so a bulk action's flash waits until the refresh draws the change.
import PriorityTag from '@/components/PriorityTag';
import { formatDuration } from '@/lib/time';
import DueTag from '../../DueTag';
import TaskCheck from '../../TaskCheck';
import { columnOf } from '../bandView';
import tickStyles from '../TaskTick.module.css';
import { FilesCount, PersonCell, SelectBox, StatusChip, TaskNumber } from './TableParts';
import { phaseText, rowLine } from './tableView';
import partStyles from './TableParts.module.css';
import styles from './TaskTable.module.css';

const CONTROLS = 'button, a, input, label, select, textarea, [role="menu"], [role="menuitem"]';

/** A click that should open the task: on the row itself, not on one of its controls. */
export const opensRow = (event) =>
  event.target instanceof Element &&
  event.currentTarget.contains(event.target) &&
  !event.target.closest(CONTROLS);

/** The values a row shows its person and phase by (what a bulk action's motion waits for). */
export const rowMarks = (task) => ({
  'data-person': task.assignee ? String(task.assignee.id) : 'anyone',
  'data-phase': columnOf(task),
});

/** The title button and, in the table, the report line under an open task's title. */
export function RowTitle({ task, onOpen, withLine = true }) {
  const line = withLine ? rowLine(task) : null;
  return (
    <>
      <button
        type="button"
        className={styles.title}
        data-row-title=""
        onClick={(event) => onOpen(task, event.currentTarget)}
      >
        {task.title}
      </button>
      {line ? <span className={`${styles.line} ${styles[line.tone]}`}>{line.text}</span> : null}
    </>
  );
}

/** Each column's cell. */
function cellOf(key, { task, board, selected, onToggle, onOpen, onPeople }) {
  const done = task.status === 'done';
  switch (key) {
    case 'select':
      return <SelectBox task={task} checked={selected} onToggle={onToggle} />;
    case 'tick':
      return (
        <TaskCheck
          taskId={task.id}
          title={task.title}
          done={done}
          className={tickStyles.tick}
          onChange={(next, saved, options) => board.tick(task, next, saved, options)}
        />
      );
    case 'num':
      return <TaskNumber id={task.id} />;
    case 'task':
      return <RowTitle task={task} onOpen={onOpen} />;
    case 'phase':
      return phaseText(task);
    case 'person':
      return <PersonCell task={task} access={board.access} onPeople={onPeople} />;
    case 'priority':
      return <PriorityTag priority={task.priority} />;
    case 'due':
      return <DueTag dueDate={task.dueDate} today={board.today} done={done} />;
    case 'status':
      return <StatusChip task={task} />;
    case 'files':
      return <FilesCount task={task} />;
    default:
      return task.minutes > 0 ? (
        <span className={partStyles.time}>{formatDuration(task.minutes)}</span>
      ) : null;
  }
}

const CELL_CLASS = { select: 'narrow', tick: 'narrow', task: 'taskCell' };

/**
 * @param {{ task: object, keys: string[], board: object, selected?: boolean,
 *   onToggle?: (id: number, on: boolean) => void,
 *   onOpen: (task: object, origin: HTMLElement | null) => void,
 *   onPeople?: (task: object, button: HTMLElement) => void }} props keys: columnsFor's
 */
export default function TableRow({
  task,
  keys,
  board,
  selected = false,
  onToggle,
  onOpen,
  onPeople,
}) {
  const done = task.status === 'done';
  const parts = {
    task,
    board,
    selected,
    onToggle,
    onOpen,
    onPeople: onPeople ? (button) => onPeople(task, button) : undefined,
  };
  return (
    <tr
      className={[styles.row, done ? styles.done : null, selected ? styles.selected : null]
        .filter(Boolean)
        .join(' ')}
      data-flip={`row:${task.id}`}
      {...rowMarks(task)}
      onClick={(event) => {
        if (opensRow(event)) {
          onOpen(task, event.currentTarget.querySelector('[data-row-title]'));
        }
      }}
    >
      {keys.map((key) => (
        <td key={key} className={styles[CELL_CLASS[key] ?? 'small']}>
          {cellOf(key, parts)}
        </td>
      ))}
    </tr>
  );
}
