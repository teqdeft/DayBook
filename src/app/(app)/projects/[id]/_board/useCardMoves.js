'use client';
// Moving cards between phases (CONTRACT 27, Moving a card), for the Board: the card moves at once
// (optimistic) while `PATCH /api/project-tasks/[id] { phase }` runs, then "Moved to Testing." with
// Undo for 6 s, which sends the old phase back. A failed move puts the card back with "Couldn't move
// the task" and the API's message. The moves the page doesn't show yet are kept until a refresh
// brings the task in its new phase.
import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { moveBody, moveOf, movedText, pendingMoves, undoOf, withMoves } from './boardMoves';

const without = (moves, taskId) => {
  const next = new Map(moves);
  next.delete(taskId);
  return next;
};

/**
 * The moves the page doesn't show yet (task id to phase): a refresh that brings a task in the
 * phase it was moved to ends that move.
 * @returns {[Map<number, string | null>, Function]} the moves to show, and their setter
 */
function useShownMoves(tasks) {
  const [moves, setMoves] = useState(() => new Map());
  const [seen, setSeen] = useState(tasks);
  let shown = moves;
  if (seen !== tasks) {
    shown = pendingMoves(moves, tasks);
    setSeen(tasks);
    if (shown !== moves) setMoves(shown);
  }
  return [shown, setMoves];
}

/**
 * Sends one move: the card moves at once; a failure puts it back (or drops the move when it had
 * none before) with "Couldn't move the task".
 * @returns {(move: object) => Promise<boolean>} true once the server has it
 */
function useSendMove(setMoves) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  return useCallback(
    async (move) => {
      setMoves((now) => new Map(now).set(move.taskId, move.to));
      try {
        await api.patch(`/api/project-tasks/${move.taskId}`, moveBody(move));
        startRefresh(() => router.refresh());
        return true;
      } catch (failure) {
        setMoves((now) =>
          move.from === undefined
            ? without(now, move.taskId)
            : new Map(now).set(move.taskId, move.from),
        );
        toast({ title: "Couldn't move the task", body: failure.message, tone: 'error' });
        return false;
      }
    },
    [router, toast, setMoves],
  );
}

/**
 * @param {object[]} tasks the page's board rows
 * @returns {{ tasks: object[], move: (task: object, phase: string) => Promise<boolean>,
 *   undo: () => void, pending: { key: number, title: string, move: object } | null,
 *   endUndo: () => void }} tasks: with the moves on their way shown; move resolves true once
 *   the server has it; pending: the Undo toast's
 */
export function useCardMoves(tasks) {
  const [shown, setMoves] = useShownMoves(tasks);
  const send = useSendMove(setMoves);
  const [pending, setPending] = useState(null);
  const counter = useRef(0);

  const move = useCallback(
    async (task, to) => {
      const step = moveOf(task, to);
      setPending(null);
      const ok = await send({ ...step, from: undefined });
      if (ok) {
        counter.current += 1;
        setPending({ key: counter.current, title: movedText(to), move: step });
      }
      return ok;
    },
    [send],
  );

  const undo = useCallback(() => {
    if (!pending) return;
    setPending(null);
    const back = undoOf(pending.move);
    send(back);
  }, [pending, send]);

  return {
    tasks: withMoves(tasks, shown),
    move,
    undo,
    pending,
    endUndo: () => setPending(null),
  };
}
