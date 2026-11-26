// The `board` object the Board's parts share (CONTRACT 28, Modules: "The board object"), put
// together from useBoard's pieces: who and what (the project, the viewer, the plan as shown), the
// tasks and columns, the filters, the view, what each card gets (`cardProps`), and every action.
// C3's cards, T's Table and D's windows (through useTaskActions) code against it.
import { PHASE_KEYS, phaseIndex, phaseLabel } from '@/modules/projectPlan/phases';
import { cardId, stayText } from './boardView';
import { openTaskFrom } from './useBoardActions';
import { isPhone } from './useBoardParts';

const offersFiles = (filesAccess) => Boolean(filesAccess) && filesAccess !== 'none';

/** The project, the viewer and the plan as shown. */
function identityOf({ props, status, phase }) {
  const plan = phase.plan;
  return {
    projectId: props.projectId,
    projectName: props.projectName ?? '',
    status,
    access: props.access,
    filesAccess: props.filesAccess,
    today: props.today,
    viewerId: props.viewerId ?? null,
    viewerName: props.viewerName ?? null,
    pmName: props.pmName ?? null,
    forecast: props.forecast ?? null,
    hoursThisMonth: props.hoursThisMonth ?? null,
    project: { id: props.projectId, pmId: props.pmId ?? null },
    plan,
    currentPhase: plan.currentPhase ?? null,
  };
}

/**
 * The filters as the parts read them: `matches(task)`, `showDone`, `any`, `clear()`, plus the
 * toolbar's state, counts and setters. Turning "Show done tasks" on or off resets the folds.
 */
function filtersOf(filters, state) {
  return {
    ...filters,
    toggle(key) {
      filters.toggle(key);
      if (key === 'showDone') state.resetFolds();
    },
    clear() {
      filters.clear();
      state.resetFolds();
    },
  };
}

/** A tick: the card's or row's own motion, and the band's, which mostly comes with the refresh. */
const tickOf =
  ({ leave, expectBand }) =>
  (task, next, saved, options) => {
    expectBand?.();
    return leave.tick(task, next, saved, options);
  };

/** What a card gets from the board (C3's TaskCard reads it). */
function cardPropsOf(parts) {
  const { view, filters, fileDrop, drag } = parts;
  const tick = tickOf(parts);
  return (task) => ({
    dimmed: view.view === 'board' && filters.dims(task),
    highlighted: false,
    fileDrop: fileDrop(task),
    gripProps: drag.gripProps(task),
    onTick: (next, saved, options) =>
      tick(task, next, saved, options ?? { el: document.getElementById(cardId(task.id)) }),
  });
}

/** The confirm's "5 open tasks stay in Testing." for a move on from the current phase. */
export const stayFor = (plan, columns) => (to) => {
  const from = plan.currentPhase;
  if (!from || phaseIndex(to) <= phaseIndex(from)) return null;
  const column = columns.find((one) => one.key === from);
  return stayText(column?.open.length ?? 0, phaseLabel(from));
};

/** New task in a phase, Add task (the current phase), and Quick add to the current phase. */
function addActionsOf({ phase, editor, view, state, quick, after, scroll }) {
  const current = () => phase.plan.currentPhase ?? PHASE_KEYS[0];
  return {
    addTask: (key) => editor?.openNew({ phase: key ?? current() }),
    addCurrent: () => editor?.openNew({ phase: current() }),
    async quickAddCurrent() {
      const key = current();
      if (view.view !== 'board') await view.setView('board');
      if (isPhone()) state.setStep(key);
      quick.openQuick(key);
      after(null, () => scroll.show(key));
    },
  };
}

/** The columns' own state and the phone's step. */
function columnsOf({ data, state }) {
  return {
    columns: data.columns,
    tiles: data.tiles,
    counts: data.counts,
    fill: data.fill,
    steps: data.steps,
    step: data.steps.includes(state.step) ? state.step : data.steps[0],
    setStep: state.setStep,
    isFoldOpen: state.isFoldOpen,
    toggleFold: state.toggleFold,
  };
}

/**
 * @param {object} parts useBoard's pieces
 * @returns {object} the board (CONTRACT 28's `board` object, and what the Board's own parts read)
 */
export function boardOf(parts) {
  const { props, tasks, view, card, actions, attach, editor, panels } = parts;
  const manage = props.access === 'manage';
  return {
    ...identityOf(parts),
    ...columnsOf(parts),
    tasks,
    filters: filtersOf(parts.filters, parts.state),
    view: view.view,
    setView: view.setView,
    railOpen: view.railOpen,
    tableSort: view.tableSort,
    cardProps: cardPropsOf(parts),
    tick: tickOf(parts),
    expectBand: parts.expectBand,
    move: card.move,
    deleteTask: card.deleteTask,
    openTask: (task, origin) => openTaskFrom(parts.taskWindow, task, origin),
    editTask: (task) => editor?.openEdit(task),
    askMove: (task, origin) => actions?.openMove({ tasks: [task], origin }),
    ...addActionsOf(parts),
    batchFor: (taskId) => (manage ? (attach?.batchFor(taskId) ?? null) : null),
    showFiles: () => offersFiles(props.filesAccess),
    ...parts.quick,
    ...parts.phaseActs,
    moves: parts.moves,
    phaseMoved: parts.phase.moved,
    stayFor: stayFor(parts.phase.plan, parts.data.columns),
    ...panels,
    scroll: parts.scroll,
  };
}
