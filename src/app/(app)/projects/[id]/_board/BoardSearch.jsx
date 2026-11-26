'use client';
// The toolbar's search (CONTRACT 28, Board toolbar item 3): "Search tasks or #number", filtering as
// you type (a title that contains the text; "#88" and "88" also find task #88). On a phone it is a
// 44 px icon button, "Search tasks", that opens the field as its own row and puts the focus in it.
import { useRef } from 'react';
import { Search } from 'lucide-react';
import Input from '@/components/Input';
import styles from './Toolbar.module.css';

export const SEARCH_ID = 'board-search';

/**
 * @param {{ value: string, onChange: (value: string) => void, open: boolean,
 *   onOpen: (open: boolean) => void }} props open: the phone's field is shown
 */
export default function BoardSearch({ value, onChange, open, onOpen }) {
  const inputRef = useRef(null);
  return (
    <>
      <button
        type="button"
        className={styles.searchToggle}
        aria-label="Search tasks"
        aria-expanded={open}
        aria-controls={SEARCH_ID}
        onClick={() => {
          onOpen(!open);
          if (!open) requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Search size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <div className={styles.search}>
        <Search size={16} strokeWidth={1.8} aria-hidden="true" />
        <label className="visually-hidden" htmlFor={SEARCH_ID}>
          Search tasks or #number
        </label>
        <Input
          ref={inputRef}
          id={SEARCH_ID}
          type="search"
          className={styles.searchInput}
          placeholder="Search tasks or #number"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </>
  );
}
