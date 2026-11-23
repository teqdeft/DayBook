'use client';
// The cells of the Missing check-outs table (CONTRACT 25, item 7): the row's checkbox, the person,
// the day, the suggestion (with "Asked HR for 7:10 PM"), the check-out input with its row error,
// the reminder line and the actions (Fix and Remind, or why there are none).
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Input from '@/components/Input';
import ReminderNote from '../ReminderNote';
import RowAction from '../RowAction';
import styles from './MissingTable.module.css';

/** The id of a row's check-out input (focus moves there on errors). */
export const inputIdOf = (row) => `missing-out-${row.id}`;

const label = (row) => `${row.user.name}, ${row.dayLabel}`;

/** 18 px checkbox with a 44 px hit area. */
export function SelectCell({ row, checked, onToggle }) {
  return (
    <label className={styles.checkHit}>
      <input
        type="checkbox"
        className={styles.check}
        checked={checked}
        disabled={!row.canAct}
        onChange={(event) => onToggle(row, event.target.checked)}
        aria-label={`Select ${label(row)}`}
      />
    </label>
  );
}

export function PersonCell({ row }) {
  return (
    <span className={styles.person}>
      <Avatar user={row.user} size={34} />
      <span className={styles.personText}>
        <span className={styles.personName}>{row.user.name}</span>
        {row.user.designation ? (
          <span className={styles.personRole}>{row.user.designation}</span>
        ) : null}
      </span>
    </span>
  );
}

export function DayCell({ row }) {
  return (
    <span className={styles.stack}>
      <span className={styles.time}>{row.dayLabel}</span>
      {row.relLabel ? <span className={styles.mline}>{row.relLabel}</span> : null}
    </span>
  );
}

export function SuggestedCell({ row }) {
  return (
    <span className={styles.stack}>
      {row.suggestedText ? (
        <span className={styles.time}>{row.suggestedText}</span>
      ) : (
        <span className={styles.muted}>None</span>
      )}
      {row.pendingText ? <span className={styles.mline}>{row.pendingText}</span> : null}
    </span>
  );
}

/** The 120 px time input, prefilled with the suggestion; the row's error under it. */
export function OutCell({ row, value, error, onChange }) {
  const errorId = `${inputIdOf(row)}-error`;
  return (
    <span className={styles.stack}>
      <Input
        id={inputIdOf(row)}
        type="time"
        compact
        className={styles.outInput}
        value={value}
        onChange={(event) => onChange(row, event.target.value)}
        disabled={!row.canAct}
        error={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-label={`Check-out for ${row.user.name} on ${row.dayLabel}`}
      />
      {error ? (
        <span id={errorId} className={styles.rowError}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function RemindedCell({ row }) {
  if (!row.reminded) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.reminded}>
      <ReminderNote reminded={row.reminded} nextAt={row.nextAt} bare />
    </span>
  );
}

/** Fix (RowAction, prefilled from the row's input) and Remind; or why the row has none. */
export function ActionCell({ row, value, onRemind }) {
  if (row.own) return <span className={styles.actionNote}>Your own. Fix it from Today.</span>;
  if (!row.canAct) return <span className={styles.actionNote}>Handle it under Corrections</span>;
  const fixRow = {
    attendanceId: row.id,
    userId: row.userId,
    name: row.user.name,
    workDate: row.workDate,
    dayLabel: row.dayLabel,
    checkIn: row.checkIn,
    checkOut: value || null,
    location: row.location,
    suggestedText: row.suggestedText,
    isToday: row.isToday,
  };
  return (
    <span className={styles.actions}>
      <RowAction
        kind="fix"
        row={fixRow}
        variant="text"
        size="small"
        className={styles.actionButton}
      />
      <Button
        variant="text"
        size="small"
        className={styles.actionButton}
        onClick={() => onRemind(row)}
        aria-label={`Remind ${row.user.name} about ${row.dayLabel}`}
      >
        Remind
      </Button>
    </span>
  );
}
