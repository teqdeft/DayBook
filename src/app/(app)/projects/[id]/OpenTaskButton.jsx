'use client';
// A task's title as a button that opens the task window (CONTRACT 27): the Summary tab's Critical
// tasks rows. The window (TaskWindowProvider, mounted by the page) returns focus here when it
// closes.
import { useTaskWindow } from '@/components/task/TaskWindowProvider';

/**
 * @param {{ taskId: number, className?: string, children: import('react').ReactNode }} props
 */
export default function OpenTaskButton({ taskId, className, children }) {
  const taskWindow = useTaskWindow();
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => taskWindow?.open(taskId, { origin: event.currentTarget })}
    >
      {children}
    </button>
  );
}
