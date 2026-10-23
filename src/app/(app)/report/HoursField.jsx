// A project card's hours box ("Hours [ 6h 30m ]"). Time is exact to the minute (company request):
// the box shows '2h 15m' and takes '2h 15m', '2h15m', '2:15', '2.25', '2,25', '45m' or '2'; on
// leaving it, a valid entry is written out as '2h 15m'. In required timer mode (CONTRACT 15) the
// hours come from the timers: the box is read-only with a "From timers" hint the input points to.
import { Timer } from 'lucide-react';
import { normalizeHours } from './reportHours';
import styles from './HoursField.module.css';

/**
 * @param {{ name: string, value: string, readOnly?: boolean, fromTimers?: boolean,
 *   errorId?: string | null, hintId: string, onChange: (value: string) => void,
 *   onNormalize?: (value: string) => void }} props errorId is the id of the hours error shown
 *   under the card head, when there is one; onNormalize gets the tidy text ('2.25' -> '2h 15m')
 *   when the person leaves the box and it reads differently
 */
export default function HoursField({
  name,
  value,
  readOnly = false,
  fromTimers = false,
  errorId = null,
  hintId,
  onChange,
  onNormalize,
}) {
  const describedBy = [errorId, fromTimers ? hintId : null].filter(Boolean).join(' ');
  const locked = readOnly || fromTimers;
  function tidy() {
    if (locked || !onNormalize) return;
    const shown = normalizeHours(value);
    if (shown !== value) onNormalize(shown);
  }
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
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder="0h"
        aria-label={`Hours for ${name}`}
        readOnly={locked}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={tidy}
      />
    </label>
  );
}
