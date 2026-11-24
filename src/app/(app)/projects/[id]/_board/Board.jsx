'use client';
// The Board (CONTRACT 27, Board tab): the band, then every phase as a column of task cards, with
// finished phases folded into "Done phases". The project's PM and Admins tick cards, add tasks under
// a column, drag cards (or move them from their menu) and drop files on them; another PM reads it
// all and changes nothing; a member sees only their tasks and Anyone tasks, read only. On a phone
// one column shows at a time with back and next buttons.
import EmptyState from '@/components/EmptyState';
import MovePhaseButton from '../MovePhaseButton';
import PhaseDatesDialog from '../PhaseDatesDialog';
import UndoToast from '../UndoToast';
import BoardFilters, { ScrollButtons } from './BoardFilters';
import { progressOf } from './bandView';
import { cardTitleId, editorsText, filterCounts, memberNote, switcherText } from './boardView';
import DonePhasesColumn from './DonePhasesColumn';
import ForecastLine from './ForecastLine';
import MoveTaskDialog from './MoveTaskDialog';
import PhaseColumn, { NoPhaseColumn } from './PhaseColumn';
import PhoneSwitcher from './PhoneSwitcher';
import ProgressBand from './ProgressBand';
import { useBoard } from './useBoard';
import styles from './Board.module.css';
import rowStyles from './BoardFilters.module.css';

/** The columns: Done phases, the six phases, then No phase yet when it has tasks. */
function Columns({ board, boardRef, member }) {
  return (
    <div
      ref={boardRef}
      className={`${styles.board} ${member ? styles.memberBoard : ''}`}
      id="project-board"
    >
      <DonePhasesColumn tiles={board.tiles} onToggle={board.toggleOpened} />
      {board.columns.map((column) =>
        column.kind === 'none' ? (
          <NoPhaseColumn key={column.key} column={column} board={board} />
        ) : (
          <PhaseColumn key={column.key} column={column} board={board} />
        ),
      )}
    </div>
  );
}

function Switcher({ board }) {
  const column = board.columns.find((one) => one.key === board.step) ?? board.columns[0];
  return (
    <PhoneSwitcher
      steps={board.steps}
      step={board.step}
      text={switcherText(column, board.filter)}
      onStep={board.setStep}
    />
  );
}

/** A member's board: "Your tasks", the columns and what is left out. */
function MemberTasks({ board, boardRef }) {
  if (board.tasks.length === 0) {
    return (
      <EmptyState
        title="Nothing for you on this project yet."
        body="Your PM adds tasks here. Tasks for anyone on the project show here too."
      />
    );
  }
  return (
    <section className={styles.section} aria-labelledby="board-your-tasks">
      <div className={rowStyles.row}>
        <h2 id="board-your-tasks" className={rowStyles.heading}>
          Your tasks
        </h2>
        <ScrollButtons scroll={board.scroll} />
      </div>
      <Switcher board={board} />
      <Columns board={board} boardRef={boardRef} member />
      <p className={styles.memberNote}>{memberNote(progressOf(board.counts).total)}</p>
    </section>
  );
}

/** The PM view: the pills, the switcher and the columns. */
function TeamTasks({ board, boardRef }) {
  return (
    <>
      <BoardFilters
        filter={board.filter}
        onFilter={board.setFilter}
        counts={filterCounts(board.tasks)}
        files={board.showFiles}
        scroll={board.scroll}
      />
      <Switcher board={board} />
      <Columns board={board} boardRef={boardRef} />
    </>
  );
}

/** The dialogs the PM opens from the board: move a card, a phase's dates, the project's phase. */
function Dialogs({ board }) {
  const { plan, moves } = board;
  const phase = board.datesFor ? plan.phases.find((row) => row.key === board.datesFor) : null;
  return (
    <>
      <MoveTaskDialog
        task={board.moveFor}
        counts={board.counts}
        onClose={board.closeMove}
        onMove={(task, to) => {
          board.closeMove();
          board.move(task, to, 'dialog');
        }}
      />
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

/**
 * @param {{ projectId: number, access: 'manage' | 'team' | 'member',
 *   filesAccess: 'manage' | 'member' | 'none', tasks: object[],
 *   counts: Record<string, { total: number, done: number }>, plan: object, today: string,
 *   status: string, pmName: string | null, hoursThisMonth?: number | null,
 *   forecast?: object | null, show?: string }} props tasks: board rows (phasesView.toBoardTask,
 *   with fileCount); counts: every task of the project per phase (countsByPhase for a member);
 *   forecast: the PM view's; show: '?show=critical' or 'files' presses that pill first
 */
export default function Board(props) {
  const [board, boardRef] = useBoard(props);
  const member = props.access === 'member';
  return (
    <div className={styles.tab}>
      {props.access === 'team' ? (
        <p className={styles.readOnly}>
          Only {editorsText(props.pmName)} can change tasks and phases.
        </p>
      ) : null}
      <ProgressBand
        projectId={props.projectId}
        access={props.access}
        plan={props.plan}
        today={props.today}
        counts={board.counts}
        hoursThisMonth={props.hoursThisMonth}
        onPart={board.showPhase}
        onPhaseMove={board.movePhase}
      >
        {member ? null : <ForecastLine forecast={props.forecast} />}
      </ProgressBand>
      {member ? (
        <MemberTasks board={board} boardRef={boardRef} />
      ) : (
        <TeamTasks board={board} boardRef={boardRef} />
      )}
      {props.access === 'manage' ? <Dialogs board={board} /> : null}
    </div>
  );
}
