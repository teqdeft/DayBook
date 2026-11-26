'use client';
// The Board tab (CONTRACT 28, The project page frame and Screens): the band, the Completed note or
// another PM's read-only line, then the view: the toolbar (Add task, Board | Table, search,
// Filter, Mine, faces), the line saying what a filter changed, and the Board (the Done phases rail
// and one column per phase, with its own sideways scroll) or the Table. The project's PM and
// Admins tick cards, add tasks, drag cards (or move them from their menu) and drop files on them;
// another PM reads it all and changes nothing; a member sees only their tasks and Anyone tasks,
// read only. On a phone one column shows at a time with back and next buttons. The live region
// for card moves is there from the first render.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import MovePhaseButton from '../MovePhaseButton';
import PhaseDatesDialog from '../PhaseDatesDialog';
import UndoToast from '../UndoToast';
import BoardToolbar from './BoardToolbar';
import { cardTitleId, editorsText, switcherText } from './boardView';
import CompletedNote from './CompletedNote';
import DoneRail from './DoneRail';
import FilterLine from './FilterLine';
import ForecastLine from './ForecastLine';
import MoveLive, { MoveLiveProvider } from './MoveLive';
import PhaseColumn from './PhaseColumn';
import PhoneSwitcher from './PhoneSwitcher';
import ProgressBand from './ProgressBand';
import TaskTable from './table/TaskTable';
import { useBoard } from './useBoard';
import styles from './Board.module.css';

/** "Scroll the board left" and "Scroll the board right", shown by CSS on a side with more. */
function Arrow({ side, scroll }) {
  const left = side === 'left';
  const Icon = left ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className={`${styles.arrow} ${left ? styles.arrowLeft : styles.arrowRight}`}
      aria-label={left ? 'Scroll the board left' : 'Scroll the board right'}
      onClick={() => scroll.step(left ? -1 : 1)}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** The phone's switcher, then the rail and the columns in their own scroll box. */
function Columns({ board, boardRef, wrapRef }) {
  const shown = board.columns.find((one) => one.key === board.step) ?? board.columns[0];
  return (
    <>
      <PhoneSwitcher
        steps={board.steps}
        step={board.step}
        text={switcherText(shown)}
        onStep={board.setStep}
      />
      <div ref={wrapRef} className={styles.boardWrap}>
        <Arrow side="left" scroll={board.scroll} />
        <div
          ref={boardRef}
          className={styles.board}
          id="project-board"
          data-board=""
          data-flip-scroll=""
        >
          <DoneRail board={board} />
          {board.columns.map((column) => (
            <PhaseColumn key={column.key} column={column} board={board} />
          ))}
        </div>
        <Arrow side="right" scroll={board.scroll} />
      </div>
    </>
  );
}

/** The Board, or a member's empty project, or the Table. */
function ViewBody({ board, boardRef, wrapRef }) {
  if (board.view === 'table') return <TaskTable board={board} />;
  if (board.access === 'member' && board.tasks.length === 0) {
    return (
      <EmptyState
        title="Nothing for you on this project yet."
        body="Your PM adds tasks here. Tasks for anyone on the project show here too."
      />
    );
  }
  return <Columns board={board} boardRef={boardRef} wrapRef={wrapRef} />;
}

/** The dialogs the PM opens from the board: a phase's dates, a phase move from a menu. */
function Dialogs({ board }) {
  const { plan, moves } = board;
  const phase = board.datesFor ? plan.phases.find((row) => row.key === board.datesFor) : null;
  return (
    <>
      <PhaseDatesDialog
        projectId={board.projectId}
        phase={phase ?? null}
        onClose={() => board.editDates(null)}
      />
      {board.phaseMove ? (
        <MovePhaseButton
          projectId={board.projectId}
          currentPhase={plan.currentPhase}
          targetPhase={board.phaseMove}
          plan={plan}
          today={board.today}
          stayText={board.stayFor(board.phaseMove)}
          onMoved={board.phaseMoved}
          open
          onOpenChange={(open) => {
            if (!open) board.movePhase(null);
          }}
        />
      ) : null}
      <UndoToast
        pending={moves.pending}
        onUndo={moves.undo}
        onEnd={moves.endUndo}
        onLeave={() => {
          const id = moves.pending?.move.taskId;
          if (id) document.getElementById(cardTitleId(id))?.focus();
        }}
      />
    </>
  );
}

/** The band, with the forecast (not for a member, not on a Completed project). */
function Band({ board, bandRef }) {
  const member = board.access === 'member';
  return (
    <ProgressBand
      projectId={board.projectId}
      access={board.access}
      plan={board.plan}
      today={board.today}
      status={board.status}
      counts={board.counts}
      hoursThisMonth={board.hoursThisMonth}
      onPart={board.showPhase}
      onPhaseMove={board.movePhase}
      onMoved={board.phaseMoved}
      stayFor={board.stayFor}
      bandRef={bandRef}
    >
      {member || board.status === 'completed' ? null : <ForecastLine forecast={board.forecast} />}
    </ProgressBand>
  );
}

function BoardBody(props) {
  const { board, rootRef, bandRef, boardRef, wrapRef, viewRef } = useBoard(props);
  return (
    <div className={styles.tab} ref={rootRef}>
      <MoveLive />
      <Band board={board} bandRef={bandRef} />
      {board.status === 'completed' ? <CompletedNote manage={board.access === 'manage'} /> : null}
      {board.access === 'team' ? (
        <p className={styles.readOnly}>
          Only {editorsText(board.pmName)} can change tasks and phases.
        </p>
      ) : null}
      <section className={styles.view} data-fill={board.fill ? '' : undefined} aria-label="Tasks">
        <BoardToolbar board={board} />
        <FilterLine board={board} />
        <div ref={viewRef} className={styles.views} data-view={board.view}>
          <ViewBody board={board} boardRef={boardRef} wrapRef={wrapRef} />
        </div>
      </section>
      {board.access === 'manage' ? <Dialogs board={board} /> : null}
    </div>
  );
}

/**
 * @param {{ projectId: number, projectName: string, access: 'manage' | 'team' | 'member',
 *   filesAccess: 'manage' | 'member' | 'none', tasks: object[],
 *   counts: Record<string, { total: number, done: number }>, plan: object, today: string,
 *   status: string, pmId: number | null, pmName: string | null, viewerId: number | null,
 *   viewerName: string | null, hoursThisMonth?: number | null, forecast?: object | null,
 *   show?: string | null, view?: 'board' | 'table', railOpen?: boolean }} props tasks: board
 *   rows (phasesView.toBoardTask); counts: every task of the project per phase (countsByPhase for
 *   a member); forecast: the PM view's; show: `?show=critical` or `files` ticks that Filter item
 *   first; view and railOpen: the remembered view and rail (cookies, or `?view=`)
 */
export default function Board(props) {
  return (
    <MoveLiveProvider>
      <BoardBody {...props} />
    </MoveLiveProvider>
  );
}
