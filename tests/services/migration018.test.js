// Migration 018 (CONTRACT 25, "Data" and "Deploy before migrate") on a test database taken back
// to 017 and up to 018 again. .github/workflows/migration-check.yml runs this file on MySQL 8.4
// too, so it reads information_schema the way both servers answer and uses only DB_NAME.
// 1. Every new table, column, ENUM, key and foreign key.
// 2. Before 018 (the code deployed, the migrate line not run yet): every new read answers its
//    fallback, every new write UPDATE_NEEDED (503) with nothing half-written, the 1.09 paths still
//    work, one warning per area and no error.
// 3. The migrate: 1.09 Removes since 1 Nov become away breaks with one audit row each, every skip
//    case, daily reports untouched, the deploy day's late alerts claimed; a second run inserts
//    nothing; a run that left a table out makes it again. Then everything works without a restart.
// 4. down removes only the away breaks and their audit rows and reads HR's break fixes as the
//    person's own; up again keeps the data.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadAttendance } from '@/app/(app)/attendance/attendanceData';
import { loadMonth } from '@/app/(app)/attendance/month/monthData';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { attendance } from '@/modules/attendance';
import { UPDATE_NEEDED_MESSAGE } from '@/modules/attendance/migration018';
import { dashboard } from '@/modules/dashboard';
import { timers } from '@/modules/timers';
import { companyNow } from '@/worker/clock';
import * as migration018 from '../../db/migrations/018_hr_tools.js';
import { resetDatabase } from '../helpers/db.js';
import {
  at,
  awayBreaks,
  COLUMNS,
  columnsOf,
  constraintsOf,
  FOREIGN_KEYS,
  foreignKeysOf,
  INDEXES,
  indexesOf,
  MIGRATION,
  NEW_TABLES,
  realCompanyDate,
  reportTables,
  tablesOf,
  withMigrationLog,
} from './migration018Kit.js';
import { createWorld, NOV2, OFFICE_IP, setClock, TODAY, YESTERDAY } from './migration018World.js';
import { caught } from './timersKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const remindersRoute = await import('@/app/api/attendance/reminders/route.js');
const holidaysRoute = await import('@/app/api/holidays/route.js');
const hideRoute = await import('@/app/api/attendance/me/missing-checkouts/hide/route.js');
const selfFixRoute = await import('@/app/api/attendance/me/missing-checkouts/[id]/fix/route.js');

const EXPIRES = new Date('2026-12-26T04:00:00Z');
// Each migrate step copies attendance and attendance_breaks once (ALGORITHM=COPY).
const MIGRATE_MS = 120_000;
const MISSING_018 = /^The 1\.10 database update is missing \(run npm run migrate\); (\w+) is off$/;

let world;
let reportsBefore;
const warnings = [];
const errors = [];

const iso = (date, clock) => at(date, clock).toISOString();
const count = async (table, where = {}) =>
  Number((await db(table).where(where).count({ n: '*' }))[0].n);

/** A 1.10 write before 018: UPDATE_NEEDED, 503, the one sentence. */
async function refused(promise) {
  expect(await caught(promise)).toMatchObject({
    code: 'UPDATE_NEEDED',
    status: 503,
    message: UPDATE_NEEDED_MESSAGE,
  });
}

/** Row counts of every table a refused write could have half-written. */
async function writeCounts() {
  const tables = ['notifications', 'auditLogs', 'slackOutbox', 'attendanceCorrections'];
  const counts = {};
  for (const table of [...tables, 'attendanceBreaks', 'timeEntries']) {
    counts[table] = await count(table);
  }
  return counts;
}

/** A POST to a route handler as `user` (with the route's `params`); returns the Response. */
function post(handler, user, path, body, params = {}) {
  sessionUser = { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
  const request = new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { Origin: env.appOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return handler(request, { params: Promise.resolve(params) });
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  // Leave the test database migrated for the next file.
  await db.migrate.latest();
});

describe('migration 018: tables, columns, keys', () => {
  it('creates the four tables as InnoDB with utf8mb4_unicode_ci', async () => {
    const found = await tablesOf(NEW_TABLES);
    for (const table of NEW_TABLES) {
      expect(found[table], table).toEqual({ collation: 'utf8mb4_unicode_ci', engine: 'InnoDB' });
    }
  });

  it('adds every column with its type, ENUM values, nullability and collation', async () => {
    for (const table of Object.keys(COLUMNS)) {
      expect(await columnsOf(table), table).toEqual(COLUMNS[table]);
    }
  });

  it('creates every unique key and index with knex names', async () => {
    for (const [table, indexes] of Object.entries(INDEXES)) {
      expect(await indexesOf(table), table).toMatchObject(indexes);
      const constraints = await constraintsOf(table);
      for (const [name, [unique]] of Object.entries(indexes)) {
        if (unique) expect(constraints[name], name).toBe('UNIQUE');
      }
    }
  });

  it('creates every foreign key with its ON DELETE rule', async () => {
    for (const [table, keys] of Object.entries(FOREIGN_KEYS)) {
      expect(await foreignKeysOf(table), table).toMatchObject(keys);
      const constraints = await constraintsOf(table);
      for (const name of Object.keys(keys)) expect(constraints[name], name).toBe('FOREIGN KEY');
    }
  });
});

describe('before migration 018 (the code deployed, the migrate line not run yet)', () => {
  beforeAll(async () => {
    await db.migrate.down({ name: MIGRATION });
    expect(await tablesOf(NEW_TABLES)).toEqual({});
    // The first migrate claims the deploy day's late alerts again (Data step 8).
    await db('jobRuns').where({ job: 'late-alerts' }).del();
    world = await createWorld();
    reportsBefore = await reportTables();
    vi.spyOn(logger, 'warn').mockImplementation((...args) => warnings.push(args));
    vi.spyOn(logger, 'error').mockImplementation((...args) => errors.push(args));
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('morning: no check-in reminders, and the summary is sent once by the bell it left', async () => {
    setClock('10:05');
    expect(await attendance.sendCheckinReminders(TODAY)).toEqual({
      reminded: 0,
      unavailable: true,
    });
    expect(await attendance.sendHrMorningSummary(TODAY)).toEqual({ sent: 1 });
    setClock('10:15');
    expect(await attendance.sendHrMorningSummary(TODAY)).toEqual({ sent: 0 });
    expect(
      await count('notifications', { userId: world.hr.id, type: 'attendance.hr_summary' }),
    ).toBe(1);
  });

  it('Today: no pop-up, no removed time, and only the running timer is asked about', async () => {
    setClock('14:30');
    const mine = await attendance.getMyToday({ user: world.karan.user });
    expect(mine.missing).toEqual({ items: [], autoOpen: false });
    expect(mine.upcoming).toMatchObject({ leave: null, holiday: null });
    expect(mine.day).toMatchObject({ holiday: null, leave: null, isWorkingDay: true });
    const priya = await timers.getState({ user: world.priya });
    expect(priya).toMatchObject({ away: null, removed: [] });
    const vishal = await timers.getState({ user: world.vishal });
    expect(vishal.away).toMatchObject({ fromClock: '13:00', toClock: '13:45', running: true });
    expect(vishal.removed).toEqual([]);
  });

  it('a Remove on a finished entry answers UPDATE_NEEDED and changes nothing', async () => {
    const entry = await db('timeEntries').where({ id: world.priyaEntry }).first();
    const counts = await writeCounts();
    await refused(
      timers.resolveAway({
        user: world.priya,
        entryId: world.priyaEntry,
        from: iso(TODAY, '10:30'),
        to: iso(TODAY, '11:00'),
        decision: 'remove',
      }),
    );
    expect(await db('timeEntries').where({ id: world.priyaEntry }).first()).toEqual(entry);
    expect(await writeCounts()).toEqual(counts);
  });

  it('a Remove of the running entry is the 1.09 split, not saved as a break', async () => {
    const { away } = await timers.getState({ user: world.vishal });
    const after = await timers.resolveAway({ user: world.vishal, ...away, decision: 'remove' });
    expect(after.answer).toMatchObject({ minutes: 45, savedAsBreak: false, breakId: null });
    expect(after.removed).toEqual([]);
    const [head, copy] = await db('timeEntries').where({ userId: world.vishal.id }).orderBy('id');
    expect(head).toMatchObject({ stopReason: 'away', endedAt: at(TODAY, '13:00') });
    expect(copy).toMatchObject({ startedAt: at(TODAY, '13:45'), endedAt: null });
    expect(copy.createdAt).toEqual(head.updatedAt); // so 018 finds it
    expect(await count('attendanceBreaks', { userId: world.vishal.id })).toBe(0);
    world.vishalHead = Number(head.id);
  });

  it("HR's break list reads with needsUpdate; Change end, Delete and Put back are refused", async () => {
    const list = await attendance.listBreaksForRow({
      viewer: world.hr,
      attendanceId: world.priyaRow,
    });
    expect(list).toMatchObject({ needsUpdate: true, breakMinutes: 15 });
    expect(list.breaks).toEqual([expect.objectContaining({ source: 'self', changedBy: null })]);
    const breakId = list.breaks[0].id;
    const stored = await db('attendanceBreaks').where({ id: breakId }).first();
    const counts = await writeCounts();
    const fix = { actor: world.hr, attendanceId: world.priyaRow, breakId };
    await refused(
      attendance.changeBreakEnd({ ...fix, endClock: '12:40', reason: 'Back at 12:40' }),
    );
    await refused(attendance.deleteBreak({ ...fix, reason: 'Not a break' }));
    await refused(timers.putBackAway({ user: world.priya, breakId }));
    expect(await db('attendanceBreaks').where({ id: breakId }).first()).toEqual(stored);
    expect(await writeCounts()).toEqual(counts);
  });

  it('the pop-up, reminders, holidays and leave writes are refused with nothing half-written', async () => {
    const { hr, karan, ravi, tara } = world;
    const row = await db('attendance').where({ id: karan.rowId }).first();
    const counts = await writeCounts();
    const fix = { user: karan.user, attendanceId: karan.rowId, checkOut: '18:00' };
    await refused(attendance.fixMyMissingCheckout(fix));
    // Over the limit too: the whole Save is refused, so no request for HR is made either.
    await refused(attendance.fixMyMissingCheckout({ ...fix, checkOut: '21:00', reason: 'Late' }));
    await refused(attendance.hideMissingCheckoutPrompt({ user: karan.user }));
    await refused(attendance.remind({ actor: hr, kind: 'check_in', userIds: [tara.id] }));
    await refused(attendance.createHoliday({ actor: hr, date: '2026-11-24', name: 'Guru Nanak' }));
    await refused(attendance.updateHoliday({ actor: hr, id: 1, name: 'Diwali' }));
    await refused(attendance.deleteHoliday({ actor: hr, id: 1 }));
    const leave = { actor: hr, userId: ravi.id, fromDate: '2026-11-25', part: 'full' };
    await refused(attendance.previewLeave(leave));
    await refused(attendance.createLeave({ ...leave, paid: true, leaveType: 'casual' }));
    await refused(
      attendance.updateLeave({ actor: hr, id: 1, note: 'Fever', reason: 'Add a note' }),
    );
    await refused(attendance.deleteLeave({ actor: hr, id: 1, reason: 'Marked by mistake' }));
    expect(await db('attendance').where({ id: karan.rowId }).first()).toEqual(row);
    expect(await writeCounts()).toEqual(counts);
  });

  it('their routes answer 503 with the sentence', async () => {
    const answers = [
      await post(remindersRoute.POST, world.hr, '/api/attendance/reminders', {
        kind: 'check_in',
        userIds: [world.tara.id],
      }),
      await post(holidaysRoute.POST, world.hr, '/api/holidays', {
        date: '2026-11-24',
        name: 'Guru Nanak Jayanti',
      }),
      await post(hideRoute.POST, world.karan.user, '/api/attendance/me/missing-checkouts/hide'),
      await post(
        selfFixRoute.POST,
        world.karan.user,
        `/api/attendance/me/missing-checkouts/${world.karan.rowId}/fix`,
        { checkOut: '21:00', reason: 'Left late' },
        { id: String(world.karan.rowId) },
      ),
    ];
    for (const response of answers) {
      expect(response.status).toBe(503);
      expect((await response.json()).error).toMatchObject({
        code: 'UPDATE_NEEDED',
        message: UPDATE_NEEDED_MESSAGE,
      });
    }
  });

  it('every new read answers its fallback, and the worker clock reads as 1.09', async () => {
    expect(await attendance.listHolidays()).toMatchObject({ available: false, items: [] });
    const leave = await attendance.listLeave({ viewer: world.hr });
    expect(leave).toMatchObject({ available: false, items: [], total: 0 });
    expect(await attendance.listReminders({ since: at(TODAY, '00:00') })).toEqual([]);
    expect(await attendance.deleteOldReminders('2026-05-23')).toBe(0);
    expect((await attendance.checkoutEnteredFor([world.karan.rowId])).size).toBe(0);
    const calendar = await attendance.loadCalendar({ from: '2026-11-01', to: TODAY });
    expect(calendar.available).toBe(false);
    expect(await companyNow()).toMatchObject({ date: TODAY, workingDay: true, holiday: null });
  });

  it('the day page, the month, both Excel files and the Team board read as 1.09', async () => {
    const items = await attendance.listDay(TODAY, { viewer: world.hr });
    const priya = items.find((item) => item.user.id === world.priya.id);
    expect(priya).toMatchObject({ breakMinutes: 15 });
    const page = await loadAttendance({ user: world.hr, date: TODAY });
    expect(page.day).toMatchObject({ isWorkingDay: true, holiday: null });
    expect(page.leave).toMatchObject({ available: false });
    expect(page.rows.find((row) => row.id === world.priya.id)).toBeTruthy();
    const day = await attendance.exportDay(TODAY, { viewer: world.hr });
    expect(day.sheets[0].rows.length).toBeGreaterThan(0);
    expect(day.sheets[0].rows.every((row) => !row.enteredBy)).toBe(true);
    const month = await attendance.getMonth({ viewer: world.hr });
    expect(month.available).toEqual({ holidays: false, leave: false });
    expect((await loadMonth({ user: world.hr })).needsUpdate).toBe(true);
    expect((await attendance.exportMonth({ viewer: world.hr })).filename).toBe(
      'attendance-2026-11.xlsx',
    );
    const person = await attendance.getPersonMonth({ viewer: world.hr, userId: world.sana.id });
    expect(person.available).toEqual({ holidays: false, leave: false });
    expect((await attendance.getNeedsLook({ viewer: world.hr })).period).toBeTruthy();
    expect((await dashboard.getTeamToday({ viewer: world.hr })).holiday).toBeNull();
  });

  it("check-in, check-out and HR's list, Fix and bulk fix work without the new columns", async () => {
    const { hr, meera, rohan, ravi } = world;
    const list = await attendance.listMissingCheckouts({ viewer: hr, suggest: true });
    expect(list.total).toBe(3);
    expect(list.items.every((item) => item.reminded === null)).toBe(true);
    setClock('14:30');
    expect(await attendance.checkIn({ user: ravi, ip: OFFICE_IP })).toMatchObject({
      lateMinutes: 300,
    });
    setClock('14:40');
    expect((await attendance.checkOut({ user: ravi, ip: OFFICE_IP })).row.checkOutAt).toEqual(
      at(TODAY, '14:40'),
    );
    const fixed = await attendance.updateRow({
      actor: hr,
      id: rohan.rowId,
      checkOut: '18:30',
      reason: 'Left at 6:30',
    });
    expect(fixed.checkOutAt).toEqual(at(YESTERDAY, '18:30'));
    const bulk = await attendance.fixMissingCheckouts({
      actor: hr,
      items: [{ attendanceId: meera.rowId, checkOut: '18:15' }],
      reason: 'Checked with Meera',
    });
    expect(bulk).toMatchObject({ fixed: [{ attendanceId: meera.rowId }], failed: [] });
  });

  it('the late alert is unavailable; each area warned once and nothing logged an error', async () => {
    setClock('18:45');
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 0, unavailable: true });
    expect(await count('notifications', { type: 'attendance.late_alert' })).toBe(0);
    const areas = warnings
      .map(([message]) => MISSING_018.exec(String(message))?.[1])
      .filter(Boolean)
      .sort();
    expect(areas).toEqual(['alerts', 'breaks', 'calendar', 'checkouts', 'reminders']);
    const missing = errors.filter(([first]) => [1146, 1054].includes(first?.err?.errno));
    expect(missing).toEqual([]);
  });
});

describe('the migrate', { timeout: MIGRATE_MS }, () => {
  it("rebuilds 1.09 Removes since 1 Nov as away breaks, one audit row each, and claims today's late alerts", async () => {
    const lines = await withMigrationLog(() => db.migrate.up({ name: MIGRATION }));
    expect(lines).toEqual(['018: rebuilt 3 away breaks (5 skipped)']);
    const { split, moved, vishal } = world;
    const vishalRow = await db('attendance').where({ userId: vishal.id, workDate: TODAY }).first();
    const expected = [
      [split.user.id, NOV2, '13:00', '13:45', split.head, split.rowId],
      [moved.user.id, NOV2, '10:00', '10:20', moved.entry, moved.rowId],
      [vishal.id, TODAY, '13:00', '13:45', world.vishalHead, vishalRow.id],
    ];
    expect(await awayBreaks()).toEqual(
      expected.map(([userId, workDate, from, to, awayEntryId, attendanceId]) => ({
        userId: Number(userId),
        workDate,
        from: iso(workDate, from),
        to: iso(workDate, to),
        awayEntryId: Number(awayEntryId),
        attendanceId: Number(attendanceId),
        endReason: 'away',
      })),
    );
    const date = realCompanyDate();
    const runs = await db('jobRuns').where({ job: 'late-alerts' }).orderBy('runKey');
    expect(runs.map((run) => [run.runKey, run.status])).toEqual([
      [`late_alerts:${date}`, 'done'],
      [`late_alerts:${date}#2`, 'done'],
      [`late_alerts:${date}#3`, 'done'],
    ]);
  });

  it('writes each break as the backfill and audits it; other breaks read as self', async () => {
    const made = await db('attendanceBreaks').where({ source: 'away' }).orderBy('id');
    const audits = await db('auditLogs')
      .where({ action: 'attendance.away_backfill' })
      .orderBy('id');
    expect(audits).toHaveLength(made.length);
    made.forEach((row, index) => {
      expect(row).toMatchObject({ pausedEntryId: null, changedById: null, changedAt: null });
      expect(row.createdAt).toEqual(row.updatedAt);
      expect(audits[index]).toMatchObject({
        actorId: null,
        entityType: 'attendance',
        entityId: Number(row.attendanceId),
        reason: 'Removed timer time counted as a break (1.10)',
      });
      expect(JSON.parse(audits[index].after)).toEqual({
        breakId: Number(row.id),
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt.toISOString(),
      });
    });
    const others = await db('attendanceBreaks').whereNot({ source: 'away' });
    expect(others.length).toBe(3);
    expect(others.every((row) => row.source === 'self' && row.changedById === null)).toBe(true);
    expect(await reportTables()).toEqual(reportsBefore);
  });

  it('a second run inserts nothing, and a run that left a table out makes it again', async () => {
    const before = await awayBreaks();
    await db.raw('DROP TABLE `attendance_alerts`');
    const lines = await withMigrationLog(() => migration018.up(db));
    expect(lines).toEqual(['018: rebuilt 0 away breaks (8 skipped)']);
    expect(await awayBreaks()).toEqual(before);
    expect(await columnsOf('attendance_alerts')).toEqual(COLUMNS.attendance_alerts);
    expect(await indexesOf('attendance_alerts')).toMatchObject(INDEXES.attendance_alerts);
    expect(await foreignKeysOf('attendance_alerts')).toMatchObject(FOREIGN_KEYS.attendance_alerts);
    expect(await count('jobRuns', { job: 'late-alerts' })).toBe(3);
  });
});

describe('after the migrate, without a restart', () => {
  beforeAll(() => {
    timers.forgetAway();
    attendance.clearNeedsLookCache();
  });

  it('holidays, leave and the month count again', async () => {
    setClock('14:30');
    const { hr, ravi } = world;
    expect(await attendance.listHolidays()).toMatchObject({ available: true, items: [] });
    const holiday = { actor: hr, date: '2026-11-24', name: 'Guru Nanak Jayanti' };
    expect(await attendance.createHoliday(holiday)).toMatchObject({ date: '2026-11-24' });
    const leave = { actor: hr, userId: ravi.id, fromDate: '2026-11-25', part: 'first_half' };
    const entry = await attendance.createLeave({ ...leave, paid: true, leaveType: 'casual' });
    expect(entry).toMatchObject({ fromDate: '2026-11-25', part: 'first_half' });
    const month = await attendance.getMonth({ viewer: hr });
    expect(month.available).toEqual({ holidays: true, leave: true });
  });

  it('the pop-up lists the missing check-out and saves it with who entered it', async () => {
    const { user, rowId } = world.karan;
    const popup = await attendance.listMyMissingCheckouts({ user });
    expect(popup.autoOpen).toBe(true);
    expect(popup.items).toEqual([expect.objectContaining({ attendanceId: rowId })]);
    const saved = await attendance.fixMyMissingCheckout({
      user,
      attendanceId: rowId,
      checkOut: '18:00',
    });
    expect(saved).toMatchObject({ outcome: 'saved', missing: { items: [], autoOpen: false } });
    const row = await db('attendance').where({ id: rowId }).first();
    expect(row).toMatchObject({ checkoutStatus: 'corrected', checkoutEnteredBy: user.id });
  });

  it("Daybook's check-in reminder and HR's Remind go out", async () => {
    setClock('10:20');
    expect((await attendance.sendCheckinReminders(TODAY)).reminded).toBeGreaterThan(0);
    expect(await count('attendanceReminders', { userId: world.tara.id })).toBe(1);
    setClock('14:30');
    const result = await attendance.remind({
      actor: world.hr,
      kind: 'check_in',
      userIds: [world.tara.id],
    });
    expect(result).toMatchObject({ sent: [{ userId: world.tara.id }], skipped: [] });
  });

  it('a finished entry is asked about and Remove saves a break; the rebuilt one shows on Today', async () => {
    const { away } = await timers.getState({ user: world.priya });
    expect(away).toMatchObject({ entryId: world.priyaEntry, fromClock: '10:30', toClock: '11:00' });
    const after = await timers.resolveAway({ user: world.priya, ...away, decision: 'remove' });
    expect(after.answer).toMatchObject({ minutes: 30, savedAsBreak: true });
    expect(after.removed).toEqual([
      expect.objectContaining({ fromClock: '10:30', toClock: '11:00' }),
    ]);
    const vishal = await timers.getState({ user: world.vishal });
    expect(vishal.removed).toEqual([
      expect.objectContaining({ fromClock: '13:00', toClock: '13:45', projectName: 'acme-app' }),
    ]);
  });

  it("HR changes a break's end, and the late alert goes out", async () => {
    const list = await attendance.listBreaksForRow({
      viewer: world.hr,
      attendanceId: world.priyaRow,
    });
    expect(list.needsUpdate).toBe(false);
    const own = list.breaks.find((item) => item.source === 'self');
    const changed = await attendance.changeBreakEnd({
      actor: world.hr,
      attendanceId: world.priyaRow,
      breakId: own.id,
      endClock: '12:40',
      reason: 'Back at 12:40',
    });
    const fixedBreak = changed.breaks.find((item) => item.id === own.id);
    expect(fixedBreak).toMatchObject({ endReason: 'hr', changedBy: { id: world.hr.id } });
    setClock('18:45');
    expect(await attendance.sendLateAlerts(TODAY)).toMatchObject({ alerted: 1 });
  });
});

describe('down, then up again', { timeout: MIGRATE_MS }, () => {
  let selfBreaks;
  let audits;

  it('down removes only the away breaks and their audit rows, and every 018 table and column', async () => {
    selfBreaks = await db('attendanceBreaks')
      .whereNot({ source: 'away' })
      .orderBy('id')
      .select('id', 'userId', 'attendanceId', 'startedAt', 'endedAt', 'pausedEntryId');
    audits = await db('auditLogs').whereNot({ action: 'attendance.away_backfill' }).orderBy('id');
    const hrFixed = await db('attendanceBreaks').where({ endReason: 'hr' }).first('id');
    await db.migrate.down({ name: MIGRATION });
    expect(await tablesOf(NEW_TABLES)).toEqual({});
    expect(await columnsOf('attendance')).toEqual({});
    expect(await columnsOf('attendance_breaks')).toEqual({
      end_reason: ["enum('self','checkout','timer','midnight')", 'YES', 'utf8mb4_unicode_ci'],
    });
    const breaks = await db('attendanceBreaks')
      .orderBy('id')
      .select('id', 'userId', 'attendanceId', 'startedAt', 'endedAt', 'pausedEntryId');
    expect(breaks).toEqual(selfBreaks);
    expect(await db('attendanceBreaks').where({ id: hrFixed.id }).first()).toMatchObject({
      endReason: 'self',
    });
    expect(await db('auditLogs').orderBy('id')).toEqual(audits);
    expect(await count('jobRuns', { job: 'late-alerts' })).toBe(3); // run records stay
    expect(await reportTables()).toEqual(reportsBefore);
  });

  it('up again makes every column and key, keeps the data and rebuilds the away breaks', async () => {
    const lines = await withMigrationLog(() => db.migrate.up({ name: MIGRATION }));
    // The three from 1.09 again, and Priya's 1.10 Remove (its break went with down).
    expect(lines).toEqual(['018: rebuilt 4 away breaks (5 skipped)']);
    for (const table of Object.keys(COLUMNS)) {
      expect(await columnsOf(table), table).toEqual(COLUMNS[table]);
    }
    for (const [table, keys] of Object.entries(FOREIGN_KEYS)) {
      expect(await foreignKeysOf(table), table).toMatchObject(keys);
    }
    const kept = await db('attendanceBreaks')
      .where({ source: 'self' })
      .orderBy('id')
      .select('id', 'userId', 'attendanceId', 'startedAt', 'endedAt', 'pausedEntryId');
    expect(kept).toEqual(selfBreaks);
    expect(await reportTables()).toEqual(reportsBefore);
  });
});
