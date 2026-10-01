import Link from 'next/link';
import styles from './IconButton.module.css';

/**
 * The 44 px square icon button (the bell). `label` is the accessible name; `dot` adds the red
 * unread dot. Renders a next/link when `href` is set.
 */
export default function IconButton({
  label,
  icon,
  dot = false,
  href,
  variant = 'secondary',
  type = 'button',
  className,
  ...rest
}) {
  const classes = [
    styles.iconButton,
    variant === 'ghost' ? styles.ghost : styles.secondary,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      {icon}
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label} title={label} {...rest}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} aria-label={label} title={label} {...rest}>
      {content}
    </button>
  );
}
