import styles from './EmptyState.module.css';

/**
 * Friendly empty list: a title, one line of help and at most one action
 * ("No reports yet this month."). Optional `icon` element sits in a soft circle above.
 */
export default function EmptyState({
  title,
  body,
  action,
  icon,
  compact = false,
  className,
  ...rest
}) {
  return (
    <div
      className={[styles.empty, compact ? styles.compact : null, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className={styles.title}>{title}</p>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
