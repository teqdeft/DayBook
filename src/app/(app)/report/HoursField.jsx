// A project card's hours box ("Hours [ 6 ]"). In required timer mode (CONTRACT 15) the hours
// come from the timers: the box is read-only with a "From timers" hint the input points to.
import { Timer } from 'lucide-react';
import styles from './HoursField.module.css';

/**
 * @param {{ name: string, value: string, readOnly?: boolean, fromTimers?: boolean,
 *   errorId?: string | null, hintId: string, onChange: (value: string) => void }} props errorId
 *   is the id of the hours error shown under the card head, when there is one
 */
export default function HoursField({
  name,
  value,
  readOnly = false,
  fromTimers = false,
  errorId = null,
  hintId,
  onChange,
}) {
  const describedBy = [errorId, fromTimers ? hintId : null].filter(Boolean).join(' ');
  return (
    <label className={styles.hours}>
      {fromTimers ? (
        <span id={hintId} className={styles.hint}>
          <Timer size={14} strokeWidth={1.8} aria-hidden="true" />
          From timers
        </span>
      ) : null}
      <span className={styles.hoursLabel}>Hours</span>
      <input
        className={`${styles.hoursInput} ${fromTimers ? styles.fromTimers : ''}`}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder="0"
        aria-label={`Hours for ${name}`}
        readOnly={readOnly || fromTimers}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
