'use client';
// When the band plays its progress (CONTRACT 28, Motion, Moments: Band progress): only after the
// viewer's own change, never on load and never for what a refresh brings from others. A commit whose
// page tasks are the same ones as before shows a change of the viewer's own (a move, a delete, a
// ticked card that has left, their Undo): it plays at once. A tick's change often comes with the
// page's refresh instead, so a tick, a Reopen or a bulk move asks for it (`expectBand`): the first
// commit that draws a change within 2 s plays it, once (useCommitMotion's queue). A phase move
// changes the band too, and plays it itself (phaseMotion.js).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useCommitMotion } from '@/lib/motion/useMotion';
import { TASK_REOPENED } from '../taskEvents';
import { bandDiffers, playBandChange } from './bandMotion';
import { bandValues } from './bandView';

/** Plays from the band last drawn to the one drawn now, which is then the last drawn. */
function playNow(memory, band) {
  const before = memory.drawn;
  memory.drawn = memory.now;
  memory.stop();
  memory.stop = playBandChange(band, before, memory.now);
}

/**
 * @param {{ bandRef: import('react').RefObject<Element>, plan: object, counts: object,
 *   tasks: object[] }} args plan: as shown; counts: the band's; tasks: the page's own (a new list
 *   comes only with a refresh)
 * @returns {() => void} expectBand: the viewer did something whose change comes with the refresh
 */
export function useBandMotion({ bandRef, plan, counts, tasks }) {
  const values = useMemo(() => bandValues({ plan, counts }), [plan, counts]);
  const memory = useRef({ drawn: null, now: null, tasks, stop: () => {}, asked: 0 });
  useLayoutEffect(() => {
    memory.current.now = values;
    memory.current.drawn ??= values;
  });
  const motion = useCommitMotion(bandRef); // its effect plays the requests, between these two
  useLayoutEffect(() => {
    const last = memory.current;
    if (last.tasks === tasks && bandDiffers(last.drawn, last.now)) playNow(last, bandRef.current);
    last.drawn = last.now;
    last.tasks = tasks;
  });
  const expectBand = useCallback(() => {
    const last = memory.current;
    last.asked += 1;
    motion.expect({
      id: `band:${last.asked}`,
      ready: () => bandDiffers(last.drawn, last.now),
      play: (band) => playNow(last, band),
    });
  }, [motion]);
  useEffect(() => {
    const last = memory.current;
    window.addEventListener(TASK_REOPENED, expectBand);
    return () => {
      window.removeEventListener(TASK_REOPENED, expectBand);
      last.stop();
    };
  }, [expectBand]);
  return expectBand;
}
