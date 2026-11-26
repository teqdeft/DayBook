'use client';
// The project's phase as the Board shows it (CONTRACT 28, Phase move sequence): after "Move to
// Launch" (or "Go back to Testing", or a column's "Make this the current phase") is saved, the
// confirm window's exit plays first, then the move: the band fills, the ring slides, the finished
// column folds into the rail, then "Phase changed to Launch." and the refresh. The new phase shows
// at once (`shownPhase`, laid over the page's plan as the server writes it, in phaseMotion's one
// flushSync commit) and is dropped as soon as the page's plan changes: the refresh brings this
// move, or someone else's, which then shows without motion. Every animation, clone and timer ends
// when the Board goes.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { duration } from '@/lib/motion/tokens';
import { phaseLabel } from '@/modules/projectPlan/phases';
import { shownPlan } from './bandView';
import { boardColumns, foldsBetween } from './boardView';
import { playPhaseMove } from './phaseMotion';

/**
 * The plan shown: the page's, or the one a move just made until the page's plan changes.
 * @returns {[object, (phase: string) => void]}
 */
function useShownPlan(plan, today) {
  const [shown, setShown] = useState(null);
  if (shown && shown.over !== plan) setShown(null);
  const current = shown && shown.over === plan ? shownPlan(plan, shown.phase, today) : plan;
  const show = useCallback((phase) => setShown({ phase, over: plan }), [plan]);
  return [current, show];
}

/**
 * @param {{ plan: object, today: string, columnArgs: object, refs: { board: object,
 *   band: object } }} args columnArgs: boardColumns' other arguments (tasks, member, opened,
 *   completed), to tell which columns fold and whether the rail is new
 * @returns {{ plan: object, moved: (to: string) => void }} plan: as shown; moved: what
 *   MovePhaseButton calls after a good save
 */
export function usePhaseMove({ plan, today, columnArgs, refs }) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const [shown, show] = useShownPlan(plan, today);
  const cleanup = useRef(() => {});
  const timer = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cleanup.current();
    },
    [],
  );

  // Called from MovePhaseButton's save, never in render: the columns before and after the move
  // tell which ones fold and whether the rail is new.
  const moved = (to) => {
    const after = shownPlan(shown, to, today);
    const { folds, railIsNew } = foldsBetween(
      boardColumns({ ...columnArgs, plan: shown, today }),
      boardColumns({ ...columnArgs, plan: after, today }),
    );
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      cleanup.current();
      cleanup.current = playPhaseMove({
        board: refs.board.current,
        band: refs.band.current,
        from: shown.currentPhase ?? null,
        to,
        folds,
        railIsNew,
        commit: () => show(to),
        toast: () => toast({ title: `Phase changed to ${phaseLabel(to)}.` }),
        refresh: () => startRefresh(() => router.refresh()),
      });
    }, duration('out'));
  };

  return { plan: shown, moved };
}
