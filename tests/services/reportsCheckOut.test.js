// "Submit and check out" on the Daily report (a company request), against the real attendance
// and reports modules: who the page offers it to (canCheckOutFromReport on the row the page
// reads), and the two steps the button runs in order, the submit and then Today's check-out.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canCheckOutFromReport,
  submittedAndCheckedOutToast,
} from '@/app/(app)/report/reportCheckOut';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { TODAY, TZ, YESTERDAY, setClock } from './timersKit.js';

const OFFICE_IP = '203.0.113.24';

let pm;
let emp;
let acme;

const parse = (entries) => saveReportSchema.parse({ entries }).entries;
const rowOf = (user, date = TODAY) => attendance.getForUserOnDate(user.id, date);
const offered = async (user, isToday = true) =>
  canCheckOutFromReport({ user, row: await rowOf(user), isToday });

beforeAll(async () => {
  await resetDatabase();
  await db('officeNetworks').insert({ name: 'Main office', ipAddress: OFFICE_IP });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = await createUser({ name: 'Emma Dev' });
  acme = await createProject(pm, { name: 'acme-app' });
  await addMembers(acme, [emp]);
});

beforeEach(async () => {
  await db('reportTasks').del();
  await db('reportEntries').del();
  await db('reportRevisions').del();
  await db('slack_outbox').del();
  await db('dailyReports').del();
  await db('attendance').del();
});

afterAll(() => setNowForTests(null));

describe('submit and check out', () => {
  it('is offered only while today is checked in, and runs the submit then the check-out', async () => {
    setClock('09:32');
    expect(await offered(emp)).toBe(false); // not checked in yet
    await attendance.checkIn({ user: emp, ip: OFFICE_IP });
    expect(await offered(emp)).toBe(true);
    expect(await offered(emp, false)).toBe(false); // another day's report

    // 6:32 PM: the submit leaves the day open, so the check-out still goes through after it.
    setClock('18:32');
    const draft = await reports.openForDate({ user: emp, workDate: TODAY });
    const entries = parse([
      { projectId: acme.id, hours: 6, tasks: [{ title: 'Booking screen', status: 'done' }] },
    ]);
    const submitted = await reports.submitReport({ user: emp, reportId: draft.id, entries });
    expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 360 });
    expect(await offered(emp)).toBe(true);

    const result = await attendance.checkOut({ user: emp, ip: OFFICE_IP });
    expect(result).toMatchObject({ reportPending: false, reportStatus: 'submitted' });
    expect(submittedAndCheckedOutToast(result, TZ)).toEqual({
      title: 'Report submitted. Checked out at 6:32 PM',
      body: 'You were here 9h and logged 6h. Add any missing hours to your report.',
    });
    expect(await offered(emp)).toBe(false); // no second check-in, nothing to offer
  });

  it("follows an open row today (as Today's Check out does), never a closed day", async () => {
    setClock('11:00');
    const admin = await createUser({ name: 'The CEO', role: 'admin', tracksAttendance: false });
    const trackedAdmin = await createUser({ name: 'Meera Admin', role: 'admin' });
    const hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
    const left = await createUser({ name: 'Gone Person', status: 'deactivated' });
    const missing = await createUser({ name: 'Forgot Checkout' });
    for (const person of [admin, trackedAdmin, hr, left, pm]) await checkIn(person, TODAY);
    // A row the midnight job (or HR) closed has no check-out time but isn't open.
    await checkIn(missing, TODAY, { checkoutStatus: 'missing' });
    // Yesterday's open row doesn't count for today.
    await checkIn(emp, YESTERDAY);

    expect(await offered(trackedAdmin)).toBe(true);
    expect(await offered(hr)).toBe(true);
    // An Admin who doesn't track attendance may still check in, and Today offers Check out.
    expect(await offered(admin)).toBe(true);
    expect(await attendance.checkOut({ user: admin, ip: OFFICE_IP })).toMatchObject({
      reportPending: true,
    });
    expect(await offered(admin)).toBe(false);
    expect(await offered(pm)).toBe(false);
    expect(await offered(left)).toBe(false);
    expect(await offered(missing)).toBe(false);
    expect(await offered(emp)).toBe(false);
  });
});
