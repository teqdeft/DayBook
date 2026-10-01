import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './DateSwitcher.module.css';

function Step({ href, label, children }) {
  if (!href) {
    return (
      <span
        className={[styles.step, styles.disabled].join(' ')}
        aria-disabled="true"
        aria-label={label}
        role="link"
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={styles.step} aria-label={label} title={label} scroll={false}>
      {children}
    </Link>
  );
}

/**
 * "‹ September 2026 ›" in a 44 px bordered box. Arrows are links; a missing href (for example
 * no future months) shows a disabled arrow.
 */
export default function DateSwitcher({
  label,
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
  className,
  ...rest
}) {
  return (
    <div className={[styles.switcher, className].filter(Boolean).join(' ')} {...rest}>
      <Step href={prevHref} label={prevLabel ?? 'Previous'}>
        <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
      </Step>
      <span className={styles.label}>{label}</span>
      <Step href={nextHref} label={nextLabel ?? 'Next'}>
        <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
      </Step>
    </div>
  );
}
