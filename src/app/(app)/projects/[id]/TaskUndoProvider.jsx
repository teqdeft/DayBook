'use client';
// Holds "Marked done." and its Undo for the project page (CONTRACT 22), above the tabs' task rows: a
// row that was just ticked often leaves the list when the page refreshes, and the toast has to
// outlive it. Undo reopens the task.
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import UndoToast from './UndoToast';

const TaskUndoContext = createContext(null);

/**
 * @returns {null | ((tick: { taskId: number, keyboard?: boolean, origin?: HTMLElement | null })
 *   => void)} offers Undo for a task just marked done; null outside a TaskUndoProvider
 */
export function useTaskUndo() {
  return useContext(TaskUndoContext);
}

/** Back to the checkbox, or to the card it was in when its row is gone. */
function returnFocus({ origin, card }) {
  if (origin?.isConnected) {
    origin.focus();
  } else if (card?.isConnected) {
    card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
  }
}

/** @param {{ children: import('react').ReactNode }} props */
export function TaskUndoProvider({ children }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(null);
  const nextKey = useRef(0);

  const offer = useCallback(({ taskId, keyboard = false, origin = null }) => {
    nextKey.current += 1;
    setPending({
      key: nextKey.current,
      title: 'Marked done.',
      taskId,
      keyboard,
      origin,
      card: origin?.closest('section') ?? null,
    });
  }, []);

  async function undo() {
    if (!pending) return;
    setPending(null);
    if (pending.keyboard) returnFocus(pending);
    try {
      await api.post(`/api/project-tasks/${pending.taskId}/status`, { status: 'open' });
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
