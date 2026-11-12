// Project health (CONTRACT 22, "Forecast"): from the tasks done in the last 3 full weeks, works out
// when the open tasks will end and whether that is before the deadline. Pure and safe in the
// browser: no I/O, and today comes in as an argument.
import { addDays, dayjs, formatDayMonthShort, trimNumber, weekRange } from '@/lib/time';
import { plural } from '@/lib/text';

/** How many full weeks the speed looks at. */
const WEEKS_LOOKED_AT = 3;
/** More days late than this is Off track; fewer is At risk. */
const AT_RISK_DAYS = 7;

const PILLS = {
  off: 'Off track',
  risk: 'At risk',
  on: 'On track',
  nodata: 'Not enough data',
  nodeadline: 'No deadline',
  noplan: 'No plan yet',
  hold: 'On hold',
  completed: 'Completed',
};

const TONES = { off: 'red', risk: 'marigold', on: 'green' };

// The list's order: the ones that need attention first.
const KIND_ORDER = Object.keys(PILLS);

/** Whole days from one 'YYYY-MM-DD' to another; negative when `to` is earlier. */
function daysBetween(from, to) {
  return dayjs.utc(to).diff(dayjs.utc(from), 'day');
}

/** '29 Dec', with the year when it isn't this year's ('10 Jan 2027'). */
function shortDate(date, today) {
  const sameYear = String(date).slice(0, 4) === String(today).slice(0, 4);
  return sameYear ? formatDayMonthShort(date) : `${formatDayMonthShort(date)} ${date.slice(0, 4)}`;
}

const dayCount = (days) => `${days} ${plural(days, 'day')}`;
const tasksAWeek = (count) => `${count} ${plural(count, 'task')} a week`;

/**
 * A speed in words: "4 tasks a week", "1 task a week", "about 3.5 tasks a week".
 * @param {number} speed tasks a week
 * @returns {string}
 */
export function speedText(speed) {
  if (Number.isInteger(speed)) return tasksAWeek(speed);
  return `about ${trimNumber(speed, 1)} tasks a week`;
}

/**
 * Whole weeks between the day the project was created and this Monday, at most 3, so a young
 * project's speed isn't pulled down by weeks before it existed. An unknown date counts as old.
 * @param {string | null | undefined} createdOn 'YYYY-MM-DD'
 * @param {string} today 'YYYY-MM-DD'
 * @returns {number} 0 to 3
 */
export function weeksCounted(createdOn, today) {
  if (!createdOn) return WEEKS_LOOKED_AT;
  const weeks = Math.floor(daysBetween(createdOn, weekRange(today).from) / 7);
  return Math.min(Math.max(weeks, 0), WEEKS_LOOKED_AT);
}

/**
 * The numbers. Divisions are done last, on whole numbers, so a speed of 10 tasks in 3 weeks finishes
 * 10 tasks in exactly 21 days (10 / (10 / 3) * 7 is a little over 21 in floating point).
 */
function measure({ status, total, done, doneByWeek, deadline, today, createdOn }) {
  const allTasks = Math.max(Number(total) || 0, 0);
  const doneTasks = Math.max(Number(done) || 0, 0);
  const left = Math.max(allTasks - doneTasks, 0);
  const weeks = weeksCounted(createdOn, today);
  const recent = (doneByWeek ?? [])
    .slice(0, weeks)
    .reduce((sum, count) => sum + (Number(count) || 0), 0);
  const running = status !== 'completed' && status !== 'on_hold';
  const daysLeft = deadline ? daysBetween(today, deadline) : null;
  const speed = weeks > 0 ? recent / weeks : 0;
  const finishOn =
    running && left > 0 && speed > 0
      ? addDays(today, Math.ceil((left * 7 * weeks) / recent))
      : null;
  return {
    pct: allTasks > 0 ? Math.round((doneTasks * 100) / allTasks) : 0,
    done: doneTasks,
    total: allTasks,
    left,
    finishOn,
    daysLate: deadline && finishOn ? daysBetween(deadline, finishOn) : null,
    daysLeft,
    speed,
    needed:
      running && left > 0 && daysLeft > 0
        ? Math.max(Math.round((left * 7) / daysLeft), Math.floor(speed) + 1)
        : null,
  };
}

const look = (kind, title, body) => ({ kind, pill: PILLS[kind], title, body });

/** The rows that need a deadline and a speed. */
function paceLook({ deadline, today }, { finishOn, daysLate, speed, needed }) {
  const by = shortDate(deadline, today);
  const pace = `At the current speed (${speedText(speed)}) the work ends around ${shortDate(finishOn, today)}.`;
  if (daysLate <= 0) {
    const title =
      daysLate === 0
        ? 'On track: will finish on time'
        : `On track: will finish about ${dayCount(-daysLate)} early`;
    return look('on', title, `${pace} The deadline is ${by}.`);
  }
  const need = needed ? ` To finish by ${by}, the team needs about ${tasksAWeek(needed)}.` : '';
  if (daysLate > AT_RISK_DAYS) {
    const title = `Off track: will miss the deadline by about ${dayCount(daysLate)}`;
    return look('off', title, `${pace}${need}`);
  }
  const title = `At risk: may miss the deadline by about ${dayCount(daysLate)}`;
  return look('risk', title, `${pace}${need}`);
}

/** The first row of the contract's table that matches. */
function lookOf(input, numbers) {
  const { status, deadline, today } = input;
  const { total, left, daysLeft, speed } = numbers;
  if (status === 'completed') return look('completed', 'Completed', 'This project is completed.');
  if (status === 'on_hold') return look('hold', 'On hold', 'This project is on hold.');
  if (total === 0) {
    return look(
      'noplan',
      'No plan yet',
      'Add tasks to the phases to see if the project is on track.',
    );
  }
  if (!deadline) {
    return look(
      'nodeadline',
      'No deadline yet',
      'Add a deadline to see if the project is on track.',
    );
  }
  if (left === 0) {
    const allDone = total === 1 ? 'The only task is done.' : `All ${total} tasks are done.`;
    const body = `${allDone} The deadline is ${shortDate(deadline, today)}.`;
    return look('on', 'On track: all tasks are done', body);
  }
  if (daysLeft < 0) {
    const open = left === 1 ? '1 task is still open.' : `${left} tasks are still open.`;
    return look('off', `Off track: the deadline passed ${dayCount(-daysLeft)} ago`, open);
  }
  if (speed === 0) {
    return look(
      'nodata',
      'Not enough data yet',
      'Daybook works out the speed from tasks marked done in the last 3 full weeks.',
    );
  }
  return paceLook(input, numbers);
}

/**
 * Works out a project's health.
 * @param {{ status: 'active'|'on_hold'|'completed', total: number, done: number,
 *   doneByWeek: number[], deadline: string | null, today: string, createdOn: string | null }} input
 *   doneByWeek = tasks done in the last 3 full weeks, newest first (progressByProject); dates are
 *   'YYYY-MM-DD' in the company time zone
 * @returns {{ kind: 'completed'|'hold'|'noplan'|'nodeadline'|'on'|'off'|'nodata'|'risk',
 *   pill: string, title: string, body: string, pct: number, done: number, total: number,
 *   left: number, finishOn: string | null, daysLate: number | null, daysLeft: number | null,
 *   speed: number, needed: number | null }} finishOn is null with nothing left, no speed, or on a
 *   completed or on-hold project; daysLate also with no deadline (negative = early); daysLeft is
 *   null with no deadline (negative = passed); needed only with tasks left and days left
 */
export function forecastProject(input) {
  const numbers = measure(input);
  return { ...lookOf(input, numbers), ...numbers };
}

/**
 * The tone of a health pill for `Tag`: Off track red, At risk marigold, On track green, the rest
 * neutral.
 * @param {string} kind forecastProject's kind
 * @returns {'red'|'marigold'|'green'|'neutral'}
 */
export function healthTone(kind) {
  return TONES[kind] ?? 'neutral';
}

/**
 * The projects list's order: off, risk, on, nodata, nodeadline, noplan, hold, completed; then the
 * nearest deadline (no deadline last); then name.
 * @param {{ kind: string, deadline?: string | null, name?: string }} a
 * @param {{ kind: string, deadline?: string | null, name?: string }} b
 * @returns {number} for Array.prototype.sort
 */
export function compareHealth(a, b) {
  const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  if ((a.deadline ?? null) !== (b.deadline ?? null)) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  }
  return String(a.name ?? '').localeCompare(String(b.name ?? ''));
}
