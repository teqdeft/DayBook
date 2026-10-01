import styles from './DayToggleGroup.module.css';

export const WEEKDAYS = [
  { value: 1, label: 'Mon', name: 'Monday' },
  { value: 2, label: 'Tue', name: 'Tuesday' },
  { value: 3, label: 'Wed', name: 'Wednesday' },
  { value: 4, label: 'Thu', name: 'Thursday' },
  { value: 5, label: 'Fri', name: 'Friday' },
  { value: 6, label: 'Sat', name: 'Saturday' },
  { value: 7, label: 'Sun', name: 'Sunday' },
];

/**
 * Working-days picker (Settings): one checkbox per day drawn as a 52 x 40 button, dark when on
 * (narrower on phones, so the week stays on one row).
 * Controlled with `value` (ISO weekdays, 1 = Monday) + onChange(nextValues), or uncontrolled
 * inside a form with `name` + `defaultValue`.
 */
export default function DayToggleGroup({
  days = WEEKDAYS,
  value,
  defaultValue,
  onChange,
  name,
  disabled = false,
  label = 'Working days',
  className,
  ...rest
}) {
  const controlled = value !== undefined;
  const selected = new Set(controlled ? value : (defaultValue ?? []));

  // Read the boxes after the click, so this works controlled and uncontrolled.
  function handleChange(event) {
    const inputs = event.currentTarget.closest('[role="group"]').querySelectorAll('input');
    onChange(days.filter((day, index) => inputs[index]?.checked).map((day) => day.value));
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={[styles.group, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {days.map((day) => {
        const state = controlled
          ? { checked: selected.has(day.value), readOnly: !onChange }
          : { defaultChecked: selected.has(day.value) };
        return (
          <label key={day.value} className={styles.day} title={day.name}>
            <input
              type="checkbox"
              className={styles.input}
              name={name}
              value={day.value}
              disabled={disabled}
              aria-label={day.name ?? day.label}
              onChange={onChange ? handleChange : undefined}
              {...state}
            />
            <span className={styles.face} aria-hidden="true">
              {day.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
