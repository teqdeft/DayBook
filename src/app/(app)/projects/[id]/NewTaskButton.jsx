'use client';
// "+ New task" in the project page's header (CONTRACT 27): the project's PM and Admins only, never
// on a Completed project. It opens the New task window (TaskEditorProvider, mounted by ProjectView)
// in the current phase, Requirement gathering while the phase is Not set. The window returns focus
// here when it closes.
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import { PHASE_KEYS } from '@/modules/projectPlan/phases';
import { useTaskEditor } from './_board/TaskEditorProvider';
import styles from './page.module.css';

/** @param {{ currentPhase: string | null }} props the project's current phase */
export default function NewTaskButton({ currentPhase }) {
  const editor = useTaskEditor();
  return (
    <Button
      className={styles.newTask}
      icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
      onClick={() => editor?.openNew({ phase: currentPhase ?? PHASE_KEYS[0] })}
    >
      New task
    </Button>
  );
}
