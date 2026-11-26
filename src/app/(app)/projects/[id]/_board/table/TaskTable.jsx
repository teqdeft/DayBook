'use client';
// The Table view of the Board tab (CONTRACT 28, Table and bulk bar): the board's tasks as rows in a
// white card, grouped by phase as the board's columns are, or listed flat while a header sorts them
// (the Phase column then shows; "Group by phase again" under the toolbar puts the groups back).
// Filters hide the rows that don't match (done rows too); "Show done tasks" adds the done rows. The
// project's PM and Admins select rows (at most 100) for the bulk bar and tick tasks; a row's person
// opens the people window; a click on a row opens the task window. On a phone the same rows are a
// stacked list of small cards. The Undo of a bulk action is this view's own toast.
import { useRef } from 'react';
import { useTaskWindow } from '@/components/task/TaskWindowProvider';
import UndoToast from '../../UndoToast';
import { useTaskActions } from '../TaskActionsProvider';
import BulkBar from './BulkBar';
import StackList from './StackList';
import TableGroup from './TableGroup';
import TableHead from './TableHead';
import TableRow from './TableRow';
import { rowTitle, shownIn } from './tableDom';
import { columnsFor, emptyText, tableRows } from './tableView';
import { useBulkActions } from './useBulkActions';
import { useRowFocus } from './useRowFocus';
import { useSelection } from './useSelection';
import { useTableSort } from './useTableSort';
import styles from './TaskTable.module.css';

const NONE = [];

/** The groups and rows in the order they are drawn. */
export const itemsOf = (view) =>
  view.flat
    ? view.rows.map((task) => ({ kind: 'row', task }))
    : view.groups.flatMap(({ column, rows }) => [
        { kind: 'group', column },
        ...rows.map((task) => ({ kind: 'row', task })),
      ]);

/**
 * Opening a row's task: the task window, with focus back on the row's title when it closes (or on
 * the table when the row has left meanwhile).
 */
function useOpenRow(board, rootRef) {
  const taskWindow = useTaskWindow();
  return (task, origin) => {
    if (!taskWindow) return board.openTask(task, origin);
    taskWindow.open(task.id, {
      origin,
      title: task.title,
      returnFocus: () => rowTitle(rootRef.current, task.id) ?? shownIn(rootRef.current, 'table'),
    });
  };
}

/** The table in its card: the header, then the group rows and the task rows, or the empty row. */
function TableCard({ board, keys, sort, items, empty, selection, onOpen, onPeople }) {
  return (
    <div className={styles.card}>
      <table className={styles.table} aria-label={`Tasks of ${board.projectName}`} tabIndex={-1}>
        <TableHead
          keys={keys}
          sort={sort}
          header={selection?.header}
          onToggleAll={selection?.toggleAll}
        />
        <tbody data-table-body="">
          {items.map((item) =>
            item.kind === 'group' ? (
              <TableGroup
                key={`group:${item.column.key}`}
                column={item.column}
                board={board}
                span={keys.length}
              />
            ) : (
              <TableRow
                key={`row:${item.task.id}`}
                task={item.task}
                keys={keys}
                board={board}
                selected={Boolean(selection?.has(item.task.id))}
                onToggle={selection?.toggle}
                onOpen={onOpen}
                onPeople={onPeople}
              />
            ),
          )}
          {empty ? (
            <tr>
              <td colSpan={keys.length} className={styles.empty}>
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** @param {{ board: object }} props board: the board object of useBoard (CONTRACT 28, Modules) */
export default function TaskTable({ board }) {
  const rootRef = useRef(null);
  const manage = board.access === 'manage';
  const actions = useTaskActions();
  const sort = useTableSort(board, rootRef);
  const view = tableRows(board, sort);
  const selection = useSelection(manage ? view.selectable : NONE);
  const bulk = useBulkActions({ board, selection, rootRef });
  useRowFocus(
    rootRef,
    view.rows.map((task) => task.id),
  );
  const shared = {
    board,
    items: itemsOf(view),
    empty: emptyText({
      rows: view.rows.length,
      filtering: Boolean(board.filters.any),
      access: board.access,
      total: board.tasks.length,
    }),
    selection: manage ? selection : null,
    onOpen: useOpenRow(board, rootRef),
    onPeople:
      manage && actions ? (task, anchor) => actions.openPeople({ tasks: [task], anchor }) : null,
  };
  const keys = columnsFor(board.access, board.filesAccess, { sorted: view.flat });
  return (
    <div ref={rootRef} className={styles.root}>
      <TableCard {...shared} keys={keys} sort={sort} />
      <StackList {...shared} />
      {manage ? (
        <>
          <BulkBar
            count={selection.count}
            busy={bulk.busy}
            onTake={bulk.takeAll}
            onGive={bulk.giveAll}
            onMove={bulk.moveAll}
            onClear={bulk.clear}
          />
          <UndoToast pending={bulk.undo.pending} onUndo={bulk.undo.run} onEnd={bulk.undo.end} />
        </>
      ) : null}
    </div>
  );
}
