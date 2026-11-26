'use client';
// The muted line under the board's toolbar (CONTRACT 28, How filters work): while something is
// filtered, how many open tasks match ("3 tasks match. The others are faded." on the Board, "3
// tasks match." in the Table) with "Clear all" ("Show everyone" when only a face is on); a
// member's note ("Only your tasks and tasks for anyone on the project are shown. Progress counts
// all 33 tasks."); and, while the Table is sorted, "Group by phase again" (the rows slide back into
// their groups, as a sort does). Both buttons go when they are pressed, so each hands the focus on:
// Clear all to the search, "Group by phase again" to the switch's Table button. The status element
// is drawn from the first render, so its first change is read out.
import { filterLine } from './boardFilters';
import { memberNote, viewButtonId } from './boardView';
import { progressOf } from './bandView';
import { SEARCH_ID } from './BoardSearch';
import styles from './FilterLine.module.css';
import { flipRows } from './table/useTableSort';

/** A control that stays takes the focus of the one that just went. */
const focusOn = (id) => document.getElementById(id)?.focus({ preventScroll: true });

/** @param {{ board: object }} props board: useBoard's (`filters`, `view`, `tableSort`, ...) */
export default function FilterLine({ board }) {
  const { filters, view, tableSort } = board;
  const count = board.tasks.filter(
    (task) => task.status !== 'done' && filters.matches(task),
  ).length;
  const line = filterLine({ count, view, filters: filters.state });
  const member = board.access === 'member';
  const regroup = view === 'table' && Boolean(tableSort?.key);
  const shown = Boolean(line || member || regroup);
  return (
    <div className={styles.line} data-shown={shown ? '' : undefined}>
      {member ? <span>{memberNote(progressOf(board.counts).total)}</span> : null}
      <span role="status">{line?.text ?? ''}</span>
      {line ? (
        <button
          type="button"
          className={styles.text}
          onClick={() => {
            filters.clear();
            focusOn(SEARCH_ID);
          }}
        >
          {line.clear}
        </button>
      ) : null}
      {regroup ? (
        <button
          type="button"
          className={styles.text}
          onClick={() => {
            flipRows(() => tableSort.clear());
            focusOn(viewButtonId('table'));
          }}
        >
          Group by phase again
        </button>
      ) : null}
    </div>
  );
}
