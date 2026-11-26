'use client';
// Board | Table (CONTRACT 28, Board toolbar item 2): two buttons in a segmented look, the pressed
// one white and bold. The choice is remembered and mirrored in the URL (useBoardView); the switch
// crossfades. Focus stays on the button pressed.
import { Kanban, Table } from 'lucide-react';
import { viewButtonId } from './boardView';
import styles from './Toolbar.module.css';

const VIEWS = [
  { key: 'board', label: 'Board', Icon: Kanban },
  { key: 'table', label: 'Table', Icon: Table },
];

/**
 * @param {{ view: 'board' | 'table', onView: (view: 'board' | 'table') => void }} props
 */
export default function ViewSwitch({ view, onView }) {
  return (
    <div className={styles.views} role="group" aria-label="View">
      {VIEWS.map(({ key, label, Icon }) => (
        <button
          key={key}
          id={viewButtonId(key)}
          type="button"
          className={styles.viewButton}
          aria-pressed={view === key}
          onClick={() => onView(key)}
        >
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
