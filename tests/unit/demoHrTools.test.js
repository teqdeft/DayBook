// The demo's HR tools (db/demo/hrTools.js, hrRecords.js and hrTimers.js, CONTRACT 25) on any day
// of the week: Ankit's late check-in today is his 4th of the payroll month, the missing check-outs
// stay missing (each marked at midnight, Arjun's reminded), Vishal's own check-out is within his
// shift end but past last seen, the holiday falls inside Karan's leave, and each Remove is written
// as 1.10 leaves it (the head's updated_at is the copy's created_at, the away break is the gap).
import { afterEach, describe, expect, it } from 'vitest';
import { localToUtc, setNowForTests } from '@/lib/time';
import { payrollMonthOf, payrollPeriod } from '@/modules/attendance/payroll';
import { anchorDate, at, dateAtOffset, workingDaysBack } from '../../db/demo/calendar.js';
import { MISSING_ROWS, buildHrRows, planHrTools } from '../../db/demo/hrTools.js';
import { REMINDED, SELF_ENTERED } from '../../db/demo/hrRecords.js';
import { TIMER_DAYS, buildTimerDays } from '../../db/demo/hrTimers.js';
import { PEOPLE } from '../../db/demo/people.js';
import { planAllDays } from '../../db/demo/plan.js';
import { COMPLETED_PROJECTS, PROJECTS } from '../../db/demo/projects.js';
import { buildRows } from '../../db/demo/rows.js';
import { assignTasks } from '../../db/demo/tasks.js';
import { addTodoLines } from '../../db/demo/todo.js';
import { DEFAULT_SETTINGS } from '../../db/seeds/03_settings.js';

const TZ = DEFAULT_SETTINGS.timezone;
const WORKING_DAYS = DEFAULT_SETTINGS.working_days;
// A Wednesday, a Friday, a Monday and a Sunday (anchored to the Friday before).
const DAYS = ['2026-11-11', '2026-11-13', '2026-11-16', '2026-11-22'];

/** The seed's rows on a day, as seedDemo.js builds them, without a database. */
function demo(day) {
  setNowForTests(localToUtc(day, '12:00', TZ).toISOString());
  const anchor = anchorDate(TZ, WORKING_DAYS);
  const days = workingDaysBack(anchor, WORKING_DAYS);
  const projects = new Map(
    [...PROJECTS, ...COMPLETED_PROJECTS].map((project, i) => [
      project.key,
      { ...project, id: i + 1 },
    ]),
  );
  const users = new Map(PEOPLE.map((person, i) => [person.key, { ...person, id: i + 2 }]));
  const settings = {
    tz: TZ,
    workingDays: WORKING_DAYS,
    lateAfter: DEFAULT_SETTINGS.late_after,
    reportLock: DEFAULT_SETTINGS.report_lock,
    payrollStartDay: 1,
  };
  const plans = planAllDays({ days, lateAfter: settings.lateAfter, midday: false, projects });
  assignTasks(plans);
  addTodoLines(plans);
  planHrTools(plans, { anchor, ...settings });
  const { rows, index } = buildRows(plans, { ...settings, days, users, projects });
  const dateOf = (offset) => days[offset] ?? dateAtOffset(anchor, offset, WORKING_DAYS);
  const when = (offset, clock) => at(dateOf(offset), clock, TZ);
  const ctx = { ...settings, today: anchor, users, projects, index, when, dateOf };
  return { anchor, days, users, rows, index, hr: buildHrRows(ctx), timers: buildTimerDays(ctx) };
}

const rowOf = (built, key, offset) => built.index.attendance.get(`${key}|${offset}`);

afterEach(() => setNowForTests(null));

describe.each(DAYS)('the demo HR tools on %s', (day) => {
  it("makes today Ankit's 4th late day of the payroll month", () => {
    const built = demo(day);
    const { from } = payrollPeriod(payrollMonthOf(built.anchor, 1), 1);
    const late = built.rows.attendance.filter(
      (row) =>
        row.userId === built.users.get('ankit').id && row.workDate >= from && row.lateMinutes > 0,
    );
    expect(late.map((row) => row.workDate)).toContain(built.anchor);
    expect(late).toHaveLength(4);
  });

  it('keeps the missing check-outs missing, each marked at midnight', () => {
    const built = demo(day);
    const marked = new Set(
      built.hr.audit
        .filter((line) => line.action === 'attendance.mark_missing')
        .map((line) => line.entityId),
    );
    for (const [key, offset] of MISSING_ROWS) {
      const row = rowOf(built, key, offset);
      expect(row).toMatchObject({ checkoutStatus: 'missing', checkOutAt: null });
      expect(marked.has(row.id)).toBe(true);
    }
    const [reminder] = built.hr.reminders;
    expect(reminder).toMatchObject({
      userId: built.users.get(REMINDED.key).id,
      kind: 'missing_checkout',
      workDate: built.anchor,
      sentBy: built.users.get(REMINDED.by).id,
    });
  });

  it('gives Vishal a check-out he entered within his shift end, past last seen', () => {
    const built = demo(day);
    const row = rowOf(built, SELF_ENTERED.key, SELF_ENTERED.offset);
    expect(row).toMatchObject({
      checkoutStatus: 'corrected',
      checkoutEnteredBy: built.users.get(SELF_ENTERED.key).id,
    });
    const shiftEnd = at(row.workDate, DEFAULT_SETTINGS.office_end, TZ);
    expect(row.checkOutAt.getTime()).toBeLessThanOrEqual(shiftEnd.getTime());
    const lastSeenPlus15 = row.checkoutSuggestedAt.getTime() + 15 * 60_000;
    expect(row.checkOutAt.getTime()).toBeGreaterThan(lastSeenPlus15);
  });

  it("puts the holiday on a working weekday ahead, inside Karan's leave", () => {
    const built = demo(day);
    const [holiday] = built.hr.holidays;
    expect(holiday.holidayDate > built.anchor).toBe(true);
    const weekday = new Date(`${holiday.holidayDate}T00:00:00Z`).getUTCDay() || 7;
    expect(WORKING_DAYS).toContain(weekday);
    const karan = built.hr.leave.find((entry) => entry.userId === built.users.get('karan').id);
    expect(karan.fromDate < holiday.holidayDate && holiday.holidayDate < karan.toDate).toBe(true);
  });

  it('writes each Remove as a split with the away break in its gap', () => {
    const built = demo(day);
    const { entries, breaks } = built.timers;
    for (const entry of entries) expect(entry.awayCheckedUntil).toEqual(entry.endedAt);
    const heads = entries.filter((entry) => entry.stopReason === 'away');
    expect(heads).toHaveLength(Object.keys(TIMER_DAYS).length);
    for (const head of heads) {
      const copy = entries[entries.indexOf(head) + 1];
      expect(copy.projectId).toBe(head.projectId);
      expect(copy.createdAt).toEqual(head.updatedAt);
      const away = breaks.find((item) => item.awayEntryId === head.id);
      expect(away).toMatchObject({ source: 'away', endReason: 'away', pausedEntryId: null });
      expect([away.startedAt, away.endedAt]).toEqual([head.endedAt, copy.startedAt]);
    }
    const minutes = (key) =>
      breaks
        .filter((item) => item.userId === built.users.get(key).id)
        .reduce((sum, item) => sum + (item.endedAt - item.startedAt) / 60_000, 0);
    expect(minutes('priya')).toBe(55);
    expect(breaks.find((item) => item.source === 'self').workDate).toBe(built.days[1]);
    expect(entries.filter((entry) => entry.workDate === built.anchor)).toHaveLength(2);
  });
});
