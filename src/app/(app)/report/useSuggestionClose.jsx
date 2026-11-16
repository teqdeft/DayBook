// "Done already" and "Not needed" on an unfinished-task suggestion (CONTRACT 24), shared by the
// report's box, the Still open dialog and Today's to-do: POST /api/me/carry-suggestions/:id/close,
// then the parent drops the row (onClosed) and an Undo toast shows ("Marked done." / "Marked not
// needed."); Undo opens it again and the parent puts the row back (onRestored). An error toasts
// the API's message and the row stays. The toast sits with the app's toasts (useToastSlot).
import { useCallback, useEffect, useRef, useState } from 'react';
import UndoToast from '@/app/(app)/projects/[id]/UndoToast';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';

export const CLOSED_TEXT = { done: 'Marked done.', dropped: 'Marked not needed.' };

const NO_IDS = new Set();

/** The close route of one suggestion. */
export const closePath = (taskId) => `/api/me/carry-suggestions/${Number(taskId)}/close`;

/**
 * @param {{ onClosed?: (taskId: number) => void, onRestored?: (item: object) => void,
 *   onLeave?: () => void }} options onLeave puts focus back by the rows (Tab, Shift+Tab or
 *   Escape on the toast's Undo)
 * @returns {{ busy: Set<number>, close: (item: object, reason: 'done' | 'dropped',
 *   event?: { detail?: number }) => Promise<boolean>, pending: object | null,
 *   toast: import('react').ReactElement }} close resolves true once the task is closed
 */
export function useSuggestionClose({ onClosed, onRestored, onLeave } = {}) {
  const toast = useToast();
  const [busy, setBusy] = useState(NO_IDS);
  const [pending, setPending] = useState(null);
  const inFlight = useRef(new Set());
  const count = useRef(0);
  const latest = useRef({ onClosed, onRestored });
  useEffect(() => {
    latest.current = { onClosed, onRestored };
  });

  const mark = useCallback((taskId, on) => {
    if (on) inFlight.current.add(taskId);
    else inFlight.current.delete(taskId);
    setBusy(new Set(inFlight.current));
  }, []);

  const close = useCallback(
    async (item, reason, event) => {
      const taskId = Number(item.taskId);
      if (inFlight.current.has(taskId)) return false;
      mark(taskId, true);
      try {
        await api.post(closePath(taskId), { reason });
      } catch (error) {
        toast({ title: "Couldn't mark the task", body: error?.message, tone: 'error' });
        return false;
      } finally {
        mark(taskId, false);
      }
      latest.current.onClosed?.(taskId);
      count.current += 1;
      // A press from the keyboard (detail 0) moves focus to Undo, so it can be reached in time.
      setPending({
        key: count.current,
        title: CLOSED_TEXT[reason],
        keyboard: event?.detail === 0,
        item,
        reason,
      });
      return true;
    },
    [mark, toast],
  );

  const undo = useCallback(async () => {
    const current = pending;
    if (!current) return;
    setPending(null);
    try {
      await api.post(closePath(current.item.taskId), { reason: current.reason, undo: true });
    } catch (error) {
      toast({ title: "Couldn't undo it", body: error?.message, tone: 'error' });
      return;
    }
    latest.current.onRestored?.(current.item);
  }, [pending, toast]);

  const end = useCallback(() => setPending(null), []);

  return {
    busy,
    close,
    pending,
    toast: <UndoToast pending={pending} onUndo={undo} onEnd={end} onLeave={onLeave} />,
  };
}
