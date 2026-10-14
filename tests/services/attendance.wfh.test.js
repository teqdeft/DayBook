// Work-from-home requests (CONTRACT 17): asking, its checks and who hears about it. Decisions and
// cancelling are in attendance.wfhDecisions.test.js.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { pickWfhApprovers } from '@/modules/attendance/recipients';
import { formatDayRange } from '@/modules/attendance/wording';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const NOW = '2026-09-30T05:30:00Z'; // Wednesday 30 September, 11:00 AM in India
let hr;
let hr2;
let admin;
let admin2;

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { code: error.code, message: error.message, fields: error.fields };
  }
  return { code: 'OK' };
}

const code = async (promise) => (await failure(promise)).code;
const ask = (user, input) =>
  attendance.requestWfh({ user, reason: 'Plumber visit at home', ip: '10.0.0.9', ...input });

async function toldOf(type, title) {
  const rows = await db('notifications').where({ type, title }).orderBy('userId');
  return rows.map((row) => row.userId);
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ slack_enabled: true, slack_requests_notify: true });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', slackUserId: 'UHR1' });
  hr2 = await createUser({ name: 'Anjali Bose', role: 'hr', slackUserId: 'UHR2' });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin', slackUserId: 'UADM1' });
  admin2 = await createUser({ name: 'Meera Pillai', role: 'admin', slackUserId: 'UADM2' });
});

beforeEach(() => setNowForTests(NOW));

describe('asking to work from home', () => {
  it('saves the request, tells HR in the app and on Slack, and audits it', async () => {
    const vishal = await createUser({ name: 'Vishal Saini', slackUserId: 'UVISHAL' });
    const request = await ask(vishal, { fromDate: '2026-10-01', reason: '  Plumber visit  ' });
    expect(request).toMatchObject({
      user: {
        id: vishal.id,
        name: 'Vishal Saini',
        initials: 'VS',
        designation: 'Developer',
        role: 'employee',
        status: 'active',
      },
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      days: 'Thu, 1 Oct',
      reason: 'Plumber visit',
      status: 'pending',
      handledBy: null,
      handledAt: null,
      declineReason: null,
    });
    expect(request.createdAt.toISOString()).toBe('2026-09-30T05:30:00.000Z');
    const title = 'Vishal Saini asked to work from home on Thu, 1 Oct';
    expect(await toldOf('wfh_request.created', title)).toEqual([hr.id, hr2.id]);
    const note = await db('notifications').where({ userId: hr.id, title }).first();
    expect(note).toMatchObject({ body: 'Plumber visit', link: '/attendance#wfh' });
    const dms = await db('slackOutbox').where({ kind: 'dm', relatedType: 'wfh_request' });
    expect(dms.map((dm) => dm.channel).sort()).toEqual(['UHR1', 'UHR2']);
    expect(parseJson(dms[0].payload).text).toBe(
      '*Vishal Saini* asked to work from home on Thu, 1 Oct.\nReason: Plumber visit\n' +
        '<http://localhost:3000/attendance#wfh|Open Attendance>',
    );
    const log = await db('auditLogs').where({ action: 'wfh_request.create' }).first();
    expect(log).toMatchObject({
      actorId: vishal.id,
      entityType: 'wfh_request',
      entityId: request.id,
      reason: 'Plumber visit',
      ip: '10.0.0.9',
    });
    expect(parseJson(log.after)).toEqual({
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      status: 'pending',
    });
  });

  it('takes today, a range up to 14 days, and names the days in rows', async () => {
    const aman = await createUser();
    expect((await ask(aman, { fromDate: '2026-09-30' })).days).toBe('Wed, 30 Sep');
    const range = await ask(aman, { fromDate: '2026-10-01', toDate: '2026-10-14' });
    expect(range).toMatchObject({ toDate: '2026-10-14', days: 'Thu, 1 – Wed, 14 Oct' });
    expect(formatDayRange('2026-09-30', '2026-10-02')).toBe('Wed, 30 Sep – Fri, 2 Oct');
    expect(formatDayRange('2026-12-31', '2027-01-01')).toBe('Thu, 31 Dec 2026 – Fri, 1 Jan 2027');
  });

  it('checks the days and the reason', async () => {
    const priya = await createUser();
    const fieldOf = async (input) => Object.entries((await failure(ask(priya, input))).fields);
    expect(await fieldOf({ fromDate: '2026-09-29' })).toEqual([
      ['fromDate', 'Pick today or a later day.'],
    ]);
    expect(await fieldOf({ fromDate: '2026-02-30' })).toEqual([
      ['fromDate', 'Pick the first day.'],
    ]);
    expect(await fieldOf({ fromDate: '2026-10-02', toDate: '2026-10-01' })).toEqual([
      ['toDate', "The last day can't be before the first day."],
    ]);
    expect(await fieldOf({ fromDate: '2026-10-01', toDate: '2026-10-15' })).toEqual([
      ['toDate', 'Ask for 14 days or fewer at a time.'],
    ]);
    expect(await fieldOf({ fromDate: '2026-10-01', reason: '  Dr.  ' })).toEqual([
      ['reason', 'Add a reason of at least 5 characters.'],
    ]);
    expect(await fieldOf({ fromDate: '2026-10-01', reason: 'x'.repeat(501) })).toEqual([
      ['reason', 'Keep it to 500 characters or fewer.'],
    ]);
    expect(await code(ask(priya, { fromDate: '2026-10-01' }))).toBe('OK');
  });

  it("refuses days already in the person's own pending or approved request", async () => {
    const karan = await createUser({ name: 'Karan Mehta' });
    const first = await ask(karan, { fromDate: '2026-10-01', toDate: '2026-10-02' });
    const pending = await failure(ask(karan, { fromDate: '2026-10-02', toDate: '2026-10-05' }));
    const asked = 'You already asked to work from home on Thu, 1 – Fri, 2 Oct.';
    expect(pending).toEqual({
      code: 'REQUEST_ALREADY_PENDING',
      message: asked,
      fields: { fromDate: asked },
    });
    await attendance.approveWfh({ actor: hr, id: first.id });
    const approved = await failure(ask(karan, { fromDate: '2026-09-30', toDate: '2026-10-01' }));
    expect(approved.fields).toEqual({
      fromDate: 'Working from home is already approved for Thu, 1 – Fri, 2 Oct.',
    });
    // Next to it, someone else's days and a cancelled request don't count.
    const later = await ask(karan, { fromDate: '2026-10-05' });
    await attendance.cancelWfh({ user: karan, id: later.id });
    expect(await code(ask(karan, { fromDate: '2026-10-05' }))).toBe('OK');
    expect(await code(ask(await createUser(), { fromDate: '2026-10-01' }))).toBe('OK');
  });

  it('saves one of two requests sent at once', async () => {
    const rohit = await createUser();
    const results = await Promise.allSettled([
      ask(rohit, { fromDate: '2026-10-06' }),
      ask(rohit, { fromDate: '2026-10-06' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe(
      'REQUEST_ALREADY_PENDING',
    );
    expect(await db('wfhRequests').where({ userId: rohit.id })).toHaveLength(1);
  });

  it("is only for people who check in (not PMs or people who don't track attendance)", async () => {
    const pm = await createUser({ role: 'pm', tracksAttendance: false });
    const untracked = await createUser({ tracksAttendance: false });
    expect(await code(ask(pm, { fromDate: '2026-10-01' }))).toBe('FORBIDDEN');
    expect(await code(ask(untracked, { fromDate: '2026-10-01' }))).toBe('FORBIDDEN');
    expect(await db('wfhRequests').whereIn('userId', [pm.id, untracked.id])).toHaveLength(0);
  });
});

describe('who decides', () => {
  const pools = { hr: [{ id: 1 }, { id: 2 }], admins: [{ id: 8 }, { id: 9 }] };
  const ids = (list) => list.map((person) => person.id);

  it('sends an employee to HR, or the Admins when there is no HR', () => {
    expect(ids(pickWfhApprovers(pools, { id: 5, role: 'employee' }))).toEqual([1, 2]);
    expect(ids(pickWfhApprovers({ ...pools, hr: [] }, { id: 5, role: 'employee' }))).toEqual([
      8, 9,
    ]);
  });

  it("sends an HR person's to the Admins (other HR without Admins), an Admin's to the others", () => {
    expect(ids(pickWfhApprovers(pools, { id: 1, role: 'hr' }))).toEqual([8, 9]);
    expect(ids(pickWfhApprovers({ ...pools, admins: [] }, { id: 1, role: 'hr' }))).toEqual([2]);
    expect(ids(pickWfhApprovers(pools, { id: 8, role: 'admin' }))).toEqual([9]);
    expect(
      pickWfhApprovers({ hr: pools.hr, admins: [{ id: 8 }] }, { id: 8, role: 'admin' }),
    ).toEqual([]);
  });

  it("tells the Admins about HR's request, and only the other Admin about an Admin's", async () => {
    await ask(hr, { fromDate: '2026-10-07' });
    await ask(admin, { fromDate: '2026-10-07' });
    const wednesday = 'on Wed, 7 Oct';
    expect(
      await toldOf('wfh_request.created', `Neha Gupta asked to work from home ${wednesday}`),
    ).toEqual([admin.id, admin2.id]);
    expect(
      await toldOf('wfh_request.created', `Ravi Kapoor asked to work from home ${wednesday}`),
    ).toEqual([admin2.id]);
  });
});
