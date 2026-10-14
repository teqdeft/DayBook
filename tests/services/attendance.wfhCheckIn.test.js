// Check-in with the CONTRACT 17 settings (Office from anywhere, WFH only on HR-approved days),
// getMyToday's additions and the work-from-home reads: lists, the pending count and the nav badge.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { dashboard } from '@/modules/dashboard';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const NOW = '2026-09-30T04:00:00Z'; // Wednesday 30 September, 9:30 AM in India
const OFFICE_IP = '203.0.113.24';
const HOME_IP = '198.51.100.7';
let hr;
let admin;
let admin2;

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return { code: 'OK' };
}

const code = async (promise) => (await failure(promise)).code;
const ask = (user, fromDate, toDate = fromDate) =>
  attendance.requestWfh({ user, fromDate, toDate, reason: 'Waiting for a delivery' });

async function approved(user, fromDate, toDate) {
  const request = await ask(user, fromDate, toDate);
  return attendance.approveWfh({ actor: hr, id: request.id });
}

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  admin2 = await createUser({ name: 'Meera Pillai', role: 'admin' });
  await db('officeNetworks').insert({ name: 'Main office', ipAddress: OFFICE_IP });
});

beforeEach(async () => {
  await setSettings({
    allow_unverified_office: true,
    office_checkin_anywhere: false,
    wfh_requires_approval: true,
  });
  setNowForTests(NOW);
});

describe('Office check-in from anywhere', () => {
  it('saves Office as verified from any network, keeps the IP and tells nobody', async () => {
    await setSettings({ office_checkin_anywhere: true });
    const vishal = await createUser({ name: 'Vishal Saini' });
    const row = await attendance.checkIn({ user: vishal, ip: HOME_IP, location: 'office' });
    expect(row).toMatchObject({ location: 'office', officeVerified: true, checkInIp: HOME_IP });
    const asked = await createUser();
    const flagged = await attendance.checkIn({
      user: asked,
      ip: null,
      location: 'office',
      unverifiedOffice: true,
    });
    expect(flagged).toMatchObject({ location: 'office', officeVerified: true });
    expect(await db('notifications').where({ type: 'attendance.unverified_office' })).toEqual([]);
    expect(await db('auditLogs').where({ action: 'attendance.unverified_office' })).toEqual([]);
  });

  it('makes Office the default and still needs approval for WFH', async () => {
    await setSettings({ office_checkin_anywhere: true, allow_unverified_office: false });
    const row = await attendance.checkIn({ user: await createUser(), ip: HOME_IP });
    expect(row).toMatchObject({ location: 'office', officeVerified: true });
    const home = attendance.checkIn({ user: await createUser(), ip: HOME_IP, location: 'wfh' });
    expect(await code(home)).toBe('WFH_NOT_APPROVED');
  });

  it('keeps the guide rules when it is off', async () => {
    const away = attendance.checkIn({ user: await createUser(), ip: HOME_IP, location: 'office' });
    expect(await code(away)).toBe('OFFICE_NETWORK_REQUIRED');
    const row = await attendance.checkIn({
      user: await createUser(),
      ip: HOME_IP,
      location: 'office',
      unverifiedOffice: true,
    });
    expect(row).toMatchObject({ location: 'office', officeVerified: false });
  });
});

describe('WFH check-in needs an approved request', () => {
  it('refuses WFH without an approved request for today (pending or another day)', async () => {
    const karan = await createUser({ name: 'Karan Mehta' });
    const refused = await failure(attendance.checkIn({ user: karan, ip: HOME_IP }));
    expect(refused).toEqual({
      code: 'WFH_NOT_APPROVED',
      status: 409,
      message: "Working from home needs HR's approval for today. Ask HR first.",
    });
    await ask(karan, '2026-09-30');
    await approved(karan, '2026-10-01');
    expect(await code(attendance.checkIn({ user: karan, ip: HOME_IP, location: 'wfh' }))).toBe(
      'WFH_NOT_APPROVED',
    );
    expect(await db('attendance').where({ userId: karan.id })).toHaveLength(0);
  });

  it('checks in as WFH on a day an approved request covers', async () => {
    const deepak = await createUser();
    await approved(deepak, '2026-09-30', '2026-10-02');
    const row = await attendance.checkIn({ user: deepak, ip: HOME_IP, location: 'wfh' });
    expect(row).toMatchObject({ location: 'wfh', officeVerified: true });
  });

  it("doesn't ask HR, Admins, the office network or anyone when the setting is off", async () => {
    expect((await attendance.checkIn({ user: hr, ip: HOME_IP })).location).toBe('wfh');
    expect((await attendance.checkIn({ user: admin, ip: null })).location).toBe('wfh');
    const onSite = await attendance.checkIn({
      user: await createUser(),
      ip: OFFICE_IP,
      location: 'wfh',
    });
    expect(onSite).toMatchObject({ location: 'office', officeVerified: true });
    await setSettings({ wfh_requires_approval: false });
    expect((await attendance.checkIn({ user: await createUser(), ip: HOME_IP })).location).toBe(
      'wfh',
    );
  });
});

describe('getMyToday and getWfhForDay', () => {
  it("adds the settings and the person's requests for today", async () => {
    const simran = await createUser();
    await ask(simran, '2026-09-30');
    const today = await attendance.getMyToday({ user: simran, ip: HOME_IP });
    expect(today).toMatchObject({ officeAnywhere: false, wfhNeedsApproval: true });
    expect(today.wfh).toMatchObject({ required: true, approved: null });
    expect(today.wfh.pending.map((item) => item.fromDate)).toEqual(['2026-09-30']);

    const yash = await createUser();
    const ok = await approved(yash, '2026-09-30', '2026-10-01');
    await setSettings({ office_checkin_anywhere: true });
    const his = await attendance.getMyToday({ user: yash, ip: HOME_IP });
    expect(his).toMatchObject({ officeAnywhere: true, wfhNeedsApproval: true });
    expect(his.wfh.approved).toMatchObject({ id: ok.id, handledBy: { name: 'Neha Gupta' } });
    expect(his.wfh.pending).toEqual([]);
  });

  it('needs no approval for HR or Admins, or when the setting is off', async () => {
    expect((await attendance.getMyToday({ user: hr })).wfhNeedsApproval).toBe(false);
    expect((await attendance.getWfhForDay(admin.id, '2026-09-30')).required).toBe(false);
    const nikhil = await createUser();
    expect((await attendance.getWfhForDay(nikhil.id, '2026-09-30')).required).toBe(true);
    await setSettings({ wfh_requires_approval: false });
    expect(await attendance.getWfhForDay(nikhil.id, '2026-09-30')).toEqual({
      required: false,
      approved: null,
      pending: [],
    });
  });
});

describe('lists, the pending count and the nav badge', () => {
  let farhan;
  let mine;
  let ceos;

  beforeAll(async () => {
    await db('wfhRequests').del();
    farhan = await createUser({ name: 'Farhan Ali' });
    setNowForTests(NOW);
    await setSettings({ wfh_requires_approval: true });
    mine = await ask(hr, '2026-10-05');
    ceos = await ask(admin2, '2026-10-06');
    await ask(farhan, '2026-10-02');
    await ask(farhan, '2026-10-01');
    const old = await ask(farhan, '2026-10-07');
    await attendance.declineWfh({ actor: hr, id: old.id, reason: 'Team day' });
  });

  it("gives approvers everyone's (an Admin's to Admins only), pending first", async () => {
    const forHr = await attendance.listWfhRequests({ viewer: hr });
    expect(forHr.total).toBe(4);
    expect(forHr.items.map((item) => [item.user.name, item.fromDate, item.status])).toEqual([
      ['Farhan Ali', '2026-10-01', 'pending'],
      ['Farhan Ali', '2026-10-02', 'pending'],
      ['Neha Gupta', '2026-10-05', 'pending'],
      ['Farhan Ali', '2026-10-07', 'declined'],
    ]);
    const forAdmin = await attendance.listWfhRequests({ viewer: admin, status: 'pending' });
    expect(forAdmin.items.map((item) => item.fromDate)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-05',
      '2026-10-06',
    ]);
    const page = await attendance.listWfhRequests({ viewer: admin, limit: 2, offset: 1 });
    expect([page.total, page.items.map((item) => item.fromDate)]).toEqual([
      5,
      ['2026-10-02', '2026-10-05'],
    ]);
    const declined = await attendance.listWfhRequests({ viewer: hr, status: 'declined' });
    expect(declined.items.map((item) => item.declineReason)).toEqual(['Team day']);
  });

  it('gives anyone else only their own, whatever they ask for', async () => {
    const own = await attendance.listWfhRequests({ viewer: farhan, userId: hr.id });
    expect(own.total).toBe(3);
    expect(new Set(own.items.map((item) => item.user.id))).toEqual(new Set([farhan.id]));
    const pm = await createUser({ role: 'pm', tracksAttendance: false });
    expect(await attendance.listWfhRequests({ viewer: pm })).toEqual({ items: [], total: 0 });
  });

  it('keeps pending ones not over by a day and those handled since it (handledSince)', async () => {
    setNowForTests('2026-10-08T05:00:00Z');
    const late = await ask(farhan, '2026-10-09');
    await attendance.approveWfh({ actor: hr, id: late.id });
    // The 1 Oct request ended before 2 Oct; the decline on 30 Sep is older than 2 Oct.
    const recent = await attendance.listWfhRequests({ viewer: hr, handledSince: '2026-10-02' });
    expect(recent.items.map((item) => [item.fromDate, item.status])).toEqual([
      ['2026-10-02', 'pending'],
      ['2026-10-05', 'pending'],
      ['2026-10-09', 'approved'],
    ]);
    expect(recent.total).toBe(3);
    await db('wfhRequests').where({ id: late.id }).del();
  });

  it('reads each list with one query for the rows and one for the total', async () => {
    const queries = [];
    const listen = (query) => queries.push(query.sql);
    db.on('query', listen);
    await attendance.listWfhRequests({ viewer: admin });
    db.removeListener('query', listen);
    expect(queries.filter((sql) => sql.includes('wfh_requests'))).toHaveLength(2);
  });

  it("counts pending requests others asked for, an Admin's for Admins only", async () => {
    expect(await attendance.countPendingWfh({ viewer: hr })).toBe(2);
    expect(await attendance.countPendingWfh({ viewer: admin })).toBe(4);
    expect(await attendance.countPendingWfh({ viewer: admin2 })).toBe(3);
    expect(await attendance.countPendingWfh({ viewer: farhan })).toBe(0);
    expect(await attendance.countPendingWfh()).toBe(4);
  });

  it('stops counting a pending request once its days are over', async () => {
    setNowForTests('2026-10-03T05:00:00Z'); // Farhan's 1 and 2 Oct are over
    expect(await attendance.countPendingWfh({ viewer: hr })).toBe(0);
    expect(await attendance.countPendingWfh({ viewer: admin })).toBe(2);
    expect(await attendance.countPendingWfh({ viewer: admin2 })).toBe(1);
    expect(await dashboard.getNavBadges(hr)).toEqual({ requests: 0, corrections: 0 });
    expect(await dashboard.getNavBadges(admin)).toMatchObject({ corrections: 2 });
    expect((await attendance.listWfhRequests({ viewer: hr, status: 'pending' })).total).toBe(3);
  });

  it('adds them to the Attendance badge with the corrections, in one query', async () => {
    expect(await dashboard.getNavBadges(hr)).toEqual({ requests: 0, corrections: 2 });
    expect(await dashboard.getNavBadges(admin2)).toMatchObject({ corrections: 3 });
    expect(await dashboard.getNavBadges(farhan)).toEqual({ requests: 0, corrections: 0 });
    const queries = [];
    const listen = (query) => queries.push(query.sql);
    db.on('query', listen);
    expect(await dashboard.getNavBadges(admin)).toMatchObject({ corrections: 4 });
    db.removeListener('query', listen);
    // Besides the company's settings (cached in-process outside tests) for today's date.
    expect(queries.filter((sql) => !sql.includes('`settings`'))).toHaveLength(1);
  });
});
