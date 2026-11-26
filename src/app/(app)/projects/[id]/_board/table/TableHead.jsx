'use client';
// The Table's header row (CONTRACT 28, Table and bulk bar: Columns, Sorting), 40 px, sticky while
// the page scrolls (not below a 1,280 px window): for the project's PM and Admins "Select all shown
// tasks" (checked when every shown open task is selected, mixed when only some) and the tick's
// visually hidden "Done"; then a button per column. The sorted header says its real direction
// (`aria-sort`) with a ChevronUp or ChevronDown.
import { useLayoutEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SELECT_ALL_ID } from './tableDom';
import { HEADERS } from './tableView';
import partStyles from './TableParts.module.css';
import styles from './TaskTable.module.css';

/** "Select all shown tasks": its mixed state is a DOM property (no attribute for it). */
function SelectAll({ header, onToggleAll }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = header.mixed;
  }, [header.mixed]);
  return (
    <label className={partStyles.select}>
      <input
        ref={ref}
        id={SELECT_ALL_ID}
        type="checkbox"
        aria-label="Select all shown tasks"
        checked={header.checked}
        disabled={header.disabled}
        onChange={(event) => onToggleAll(event.target.checked)}
      />
    </label>
  );
}

/** A column's header: a button that sorts by it. */
function SortHeader({ name, sort }) {
  const dir = sort.ariaSort(name);
  const Chevron = dir === 'ascending' ? ChevronUp : ChevronDown;
  return (
    <th scope="col" aria-sort={dir} className={styles[name === 'task' ? 'taskHead' : 'small']}>
      <button type="button" className={styles.sort} onClick={() => sort.sortBy(name)}>
        {HEADERS[name]}
        {dir ? <Chevron size={14} strokeWidth={1.8} aria-hidden="true" /> : null}
      </button>
    </th>
  );
}

/**
 * @param {{ keys: string[], sort: ReturnType<typeof import('./useTableSort').useTableSort>,
 *   header?: { checked: boolean, mixed: boolean, disabled: boolean },
 *   onToggleAll?: (on: boolean) => void }} props keys: columnsFor's
 */
export default function TableHead({ keys, sort, header, onToggleAll }) {
  return (
    <thead data-table-head="">
      <tr>
        {keys.map((name) => {
          if (name === 'select') {
            return (
              <th key={name} scope="col" className={styles.narrow}>
                <SelectAll header={header} onToggleAll={onToggleAll} />
              </th>
            );
          }
          if (name === 'tick') {
            return (
              <th key={name} scope="col" className={styles.narrow}>
                <span className="visually-hidden">Done</span>
              </th>
            );
          }
          return <SortHeader key={name} name={name} sort={sort} />;
        })}
      </tr>
    </thead>
  );
}
