'use client';
// The Board's state and the actions its parts share (CONTRACT 27, Board tab): the tasks as the
// viewer sees them (with the moves on their way, without the ones waiting to be deleted), the
// columns, the pressed filter, the dialogs (move a card, edit a phase's dates, move the project's
// phase), the drags and file drops, and where focus goes after each action (and when a focused
// card is drawn again: useCardFocus).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTaskAttach } from '@/components/files/TaskAttachProvider';
import { useTaskWindow } from '@/components/task/TaskWindowProvider';
import { isPhase } from '@/modules/projectPlan/phases';
import { columnOf, countByPhase } from './bandView';
import { nextCardAfter } from './boardMoves';
import {
  addTaskId,
  boardColumns,
  cardId,
  cardTitleId,
  filterOf,
  foldButtonId,
  isDimmed,
  phoneSteps,
  tileButtonId,
} from './boardView';
import { useTaskEditor } from './TaskEditorProvider';
import { useBoardDrag } from './useBoardDrag';
import {
  isPhone,
  useAfterRender,
  useColumnState,
  useHighlight,
  useKeyboardInput,
  useQuickAdd,
} from './useBoardParts';
import { useBoardScroll } from './useBoardScroll';
import { useCardFileDrop } from './useCardFileDrop';
import { useCardFocusKeeper } from './useCardFocus';
import { useCardMoves } from './useCardMoves';

const NO_DROP = { over: false, gapAt: null, handlers: {} };
const menuOf = (taskId) =>
  document.getElementById(cardId(taskId))?.querySelector('[aria-haspopup="menu"]') ?? null;

/**
 * Moving and deleting a card, with focus after each: a drag keeps it on the card's title; a move
 * from the dialog goes to the card's "⋯" in its new column (on a phone, to the next card left
 * behind, or "+ Add task"); a move that fails puts the card back, drawn again in its old column,
 * and focus with it (its "⋯" after the dialog on a desktop, else its title); a delete with the
 * pointer to the next card, or "+ Add task"; a delete from the keyboard to the toast's Undo, and
 * from there back to the card (Undo) or the next one.
 */
export function cardActions({ columns, moves, editor, after, keyboard, scroll, setHighlight }) {
  const columnFor = (task) => columns.find((column) => column.key === columnOf(task));
  const nextFocus = (task) => {
    const column = columnFor(task);
    const next = nextCardAfter(column?.open ?? [], task.id);
    return next ? cardTitleId(next) : addTaskId(column?.key);
  };
  return {
    async move(task, to, how) {
      if (how === 'drag') after(cardTitleId(task.id));
      else if (isPhone()) after(nextFocus(task));
      else
        after(
          () => menuOf(task.id),
          () => scroll.show(to),
        );
      setHighlight(how === 'dialog' && isPhone() ? null : task.id);
      const moved = await moves.move(task, to);
      if (!moved) {
        after(how === 'dialog' && !isPhone() ? () => menuOf(task.id) : cardTitleId(task.id));
      }
      return moved;
    },
    deleteTask(task) {
      const focus = nextFocus(task);
      const fromKeyboard = keyboard();
      editor?.remove(task, {
        keyboard: fromKeyboard,
        // After Undo the card is back; after Tab or Escape it is gone, so the next card instead.
        returnFocus: () =>
          document.getElementById(cardTitleId(task.id)) ?? document.getElementById(focus),
      });
      // From the keyboard the Undo toast takes focus (UndoToast), so Enter undoes the delete.
      if (!fromKeyboard) after(focus);
    },
  };
}

/**
 * Opens the task window from a card: the card's title shows at once while the task loads, focus
 * comes back to what opened it on close (the title for a click on the card itself, which can't
 * take focus), and, when the card was drawn again meanwhile (marked done in the window, it moves
 * to "› 6 done"), to its title there or that fold's button, or its column's "+ Add task".
 * @param {{ open: Function } | null} taskWindow useTaskWindow()
 * @param {object} task a board card's task
 * @param {HTMLElement | null} origin what was clicked: the card, its title or its "⋯"
 */
export function openTaskFrom(taskWindow, task, origin) {
  const byId = (id) => document.getElementById(id);
  const column = columnOf(task);
  const onCard = origin?.id === cardId(task.id);
  taskWindow?.open(task.id, {
    origin: (onCard ? byId(cardTitleId(task.id)) : null) ?? origin,
    title: task.title,
    returnFocus: () =>
      byId(cardTitleId(task.id)) ?? byId(foldButtonId(column)) ?? byId(addTaskId(column)),
  });
}

/** Whether the viewer gets the "With files" pill (the files they may see). */
const offersFiles = (filesAccess) => Boolean(filesAccess) && filesAccess !== 'none';

/**
 * The pill pressed first, from `?show=`: never one for a member, and With files only when that
 * pill is there, so a viewer without file rights isn't shown a dimmed board about files.
 * @param {{ access: string, filesAccess?: string, show?: string | string[] | null }} input
 * @returns {'all' | 'critical' | 'files'}
 */
export function firstFilter({ access, filesAccess, show }) {
  if (access === 'member') return 'all';
  const wanted = filterOf(show);
  return wanted === 'files' && !offersFiles(filesAccess) ? 'all' : wanted;
}

/** A done phase opened from its tile, or a band part's column, brought into view. */
function phaseActions({ columns, state, after, scroll }) {
  return {
    toggleOpened(key) {
      const opening = !state.opened.includes(key);
      state.setOpened(opening ? [...state.opened, key] : state.opened.filter((one) => one !== key));
      if (opening) after(null, () => scroll.show(key));
      else after(tileButtonId(key));
    },
    showPhase(key) {
      if (isPhone()) return state.setStep(key);
      const column = columns.find((one) => one.key === key);
      if (column?.hidden) state.setOpened([...state.opened, key]);
      after(null, () => scroll.show(key));
    },
  };
}

/** The tasks as shown, the columns and the scroll area. */
function useBoardView({ props, editor, moves, opened }) {
  const member = props.access === 'member';
  const tasks = moves.tasks.filter((task) => !editor?.isHidden(task.id));
  const { tiles, columns } = boardColumns({
    plan: props.plan,
    tasks,
    member,
    today: props.today,
    opened,
  });
  const [boardRef, scroll] = useBoardScroll(
    columns.map((column) => `${column.key}:${column.hidden}`).join(),
  );
  const counts = member ? props.counts : countByPhase(tasks);
  return { tasks, tiles, columns, counts, boardRef, scroll };
}

/** The pill pressed (first from `?show=`) and the dialogs open: move a card, dates, phase move. */
function useBoardChoices({ access, filesAccess, show }) {
  const params = useSearchParams();
  const [filter, setFilter] = useState(() =>
    firstFilter({ access, filesAccess, show: show ?? params?.get('show') }),
  );
  const [panels, setPanels] = useState({ moveFor: null, datesFor: null, phaseMove: null });
  const setPanel = (key) => (value) => setPanels((now) => ({ ...now, [key]: value }));
  return { filter, setFilter, panels, setPanel };
}

/**
 * For the project's PM and Admins: dragging a card to another phase, dropping files on a card, and
 * the batch of files on their way to each card (the attach store's).
 */
function useCardDrops({ manage, attach, move }) {
  const drag = useBoardDrag({ enabled: manage, onDrop: (task, to) => move(task, to, 'drag') });
  const fileDrop = useCardFileDrop({
    enabled: manage && Boolean(attach),
    onFiles: (task, files) =>
      attach?.add(task.id, files, { title: task.title, from: 'drop', fileCount: task.fileCount }),
  });
  const batchFor = (taskId) => (manage ? (attach?.batchFor(taskId) ?? null) : null);
  return { drag, fileDrop, batchFor };
}

/** The values and actions the Board's parts read (useBoard's first value). */
function boardOf({ props, view, actions, quick, choices, drops, state, extra }) {
  const { filter, setFilter, panels, setPanel } = choices;
  const { drag, fileDrop, batchFor } = drops;
  const { moves, editor, highlight, taskWindow } = extra;
  const steps = phoneSteps(view.columns);
  return {
    ...props,
    ...view,
    ...actions,
    ...quick,
    ...panels,
    moves,
    steps,
    step: steps.includes(state.step) ? state.step : steps[0],
    setStep: state.setStep,
    isFoldOpen: state.isFoldOpen,
    toggleFold: state.toggleFold,
    filter,
    setFilter,
    showFiles: offersFiles(props.filesAccess),
    batchFor,
    cardProps: (task) => ({
      dimmed: isDimmed(task, filter),
      highlighted: highlight === task.id,
      lifted: drag.dragging?.id === task.id,
      drag: drag.cardDrag(task, Boolean(batchFor(task.id)?.busy)),
      fileDrop: fileDrop(task),
    }),
    columnDrop: (column) => (isPhase(column.key) ? drag.columnDrop(column) : NO_DROP),
    openTask: (task, origin) => openTaskFrom(taskWindow, task, origin),
    editTask: (task) => editor?.openEdit(task),
    askMove: setPanel('moveFor'),
    closeMove: () => setPanel('moveFor')(null),
    editDates: setPanel('datesFor'),
    movePhase: setPanel('phaseMove'),
  };
}

/**
 * @param {object} props Board's props
 * @returns {[object, import('react').RefObject<HTMLElement>]} the board's values and actions, and
 *   the ref of the columns' scroll area
 */
export function useBoard(props) {
  const editor = useTaskEditor();
  const taskWindow = useTaskWindow();
  const attach = useTaskAttach();
  const choices = useBoardChoices(props);
  const [highlight, setHighlight, saved] = useHighlight();
  const after = useAfterRender();
  const keyboard = useKeyboardInput();
  const moves = useCardMoves(props.tasks);
  const state = useColumnState(props.plan);
  const { boardRef, ...view } = useBoardView({ props, editor, moves, opened: state.opened });
  useCardFocusKeeper(view.columns);
  const quick = useQuickAdd({ after, editor, setHighlight });
  const deps = { ...view, moves, editor, after, keyboard, setHighlight, state };
  const actions = { ...cardActions(deps), ...phaseActions(deps) };
  const drops = useCardDrops({ manage: props.access === 'manage', attach, move: actions.move });

  useEffect(() => {
    if (saved?.edited) after(cardTitleId(saved.id));
  }, [saved, after]);

  const extra = { moves, editor, highlight, taskWindow };
  const board = boardOf({ props, view, actions, quick, choices, drops, state, extra });
  return [board, boardRef];
}
