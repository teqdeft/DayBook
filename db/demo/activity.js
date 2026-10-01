// Screen time for the demo (activity_segments, CONTRACT section 11): every tracked person's
// present working days, from check-in to check-out. Mostly active, with short idle breaks,
// locked meetings and a lunch break (screen locked, or no data at all when the laptop was closed).
// Vishal's day today is written out by hand; everyone else's follows a stable hash, never
// Math.random, so every run gives the same rows.
//
// Today is the canvas moment (6:52 PM, or 3:10 PM with --midday): people still checked in report
// up to that minute, some of them idle or locked right then. Farhan's browser has no Idle
// Detection, so his data is the Daybook window only (source 'window'): short visits, no locks.
import { at, clockOf, hash, minutesOf } from './calendar.js';
import { CORRECTIONS } from './requests.js';

const CANVAS_NOW = { evening: '18:52', midday: '15:10' };
const WINDOW_ONLY = new Set(['farhan']);
// What some people still at work are doing at the canvas moment (others: from the hash).
const STATE_NOW = { simran: 'idle', sahil: 'locked', rohit: 'active' };

// Vishal, today (01, 06): in at 9:32, out at 6:34 PM. 7h 27m active, 32m idle, 1h 3m locked.
const VISHAL_TODAY = [
  ['active', '09:32', '10:47'],
  ['idle', '10:47', '10:58'], // coffee
  ['active', '10:58', '12:15'],
  ['idle', '12:15', '12:24'], // talking through the backend changes at a colleague's desk
  ['active', '12:24', '13:21'],
  ['locked', '13:21', '14:02'], // lunch
  ['active', '14:02', '15:36'],
  ['idle', '15:36', '15:48'],
  ['active', '15:48', '16:30'],
  ['locked', '16:30', '16:52'], // meeting room
  ['active', '16:52', '18:34'], // report submitted at 6:29 PM
];

/** Adds a piece, merging it into the previous one when it continues the same state. */
function push(pieces, state, from, to) {
  if (to <= from) return;
  const last = pieces.at(-1);
  if (last && last.state === state && last.to === from) last.to = to;
  else pieces.push({ state, from, to });
}

/** The break after work stretch `i`: [state, minutes] parts (empty when they keep working). */
function breakAfter(i, roll) {
  const kind = roll(`b${i}`, 20);
  if (kind < 11) return [['idle', 3 + roll(`i${i}`, 12)]];
  if (kind < 15) return [['locked', 8 + roll(`l${i}`, 18)]];
  if (kind < 17) {
    return [
      ['idle', 3 + roll(`il${i}`, 4)],
      ['locked', 10 + roll(`ll${i}`, 11)],
    ];
  }
  return [];
}

/**
 * Work between `from` and `to`: active stretches with idle breaks and locked meetings. A block
 * always ends with at least 10 minutes of work (people check out from the app).
 */
function fillWork(pieces, from, to, roll) {
  let t = from;
  for (let i = 0; t < to; i += 1) {
    const activeEnd = Math.min(t + 25 + roll(`w${i}`, 60), to);
    push(pieces, 'active', t, activeEnd);
    t = activeEnd;
    const parts = breakAfter(i, roll);
    const length = parts.reduce((sum, [, minutes]) => sum + minutes, 0);
    if (t >= to || t + length > to - 10) {
      push(pieces, 'active', t, to);
      return;
    }
    for (const [state, minutes] of parts) {
      push(pieces, state, t, t + minutes);
      t += minutes;
    }
  }
}

/** Lunch: locked, idle then locked (screen locked itself), or no data (laptop closed). */
function addLunch(pieces, from, to, roll) {
  const kind = roll('lunch-kind', 4);
  if (kind === 0) return;
  if (kind === 2 && to - from > 20) {
    push(pieces, 'idle', from, from + 10);
    push(pieces, 'locked', from + 10, to);
    return;
  }
  push(pieces, 'locked', from, to);
}

/** A whole day with Idle Detection (source 'system'). */
function systemDay(start, end, roll) {
  const pieces = [];
  const lunchStart = minutesOf('13:00') + roll('lunch', 45);
  const lunchEnd = lunchStart + 30 + roll('lunch-length', 21);
  fillWork(pieces, start, Math.min(lunchStart, end), (label, mod) => roll(`am-${label}`, mod));
  if (end > lunchStart) {
    addLunch(pieces, lunchStart, Math.min(lunchEnd, end), roll);
    if (end > lunchEnd) {
      fillWork(pieces, lunchEnd, end, (label, mod) => roll(`pm-${label}`, mod));
    }
  }
  return pieces;
}

/**
 * Only the Daybook window: check-in, two short visits and writing the report at the end of the
 * day (not yet when still at work).
 */
function windowDay(start, end, roll, { stillIn }) {
  const pieces = [];
  const visit = (from, active, idle) => {
    if (from + active + idle > end || from < start) return;
    push(pieces, 'active', from, from + active);
    push(pieces, 'idle', from + active, from + active + idle);
  };
  visit(start, 6 + roll('w-in', 5), 3 + roll('w-in-idle', 4));
  visit(minutesOf('11:30') + roll('w-am', 40), 5 + roll('w-am-len', 8), 4);
  visit(minutesOf('15:00') + roll('w-pm', 40), 4 + roll('w-pm-len', 6), 6);
  const reportFrom = end - 22 - roll('w-report', 10);
  if (!stillIn && reportFrom > (pieces.at(-1)?.to ?? start)) {
    push(pieces, 'active', reportFrom, end);
  }
  return pieces;
}

/** People still in at the canvas moment: some are idle or have the screen locked right now. */
function endStillIn(key, pieces, end, roll) {
  const kind = roll('now', 5);
  const state = STATE_NOW[key] ?? (kind < 3 ? 'active' : ['idle', 'locked'][kind - 3]);
  if (state === 'active' || pieces.length === 0) return pieces;
  const from = end - (state === 'idle' ? 6 : 12);
  const kept = pieces.filter((piece) => piece.from < from);
  kept.at(-1).to = Math.min(kept.at(-1).to, from);
  push(kept, state, from, end);
  return kept;
}

/** Start and end of the day's data in minutes after midnight, or null for no data. */
function dayBounds(plan, ctx) {
  const isToday = plan.date === ctx.today;
  const correction = (type) =>
    CORRECTIONS.find(
      (c) =>
        c.key === plan.key && c.offset === plan.offset && c.type === type && c.status === 'pending',
    );
  // A pending correction says when they really started or stopped; screen time agrees.
  let start = minutesOf(correction('check_in')?.requested.clock ?? plan.in);
  let end = plan.out
    ? minutesOf(plan.out)
    : minutesOf(correction('check_out')?.requested.clock ?? '18:30');
  if (isToday) {
    const now = minutesOf(ctx.midday ? CANVAS_NOW.midday : CANVAS_NOW.evening);
    if (!plan.out) end = now;
    end = Math.min(end, now);
    start = Math.min(start, end);
  }
  // Still at work at the canvas moment (checked out later, or not at all).
  const stillIn = isToday && (!plan.out || minutesOf(plan.out) > end);
  return end - start >= 30 ? { start, end, isToday, stillIn } : null;
}

/** One person's pieces on one day: [{ state, from, to }] in minutes after midnight. */
function piecesFor(plan, ctx) {
  const bounds = dayBounds(plan, ctx);
  if (!bounds) return { pieces: [], source: 'system' };
  const { start, end, isToday, stillIn } = bounds;
  const roll = (label, mod) => hash(plan.key, plan.date, 'screen', label) % mod;
  if (plan.key === 'vishal' && isToday) {
    const pieces = [];
    for (const [state, from, to] of VISHAL_TODAY) {
      push(pieces, state, minutesOf(from), Math.min(minutesOf(to), end));
    }
    return { pieces, source: 'system' };
  }
  if (WINDOW_ONLY.has(plan.key)) {
    return { pieces: windowDay(start, end, roll, { stillIn }), source: 'window' };
  }
  const pieces = systemDay(start, end, roll);
  return { pieces: stillIn ? endStillIn(plan.key, pieces, end, roll) : pieces, source: 'system' };
}

/** Throws when a day's pieces overlap, run backwards or leave the day's bounds. */
function checkPieces(key, date, pieces) {
  let previous = -1;
  for (const piece of pieces) {
    if (piece.from >= piece.to || piece.from < previous) {
      throw new Error(`Demo screen time for ${key} on ${date} overlaps or runs backwards`);
    }
    previous = piece.to;
  }
}

/**
 * activity_segments rows for every present day of every tracked person.
 * @param {Map<string, object[]>} plansByPerson the day plans (after buildRows applied corrections)
 * @param {{ tz: string, today: string, midday: boolean, users: Map<string, { id: number }> }} ctx
 * @returns {object[]}
 */
export function buildActivitySegments(plansByPerson, ctx) {
  const rows = [];
  for (const [key, plans] of plansByPerson) {
    const user = ctx.users.get(key);
    if (!user?.tracksAttendance) throw new Error(`Demo screen time for untracked ${key}`);
    for (const plan of plans) {
      if (plan.absent) continue;
      const { pieces, source } = piecesFor(plan, ctx);
      checkPieces(key, plan.date, pieces);
      for (const piece of pieces) {
        const startedAt = at(plan.date, clockOf(piece.from), ctx.tz);
        const endedAt = at(plan.date, clockOf(piece.to), ctx.tz);
        rows.push({
          userId: user.id,
          workDate: plan.date,
          state: piece.state,
          source,
          startedAt,
          endedAt,
          createdAt: startedAt,
          updatedAt: endedAt,
        });
      }
    }
  }
  return rows;
}
