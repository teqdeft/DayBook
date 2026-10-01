import styles from './Input.module.css';

/**
 * Text input: 44 px (40 px with `compact`), 10 px radius, 1 px --line-strong border.
 * `error` (true or a message) gives the red state; show the message with Field.
 */
export default function Input({ error, compact = false, type = 'text', className, ...rest }) {
  const classes = [
    styles.control,
    compact ? styles.compact : null,
    error ? styles.invalid : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <input type={type} className={classes} aria-invalid={error ? true : undefined} {...rest} />
  );
}
