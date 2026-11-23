// Daybook 1.10 (CONTRACT 25 A and 2) in the demo: timer entries and breaks for two people, so
// Today's removed-time row with Put back and HR's break list have something to show. The e2e
// browser can't run Idle Detection, so the rows are written as a Remove would have left them.
//
// - Priya Sharma (acme-seo), on the working day before the anchor: a break at 10:30 she forgot to
//   end (the timer she started at 11:00 ended it, so HR can fix its end, a time that has always
//   passed), and 25 minutes of lunch removed from her timer at 1:00 PM (an away break). Breaks
//   55m, under the hour's allowance, so her row keeps no Over tag; today's row (artboard 09) has
//   no breaks.
// - Nikhil Arora (acme-app), today: 45 minutes removed at 11:00, which he can put back from Today
//   (Put back is for today's removed time only).
//
// A Remove splits the timer: the head ends at the span's start with stop_reason 'away' and a copy
// starts at its end; the head's updated_at, the copy's created_at and the break's created_at are
// the moment of the answer. Every entry counts as asked about up to its end (away_checked_until),
// so the sidebar chip asks no question about the demo's screen time.
import { at } from './calendar.js';

/**
 * `offset` is the working-day offset (0 = the anchor). Entries: { ref, from, to ('checkout' = the
 * row's check-out), stop, note }; a Remove's head stops as 'away' and the next entry is its copy.
 * `answeredAt` is when the Remove was answered. Breaks: { from, to, endReason, paused?,
 * awayEntry? } with refs to the entries.
 */
export const TIMER_DAYS = {
  priya: {
    offset: 1,
    project: 'seo',
    entries: [
      { ref: 'p1', from: '09:45', to: '10:30', stop: 'break', note: 'Monthly ranking report' },
      { ref: 'p2', from: '11:00', to: '13:00', stop: 'away', note: 'Backlink audit' },
      { ref: 'p3', from: '13:25', to: 'checkout', stop: 'checkout', note: 'Backlink audit' },
    ],
    answeredAt: '13:27',
    breaks: [
      { from: '10:30', to: '11:00', endReason: 'timer', paused: 'p1' },
      { from: '13:00', to: '13:25', endReason: 'away', awayEntry: 'p2' },
    ],
  },
  nikhil: {
    offset: 0,
    project: 'app',
    entries: [
      { ref: 'n1', from: '09:40', to: '11:00', stop: 'away', note: 'Booking screen API' },
      { ref: 'n2', from: '11:45', to: '12:30', stop: 'stopped', note: 'Booking screen API' },
    ],
    answeredAt: '11:47',
    breaks: [{ from: '11:00', to: '11:45', endReason: 'away', awayEntry: 'n1' }],
  },
};

/** The entry that follows a Remove's head (its copy) is created when the person answered. */
function entryRows(day, ctx) {
  const { date, tz, userId, projectId, checkOutAt } = ctx;
  const when = (clock) => (clock === 'checkout' ? checkOutAt : at(date, clock, tz));
  return day.entries.map((entry, i) => {
    const previous = day.entries[i - 1];
    const isCopy = previous?.stop === 'away';
    const isHead = entry.stop === 'away';
    return {
      userId,
      workDate: date,
      projectId,
      projectTaskId: null,
      note: entry.note,
      startedAt: when(entry.from),
      endedAt: when(entry.to),
      source: 'timer',
      stopReason: entry.stop,
      awayCheckedUntil: when(entry.to),
      createdAt: when(isCopy ? day.answeredAt : entry.from),
      updatedAt: when(isHead ? day.answeredAt : entry.to),
    };
  });
}

function breakRows(day, ctx, idOf) {
  const { date, tz, userId, attendanceId } = ctx;
  const when = (clock) => at(date, clock, tz);
  return day.breaks.map((item) => {
    const away = Boolean(item.awayEntry);
    return {
      userId,
      attendanceId,
      workDate: date,
      startedAt: when(item.from),
      endedAt: when(item.to),
      endReason: item.endReason,
      pausedEntryId: item.paused ? idOf(item.paused) : null,
      source: away ? 'away' : 'self',
      awayEntryId: away ? idOf(item.awayEntry) : null,
      changedById: null,
      changedAt: null,
      createdAt: when(away ? day.answeredAt : item.from),
      updatedAt: when(away ? day.answeredAt : item.to),
    };
  });
}

/**
 * time_entries and attendance_breaks rows for the TIMER_DAYS, with their ids (both tables were
 * just emptied).
 * @param {{ tz: string, users: Map<string, { id: number }>, projects: Map<string, { id: number }>,
 *   index: { attendance: Map<string, { id: number, workDate: string, checkOutAt: Date | null }> } }}
 *   ctx
 * @returns {{ entries: object[], breaks: object[] }}
 */
export function buildTimerDays(ctx) {
  const entries = [];
  const breaks = [];
  for (const [key, day] of Object.entries(TIMER_DAYS)) {
    const row = ctx.index.attendance.get(`${key}|${day.offset}`);
    const closes = day.entries.some((entry) => entry.to === 'checkout');
    if (!row || (closes && !row.checkOutAt)) {
      throw new Error(`Demo data: ${key} has no check-in (or check-out) for the timer day`);
    }
    const person = {
      date: row.workDate,
      tz: ctx.tz,
      userId: ctx.users.get(key).id,
      projectId: ctx.projects.get(day.project).id,
      attendanceId: row.id,
      checkOutAt: row.checkOutAt,
    };
    const ids = new Map();
    for (const [i, entry] of entryRows(day, person).entries()) {
      entry.id = entries.length + 1;
      ids.set(day.entries[i].ref, entry.id);
      entries.push(entry);
    }
    for (const item of breakRows(day, person, (ref) => ids.get(ref))) {
      item.id = breaks.length + 1;
      breaks.push(item);
    }
  }
  return { entries, breaks };
}
