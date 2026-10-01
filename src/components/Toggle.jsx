'use client';

import { useId } from 'react';
import styles from './Toggle.module.css';

/**
 * On/off switch (a real checkbox with role="switch"). With `label` it renders the settings row:
 * label and help on the left, switch on the right. Without a label, pass aria-label.
 * onChange receives (checked, event). Leave `checked` undefined to use `defaultChecked`.
 */
export default function Toggle({
  checked,
  defaultChecked,
  onChange,
  label,
  help,
  disabled = false,
  name,
  value,
  id,
  className,
  ...rest
}) {
  const autoId = useId();
  const inputId = id ?? `toggle-${autoId}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const controlled = checked !== undefined;
  const state = controlled
    ? { checked: Boolean(checked), readOnly: !onChange }
    : { defaultChecked: Boolean(defaultChecked) };

  const control = (
    <span className={styles.control}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className={styles.input}
        name={name}
        value={value}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={onChange ? (event) => onChange(event.target.checked, event) : undefined}
        {...state}
        {...rest}
      />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </span>
  );

  if (!label) {
    return <span className={[styles.bare, className].filter(Boolean).join(' ')}>{control}</span>;
  }

  return (
    <label
      htmlFor={inputId}
      className={[styles.row, disabled ? styles.disabled : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {help ? (
          <span className={styles.help} id={helpId}>
            {help}
          </span>
        ) : null}
      </span>
      {control}
    </label>
  );
}
