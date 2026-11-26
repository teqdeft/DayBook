'use client';
// Holds "Marked done." and its Undo for the project page (CONTRACT 22), above the tabs' task rows: a
// row that was just ticked often leaves the list when the page refreshes, and the toast has to
// outlive it. Undo reopens the task and tells the board (TASK_REOPENED), whose tick hold would
// otherwise keep showing it done for a while (CONTRACT 28). Focus goes back to the checkbox, or,
// once it has left with its card or row, to the place read as it was ticked (tickFocus.js).
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { isShown } from './_board/table/tableDom';
import { sayReopened } from './taskEvents';
import UndoToast from './UndoToast';

const TaskUndoContext = createContext(null);

/**
 * @returns {null | ((tick: { taskId: number, keyboard?: boolean, origin?: HTMLElement | null,
 *   place?: (() => HTMLElement | null) | null }) => void)} offers Undo for a task just marked done
 *   (place: tickFocus.placeAfterTick's); null outside a TaskUndoProvider
 */
export function useTaskUndo() {
  return useContext(TaskUndoContext);
}

/**
 * Back to the checkbox, or, once it has left with its card or row, to the place read as it was
 * ticked (a box that isn't a control takes the focus where it is, without a scroll).
 */
export function returnFocus({ origin, place }) {
  const target = isShown(origin) ? origin : (place?.() ?? null);
  target?.focus({ preventScroll: target.getAttribute('tabindex') === '-1' });
}

/** @param {{ children: import('react').ReactNode }} props */
export function TaskUndoProvider({ children }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(null);
  const nextKey = useRef(0);

  const offer = useCallback(({ taskId, keyboard = false, origin = null, place = null }) => {
    nextKey.current += 1;
    const key = nextKey.current;
    setPending({ key, title: 'Marked done.', taskId, keyboard, origin, place });
  }, []);

  async function undo() {
    if (!pending) return;
    setPending(null);
    if (pending.keyboard) returnFocus(pending);
    try {
      await api.post(`/api/project-tasks/${pending.taskId}/status`, { status: 'open' });
      sayReopened(pending.taskId);
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't reopen the task", body: error.message, tone: 'error' });
    }
  }

  return (
    <TaskUndoContext.Provider value={offer}>
      {children}
      <UndoToast
        pending={pending}
        onUndo={undo}
        onEnd={() => setPending(null)}
        onLeave={() => {
          if (pending) returnFocus(pending);
        }}
      />
    </TaskUndoContext.Provider>
  );
}
