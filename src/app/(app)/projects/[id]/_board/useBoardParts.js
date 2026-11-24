'use client';
// The smaller pieces of the Board's state (CONTRACT 27, Board tab): focus after the next render, the
// last kind of input (for the Undo toasts), the highlighted card, the one quick add field open, and
// the columns' own state (the done phases opened from their tiles, the folds of done cards, the
// phone's step). useBoard puts them together.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { addTaskId, firstStep } from './boardView';
import { toldWho } from './taskFormModel';
import { useSavedTask } from './TaskEditorProvider';

/** True at 640 px and below (the phone's one column at a time). */
export const isPhone = () => Boolean(window.matchMedia?.('(max-width: 640px)').matches);

/**
 * Focus (or a scroll) after the next render.
 * @returns {(target: string | null | (() => HTMLElement | null), then?: () => void) => void}
 *   target: an element id, or a function that finds the element
 */
export function useAfterRender() {
  const job = useRef(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const next = job.current;
    if (!next) return;
    job.current = null;
    requestAnimationFrame(() => {
      const { target } = next;
      const element = typeof target === 'function' ? target() : document.getElementById(target);
      element?.focus?.();
      next.then?.();
    });
  }, [tick]);
  return useCallback((target, then) => {
    job.current = { target, then };
    setTick((count) => count + 1);
  }, []);
}

/** Whether the last thing the person did was on the keyboard (an Undo toast then takes focus). */
export function useKeyboardInput() {
  const keyboard = useRef(false);
  useEffect(() => {
    const onKey = () => (keyboard.current = true);
    const onPointer = () => (keyboard.current = false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return useCallback(() => keyboard.current, []);
}

/**
 * The card highlighted for 1.5 s: one just added, edited (TaskEditorProvider) or moved.
 * @returns {[number | null, (id: number | null) => void, object | null]} the id, its setter and
 *   the editor's last save
 */
export function useHighlight() {
  const saved = useSavedTask();
  const [highlight, setHighlight] = useState(null);
  const [seenSave, setSeenSave] = useState(saved?.key ?? null);
  if ((saved?.key ?? null) !== seenSave) {
    setSeenSave(saved?.key ?? null);
    if (saved) setHighlight(saved.id);
  }
  useEffect(() => {
    if (highlight === null) return undefined;
    const timer = setTimeout(() => setHighlight(null), 1600);
    return () => clearTimeout(timer);
  }, [highlight]);
  return [highlight, setHighlight, saved];
}

/**
 * The one quick add field open on the board, and what happens after an add.
 * @param {{ after: Function, editor: object | null, setHighlight: Function }} deps
 */
export function useQuickAdd({ after, editor, setHighlight }) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const [quick, setQuick] = useState(null);
  return {
    quick,
    openQuick: (key) => setQuick(key),
    closeQuick(key) {
      setQuick(null);
      after(addTaskId(key));
    },
    quickAdded(task, column) {
      // A quick task is for anyone: everyone on the project is told, unless nobody was.
      const who = task?.told === undefined ? toldWho('members') : toldWho(task.told, task.toldName);
      toast({
        title: `Task added to ${column.label}.`,
        body: who ? `${who} gets a notification.` : undefined,
      });
      if (task?.id) setHighlight(task.id);
      startRefresh(() => router.refresh());
    },
    // Focus goes to the column's "+ Add task" first, so it comes back there when the window closes.
    quickMore(title, column) {
      setQuick(null);
      after(addTaskId(column.key), () => editor?.openNew({ phase: column.key, title }));
    },
  };
}

/**
 * The columns' own state: the done phases opened from their tiles, the folds of done cards (each
 * column's default until toggled) and the phone's step (the current phase first).
 * @param {object} plan
 */
export function useColumnState(plan) {
  const [opened, setOpened] = useState([]);
  const [folds, setFolds] = useState({});
  const [step, setStep] = useState(() => firstStep(plan.currentPhase));
  const isFoldOpen = (column) => folds[column.key] ?? column.doneOpen;
  return {
    opened,
    setOpened,
    step,
    setStep,
    isFoldOpen,
    toggleFold: (column) => setFolds({ ...folds, [column.key]: !isFoldOpen(column) }),
  };
}
