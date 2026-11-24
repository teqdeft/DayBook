'use client';
// The row above the columns (CONTRACT 27, Filter pills): in the PM view the pills "All open (10)",
// "Critical (4)" and "With files (4)" that fade every other card (nothing hides) with a line saying
// what changed; in a member's view the heading "Your tasks". At the right, when the board is wider
// than its area, "Scroll the board left" and "Scroll the board right".
import { ChevronLeft, ChevronRight } from 'lucide-react';
import FilterPills from '@/components/FilterPills';
import { filterItems, filterStatus } from './boardView';
import styles from './BoardFilters.module.css';

/** The two 44 px buttons that scroll the board sideways, only when it scrolls. */
export function ScrollButtons({ scroll }) {
  if (!scroll.scrolls) return null;
  return (
    <div className={styles.scrollButtons}>
      <button
        type="button"
        className={styles.squareButton}
        aria-label="Scroll the board left"
        onClick={() => scroll.step(-1)}
      >
        <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.squareButton}
        aria-label="Scroll the board right"
        onClick={() => scroll.step(1)}
      >
        <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * @param {{ filter: 'all' | 'critical' | 'files', onFilter: (value: string) => void,
 *   counts: { all: number, critical: number, files: number }, files: boolean,
 *   scroll: object }} props files: "With files" shows (the viewer may see files); scroll:
 *   useBoardScroll's
 */
export default function BoardFilters({ filter, onFilter, counts, files, scroll }) {
  return (
    <div className={styles.row}>
      <FilterPills
        label="Highlight cards"
        items={filterItems(counts, { files })}
        value={filter}
        onChange={onFilter}
      />
      <p className={styles.status} role="status">
        {filterStatus(filter, counts)}
      </p>
      <ScrollButtons scroll={scroll} />
    </div>
  );
}
