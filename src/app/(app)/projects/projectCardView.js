// What a card on My projects shows about the project's plan (CONTRACT 27, My projects): a mini band
// of the six phases (done green, the current one filled to the project's share of done tasks,
// later ones the track) and the line "Development · 66% · Deadline 16 Dec" ("No phase yet · 40%",
// "No tasks yet"). Pure: the cards and their tests use it.
import { formatDayMonthShort } from '@/lib/time';
import { PHASE_KEYS, phaseIndex, phaseLabel } from '@/modules/projectPlan/phases';

/** Done tasks as a whole percent of all of them, 0 without tasks. */
export function percentDone(progress) {
  const total = Number(progress?.total) || 0;
  return total > 0 ? Math.round(((Number(progress.done) || 0) / total) * 100) : 0;
}

/**
 * The six parts of the mini band.
 * @param {{ plan?: { currentPhase: string | null } | null, progress?: { total, done } | null }} args
 * @returns {Array<{ key: string, state: 'done' | 'current' | 'later', fill: number }>} fill: the
 *   current part's share in percent (100 for done parts, 0 for later ones)
 */
export function miniBand({ plan, progress }) {
  const current = phaseIndex(plan?.currentPhase);
  const share = percentDone(progress);
  return PHASE_KEYS.map((key, index) => {
    if (index < current) return { key, state: 'done', fill: 100 };
    if (index === current) return { key, state: 'current', fill: share };
    return { key, state: 'later', fill: 0 };
  });
}

/**
 * The muted line under the band.
 * @param {{ plan?: { currentPhase: string | null, deadline: string | null } | null,
 *   progress?: { total, done } | null }} args
 * @returns {string}
 */
export function phaseLine({ plan, progress }) {
  if (!(Number(progress?.total) > 0)) return 'No tasks yet';
  const words = [plan?.currentPhase ? phaseLabel(plan.currentPhase) : 'No phase yet'];
  words.push(`${percentDone(progress)}%`);
  if (plan?.deadline) words.push(`Deadline ${formatDayMonthShort(plan.deadline)}`);
  return words.join(' · ');
}
