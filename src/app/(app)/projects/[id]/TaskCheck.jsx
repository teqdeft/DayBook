'use client';
// The real checkbox on a task (CONTRACT 22): only the box ticks, never the title beside it. It shows
// the new state at once, while the request and the page refresh run, and goes back by itself if the
// request fails. Marking done offers Undo; unticking a done task just reopens it. Show it only to
// people who can manage the project: the status route refuses anyone else. Since 1.13 (CONTRACT
// 28, Motion) a box with `onChange` carries a check that draws (an inline SVG path, pathLength 1):
// the board's round tick shows it and draws it only while the card is `data-ticking`, so it never
// draws on load for tasks already done. `onChange(next, saved, { el })` lets the board, the Table and My tasks play
// the tick (saved resolves true once the server has it, false when it failed).
import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { useTaskUndo } from './TaskUndoProvider';
import { placeAfterTick } from './tickFocus';
import styles from './TaskCheck.module.css';

/** The check that draws (CONTRACT 28): `pathLength="1"`, so `stroke-dashoffset` 1 → 0 draws it. */
function DrawnCheck() {
  return (
    <svg
      className={styles.check}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" pathLength="1" />
    </svg>
  );
}

/**
 * The save behind the box: the new state at once, then the request, Undo and the refresh; the
 * state goes back by itself when the request fails.
 * @returns {{ checked: boolean, busy: boolean, change: (event: Event) => void }}
 */
function useStatusSave({ taskId, done, onChange }) {
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
    // Read now: the card or row has often left by the time the server answers.
    const place = next ? placeAfterTick(origin) : null;
    let settle = () => {};
    const saved = new Promise((resolve) => (settle = resolve));
    onChange?.(next, saved, { el: origin });
    startTransition(async () => {
      setChecked(next);
      try {
        await api.post(`/api/project-tasks/${taskId}/status`, { status: next ? 'done' : 'open' });
        if (next) offerUndo?.({ taskId, keyboard, origin, place });
        startTransition(() => router.refresh());
        settle(true);
      } catch (error) {
        toast({ title: "Couldn't change the task", body: error.message, tone: 'error' });
        settle(false);
      }
    });
  }
  return { checked, busy, change };
}

/**
 * @param {{ taskId: number, title: string, done?: boolean, className?: string,
 *   onChange?: (next: boolean, saved: Promise<boolean>, options: { el: HTMLInputElement })
 *     => void }} props
 *   title: names the box for screen readers ("Done: Scope signed off by Acme"); onChange: called
 *   at once, before the request (`el`: the box, so the motion finds its card or row); the drawn
 *   check comes with it (the board, the Table and My tasks), the plain box keeps the browser's
 */
export default function TaskCheck({ taskId, title, done = false, className, onChange }) {
  const { checked, busy, change } = useStatusSave({ taskId, done, onChange });
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
      {onChange ? <DrawnCheck /> : null}
    </label>
  );
}
