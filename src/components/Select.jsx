import inputStyles from './Input.module.css';
import styles from './Select.module.css';

/**
 * Native select styled like Input (the browser draws the arrow, as on the canvas).
 * Pass `options` ([{ value, label, disabled? }]) or <option> children.
 */
export default function Select({ options, error, compact = false, className, children, ...rest }) {
  const classes = [
    inputStyles.control,
    styles.select,
    compact ? inputStyles.compact : null,
    error ? inputStyles.invalid : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <select className={classes} aria-invalid={error ? true : undefined} {...rest}>
      {options
        ? options.map((option) => (
            <option key={String(option.value)} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))
        : children}
    </select>
  );
}
