import { cloneElement, isValidElement } from 'react';
import styles from './Field.module.css';

/**
 * Label + control + help or error text. The single child control gets aria-describedby and
 * aria-invalid wired to the help and error lines. Errors come from the API's `fields` map.
 */
export default function Field({ label, htmlFor, help, error, className, children, ...rest }) {
  const helpId = help && htmlFor ? `${htmlFor}-help` : undefined;
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  // Clone the child itself (not via Children.toArray, which adds a key): the control must keep the
  // same identity when help or error text appears, or React remounts it and typing is lost.
  let control = children;
  if (isValidElement(children) && (describedBy || error)) {
    const extra = {};
    if (describedBy) {
      extra['aria-describedby'] = [children.props['aria-describedby'], describedBy]
        .filter(Boolean)
        .join(' ');
    }
    if (error) extra['aria-invalid'] = true;
    control = cloneElement(children, extra);
  }

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')} {...rest}>
      {label ? (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {control}
      {help ? (
        <p className={styles.help} id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
