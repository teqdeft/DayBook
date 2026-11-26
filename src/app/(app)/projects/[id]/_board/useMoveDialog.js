'use client';
// The project page's one "Move to phase…" window (CONTRACT 28, The people window, Move to phase…),
// for TaskActionsProvider: a card's "⋯", the grip's click and the task window move through the
// Board's registered mover, so the card glides to its new column; with no Board on screen (another
// tab) it is a plain `PATCH /api/project-tasks/[id] { phase }`, the toast and a refresh. The Table's
// bulk bar brings its own `onMove` (the bulk route).
import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { moveBody, movedText } from './boardMoves';

/** The registered Board's counts per phase (an object or a function), for the window's rows. */
export const countsOf = (board) =>
  (typeof board?.counts === 'function' ? board.counts() : board?.counts) ?? null;

/** A move without the Board: the PATCH, "Moved to Testing." and a refresh, or the error toast. */
function usePlainMove() {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  return async (task, to) => {
    try {
      await api.patch(`/api/project-tasks/${task.id}`, moveBody({ to }));
      toast({ title: movedText(to) });
      startRefresh(() => router.refresh());
    } catch (error) {
      toast({ title: "Couldn't move the task", body: error.message, tone: 'error' });
    }
  };
}

/**
 * @param {{ current: object | null }} boardRef the registered Board (`move`, `counts`)
 * @returns {{ move: { tasks: object[], counts: object | null, open: boolean } | null,
 *   open: (options: { tasks: object[], origin?: Element, onMove?: (to: string) => unknown,
 *     counts?: object }) => void, choose: (to: string) => void, close: () => void }} move: the
 *   window's state, kept while it closes so it can play its exit
 */
export function useMoveDialog(boardRef) {
  const plainMove = usePlainMove();
  const [move, setMove] = useState(null);

  const open = useCallback(
    ({ tasks, onMove = null, counts = null }) =>
      setMove({ tasks, onMove, counts: counts ?? countsOf(boardRef.current), open: true }),
    [boardRef],
  );
  const close = useCallback(() => setMove((now) => (now ? { ...now, open: false } : now)), []);
  const choose = (to) => {
    const chosen = move;
    close();
    if (!chosen) return;
    if (chosen.onMove) return chosen.onMove(to);
    for (const task of chosen.tasks) {
      if (boardRef.current?.move) boardRef.current.move(task, to, 'dialog');
      else plainMove(task, to);
    }
  };
  return { move, open, choose, close };
}
