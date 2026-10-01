// Turns the people and the schedule into one plan per person per working day: where they were,
// when they checked in and out, and which projects and hours their report has. Tasks come later
// (tasks.js), once every day is planned.
import { PEOPLE } from './people.js';
import {
  FORCE_PRESENT,
  LATE_GRACE_MINUTES,
  MISSING_CHECKOUT,
  TODAY,
  VISHAL_DAYS,
  WEEK_DAYS,
  WEEK_HOURS,
} from './schedule.js';
import { clockOf, hash, hoursToMinutes, minutesOf } from './calendar.js';

// Present but no report, somewhere in the older history ("most" reports are submitted).
const HISTORY_MISSES = new Set(['sahil|30', 'harsh|26']);
const DAILY_HOURS = [6, 6.5, 7, 7.5, 8, 7, 6.5, 7.5];

/**
 * Plans every tracked person's working days, oldest first.
 * @param {{ days: string[], lateAfter: string, midday: boolean, projects: Map<string, object> }} ctx
 *   days[offset] is the date of that working-day offset (0 = anchor)
 * @returns {Map<string, object[]>} person key -> plans, oldest first
 */
export function planAllDays(ctx) {
  const plans = new Map();
  for (const person of PEOPLE.filter((p) => p.tracksAttendance && p.status === 'active')) {
    const list = [];
    for (let offset = ctx.days.length - 1; offset >= 0; offset -= 1) {
      list.push(planDay(person, offset, ctx));
    }
    plans.set(person.key, list);
  }
  return plans;
}

function planDay(person, offset, ctx) {
  const base = { key: person.key, offset, date: ctx.days[offset] };
  if (person.key === 'vishal' && offset < VISHAL_DAYS.length) {
    return withLate({ ...base, ...planVishal(offset, ctx) }, ctx);
  }
  if (offset <= 2) return withLate({ ...base, ...planThisWeek(person, offset) }, ctx);
  return withLate({ ...base, ...planHistory(person, offset, ctx) }, ctx);
}

function planVishal(offset, ctx) {
  const source = VISHAL_DAYS[offset];
  if (source.absent) return { absent: true };
  const entries = source.entries.map(([project, hours, tasks]) => ({
    project,
    minutes: hoursToMinutes(hours),
    tasks: tasks.map(([title, status]) => ({ title, status })),
  }));
  const plan = {
    where: source.where,
    in: source.in,
    out: source.out,
    report: { status: 'submitted', entries, revisions: source.revisions, submitAt: '18:25' },
  };
  if (offset === 0) {
    plan.report.submitAt = '18:29';
    if (ctx.midday) {
      // 01 and 02: checked in at 9:32, still in, today's report is a draft.
      plan.out = null;
      plan.report = { status: 'draft', entries, revisions: 0 };
    }
  }
  return plan;
}

function planThisWeek(person, offset) {
  const week = WEEK_DAYS[offset];
  if (week.absent.includes(person.key)) return { absent: true };
  const plan = {
    where: week.wfh.includes(person.key) ? 'wfh' : 'office',
    in: onTimeClock(person.key, offset),
    out: checkOutClock(person.key, offset),
  };
  const hours = WEEK_HOURS[person.key]?.[offset];
  plan.report = hours ? submitted(person.key, offset, hours) : null;
  if (offset === 0) applyToday(person, plan);
  if (person.key === MISSING_CHECKOUT.key && offset === MISSING_CHECKOUT.offset) {
    plan.in = MISSING_CHECKOUT.in;
    plan.out = null;
    plan.checkoutStatus = 'missing';
  }
  return plan;
}

function applyToday(person, plan) {
  const today = TODAY[person.key] ?? {};
  if (today.in) plan.in = today.in;
  // Today (6:52 PM on the canvas): the canvas people have their own times; about half of
  // everyone else has checked out.
  if (today.in) plan.out = today.out ?? null;
  else if (hash(person.key, 'out-today') % 2 === 0) plan.out = null;
  if (today.unverified) plan.unverified = true;
  if (today.note) plan.note = today.note;
  if (today.report === 'none') plan.report = null;
  if (today.report === 'draft') {
    plan.report = { status: 'draft', entries: [{ project: 'seo', minutes: 180 }], revisions: 0 };
  }
}

function planHistory(person, offset, ctx) {
  const forced = FORCE_PRESENT.some(([key, at]) => key === person.key && at === offset);
  if (!forced && hash(person.key, offset, 'absent') % 41 === 0) return { absent: true };
  const wfh = person.wfhEvery > 0 && hash(person.key, offset, 'wfh') % person.wfhEvery === 0;
  const late = hash(person.key, offset, 'late') % 15 === 0;
  const plan = {
    where: wfh ? 'wfh' : 'office',
    in: late
      ? clockOf(minutesOf('09:41') + (hash(person.key, offset, 'lm') % 35))
      : onTimeClock(person.key, offset),
    out: checkOutClock(person.key, offset),
  };
  if (HISTORY_MISSES.has(`${person.key}|${offset}`)) return { ...plan, report: null };
  const entries = historyEntries(person, offset, ctx);
  plan.report = entries.length ? submitted(person.key, offset, entries) : null;
  return plan;
}

/** One or two projects the person could log on that day, with 6-8 hours in 0.25 steps. */
function historyEntries(person, offset, ctx) {
  const available = person.projects.filter((key) => {
    const project = ctx.projects.get(key);
    return project && offset >= project.minOffset && offset <= project.maxOffset;
  });
  if (available.length === 0) return [];
  const total = DAILY_HOURS[hash(person.key, offset, 'hours') % DAILY_HOURS.length];
  const main = available[0];
  if (available.length === 1 || hash(person.key, offset, 'split') % 3 === 0) {
    return [[main, total]];
  }
  const other = available[1 + (hash(person.key, offset, 'other') % (available.length - 1))];
  const mainHours = Math.round(total * 0.6 * 4) / 4;
  return [
    [main, mainHours],
    [other, total - mainHours],
  ];
}

function submitted(key, offset, hours) {
  return {
    status: 'submitted',
    entries: hours.map(([project, h]) => ({ project, minutes: hoursToMinutes(h) })),
    revisions: offset > 0 && hash(key, offset, 'rev') % 23 === 0 ? 2 : 1,
  };
}

/** A check-in between 9:05 and 9:30 (never late). */
function onTimeClock(key, offset) {
  return clockOf(minutesOf('09:05') + (hash(key, offset, 'in') % 26));
}

function checkOutClock(key, offset) {
  return clockOf(minutesOf('18:02') + (hash(key, offset, 'outc') % 48));
}

/** Adds lateMinutes (canvas grace rule) and the check-out status. */
function withLate(plan, ctx) {
  if (plan.absent) return plan;
  const diff = minutesOf(plan.in) - minutesOf(ctx.lateAfter);
  plan.lateMinutes = diff > LATE_GRACE_MINUTES ? diff : 0;
  plan.checkoutStatus ??= plan.out ? 'checked_out' : 'open';
  plan.unverified ??= false;
  plan.note ??= null;
  if (plan.report && plan.report.status === 'submitted' && !plan.report.submitAt) {
    plan.report.submitAt = submitClock(plan);
  }
  return plan;
}

/** Reports go in shortly before check-out (between 6:17 and 6:36 PM when still checked in). */
function submitClock(plan) {
  const out = plan.out ? minutesOf(plan.out) : minutesOf('18:40');
  return clockOf(out - 4 - (hash(plan.key, plan.offset, 'submit') % 20));
}
