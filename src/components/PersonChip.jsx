'use client';

import { X } from 'lucide-react';
import Avatar from './Avatar';
import styles from './PersonChip.module.css';

/** Avatar + name in a rounded chip, with a remove button when onRemove is given (project drawer). */
export default function PersonChip({
  user,
  onRemove,
  removeLabel,
  tone,
  disabled = false,
  className,
  ...rest
}) {
  return (
    <span
      className={[styles.chip, onRemove ? null : styles.static, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Avatar user={user} size={24} tone={tone} />
      <span className={styles.name}>{user?.name}</span>
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          onClick={() => onRemove(user)}
          disabled={disabled}
          aria-label={removeLabel ?? `Remove ${user?.name ?? 'person'}`}
          title={removeLabel ?? `Remove ${user?.name ?? 'person'}`}
        >
          <X size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
