// Attendance corrections and HR's direct changes (guide 7.8): requests, approve, reject, edit,
// add and confirm office. Every HR change needs a reason and is audited.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const at = (clock, date = '2026-09-30') => {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d;
};
const iso = (clock, date) => at(clock, date).toISOString();

let hr;
let hrActor;

async function code(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return 'OK';
}

async function fields(promise) {
  try {
    await promise;
  } catch (error) {
    return error.fields;
  }
  return null;
}

async function addRow(user, date, { checkIn = '09:30', checkOut, ...extra } = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(checkIn, date),
    checkOutAt: checkOut ? at(checkOut, date) : null,
    checkoutStatus: checkOut ? 'checked_out' : 'open',
    location: 'office',
    ...extra,
  });
  return id;
}

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', slackUserId: 'UHR1' });
  hrActor = { id: hr.id, name: hr.name };
  await setSettings({ slack_enabled: true, slack_requests_notify: true });
});

beforeEach(() => {
  setNowForTests(iso('11:00'));
});

describe('correction requests', () => {
  it('asks HR to fix a forgotten check-out and notifies HR in the app and on Slack', async () => {
    const deepak = await createUser({ name: 'Deepak Joshi', slackUserId: 'UDEEPAK' });
    const rowId = await addRow(deepak, '2026-09-29', { checkoutStatus: 'missing' });
    const correction = await attendance.requestCorrection({
      user: deepak,
      type: 'check_out',
      workDate: '2026-09-29',
      checkOut: '18:40',
      reason: 'Forgot to check out yesterday',
    });
    expect(correction).toMatchObject({
      attendanceId: rowId,
      type: 'check_out',
      status: 'pending',
      reason: 'Forgot to check out yesterday',
      requestedEndTime: null,
    });
    expect(correction.requestedTime.toISOString()).toBe(iso('18:40', '2026-09-29'));
    const note = await db('notifications')
      .where({ userId: hr.id, type: 'attendance_correction.requested' })
      .first();
    expect(note).toMatchObject({
      title: 'Deepak Joshi asked for a correction',
      body: 'Forgot to check out yesterday',
      link: '/attendance',
    });
    const dm = await db('slackOutbox').where({ channel: 'UHR1', kind: 'dm' }).first();
    expect(parseJson(dm.payload).text).toContain('says they left at 6:40 PM on Tue, 29 Sep.');

    expect(
      await code(
        attendance.requestCorrection({
          user: deepak,
          type: 'check_out',
          workDate: '2026-09-29',
          checkOut: '18:45',
          reason: 'Again',
        }),
      ),
    ).toBe('REQUEST_ALREADY_PENDING');

    const { items, total } = await attendance.listCorrections({ status: 'pending' });
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      user: { id: deepak.id, name: 'Deepak Joshi' },
      summary: 'Says they left at 6:40 PM on Tue, 29 Sep.',
    });
  });

  it('checks the request against the day and the clock', async () => {
    const aman = await createUser();
    const ask = (input) =>
      attendance.requestCorrection({ user: aman, reason: 'Please fix', ...input });
    expect(
      await fields(ask({ type: 'check_out', workDate: '2026-09-28', checkOut: '18:00' })),
    ).toHaveProperty('workDate');
    await addRow(aman, '2026-09-28', { checkIn: '09:40' });
    expect(
      await fields(
        ask({
          type: 'missing_day',
          workDate: '2026-09-28',
          checkIn: '09:30',
          checkOut: '18:30',
          location: 'office',
        }),
      ),
    ).toHaveProperty('type');
    expect(
      await fields(ask({ type: 'check_out', workDate: '2026-09-28', checkOut: '09:00' })),
    ).toHaveProperty('checkOut');
    expect(
      await fields(ask({ type: 'check_in', workDate: '2026-10-01', checkIn: '09:00' })),
    ).toHaveProperty('workDate');
    await addRow(aman, '2026-09-30', { checkIn: '10:30' });
    expect(
      await fields(ask({ type: 'check_in', workDate: '2026-09-30', checkIn: '11:30' })),
    ).toHaveProperty('checkIn');
    expect(
      await fields(
        ask({ type: 'missing_day', workDate: '2026-09-25', checkIn: '09:30', checkOut: '18:30' }),
      ),
    ).toHaveProperty('location');
    expect(
      await fields(
        attendance.requestCorrection({
          user: aman,
          type: 'check_in',
          workDate: '2026-09-30',
          checkIn: '09:15',
          reason: '  ',
        }),
      ),
    ).toHaveProperty('reason');
  });
});

describe('approving and rejecting', () => {
  it('approving a check-out sets the time, marks it corrected, audits the reason and tells the person', async () => {
    const karan = await createUser({ name: 'Karan Mehta', slackUserId: 'UKARAN' });
    const rowId = await addRow(karan, '2026-09-29', { checkoutStatus: 'missing' });
    const request = await attendance.requestCorrection({
      user: karan,
      type: 'check_out',
      workDate: '2026-09-29',
      checkOut: '18:40',
      reason: 'Forgot to check out yesterday',
    });
    const { correction, row } = await attendance.approveCorrection({
      actor: hrActor,
      id: request.id,
      note: 'Seen on the door log',
      ip: '10.0.0.1',
    });
    expect(correction).toMatchObject({
      status: 'approved',
      handledBy: hr.id,
      handlerNote: 'Seen on the door log',
    });
    expect(row).toMatchObject({ id: rowId, checkoutStatus: 'corrected' });
    expect(row.checkOutAt.toISOString()).toBe(iso('18:40', '2026-09-29'));
    const log = await db('auditLogs')
      .where({ action: 'attendance.correct', entityId: rowId })
      .first();
    expect(log).toMatchObject({
      actorId: hr.id,
      reason: 'Forgot to check out yesterday',
      ip: '10.0.0.1',
    });
    expect(parseJson(log.before)).toMatchObject({ checkoutStatus: 'missing', checkOutAt: null });
    expect(parseJson(log.after)).toMatchObject({ checkoutStatus: 'corrected' });
    const told = await db('notifications')
      .where({ userId: karan.id, type: 'attendance_correction.approved' })
      .first();
    expect(told.body).toContain('Your check-out on Tue, 29 Sep is now 6:40 PM.');
    const dm = await db('slackOutbox').where({ channel: 'UKARAN' }).first();
    expect(parseJson(dm.payload).text).toContain('was approved');
    expect(await code(attendance.approveCorrection({ actor: hrActor, id: request.id }))).toBe(
      'REQUEST_ALREADY_HANDLED',
    );
  });

  it('approving a check-in time recomputes late minutes', async () => {
    const rohit = await createUser({ name: 'Rohit Verma' });
    const rowId = await addRow(rohit, '2026-09-30', { checkIn: '10:08', lateMinutes: 38 });
    const request = await attendance.requestCorrection({
      user: rohit,
      type: 'check_in',
      workDate: '2026-09-30',
      checkIn: '09:35',
      reason: 'Wrong check-in time',
    });
    const [item] = (await attendance.listCorrections()).items.filter((c) => c.id === request.id);
    expect(item.summary).toBe('Says they arrived at 9:35 but checked in at 10:08.');
    const { row } = await attendance.approveCorrection({ actor: hrActor, id: request.id });
    expect(row).toMatchObject({ id: rowId, lateMinutes: 5, checkoutStatus: 'open' });
    expect(row.checkInAt.toISOString()).toBe(iso('09:35'));
  });

  it('approving a missing day creates the row', async () => {
    const priya = await createUser({ name: 'Priya Sharma', shiftStart: '09:00:00' });
    const request = await attendance.requestCorrection({
      user: priya,
      type: 'missing_day',
      workDate: '2026-09-25',
      checkIn: '09:20',
      checkOut: '18:30',
      location: 'wfh',
      reason: 'Worked from home, forgot to check in',
    });
    expect(request).toMatchObject({ attendanceId: null, requestedLocation: 'wfh' });
    expect(request.requestedEndTime.toISOString()).toBe(iso('18:30', '2026-09-25'));
    const { row, correction } = await attendance.approveCorrection({
      actor: hrActor,
      id: request.id,
    });
    expect(row).toMatchObject({
      userId: priya.id,
      workDate: '2026-09-25',
      location: 'wfh',
      officeVerified: true,
      lateMinutes: 20,
      isWorkingDay: true,
      checkoutStatus: 'corrected',
      source: 'hr',
    });
    expect(correction.attendanceId).toBe(row.id);
  });

  it('rejecting needs a note and tells the person', async () => {
    const simran = await createUser({ name: 'Simran Kaur' });
    await addRow(simran, '2026-09-29', { checkOut: '18:00' });
    const request = await attendance.requestCorrection({
      user: simran,
      type: 'check_out',
      workDate: '2026-09-29',
      checkOut: '20:00',
      reason: 'Stayed late',
    });
    expect(
      await code(attendance.rejectCorrection({ actor: hrActor, id: request.id, note: ' ' })),
    ).toBe('VALIDATION_FAILED');
    const rejected = await attendance.rejectCorrection({
      actor: hrActor,
      id: request.id,
      note: 'The door log says 6:00 PM.',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      handlerNote: 'The door log says 6:00 PM.',
    });
    const told = await db('notifications')
      .where({ userId: simran.id, type: 'attendance_correction.rejected' })
      .first();
    expect(told).toMatchObject({
      title: 'Your attendance correction was rejected',
      body: 'The door log says 6:00 PM.',
    });
    const row = await db('attendance').where({ userId: simran.id }).first();
    expect(row.checkOutAt.toISOString()).toBe(iso('18:00', '2026-09-29'));
    expect(
      await code(attendance.rejectCorrection({ actor: hrActor, id: request.id, note: 'Again' })),
    ).toBe('REQUEST_ALREADY_HANDLED');
  });
});

describe('HR changes', () => {
  it('editing needs a reason; a new check-out is marked corrected and audited before/after', async () => {
    const vishal = await createUser({ name: 'Vishal Saini' });
    const id = await addRow(vishal, '2026-09-29', { checkoutStatus: 'missing' });
    expect(
      await fields(attendance.updateRow({ actor: hrActor, id, checkOut: '18:31', reason: '' })),
    ).toHaveProperty('reason');
    const row = await attendance.updateRow({
      actor: hrActor,
      id,
      checkIn: '09:45',
      checkOut: '18:31',
      reason: 'Confirmed with his PM',
      ip: '10.0.0.2',
    });
    expect(row).toMatchObject({ checkoutStatus: 'corrected', lateMinutes: 15 });
    expect(row.checkOutAt.toISOString()).toBe(iso('18:31', '2026-09-29'));
    const log = await db('auditLogs').where({ action: 'attendance.edit', entityId: id }).first();
    expect(log).toMatchObject({ actorId: hr.id, reason: 'Confirmed with his PM' });
    expect(parseJson(log.before)).toMatchObject({ checkoutStatus: 'missing', lateMinutes: 0 });
    expect(parseJson(log.after)).toMatchObject({ checkoutStatus: 'corrected', lateMinutes: 15 });
    expect(
      await fields(attendance.updateRow({ actor: hrActor, id, checkIn: '19:00', reason: 'Oops' })),
    ).toHaveProperty('checkIn');
    const told = await db('notifications').where({ userId: vishal.id, type: 'attendance.edited' });
    expect(told).toHaveLength(1);
  });

  it('adds a row for someone who forgot, once', async () => {
    const ankit = await createUser({ name: 'Ankit Rana' });
    const input = {
      actor: hrActor,
      userId: ankit.id,
      workDate: '2026-09-28',
      checkIn: '09:30',
      location: 'office',
      reason: 'Was in the office, phone died',
    };
    expect(await fields(attendance.createForUser(input))).toHaveProperty('checkOut');
    const row = await attendance.createForUser({ ...input, checkOut: '18:30' });
    expect(row).toMatchObject({ source: 'hr', checkoutStatus: 'corrected', lateMinutes: 0 });
    expect(await code(attendance.createForUser({ ...input, checkOut: '18:30' }))).toBe(
      'ATTENDANCE_EXISTS',
    );
    const today = await attendance.createForUser({
      ...input,
      workDate: '2026-09-30',
      checkIn: '09:50',
    });
    expect(today).toMatchObject({ checkoutStatus: 'open', lateMinutes: 20, checkOutAt: null });
    expect(
      await fields(attendance.createForUser({ ...input, workDate: '2026-09-30', reason: '' })),
    ).toHaveProperty('reason');
    const log = await db('auditLogs')
      .where({ action: 'attendance.create', entityId: row.id })
      .first();
    expect(log.reason).toBe('Was in the office, phone died');
  });

  it("doesn't add rows for people who don't track attendance (PMs)", async () => {
    const pm = await createUser({ name: 'Pam', role: 'pm', tracksAttendance: false });
    const input = {
      actor: hrActor,
      userId: pm.id,
      workDate: '2026-09-28',
      checkIn: '09:30',
      checkOut: '18:30',
      location: 'office',
      reason: 'Was in the office',
    };
    expect(await code(attendance.createForUser(input))).toBe('CONFLICT');
    expect(await db('attendance').where({ userId: pm.id })).toHaveLength(0);
  });

  it('confirms an unverified office check-in with a reason', async () => {
    const aman = await createUser();
    const id = await addRow(aman, '2026-09-30', { officeVerified: false });
    expect(
      await fields(attendance.confirmOffice({ actor: hrActor, id, reason: '' })),
    ).toHaveProperty('reason');
    const row = await attendance.confirmOffice({
      actor: hrActor,
      id,
      reason: 'Saw him at his desk',
    });
    expect(row.officeVerified).toBe(true);
    const log = await db('auditLogs')
      .where({ action: 'attendance.confirm_office', entityId: id })
      .first();
    expect(log.reason).toBe('Saw him at his desk');
    expect(await code(attendance.confirmOffice({ actor: hrActor, id, reason: 'Again' }))).toBe(
      'CONFLICT',
    );
  });
});

describe('nobody decides on their own attendance', () => {
  it("sends an HR person's own request to an Admin and stops them handling it or their row", async () => {
    const admin = await createUser({ name: 'Meera Pillai', role: 'admin' });
    const adminActor = { id: admin.id, name: admin.name };
    const rowId = await addRow(hr, '2026-09-29', { checkoutStatus: 'missing' });
    const own = await attendance.requestCorrection({
      user: hr,
      type: 'check_out',
      workDate: '2026-09-29',
      checkOut: '18:20',
      reason: 'Forgot to check out yesterday',
    });
    // Neha is the only HR person, so the request goes to the Admin instead of nobody.
    const told = await db('notifications').where({
      type: 'attendance_correction.requested',
      title: 'Neha Gupta asked for a correction',
    });
    expect(told.map((n) => n.userId)).toEqual([admin.id]);

    expect(await code(attendance.approveCorrection({ actor: hrActor, id: own.id }))).toBe(
      'FORBIDDEN',
    );
    expect(
      await code(attendance.rejectCorrection({ actor: hrActor, id: own.id, note: 'No' })),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        attendance.updateRow({ actor: hrActor, id: rowId, checkOut: '18:20', reason: 'Mine' }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        attendance.createForUser({
          actor: hrActor,
          userId: hr.id,
          workDate: '2026-09-28',
          checkIn: '09:30',
          checkOut: '18:30',
          location: 'office',
          reason: 'Mine',
        }),
      ),
    ).toBe('FORBIDDEN');
    const unverified = await addRow(hr, '2026-09-30', { officeVerified: false });
    expect(
      await code(attendance.confirmOffice({ actor: hrActor, id: unverified, reason: 'Mine' })),
    ).toBe('FORBIDDEN');
    expect((await db('attendanceCorrections').where({ id: own.id }).first()).status).toBe(
      'pending',
    );

    const { row } = await attendance.approveCorrection({ actor: adminActor, id: own.id });
    expect(row).toMatchObject({ id: rowId, checkoutStatus: 'corrected' });
  });
});
