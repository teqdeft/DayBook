'use client';
// Moving cards between phases (CONTRACT 27, Moving a card; CONTRACT 28, Motion), for the Board:
// the card moves at once (optimistic) while `PATCH /api/project-tasks/[id] { phase }` runs, then
// "Moved to Testing." with Undo for 6 s, which sends the old phase back. A failed move puts the
// card back (gliding, with reduce motion at once) with "Couldn't move the task" and the API's
// message. The moves the page doesn't show yet are kept until a refresh brings the task in its new
// phase. 1.13 splits a move into `show(step)` (sync: the optimistic map, so a FLIP or a drop can
// wrap it in flushSync) and `send(step)` (the PATCH, then the refresh); 1.12's `move()` stays
// beside them for the board that still uses it.
import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { glideMove } from './boardMotion';
import { moveBody, moveOf, movedText, pendingMoves, undoOf, withMoves } from './boardMoves';
import { NO_PHASE } from '../phasesView';

const without = (moves, taskId) => {
  const next = new Map(moves);
  next.delete(taskId);
  return next;
};

/** The column key a phase is drawn in ('none' for No phase yet). */
const columnKey = (phase) => phase ?? NO_PHASE;

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
 * Sends one move already shown: a failure puts the card back (to `step.revert` when given, else
 * where the page has it) with "Couldn't move the task".
 * @returns {(step: object) => Promise<boolean>} true once the server has it
 */
function useSendMove(setMoves, rootRef) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  return useCallback(
    async (step) => {
      try {
        await api.patch(`/api/project-tasks/${step.taskId}`, moveBody(step));
        startRefresh(() => router.refresh());
        return true;
      } catch (failure) {
        const back = (now) =>
          step.revert === undefined
            ? without(now, step.taskId)
            : new Map(now).set(step.taskId, step.revert);
        glideMove(rootOf(rootRef), step.taskId, () => setMoves(back), {
          to: step.revert === undefined ? undefined : columnKey(step.revert),
        });
        toast({ title: "Couldn't move the task", body: failure.message, tone: 'error' });
        return false;
      }
    },
    [router, toast, setMoves, rootRef],
  );
}

/** Where the glide looks for the cards: the board, else the page (the same `data-flip` keys). */
const rootOf = (rootRef) => rootRef?.current ?? globalThis.document ?? null;

/**
 * Sends a move shown already and offers Undo once the server has it ("Moved to Testing.").
 * @returns {{ pending: object | null, setPending: Function,
 *   send: (step: object, options?: { undo?: boolean }) => Promise<boolean> }}
 */
function useUndoToast(post) {
  const [pending, setPending] = useState(null);
  const counter = useRef(0);
  const send = useCallback(
    async (step, { undo = true } = {}) => {
      if (undo) setPending(null);
      const ok = await post(step);
      if (ok && undo) {
        counter.current += 1;
        const move = { taskId: step.taskId, from: step.from ?? null, to: step.to };
        setPending({ key: counter.current, title: movedText(step.to), move });
      }
      return ok;
    },
    [post],
  );
  return { pending, setPending, send };
}

/**
 * @param {object[]} tasks the page's board rows
 * @param {{ rootRef?: import('react').RefObject<Element> }} [options] the board, for the glide
 *   back after a failed save or an Undo (the page when not given)
 * @returns {{ tasks: object[], move: (task: object, phase: string) => Promise<boolean>,
 *   show: (step: { taskId: number, to: string | null }) => void,
 *   send: (step: object, options?: { undo?: boolean }) => Promise<boolean>,
 *   undo: () => void, pending: { key: number, title: string, move: object } | null,
 *   endUndo: () => void }} tasks: with the moves on their way shown; show: the optimistic move
 *   (sync); send: its PATCH and refresh (with the Undo toast unless `undo: false`); move: 1.12's
 *   show + send; pending: the Undo toast's
 */
export function useCardMoves(tasks, { rootRef } = {}) {
  const [shown, setMoves] = useShownMoves(tasks);
  const post = useSendMove(setMoves, rootRef);
  const { pending, setPending, send } = useUndoToast(post);

  const show = useCallback(
    (step) => setMoves((now) => new Map(now).set(step.taskId, step.to)),
    [setMoves],
  );

  const move = useCallback(
    async (task, to) => {
      const step = moveOf(task, to);
      show(step);
      return send(step);
    },
    [show, send],
  );

  const undo = useCallback(() => {
    if (!pending) return;
    setPending(null);
    const back = undoOf(pending.move);
    glideMove(rootOf(rootRef), back.taskId, () => show(back), { to: columnKey(back.to) });
    send({ ...back, revert: back.from }, { undo: false });
  }, [pending, setPending, show, send, rootRef]);

  return {
    tasks: withMoves(tasks, shown),
    move,
    show,
    send,
    undo,
    pending,
    endUndo: () => setPending(null),
  };
}
