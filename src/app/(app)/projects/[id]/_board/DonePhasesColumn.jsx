'use client';
// "Done phases" (CONTRACT 27, Columns): one tile per phase before the current one whose tasks are
// all done. A tile names the phase (a green check, or the neutral "Skipped" tag for a phase jumped
// over), counts its tasks ("6 of 6 tasks"; a member's "4 of yours, done"), says when it ended late,
// and opens its tasks as a normal column with "Show tasks" until "Hide tasks".
import { Check } from 'lucide-react';
import Tag from '@/components/Tag';
import { tileButtonId } from './boardView';
import styles from './DonePhasesColumn.module.css';
import boardStyles from './Board.module.css';

/**
 * @param {{ tiles: Array<{ key: string, label: string, skipped: boolean, text: string,
 *   note: string | null, opened: boolean }>, onToggle: (key: string) => void }} props tiles:
 *   boardView.boardColumns'
 */
export default function DonePhasesColumn({ tiles, onToggle }) {
  if (tiles.length === 0) return null;
  return (
    <section className={boardStyles.doneColumn} aria-label="Done phases" data-column="done-phases">
      <h3 className={styles.title}>Done phases</h3>
      <ul className={styles.tiles}>
        {tiles.map((tile) => (
          <li key={tile.key} className={styles.tile}>
            <span className={styles.name}>
              {tile.skipped ? null : (
                <Check size={16} strokeWidth={2.4} aria-hidden="true" className={styles.check} />
              )}
              <span>{tile.label}</span>
              {tile.skipped ? (
                <Tag tone="neutral" className={styles.tag}>
                  Skipped
                </Tag>
              ) : null}
            </span>
            <span className={styles.line}>{tile.text}</span>
            {tile.note ? (
              <span className={`${styles.line} ${styles.late}`}>{tile.note}</span>
            ) : null}
            <button
              type="button"
              id={tileButtonId(tile.key)}
              className={styles.toggle}
              aria-expanded={tile.opened}
              onClick={() => onToggle(tile.key)}
            >
              {tile.opened ? 'Hide' : 'Show'}
              <span className="visually-hidden"> {tile.label}</span> tasks
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
