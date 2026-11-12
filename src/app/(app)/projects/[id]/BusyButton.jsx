'use client';
// A Button with a spinner while it works that keeps keyboard focus (CONTRACT 22): aria-disabled, not
// disabled, and presses are ignored while busy. A disabled button drops focus to the page for the
// whole of an AI call (up to 55 s) and gives it back nowhere. Add file and the report's Polish button
// work the same way.
import { LoaderCircle } from 'lucide-react';
import Button from '@/components/Button';
import styles from './BusyButton.module.css';

/**
 * @param {{ busy: boolean, onClick: (event: import('react').MouseEvent) => void,
 *   className?: string, children: import('react').ReactNode }} props and any other Button prop
 *   (variant, size, aria-label); `loading` and `disabled` are never set, so focus stays
 */
export default function BusyButton({ busy, onClick, className, children, ...rest }) {
  return (
    <Button
      {...rest}
      className={[busy ? styles.busy : null, className].filter(Boolean).join(' ')}
      icon={
        busy ? (
          <LoaderCircle className={styles.spinner} size={18} strokeWidth={1.8} aria-hidden="true" />
        ) : undefined
      }
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
    >
      {children}
    </Button>
  );
}
