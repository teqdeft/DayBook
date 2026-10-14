// Decisions on work-from-home requests (CONTRACT 17): HR's approve and decline, and the person's
// cancel (ending an approved request early once it has started). Every rule and error code; an
// Admin's request is for Admins only; days that are over can't be approved.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
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

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ slack_enabled: true, slack_requests_notify: true });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', slackUserId: 'UHR1' });
  hr2 = await createUser({ name: 'Anjali Bose', role: 'hr', slackUserId: 'UHR2' });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin', slackUserId: 'UADM1' });
  admin2 = await createUser({ name: 'Meera Pillai', role: 'admin', slackUserId: 'UADM2' });
});

beforeEach(() => setNowForTests(NOW));

describe('approving and declining', () => {
  it('approves a pending request once, tells the person and audits it', async () => {
    const deepak = await createUser({ name: 'Deepak Joshi', slackUserId: 'UDEEPAK' });
    const asked = await ask(deepak, { fromDate: '2026-10-01', toDate: '2026-10-02' });
    const approved = await attendance.approveWfh({ actor: hr, id: asked.id, ip: '10.0.0.2' });
    expect(approved).toMatchObject({
      id: asked.id,
      status: 'approved',
      handledBy: { id: hr.id, name: 'Neha Gupta' },
      declineReason: null,
    });
    expect(approved.handledAt.toISOString()).toBe('2026-09-30T05:30:00.000Z');
    const told = await db('notifications').where({ userId: deepak.id }).first();
    expect(told).toMatchObject({
      type: 'wfh_request.approved',
      title: 'Working from home approved for Thu, 1 – Fri, 2 Oct',
      body: null,
      link: '/today',
    });
    const dm = await db('slackOutbox').where({ channel: 'UDEEPAK' }).first();
    expect(parseJson(dm.payload).text).toBe('Working from home approved for Thu, 1 – Fri, 2 Oct.');
    const log = await db('auditLogs').where({ action: 'wfh_request.approve' }).first();
    expect(log).toMatchObject({ actorId: hr.id, entityId: asked.id, ip: '10.0.0.2' });
    expect(parseJson(log.after)).toMatchObject({ status: 'approved' });

    expect(await code(attendance.approveWfh({ actor: hr2, id: asked.id }))).toBe(
      'REQUEST_ALREADY_HANDLED',
    );
    expect(await code(attendance.declineWfh({ actor: hr2, id: asked.id, reason: 'No' }))).toBe(
      'REQUEST_ALREADY_HANDLED',
    );
  });

  it('declines with a reason the person reads in the app and on Slack', async () => {
    const simran = await createUser({ name: 'Simran Kaur', slackUserId: 'USIMRAN' });
    const asked = await ask(simran, { fromDate: '2026-10-01' });
    const decline = (reason) => failure(attendance.declineWfh({ actor: hr, id: asked.id, reason }));
    expect((await decline(' x ')).fields).toEqual({ reason: 'Add a reason for them.' });
    expect((await decline(undefined)).code).toBe('VALIDATION_FAILED');
    expect((await decline('y'.repeat(301))).fields).toEqual({
      reason: 'Keep it to 300 characters or fewer.',
    });
    const declined = await attendance.declineWfh({
      actor: hr,
      id: asked.id,
      reason: '  Client demo in the office  ',
    });
    expect(declined).toMatchObject({
      status: 'declined',
      declineReason: 'Client demo in the office',
      handledBy: { id: hr.id, name: 'Neha Gupta' },
    });
    const told = await db('notifications').where({ userId: simran.id }).first();
    expect(told).toMatchObject({
      type: 'wfh_request.declined',
      title: 'Working from home declined for Thu, 1 Oct',
      body: 'Client demo in the office',
      link: '/today',
    });
    const dm = await db('slackOutbox').where({ channel: 'USIMRAN' }).first();
    expect(parseJson(dm.payload).text).toBe(
      'Working from home declined for Thu, 1 Oct.\nReason: Client demo in the office',
    );
    const log = await db('auditLogs').where({ action: 'wfh_request.decline' }).first();
    expect(log).toMatchObject({ actorId: hr.id, reason: 'Client demo in the office' });
  });

  it("needs attendance.correct, never your own, and hides an Admin's from HR", async () => {
    const yash = await createUser({ name: 'Yash Rao' });
    const asked = await ask(yash, { fromDate: '2026-10-08' });
    expect(await code(attendance.approveWfh({ actor: await createUser(), id: asked.id }))).toBe(
      'FORBIDDEN',
    );
    expect(await code(attendance.approveWfh({ actor: hr, id: 999999 }))).toBe('NOT_FOUND');

    const own = await ask(hr2, { fromDate: '2026-10-08' });
    const mine = await failure(attendance.approveWfh({ actor: hr2, id: own.id }));
    expect(mine).toMatchObject({
      code: 'FORBIDDEN',
      message: "You can't handle your own request.",
    });
    expect(await code(attendance.declineWfh({ actor: hr2, id: own.id, reason: 'No' }))).toBe(
      'FORBIDDEN',
    );
    expect((await attendance.approveWfh({ actor: hr, id: own.id })).status).toBe('approved');

    const ceos = await ask(admin2, { fromDate: '2026-10-08' });
    const hidden = await failure(attendance.approveWfh({ actor: hr, id: ceos.id }));
    const missing = await failure(attendance.approveWfh({ actor: hr, id: 999999 }));
    expect(hidden).toEqual(missing);
    expect(await code(attendance.declineWfh({ actor: hr, id: ceos.id, reason: 'No' }))).toBe(
      'NOT_FOUND',
    );
    expect((await attendance.approveWfh({ actor: admin, id: ceos.id })).status).toBe('approved');
  });
});

describe('cancelling', () => {
  it('cancels your own pending request, or an approved one that starts after today', async () => {
    const kavya = await createUser({ name: 'Kavya Iyer' });
    const pending = await ask(kavya, { fromDate: '2026-10-01' });
    const cancelled = await attendance.cancelWfh({ user: kavya, id: pending.id, ip: '10.0.0.3' });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      handledBy: { id: kavya.id, name: 'Kavya Iyer' },
    });
    const log = await db('auditLogs')
      .where({ action: 'wfh_request.cancel', entityId: pending.id })
      .first();
    expect(log).toMatchObject({ actorId: kavya.id, ip: '10.0.0.3' });
    expect(parseJson(log.before)).toEqual({ status: 'pending', handledBy: null });
    expect(await code(attendance.cancelWfh({ user: kavya, id: pending.id }))).toBe(
      'REQUEST_ALREADY_HANDLED',
    );

    const tomorrow = await ask(kavya, { fromDate: '2026-10-01' });
    await attendance.approveWfh({ actor: hr, id: tomorrow.id });
    expect((await attendance.cancelWfh({ user: kavya, id: tomorrow.id })).status).toBe('cancelled');
  });

  it('cancels an approved request starting today outright before a WFH check-in', async () => {
    const sahil = await createUser({ name: 'Sahil Khan' });
    const today = await ask(sahil, { fromDate: '2026-09-30', toDate: '2026-10-01' });
    await attendance.approveWfh({ actor: hr, id: today.id });
    const cancelled = await attendance.cancelWfh({ user: sahil, id: today.id });
    expect(cancelled).toMatchObject({ status: 'cancelled', toDate: '2026-10-01' });
    const home = attendance.checkIn({ user: sahil, ip: '198.51.100.7', location: 'wfh' });
    expect(await code(home)).toBe('WFH_NOT_APPROVED');
  });

  it("refuses a declined request and someone else's", async () => {
    const sahil = await createUser({ name: 'Sahil Khan' });
    const declined = await ask(sahil, { fromDate: '2026-10-09' });
    await attendance.declineWfh({ actor: hr, id: declined.id, reason: 'Team day' });
    expect(await code(attendance.cancelWfh({ user: sahil, id: declined.id }))).toBe(
      'REQUEST_ALREADY_HANDLED',
    );
    const other = await ask(await createUser(), { fromDate: '2026-10-09' });
    expect(await code(attendance.cancelWfh({ user: sahil, id: other.id }))).toBe('NOT_FOUND');
    expect(await code(attendance.cancelWfh({ user: hr, id: other.id }))).toBe('NOT_FOUND');
    expect(await code(attendance.cancelWfh({ user: sahil, id: 999999 }))).toBe('NOT_FOUND');
  });
});

describe('ending an approved request early (it has started)', () => {
  const HOME_IP = '198.51.100.7';
  const approve = async (user, fromDate, toDate) => {
    const asked = await ask(user, { fromDate, toDate });
    return attendance.approveWfh({ actor: hr, id: asked.id });
  };

  it('keeps the days up to yesterday and audits the old and new last day', async () => {
    const arjun = await createUser({ name: 'Arjun Nair' });
    const range = await approve(arjun, '2026-09-30', '2026-10-13');
    setNowForTests('2026-10-02T05:30:00Z'); // Fri 2 Oct, not checked in yet
    const ended = await attendance.cancelWfh({ user: arjun, id: range.id, ip: '10.0.0.4' });
    expect(ended).toMatchObject({
      status: 'approved',
      fromDate: '2026-09-30',
      toDate: '2026-10-01',
      days: 'Wed, 30 Sep – Thu, 1 Oct',
      handledBy: { id: hr.id, name: 'Neha Gupta' },
    });
    const log = await db('auditLogs')
      .where({ action: 'wfh_request.cancel', entityId: range.id })
      .first();
    expect(log).toMatchObject({ actorId: arjun.id, ip: '10.0.0.4' });
    expect(parseJson(log.before)).toEqual({ status: 'approved', toDate: '2026-10-13' });
    expect(parseJson(log.after)).toEqual({ status: 'approved', toDate: '2026-10-01' });
    const home = attendance.checkIn({ user: arjun, ip: HOME_IP, location: 'wfh' });
    expect(await code(home)).toBe('WFH_NOT_APPROVED');
    // The days given back can be asked for again.
    expect((await ask(arjun, { fromDate: '2026-10-05' })).status).toBe('pending');
  });

  it('keeps today when they already checked in from home', async () => {
    const nikhil = await createUser({ name: 'Nikhil Das' });
    const range = await approve(nikhil, '2026-09-30', '2026-10-06');
    setNowForTests('2026-10-01T04:00:00Z');
    await attendance.checkIn({ user: nikhil, ip: HOME_IP, location: 'wfh' });
    const ended = await attendance.cancelWfh({ user: nikhil, id: range.id });
    expect(ended).toMatchObject({ status: 'approved', toDate: '2026-10-01' });

    const today = await approve(nikhil, '2026-10-02', '2026-10-02');
    setNowForTests('2026-10-02T04:00:00Z');
    await attendance.checkIn({ user: nikhil, ip: HOME_IP, location: 'wfh' });
    expect(await failure(attendance.cancelWfh({ user: nikhil, id: today.id }))).toMatchObject({
      code: 'CONFLICT',
      message: "Today is the last day and you've checked in from home, so it stays.",
    });
  });

  it('has nothing to cancel once the days are over', async () => {
    const farhan = await createUser({ name: 'Farhan Ali' });
    const past = await approve(farhan, '2026-09-30', '2026-10-01');
    setNowForTests('2026-10-05T05:30:00Z');
    expect(await failure(attendance.cancelWfh({ user: farhan, id: past.id }))).toMatchObject({
      code: 'CONFLICT',
      message: "Those days are over, so there's nothing to cancel.",
    });
    expect((await db('wfhRequests').where({ id: past.id }).first()).toDate).toBe('2026-10-01');
  });
});

describe('a pending request whose days are over', () => {
  it("can't be approved any more, but can still be declined", async () => {
    const karan = await createUser({ name: 'Karan Mehta', slackUserId: 'UKARAN' });
    const asked = await ask(karan, { fromDate: '2026-09-30' });
    setNowForTests('2026-10-01T05:30:00Z');
    expect(await failure(attendance.approveWfh({ actor: hr, id: asked.id }))).toMatchObject({
      code: 'CONFLICT',
      message: "Those days are over, so it can't be approved.",
    });
    expect(await db('notifications').where({ userId: karan.id })).toEqual([]);
    expect(await db('slackOutbox').where({ channel: 'UKARAN' })).toEqual([]);
    const declined = await attendance.declineWfh({ actor: hr, id: asked.id, reason: 'Too late' });
    expect(declined.status).toBe('declined');

    // A range still running is approved for the days left.
    const range = await ask(karan, { fromDate: '2026-10-01', toDate: '2026-10-02' });
    setNowForTests('2026-10-02T05:30:00Z');
    expect((await attendance.approveWfh({ actor: hr, id: range.id })).status).toBe('approved');
  });
});
