'use client';
// The smaller pieces of the Board's state (CONTRACT 27 and 28, Board tab): focus after the next
// render, the last kind of input (for the Undo toasts), the 700 ms flash of a card just edited,
// moved or assigned (it was 1.12's 1.5 s highlight), the one quick add field open, and the
// columns' own state (the done phases opened as columns, the folds of done cards, the phone's
// step). useBoard puts them together.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { flash } from '@/lib/motion/animate';
import { addTaskId, firstStep } from './boardView';
import { toldWho } from './taskFormModel';

/**
 * Actions made from this render's values but called later (from events, timers or the drag),
 * never in render, since they read the board's refs: the methods stay the same functions and
 * use the values of the last commit.
 * @template {Record<string, Function>} T
 * @param {() => T} make makes the actions from this render's values
 * @param {Array<keyof T>} names the methods to hand out
 * @returns {T}
 */
export function useLatestActions(make, names) {
  const latest = useRef(make);
  useLayoutEffect(() => {
    latest.current = make;
  });
  const key = names.join();
  return useMemo(
    () =>
      Object.fromEntries(
        key.split(',').map((name) => [name, (...args) => latest.current()[name](...args)]),
      ),
    [key],
  );
}

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

/** A task's card on the board and its row in the Table, whichever is drawn. */
export const shownCopies = (taskId) =>
  document.querySelectorAll(`[data-flip="card:${taskId}"], [data-flip="row:${taskId}"]`);

/**
 * The flash of a card (or Table row) just edited or assigned, played on the next frame so the
 * change it follows is drawn first. Colour only; it stays with reduce motion.
 * @returns {(taskId: number) => void}
 */
export function useFlash() {
  return useCallback((taskId) => {
    requestAnimationFrame(() => flash(shownCopies(taskId)));
  }, []);
}

/**
 * The one quick add field open on the board, and what happens after an add: the toast, the new
 * card making its entrance once the refresh draws it, the refresh.
 * @param {{ after: Function, editor: object | null,
 *   expectNew: (taskId: number, phase: string) => void }} deps
 */
export function useQuickAdd({ after, editor, expectNew }) {
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
      if (task?.id) expectNew(task.id, column.key);
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
 * The columns' own state: the done phases opened as columns, the folds of done cards (each
 * column's default until toggled; all open while "Show done tasks" is on) and the phone's step
 * (the current phase first).
 * @param {object} plan
 * @param {boolean} showDone the Filter menu's "Show done tasks"
 */
export function useColumnState(plan, showDone) {
  const [opened, setOpened] = useState([]);
  const [folds, setFolds] = useState({});
  const [step, setStep] = useState(() => firstStep(plan.currentPhase));
  const isFoldOpen = (column) => showDone || (folds[column.key] ?? column.doneOpen);
  return {
    opened,
    setOpened,
    step,
    setStep,
    isFoldOpen,
    toggleFold: (column) => setFolds({ ...folds, [column.key]: !isFoldOpen(column) }),
    resetFolds: () => setFolds({}),
  };
}
