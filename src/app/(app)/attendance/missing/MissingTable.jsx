'use client';
// The Missing check-outs table (CONTRACT 25, item 7). HR and Admins pick rows (a labelled "Select
// all on this page" in the card's head row, since the table head is hidden below 1024 px), type
// or keep each row's time, and fix or remind them one by one or together from the bulk bar. Rows
// that fail keep their message under the input, and focus moves to the first of them. PMs see
// Person, Day and Check-in only. Below 1280 px the rows are cards, so Fix and Remind never hide
// off to the side on a laptop.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import RemindSelectedButton from '../RemindSelectedButton';
import { useRemind } from '../useRemind';
import MissingFixDialog from './MissingFixDialog';
import {
  ActionCell,
  DayCell,
  OutCell,
  PersonCell,
  RemindedCell,
  SelectCell,
  SuggestedCell,
  inputIdOf,
} from './missingCells';
import styles from './MissingTable.module.css';

/** The columns: PMs get Person, Day and Check-in only (Check-in takes the rest of the row). */
function columnsFor(canCorrect, cells) {
  const base = [
    {
      key: 'person',
      header: 'Person',
      width: canCorrect ? 190 : 280,
      render: (row) => <PersonCell row={row} />,
    },
    {
      key: 'day',
      header: 'Day',
      width: canCorrect ? 112 : 180,
      render: (row) => <DayCell row={row} />,
    },
    {
      key: 'in',
      header: 'Check-in',
      width: canCorrect ? 84 : undefined,
      render: (row) => <span className={styles.checkTime}>{row.checkInText}</span>,
    },
  ];
  if (!canCorrect) return base;
  return [
    {
      key: 'select',
      header: <span className="visually-hidden">Select</span>,
      width: 58,
      className: styles.selCell,
      render: cells.select,
    },
    ...base,
    {
      key: 'suggested',
      header: 'Suggested',
      width: 150,
      render: (row) => <SuggestedCell row={row} />,
    },
    { key: 'out', header: 'Check-out', width: 150, render: cells.out },
    {
      key: 'reminded',
      header: 'Reminded',
      width: 130,
      render: (row) => <RemindedCell row={row} />,
    },
    {
      key: 'action',
      header: <span className="visually-hidden">Action</span>,
      label: 'Action',
      render: cells.action,
    },
  ];
}

/** The head row's right side while rows are selected (sticky at the bottom below 1024 px). */
function BulkBar({ count, users, onFix, onClear, fixRef }) {
  return (
    <div className={styles.bulk}>
      <span className={styles.bulkCount} role="status">
        {count} selected
      </span>
      <RemindSelectedButton users={users} className={styles.bulkButton} />
      <Button ref={fixRef} size="compact" onClick={onFix} className={styles.bulkButton}>
        Fix selected
      </Button>
      <Button
        variant="text"
        size="compact"
        onClick={onClear}
        className={`${styles.bulkButton} ${styles.bulkClear}`}
      >
        Clear
      </Button>
    </div>
  );
}

function SelectAll({ checked, mixed, disabled, onChange, inputRef }) {
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = mixed;
  }, [mixed, inputRef]);
  return (
    <label className={styles.selectAll}>
      <input
        ref={inputRef}
        type="checkbox"
        className={styles.check}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      Select all on this page
    </label>
  );
}

/** One person per remind, however many of their days are selected. */
function peopleOf(rows) {
  const byId = new Map(rows.map((row) => [row.userId, { id: row.userId, name: row.user.name }]));
  return [...byId.values()];
}

/** @param {{ rows: object[], canCorrect: boolean }} props rows from missingData.js */
export default function MissingTable({ rows, canCorrect }) {
  const router = useRouter();
  const { send } = useRemind();
  const [selected, setSelected] = useState(() => new Set());
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [fixing, setFixing] = useState(null);
  const focusNext = useRef(null);
  const selectAllRef = useRef(null);
  const fixRef = useRef(null);

  // Focus moves after the dialog has closed (and given focus back to its opener).
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return undefined;
    focusNext.current = null;
    const frame = requestAnimationFrame(() => target()?.focus());
    return () => cancelAnimationFrame(frame);
  });

  const valueOf = (row) => values[row.id] ?? row.suggestedClock ?? '';
  const selectable = rows.filter((row) => row.canAct);
  const chosen = selectable.filter((row) => selected.has(row.id));
  const focusInput = (id) => {
    focusNext.current = () => document.getElementById(inputIdOf({ id }));
  };

  function toggle(row, on) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
  }

  function setValue(row, value) {
    setValues((current) => ({ ...current, [row.id]: value }));
    setErrors(({ [row.id]: _gone, ...rest }) => rest);
  }

  function fixSelected() {
    const noTime = chosen.filter((row) => !valueOf(row));
    if (noTime.length > 0) {
      setErrors((current) => ({
        ...current,
        ...Object.fromEntries(noTime.map((row) => [row.id, 'Add a time.'])),
      }));
      focusInput(noTime[0].id);
      return;
    }
    setFixing(chosen.map((row) => ({ ...row, checkOut: valueOf(row) })));
  }

  function done({ fixed, failed }) {
    const fixedIds = new Set(fixed.map((item) => item.attendanceId));
    setSelected((current) => new Set([...current].filter((id) => !fixedIds.has(id))));
    setErrors((current) => {
      const kept = Object.entries(current).filter(([id]) => !fixedIds.has(Number(id)));
      const next = Object.fromEntries(kept);
      for (const item of failed) next[item.attendanceId] = item.message;
      return next;
    });
    setFixing(null);
    if (failed.length > 0) focusInput(failed[0].attendanceId);
    else focusNext.current = () => selectAllRef.current;
    router.refresh();
  }

  function clear() {
    setSelected(new Set());
    focusNext.current = () => selectAllRef.current;
  }

  const cells = {
    select: (row) => <SelectCell row={row} checked={selected.has(row.id)} onToggle={toggle} />,
    out: (row) => (
      <OutCell row={row} value={valueOf(row)} error={errors[row.id]} onChange={setValue} />
    ),
    action: (row) => (
      <ActionCell
        row={row}
        value={valueOf(row)}
        onRemind={(item) => send('missing_checkout', [{ id: item.userId, name: item.user.name }])}
      />
    ),
  };
  const all = selectable.length > 0 && chosen.length === selectable.length;

  return (
    <div className={chosen.length > 0 ? styles.bulkOn : undefined}>
      <div className={styles.head}>
        <h2 className={styles.title}>Still to fix</h2>
        {canCorrect && chosen.length > 0 ? (
          <BulkBar
            count={chosen.length}
            users={peopleOf(chosen)}
            onFix={fixSelected}
            onClear={clear}
            fixRef={fixRef}
          />
        ) : null}
        {canCorrect && chosen.length === 0 ? (
          <SelectAll
            checked={all}
            mixed={chosen.length > 0 && !all}
            disabled={selectable.length === 0}
            onChange={(on) => {
              setSelected(new Set(on ? selectable.map((row) => row.id) : []));
              // The bulk bar takes the checkbox's place: focus moves to Fix selected.
              if (on) focusNext.current = () => fixRef.current;
            }}
            inputRef={selectAllRef}
          />
        ) : null}
      </div>
      <DataTable
        columns={columnsFor(canCorrect, cells)}
        rows={rows}
        caption="Still to fix"
        className={styles.table}
        stackBelow={1280}
      />
      <MissingFixDialog rows={fixing} onClose={() => setFixing(null)} onDone={done} />
    </div>
  );
}
