'use client';
// The project page header's button for the project's PM and Admins (CONTRACT 27 and 28, The project
// page frame): "+ New task" on every tab but the Board (the Board's toolbar has "Add task", its one
// add), and "Reopen project" on a Completed project. "+ New task" opens the New task window
// (TaskEditorProvider, mounted by ProjectView) in the current phase, Requirement gathering while
// the phase is Not set; the window returns focus here when it closes. Reopening from the header
// gives "+ New task" the focus.
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import { PHASE_KEYS } from '@/modules/projectPlan/phases';
import ReopenProject, { useProjectStatus } from './_board/ReopenProject';
import { useTaskEditor } from './_board/TaskEditorProvider';
import styles from './page.module.css';

/** The header's "+ New task", which takes the focus after Reopen project. */
export const NEW_TASK_ID = 'project-new-task';

/** @param {{ currentPhase: string | null }} props the project's current phase */
export default function NewTaskButton({ currentPhase }) {
  const editor = useTaskEditor();
  return (
    <Button
      id={NEW_TASK_ID}
      className={styles.newTask}
      icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
      onClick={() => editor?.openNew({ phase: currentPhase ?? PHASE_KEYS[0] })}
    >
      New task
    </Button>
  );
}

/**
 * The header's button on a tab other than the Board: "+ New task", or "Reopen project" while the
 * project shows as Completed.
 * @param {{ project: { name: string, status: string }, currentPhase: string | null }} props
 */
export function HeaderAction({ project, currentPhase }) {
  const { status } = useProjectStatus(project.status);
  if (status === 'completed') {
    return (
      <ReopenProject projectName={project.name} focusId={NEW_TASK_ID} className={styles.newTask} />
    );
  }
  return <NewTaskButton currentPhase={currentPhase} />;
}
