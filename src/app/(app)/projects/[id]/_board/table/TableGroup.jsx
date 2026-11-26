'use client';
// A phase's group row in the Table (CONTRACT 28, Table and bulk bar: Grouped by phase), 44 px on
// `--surface-muted`: the phase's name, "Current" on the current phase, "5 open", and for the
// project's PM and Admins on a project that isn't Completed "+ Add task" at the right (New task in
// that phase; "Add task to Testing" to a screen reader), never on a done phase or No phase yet.
// The phone's stacked list uses the same heading.
import { Plus } from 'lucide-react';
import Tag from '@/components/Tag';
import { canAddTo } from './tableView';
import styles from './TaskTable.module.css';

/**
 * The group's heading: name, Current, the open count and "+ Add task".
 * @param {{ column: object, board: object }} props column: one of the board's columns
 */
export function GroupHead({ column, board }) {
  return (
    <div className={styles.groupIn}>
      <h3 className={styles.groupName}>{column.label}</h3>
      {column.current ? <Tag tone="primary">Current</Tag> : null}
      <span className={styles.groupCount}>{column.open.length} open</span>
      {canAddTo(column, board) ? (
        <button type="button" className={styles.groupAdd} onClick={() => board.addTask(column.key)}>
          <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
          Add task<span className="visually-hidden"> to {column.label}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * @param {{ column: object, board: object, span: number }} props span: the table's column count
 */
export default function TableGroup({ column, board, span }) {
  return (
    <tr className={styles.group} data-flip={`group:${column.key}`}>
      <td colSpan={span}>
        <GroupHead column={column} board={board} />
      </td>
    </tr>
  );
}
