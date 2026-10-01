import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import styles from './Button.module.css';

const VARIANT_CLASS = {
  primary: styles.primary,
  secondary: styles.secondary,
  dark: styles.dark,
  text: styles.text,
  danger: styles.danger,
  marigold: styles.marigold,
};

// default 44 px, compact 40 px, medium 38 px (Approve / Decline on request and correction
// cards), small 37 px; large 47 px and xl 50 px use 16 px text ("Submit report" on the Daily
// report, "Write today's report" on Today).
const SIZE_CLASS = {
  default: styles.sizeDefault,
  compact: styles.sizeCompact,
  medium: styles.sizeMedium,
  small: styles.sizeSmall,
  large: styles.sizeLarge,
  xl: styles.sizeXl,
};

// The text variant has no box; size sets its type: 15 px ("Edit", "Confirm"), compact 14 px
// ("Review", "Show 17 more"), small 13 px.
const TEXT_SIZE_CLASS = {
  compact: styles.textCompact,
  small: styles.textSmall,
};

/**
 * The one button. Renders a next/link when `href` is set, otherwise a <button>.
 * Icons are elements: icon={<Plus size={18} strokeWidth={1.8} />}.
 */
export default function Button({
  variant = 'primary',
  size = 'default',
  icon,
  iconRight,
  href,
  type = 'button',
  loading = false,
  fullWidth = false,
  disabled = false,
  className,
  children,
  ...rest
}) {
  const classes = [
    styles.button,
    VARIANT_CLASS[variant] ?? styles.primary,
    variant === 'text' ? TEXT_SIZE_CLASS[size] : (SIZE_CLASS[size] ?? styles.sizeDefault),
    fullWidth ? styles.fullWidth : null,
    loading ? styles.isLoading : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {loading ? (
        <LoaderCircle className={styles.spinner} size={18} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        icon
      )}
      {children !== undefined && children !== null && children !== false ? (
        <span className={styles.label}>{children}</span>
      ) : null}
      {iconRight}
    </>
  );

  if (href && !disabled && !loading) {
    return (
      <Link href={href} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
}
