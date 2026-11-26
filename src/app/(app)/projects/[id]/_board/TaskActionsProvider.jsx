'use client';
// One place for the task actions every part of a project page shares (CONTRACT 28, The people
// window): give a task to someone (`assign`), Assign to me (`take`), the people window
// (`openPeople`), Move to phase… (`openMove`, the one MoveTaskDialog of the page) and the persons on
// their way laid over the Board's, the Table's and the task window's tasks (`apply`). The Board
// registers its mover (so a card glides), its new-card motion and its flash (`registerBoard`); the
// New and Edit task windows reach them through `board`. ProjectView mounts it for the project's PM
// and Admins; outside it `useTaskActions()` is null.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import UndoToast from '../UndoToast';
import MoveTaskDialog from './MoveTaskDialog';
import PeopleWindow from './PeopleWindow';
import { useAssign } from './useAssign';
import { useMoveDialog } from './useMoveDialog';
import { usePeople } from './usePeople';

const ActionsContext = createContext(null);

/** The Board's registration: a stable `board` object that calls the latest registered one. */
function useBoardSlot() {
  const current = useRef(null);
  const [on, setOn] = useState(false);
  const proxy = useMemo(
    () => ({
      move: (...args) => current.current?.move?.(...args),
      expectNew: (...args) => current.current?.expectNew?.(...args),
      flash: (...args) => current.current?.flash?.(...args),
    }),
    [],
  );
  const register = useCallback((board) => {
    current.current = board;
    setOn(true);
    return () => {
      if (current.current !== board) return;
      current.current = null;
      // A Board that registers again in the same commit (new functions) keeps `board` on.
      queueMicrotask(() => {
        if (!current.current) setOn(false);
      });
    };
  }, []);
  return { board: on ? proxy : null, register, current };
}

/** What `useTaskActions()` gives: stable while its pieces are. */
function useActionsValue({ persons, people, moves, slot }) {
  const { assign: give, take, apply } = persons;
  const { openPeople, reask } = people;
  const { open: openMove } = moves;
  const { register: registerBoard, board } = slot;
  return useMemo(
    () => ({
      assign: (task, assigneeId, opts = {}) =>
        give(task, assigneeId, {
          ...opts,
          onShareAsk: opts.onShareAsk ?? (() => reask(task, assigneeId, opts.anchor)),
        }),
      take,
      openPeople,
      openMove,
      apply,
      registerBoard,
      board,
    }),
    [give, take, apply, openPeople, reask, openMove, registerBoard, board],
  );
}

/** The page's windows and toast: the people window, Move to phase… and the person's Undo. */
function PageWindows({ people, moves, persons, options, viewerId, project }) {
  const shown = people.people;
  const move = moves.move;
  return (
    <>
      {shown ? (
        <PeopleWindow
          key={shown.key}
          tasks={shown.tasks}
          anchor={shown.anchor}
          title={shown.title}
          options={options}
          viewerId={viewerId}
          project={project}
          ask={shown.ask}
          open={shown.open}
          onPick={shown.onPick ?? people.pickFor(shown)}
          onClose={(how) => people.close(shown, how)}
        />
      ) : null}
      {move ? (
        <MoveTaskDialog
          open={move.open}
          tasks={move.tasks}
          counts={move.counts}
          onMove={moves.choose}
          onClose={moves.close}
        />
      ) : null}
      <UndoToast
        pending={persons.undo.pending}
        onUndo={persons.undo.run}
        onEnd={persons.undo.end}
      />
    </>
  );
}

/**
 * @param {{ projectId: number, project: { id: number, pmId: number | null }, status?: string,
 *   options?: object[], viewerId: number, viewerName: string,
 *   children: import('react').ReactNode }} props options: `head.options` (AssigneeOption[])
 */
export function TaskActionsProvider({
  projectId,
  project,
  options = [],
  viewerId,
  viewerName,
  children,
}) {
  const viewer = useMemo(() => {
    const me = options.find((option) => Number(option.id) === Number(viewerId));
    return me ?? { id: viewerId, name: viewerName, status: 'active' };
  }, [options, viewerId, viewerName]);
  const persons = useAssign({ options, viewer });
  const slot = useBoardSlot();
  const moves = useMoveDialog(slot.current);
  const people = usePeople({ assign: persons.assign });
  const value = useActionsValue({ persons, people, moves, slot });
  return (
    <ActionsContext.Provider value={value}>
      {children}
      <PageWindows
        people={people}
        moves={moves}
        persons={persons}
        options={options}
        viewerId={viewerId}
        project={project ?? { id: projectId, pmId: null }}
      />
    </ActionsContext.Provider>
  );
}

/**
 * @returns {{ assign: (task: object, assigneeId: number | null, options?: { origin?: Element,
 *   anchor?: Element, shareConfirmed?: boolean, shareWith?: number | '' }) =>
 *     Promise<object | null>,
 *   take: (task: object, options?: { origin?: Element, focus?: () => Element | null }) =>
 *     Promise<object | null>,
 *   openPeople: (options: { tasks: object[], anchor?: Element, title?: string,
 *     onPick?: (assigneeId: number | null, options: { shareConfirmed: boolean,
 *       tasks: object[] }) => unknown }) => void,
 *   openMove: (options: { tasks: object[], origin?: Element, onMove?: (to: string) => unknown,
 *     counts?: object }) => void,
 *   apply: (tasks: object[]) => object[],
 *   registerBoard: (board: { move: Function, expectNew: (taskId: number, phase: string) => void,
 *     flash: (taskId: number) => void, counts?: object | (() => object) }) => () => void,
 *   board: { move: Function, expectNew: Function, flash: Function } | null } | null} null
 *   outside a provider; assign and take resolve the saved task, or null when the save failed
 */
export function useTaskActions() {
  return useContext(ActionsContext);
}
