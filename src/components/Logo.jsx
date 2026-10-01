// The Daybook mark (same geometry as public/icons/icon.svg) and the "daybook" wordmark.
import styles from './Logo.module.css';

/**
 * @param {{ size?: number, wordmark?: boolean, tone?: 'light' | 'dark', className?: string }} props
 *   tone 'light' = white wordmark (sidebar), 'dark' = ink wordmark (login, paper backgrounds).
 */
export default function Logo({ size = 32, wordmark = true, tone = 'light', className = '' }) {
  return (
    <span className={`${styles.logo} ${styles[tone] ?? ''} ${className}`}>
      <svg
        className={styles.mark}
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <rect className={styles.markBg} width="32" height="32" rx="9" />
        <rect className={styles.markLine} x="7.5" y="10.25" width="12.5" height="2.25" rx="1.125" />
        <rect className={styles.markGlyph} x="9" y="18.6" width="14" height="2" />
        <circle className={styles.markGlyph} cx="9" cy="19.6" r="2.9" />
        <circle className={styles.markDot} cx="23" cy="19.6" r="2.9" />
      </svg>
      {wordmark ? (
        <span
          className={styles.wordmark}
          style={size === 32 ? undefined : { fontSize: size * 0.75 }}
        >
          daybook
        </span>
      ) : (
        <span className="visually-hidden">Daybook</span>
      )}
    </span>
  );
}
