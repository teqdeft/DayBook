'use client';
// The Table on a phone (CONTRACT 28, Table and bulk bar: Phone, 640 px and below): no table, a
// stacked list with the same group headings, each task a small card (`data-flip="row:<id>"`): the
// select box (the project's PM and Admins, 44 px), "#9", the P tag and the status chip on one line;
// the title button; then the face, the due date and the paperclip. A tap on the card opens the task.
// Both this list and the table are drawn; CSS shows one, so nothing switches after hydration.
import PriorityTag from '@/components/PriorityTag';
import DueTag from '../../DueTag';
import CardFace from '../CardFace';
import { GroupHead } from './TableGroup';
import { FilesCount, SelectBox, StatusChip, TaskNumber } from './TableParts';
import { RowTitle, opensRow, rowMarks } from './TableRow';
import { statusText } from './tableView';
import styles from './StackList.module.css';

function StackCard({ task, board, selected, onToggle, onOpen, onPeople }) {
  const manage = board.access === 'manage';
  const done = task.status === 'done';
  const classes = [styles.card, selected ? styles.selected : null, done ? styles.done : null];
  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      data-flip={`row:${task.id}`}
      {...rowMarks(task)}
      onClick={(event) => {
        if (opensRow(event)) onOpen(task, event.currentTarget.querySelector('[data-row-title]'));
      }}
    >
      <div className={styles.line}>
        {manage && !done ? (
          <SelectBox task={task} checked={selected} onToggle={onToggle} className={styles.select} />
        ) : null}
        <TaskNumber id={task.id} />
        <PriorityTag priority={task.priority} />
        {statusText(task).tone ? <StatusChip task={task} /> : null}
      </div>
      <div className={styles.title}>
        <RowTitle task={task} onOpen={onOpen} withLine={false} />
      </div>
      <div className={styles.line}>
        <CardFace
          task={task}
          access={board.access}
          onOpen={manage && onPeople ? (button) => onPeople(task, button) : undefined}
        />
        <DueTag dueDate={task.dueDate} today={board.today} done={done} />
        <FilesCount task={task} />
      </div>
    </div>
  );
}

/**
 * @param {{ items: Array<{ kind: 'group', column: object } | { kind: 'row', task: object }>,
 *   board: object, empty: string | null, selection?: { has: (id: number) => boolean,
 *   toggle: (id: number, on: boolean) => void } | null,
 *   onOpen: (task: object, origin: HTMLElement | null) => void,
 *   onPeople?: (task: object, button: HTMLElement) => void }} props items: the groups and rows in
 *   order (TaskTable's); empty: the line for no rows
 */
export default function StackList({ items, board, empty, selection, onOpen, onPeople }) {
  return (
    <div className={styles.stack} data-stack="">
      {items.map((item) =>
        item.kind === 'group' ? (
          <div
            key={`group:${item.column.key}`}
            className={styles.group}
            data-flip={`group:${item.column.key}`}
          >
            <GroupHead column={item.column} board={board} />
          </div>
        ) : (
          <StackCard
            key={`row:${item.task.id}`}
            task={item.task}
            board={board}
            selected={Boolean(selection?.has(item.task.id))}
            onToggle={selection?.toggle}
            onOpen={onOpen}
            onPeople={onPeople}
          />
        ),
      )}
      {empty ? <p className={styles.empty}>{empty}</p> : null}
    </div>
  );
}
