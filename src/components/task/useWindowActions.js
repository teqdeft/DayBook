'use client';
// The task window's people and phase actions (CONTRACT 28, Task window; The people window), over
// the project page's task actions (useTaskActions, managers only): the face button opens the
// people window anchored to it; "Assign to me" takes the task and focus goes to the face button
// (the control it pressed goes away); "Move to phase…" opens the page's Move dialog, the card
// gliding on the Board when the Board is there. The person on its way is laid over the window's
// task (`apply`), and once the page's own data has it, the window loads the task again.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { useTaskActions } from '@/app/(app)/projects/[id]/_board/TaskActionsProvider';
import { moveBody, movedText } from '@/app/(app)/projects/[id]/_board/boardMoves';
import { nextPin } from './shownPerson';
import { forgetTaskDetails } from './useTaskDetails';

/**
 * The task as the window shows it: the person on its way laid over (`apply`). When that person
 * goes from the overlay (the page refreshed after the save, or the change was undone), the task's
 * details load again so the window agrees with the page; meanwhile it keeps showing that person.
 */
function useShownTask(task, actions, loading) {
  const laid = task && actions?.apply ? (actions.apply([task])?.[0] ?? task) : task;
  const overlaid = Boolean(task) && laid !== task;
  const [pin, setPin] = useState(null);
  const next = task
    ? nextPin(pin, { overlay: overlaid ? laid.assignee : undefined, task, loading })
    : { pin: null, assignee: null };
  if (next.pin !== pin) setPin(next.pin);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !overlaid && task) forgetTaskDetails(task.id);
    was.current = overlaid;
  }, [overlaid, task]);
  if (!task || next.assignee === task.assignee) return task;
  return { ...task, assignee: next.assignee };
}

/** A move without the Board (another tab): the PATCH, the toast and a refresh. */
function usePlainMove() {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  return useCallback(
    async (task, to) => {
      try {
        await api.patch(`/api/project-tasks/${task.id}`, moveBody({ to }));
        toast({ title: movedText(to) });
        startRefresh(() => router.refresh());
        return true;
      } catch (error) {
        toast({ title: "Couldn't move the task", body: error.message, tone: 'error' });
        return false;
      }
    },
    [router, toast],
  );
}

/**
 * @param {object | null} task TaskDetails
 * @param {{ loading?: boolean }} [state] the details are loading again
 * @returns {{ task: object | null, canAct: boolean, faceRef: object,
 *   people: (anchor: HTMLElement) => void, take: (button: HTMLElement) => void,
 *   move: (button: HTMLElement) => void }}
 */
export function useWindowActions(task, { loading = false } = {}) {
  const actions = useTaskActions();
  const shown = useShownTask(task, actions, loading);
  const faceRef = useRef(null);
  const plainMove = usePlainMove();
  const [movedTo, setMovedTo] = useState(null);
  const phaseShown = movedTo && movedTo.id === task?.id ? movedTo.phase : (shown?.phase ?? null);

  const people = (anchor) => actions?.openPeople({ tasks: [shown], anchor });
  const take = (button) => {
    faceRef.current?.focus({ preventScroll: true });
    actions?.take(shown, { origin: button, focus: () => faceRef.current });
  };
  const move = (button) =>
    actions?.openMove({
      tasks: [shown],
      origin: button,
      onMove: async (to) => {
        setMovedTo({ id: shown.id, phase: to });
        const ok = actions.board?.move
          ? await actions.board.move(shown, to, 'dialog')
          : await plainMove(shown, to);
        if (ok === false) setMovedTo(null);
        forgetTaskDetails(shown.id);
      },
    });

  const withPhase = shown && phaseShown !== shown.phase ? { ...shown, phase: phaseShown } : shown;
  return { task: withPhase, canAct: Boolean(actions), faceRef, people, take, move };
}
