// What the project page says about dates and phases (CONTRACT 22), with the prototype's wording: the
// Overview, Phases and Timeline tabs and the move dialog all read from here. Pure and safe in the
// browser: today comes in as an argument, and every date is 'YYYY-MM-DD' in the company time zone.
import { plural } from '@/lib/text';
import { dayjs, formatDayMonthShort } from '@/lib/time';
import { PROJECT_PHASES, nextPhase, phaseIndex, phaseLabel } from '@/modules/projectPlan/phases';

/** Whole days from one date to another; negative when `to` is earlier. */
export function daysBetween(from, to) {
  return dayjs.utc(to).diff(dayjs.utc(from), 'day');
}

/** '1 day', '12 days' */
export const dayCount = (days) => `${days} ${plural(days, 'day')}`;

/** '29 Dec', with the year when it isn't this year's ('10 Jan 2027'). */
export function shortDate(date, today) {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return sameYear ? formatDayMonthShort(date) : longDate(date);
}

/** '15 Dec 2026' */
export function longDate(date) {
  return `${formatDayMonthShort(date)} ${date.slice(0, 4)}`;
}

/** '6 to 23 Oct', '26 Oct to 20 Nov', '16 Dec to 15 Jan 2027', or one day ('11 Nov'). */
export function dateRange(start, end, today) {
  if (start === end) return shortDate(start, today);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  if (sameYear && start.slice(0, 7) === end.slice(0, 7)) {
    return `${Number(start.slice(8))} to ${shortDate(end, today)}`;
  }
  if (sameYear && start.slice(0, 4) === today.slice(0, 4)) {
    return `${shortDate(start, today)} to ${shortDate(end, today)}`;
  }
  return `${shortDate(start, today)} to ${longDate(end)}`;
}

/**
 * A phase's planned dates in words.
 * @param {{ plannedStart: string | null, plannedEnd: string | null }} phase
 * @param {string} today
 * @returns {string | null} a range, 'From 6 Oct' or 'Until 23 Oct' with one date; null with none
 */
export function plannedRange({ plannedStart, plannedEnd }, today) {
  if (plannedStart && plannedEnd) return dateRange(plannedStart, plannedEnd, today);
  if (plannedStart) return `From ${shortDate(plannedStart, today)}`;
  if (plannedEnd) return `Until ${shortDate(plannedEnd, today)}`;
  return null;
}

/** 'A', 'A and B', 'A, B and C' */
export function joinNames(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** '7 days late', '3 days early' or 'on time'. */
export function timing(actual, planned) {
  const late = daysBetween(planned, actual);
  if (late > 0) return `${dayCount(late)} late`;
  if (late < 0) return `${dayCount(-late)} early`;
  return 'on time';
}

/**
 * Where a phase stands.
 * @param {string | null} currentPhase
 * @param {{ key: string, actualEnd: string | null }} phase
 * @returns {'current'|'later'|'done'|'skipped'} with no phase yet, every phase is later; a phase
 *   behind the current one that never ended was jumped over
 */
export function phaseStatus(currentPhase, phase) {
  if (phase.key === currentPhase) return 'current';
  if (phaseIndex(phase.key) > phaseIndex(currentPhase)) return 'later';
  return phase.actualEnd ? 'done' : 'skipped';
}

/**
 * The note beside a phase: how late it is.
 * @param {'current'|'later'|'done'|'skipped'} status phaseStatus
 * @param {{ plannedStart, plannedEnd, actualStart, actualEnd }} phase
 * @param {string} today
 * @returns {{ text: string, tone: 'red'|'marigold'|'muted' } | null} null when nothing is late
 */
export function lateNote(status, phase, today) {
  const { plannedStart, plannedEnd, actualStart, actualEnd } = phase;
  if (status === 'skipped') return { text: 'Skipped', tone: 'muted' };
  if (status === 'done') {
    const late = actualEnd && plannedEnd ? daysBetween(plannedEnd, actualEnd) : 0;
    return late > 0 ? { text: `Ended ${dayCount(late)} late`, tone: 'red' } : null;
  }
  if (status === 'later') {
    const ago = plannedStart ? daysBetween(plannedStart, today) : 0;
    return ago > 0 ? { text: `Planned start was ${dayCount(ago)} ago`, tone: 'marigold' } : null;
  }
  const overdue = plannedEnd ? daysBetween(plannedEnd, today) : 0;
  if (overdue > 0) return { text: `${dayCount(overdue)} late`, tone: 'red' };
  const started = actualStart && plannedStart ? daysBetween(plannedStart, actualStart) : 0;
  return started > 0 ? { text: `Started ${dayCount(started)} late`, tone: 'marigold' } : null;
}

/**
 * What the Move button says.
 * @param {string | null} currentPhase
 * @returns {string | null} 'Move to Design'; 'Start Requirement gathering' from no phase yet; null
 *   after the last phase
 */
export function moveLabel(currentPhase) {
  const next = nextPhase(currentPhase);
  if (!next) return null;
  return currentPhase ? `Move to ${phaseLabel(next)}` : `Start ${phaseLabel(next)}`;
}

/** "Design ends today, 7 days late." or, with no planned date to compare with, "Design ends today." */
function moveSentence(phase, verb, planned, today) {
  const when = planned ? `, ${timing(today, planned)}` : '';
  return `${phase} ${verb} today${when}.`;
}

/**
 * The words of the one move dialog.
 * @param {{ phases: Array<{ key, plannedStart, plannedEnd }>, from: string | null, to: string,
 *   today: string }} args phases: the plan's
 * @returns {{ title: string, body: string, okLabel: string }}
 */
export function movePhaseCopy({ phases, from, to, today }) {
  const a = phaseIndex(from);
  const b = phaseIndex(to);
  const label = phaseLabel(to);
  if (b < a) {
    const later = PROJECT_PHASES.slice(b + 1, a + 1).map((phase) => phase.label);
    return {
      title: `Go back to ${label}?`,
      body: `${label} opens again. ${joinNames(later)} ${later.length > 1 ? 'go' : 'goes'} back to not started.`,
      okLabel: 'Go back',
    };
  }
  const rowOf = (key) => phases?.find((phase) => phase.key === key);
  const sentences = [moveSentence(label, 'starts', rowOf(to)?.plannedStart, today)];
  if (a >= 0) {
    sentences.unshift(moveSentence(phaseLabel(from), 'ends', rowOf(from)?.plannedEnd, today));
  }
  const skipped = PROJECT_PHASES.slice(a + 1, b).map((phase) => phase.label);
  if (skipped.length > 0) {
    sentences.push(`${joinNames(skipped)} ${skipped.length > 1 ? 'are' : 'is'} skipped.`);
  }
  const action = a < 0 && b === 0 ? `Start ${label}` : `Move to ${label}`;
  return { title: `${action}?`, body: sentences.join(' '), okLabel: action };
}
