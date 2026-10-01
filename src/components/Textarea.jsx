import inputStyles from './Input.module.css';
import styles from './Textarea.module.css';

/** Multi-line input with the same border, radius and states as Input. */
export default function Textarea({ error, rows = 3, className, ...rest }) {
  const classes = [
    inputStyles.control,
    styles.textarea,
    error ? inputStyles.invalid : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <textarea rows={rows} className={classes} aria-invalid={error ? true : undefined} {...rest} />
  );
}
