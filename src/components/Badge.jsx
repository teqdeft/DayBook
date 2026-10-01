import styles from './Badge.module.css';

const TONE_CLASS = {
  marigold: styles.marigold,
  primary: styles.primary,
  red: styles.red,
  neutral: styles.neutral,
};

/**
 * Round count badge: the marigold "2" next to a card title (26 px) or a nav item (22 px).
 * Pass `label` ("2 waiting") when the number alone would not make sense to a screen reader.
 */
export default function Badge({
  children,
  tone = 'marigold',
  size = 26,
  label,
  className,
  style,
  ...rest
}) {
  return (
    <span
      className={[styles.badge, TONE_CLASS[tone] ?? styles.marigold, className]
        .filter(Boolean)
        .join(' ')}
      style={{
        minWidth: `${size}px`,
        height: `${size}px`,
        fontSize: size <= 22 ? '12px' : '13px',
        ...style,
      }}
      {...rest}
    >
      {label ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="visually-hidden">{label}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}
