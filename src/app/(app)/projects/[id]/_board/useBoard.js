'use client';
// The Board's state and the `board` object its parts share (CONTRACT 27 and 28, Modules: "The board
// object"): the tasks as the viewer sees them, the columns, the filters, Board | Table, the rail,
// the phase as shown, the card actions (tick, move, delete, open, edit, Move to phase…), the
// pointer drag and file drops, and where focus goes after each action. The Table (T), the cards
// (C3) and the task windows (D, through useTaskActions' registered board) code against it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTaskAttach } from '@/components/files/TaskAttachProvider';
import { useTaskWindow } from '@/components/task/TaskWindowProvider';
import { useCommitMotion } from '@/lib/motion/useMotion';
import { isPhase } from '@/modules/projectPlan/phases';
import { scrollBehavior } from '@/lib/motion/reducedMotion';
import { useAnnouncer } from './MoveLive';
import { useProjectStatus } from './ReopenProject';
import { useTaskActions } from './TaskActionsProvider';
import { useSavedTask, useTaskEditor } from './TaskEditorProvider';
import { expectNewCard, railFlip } from './boardMotion';
import { NO_PHASE } from '../phasesView';
import { cardTitleId } from './boardView';
import { boardOf } from './boardObject';
import { useBandMotion } from './useBandMotion';
import { cardActions, phaseActions } from './useBoardActions';
import { shownTasks, useBoardData } from './useBoardData';
import { useBoardFilters } from './useBoardFilters';
import {
  useAfterRender,
  useColumnState,
  useFlash,
  useKeyboardInput,
  useLatestActions,
  useQuickAdd,
} from './useBoardParts';
import { useBoardScroll } from './useBoardScroll';
import { useBoardView } from './useBoardView';
import { useCardFileDrop } from './useCardFileDrop';
import { useCardFocusKeeper } from './useCardFocus';
import { useCardMoves } from './useCardMoves';
import { usePhaseMove } from './usePhaseMove';
import { usePointerDrag } from './usePointerDrag';
import { useTickLeave } from './useTickLeave';

export { cardActions, openTaskFrom } from './useBoardActions';

/**
 * Lets the task actions (useTaskActions) reach this board: a Move to phase… from a menu or the
 * task window glides the card, a New task saved elsewhere rises in, an edit flashes the card, and
 * the Move dialog shows every phase's count (1.12's "6 of 12"). The functions are read when
 * called, so the board registers once.
 */
function useRegisterBoard(actions, parts) {
  const latest = useRef(parts);
  useLayoutEffect(() => {
    latest.current = parts;
  });
  useEffect(() => {
    if (!actions?.registerBoard) return undefined;
    return actions.registerBoard({
      move: (...args) => latest.current.move(...args),
      expectNew: (...args) => latest.current.expectNew(...args),
      flash: (...args) => latest.current.flash(...args),
      counts: () => latest.current.counts,
    });
  }, [actions]);
}

/** The dialogs the board opens itself: a phase's dates and a phase move from a menu. */
function usePanels() {
  const [panels, setPanels] = useState({ datesFor: null, phaseMove: null });
  const setPanel = (key) => (value) => setPanels((now) => ({ ...now, [key]: value }));
  return { ...panels, editDates: setPanel('datesFor'), movePhase: setPanel('phaseMove') };
}

/** The grip of a card, where "Move to phase…" returns the focus after a grip's click. */
const gripOf = (taskId) => document.querySelector(`[data-flip="card:${taskId}"] [data-grip]`);

/**
 * The motion around the board: the queue for new cards and the drag (a pointer drag, or the
 * grip's keyboard move; the grip's click opens Move to phase…).
 */
function useBoardMotion({ props, refs, tasks, columns, view, move, say, askMove, isBusy }) {
  const motion = useCommitMotion(refs.root);
  const drag = usePointerDrag({
    boardRef: refs.board,
    enabled: props.access === 'manage' && view === 'board',
    findTask: (id) => tasks.find((task) => Number(task.id) === Number(id)) ?? null,
    columnsOf: () => columns,
    onDrop: (task, to, how) => move(task, to, how?.mode === 'keyboard' ? 'keyboard' : 'drag'),
    say,
    askMove: (task) => askMove(task, gripOf(task.id)),
    isBusy,
  });
  // After every commit (a refresh while a card is lifted): the drag finds its card again.
  useLayoutEffect(() => {
    drag.relayout();
  });
  const expectNew = (taskId, phase) =>
    expectNewCard(motion, refs.board.current, isPhase(phase) ? phase : NO_PHASE, taskId);
  return { drag, expectNew };
}

/**
 * What the board shows: the tasks (the page's, with what is on its way), the filters, the view,
 * the columns' own state, the phase as shown, then the columns.
 */
function useBoardState(props, root, band) {
  const editor = useTaskEditor();
  const actions = useTaskActions();
  const { status } = useProjectStatus(props.status);
  const view = useBoardView({ initialView: props.view, initialRail: props.railOpen });
  const leave = useTickLeave({ rootRef: root, tasks: props.tasks });
  const moves = useCardMoves(props.tasks, { rootRef: root });
  const tasks = shownTasks({ moves, actions, leave, editor });
  const filters = useBoardFilters({ ...props, tasks });
  const state = useColumnState(props.plan, filters.showDone);
  const completed = status === 'completed';
  const columnArgs = { tasks, member: props.access === 'member', opened: state.opened, completed };
  const [boardRef, wrapRef, scroll] = useBoardScroll(
    `${view.view}:${view.railOpen}:${state.opened.join()}`,
  );
  const refs = { root, band, board: boardRef, wrap: wrapRef, view: view.viewRef };
  const phase = usePhaseMove({ plan: props.plan, today: props.today, columnArgs, refs });
  const data = useBoardData({ props, plan: phase.plan, tasks, ...state, view: view.view, status });
  const drawn = { plan: phase.plan, counts: data.counts, tasks: props.tasks };
  const expectBand = useBandMotion({ bandRef: band, ...drawn });
  const shown = { tasks, filters, state, scroll, refs, phase, data, expectBand };
  return { editor, actions, status, view, leave, moves, ...shown };
}

/** The card and column actions, made when called (they read the board's refs). */
function useBoardDoers({ base, data, after }) {
  const { moves, editor, scroll, state, view, refs } = base;
  const keyboard = useKeyboardInput();
  const board = () => refs.board.current;
  const card = useLatestActions(
    () => cardActions({ ...data, moves, editor, after, scroll, root: board, keyboard }),
    ['move', 'deleteTask'],
  );
  const flip = railFlip;
  const phaseActs = useLatestActions(
    () =>
      phaseActions({ ...data, state, after, scroll, board, view, behavior: scrollBehavior, flip }),
    ['toggleOpened', 'toggleRail', 'showPhase'],
  );
  return { card, phaseActs };
}

/**
 * @param {object} props Board's props
 * @returns {{ board: object, rootRef: object, bandRef: object, boardRef: object,
 *   wrapRef: object, viewRef: object }} board: the shared values and actions; the refs of the
 *   tab, the band, the board's scroll box, its wrapper and the view wrapper the switch fades
 */
export function useBoard(props) {
  const root = useRef(null);
  const band = useRef(null);
  const base = useBoardState(props, root, band);
  const { actions, editor, refs } = base;
  const attach = useTaskAttach();
  const { say } = useAnnouncer();
  const after = useAfterRender();
  const flash = useFlash();
  const panels = usePanels();
  const taskWindow = useTaskWindow();
  const { card, phaseActs } = useBoardDoers({ base, data: base.data, after });
  const motion = useBoardMotion({
    ...{ props, refs, tasks: base.tasks, columns: base.data.columns, view: base.view.view, say },
    move: card.move,
    askMove: (task, origin) => actions?.openMove({ tasks: [task], origin }),
    isBusy: (task) => Boolean(attach?.batchFor(task.id)?.busy),
  });
  const fileDrop = useCardFileDrop({
    enabled: props.access === 'manage' && Boolean(attach),
    onFiles: (task, files) =>
      attach?.add(task.id, files, { title: task.title, from: 'drop', fileCount: task.fileCount }),
  });
  useCardFocusKeeper(base.data.columns);
  const { counts } = base.data;
  useRegisterBoard(actions, { move: card.move, expectNew: motion.expectNew, flash, counts });
  const saved = useSavedTask();
  useEffect(() => {
    if (saved?.edited) after(cardTitleId(saved.id));
  }, [saved, after]);
  const quick = useQuickAdd({ after, editor, expectNew: motion.expectNew });
  const extra = { props, card, phaseActs, fileDrop, attach, after, quick, panels, taskWindow };
  const board = boardOf({ ...base, ...extra, drag: motion.drag });
  return {
    board,
    rootRef: root,
    bandRef: band,
    boardRef: refs.board,
    wrapRef: refs.wrap,
    viewRef: refs.view,
  };
}
