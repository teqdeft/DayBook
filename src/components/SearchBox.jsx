'use client';

import { Search } from 'lucide-react';
import styles from './SearchBox.module.css';

/**
 * 44 px search field with the magnifier inside. onChange receives (value, event). Works
 * uncontrolled inside a GET form with `name` + `defaultValue`.
 */
export default function SearchBox({
  placeholder = 'Search',
  value,
  onChange,
  name,
  defaultValue,
  label,
  className,
  ...rest
}) {
  const controlled = value !== undefined;
  const state = controlled ? { value, readOnly: !onChange } : { defaultValue };
  return (
    <div className={[styles.box, className].filter(Boolean).join(' ')}>
      <Search className={styles.icon} size={16} strokeWidth={1.8} aria-hidden="true" />
      <input
        type="search"
        className={styles.input}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        name={name}
        autoComplete="off"
        spellCheck={false}
        onChange={onChange ? (event) => onChange(event.target.value, event) : undefined}
        {...state}
        {...rest}
      />
    </div>
  );
}
