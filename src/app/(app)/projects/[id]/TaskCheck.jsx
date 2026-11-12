'use client';
// The real checkbox on a task (CONTRACT 22): only the box ticks, never the title beside it. It shows
// the new state at once, while the request and the page refresh run, and goes back by itself if the
// request fails. Marking done offers Undo; unticking a done task just reopens it. Show it only to
// people who can manage the project: the status route refuses anyone else.
import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { useTaskUndo } from './TaskUndoProvider';
import styles from './TaskCheck.module.css';

/**
 * @param {{ taskId: number, title: string, done?: boolean, className?: string }} props
 *   title: names the box for screen readers ("Done: Scope signed off by Acme")
 */
export default function TaskCheck({ taskId, title, done = false, className }) {
  const router = useRouter();
  const toast = useToast();
  const offerUndo = useTaskUndo();
  const [checked, setChecked] = useOptimistic(done);
  const [busy, startTransition] = useTransition();

  function change(event) {
    if (busy) return;
    const next = event.target.checked;
    const origin = event.target;
    // A checkbox ticked with the space bar arrives as a click with no pointer behind it.
    const keyboard = event.nativeEvent?.detail === 0;
    startTransition(async () => {
      setChecked(next);
      try {
        await api.post(`/api/project-tasks/${taskId}/status`, { status: next ? 'done' : 'open' });
        if (next) offerUndo?.({ taskId, keyboard, origin });
        startTransition(() => router.refresh());
      } catch (error) {
        toast({ title: "Couldn't change the task", body: error.message, tone: 'error' });
      }
    });
  }

  return (
    <label className={[styles.hit, className].filter(Boolean).join(' ')}>
      <input
        type="checkbox"
        className={styles.box}
        aria-label={`Done: ${title}`}
        aria-busy={busy || undefined}
        checked={checked}
        onChange={change}
      />
    </label>
  );
}
