'use client';
// The toolbar's Add task (CONTRACT 28, Board toolbar item 1; the project's PM and Admins on an open
// project): a primary split button. The main part opens New task in the current phase
// (Requirement gathering when not set); the arrow opens a menu with "New task" and "Quick add to
// Testing", which opens that column's quick add (switching to the Board, and on a phone to that
// column, first). It takes the focus after Reopen project.
import { ChevronDown, Kanban, Plus } from 'lucide-react';
import Button from '@/components/Button';
import Menu from '@/components/Menu';
import { PHASE_KEYS, phaseLabel } from '@/modules/projectPlan/phases';
import { ADD_TASK_ID } from './boardView';
import styles from './Toolbar.module.css';

const icon = (Icon) => <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;

/** @param {{ board: object }} props board: useBoard's (`currentPhase`, `addCurrent`, ...) */
export default function AddTaskButton({ board }) {
  const phase = phaseLabel(board.currentPhase ?? PHASE_KEYS[0]);
  return (
    <span className={styles.split}>
      <Button
        id={ADD_TASK_ID}
        size="compact"
        className={styles.addMain}
        icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => board.addCurrent()}
      >
        Add task
      </Button>
      <Menu
        label="More ways to add a task"
        align="start"
        width={240}
        triggerClassName={styles.addMore}
        items={[
          { label: 'New task', icon: icon(Plus), onSelect: () => board.addCurrent() },
          {
            label: `Quick add to ${phase}`,
            icon: icon(Kanban),
            onSelect: () => board.quickAddCurrent(),
          },
        ]}
      >
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </Menu>
    </span>
  );
}
