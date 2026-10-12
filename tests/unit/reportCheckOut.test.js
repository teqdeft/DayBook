// "Submit and check out" on the Daily report (a company request): who is offered it and what the
// question and the toast say. tests/services/reportsCheckOut.test.js runs it on real rows.
import { describe, expect, it } from 'vitest';
import {
  canCheckOutFromReport,
  checkOutFailedToast,
  submitAndCheckOutQuestion,
  submittedAndCheckedOutToast,
} from '@/app/(app)/report/reportCheckOut';

const employee = { role: 'employee', status: 'active', tracksAttendance: true };
const open = { checkOutAt: null, checkoutStatus: 'open' };
const offered = (user, row = open, isToday = true) => canCheckOutFromReport({ user, row, isToday });

describe('canCheckOutFromReport', () => {
  it("offers it on today's report while the person is checked in", () => {
    expect(offered(employee)).toBe(true);
    expect(offered({ ...employee, role: 'hr' })).toBe(true);
  });

  it('not on another day, before check-in or once the day is closed', () => {
    expect(offered(employee, open, false)).toBe(false);
    expect(offered(employee, null)).toBe(false);
    const out = { checkOutAt: '2026-09-30T13:02:00.000Z', checkoutStatus: 'checked_out' };
    expect(offered(employee, out)).toBe(false);
    expect(offered(employee, { checkOutAt: null, checkoutStatus: 'missing' })).toBe(false);
  });

  it('for an untracked Admin who checked in today, as Today offers Check out', () => {
    expect(offered({ role: 'admin', status: 'active', tracksAttendance: false })).toBe(true);
  });

  it('not for people who may not check out', () => {
    const pm = { role: 'pm', status: 'active', tracksAttendance: true };
    const left = { ...employee, status: 'deactivated' };
    for (const user of [pm, left, null]) expect(offered(user)).toBe(false);
  });
});

describe('texts', () => {
  it('sends the person to Today when the check-out fails, unless the day is already over', () => {
    const offline = { code: 'NETWORK', message: "You're offline or Daybook can't be reached." };
    expect(checkOutFailedToast(offline)).toEqual({
      title: "Your report is in, but we couldn't check you out",
      body: "You're offline or Daybook can't be reached. Check out from Today.",
      tone: 'error',
    });
    const out = { code: 'ALREADY_CHECKED_OUT', message: 'You have already checked out today.' };
    expect(checkOutFailedToast(out).body).toBe('You have already checked out today.');
  });

  it('asks once, with the time the day would end', () => {
    expect(submitAndCheckOutQuestion('6:32 PM')).toEqual({
      title: 'Submit your report and check out?',
      description:
        "This sends today's report and ends your day at 6:32 PM. You can't check in again today.",
    });
  });

  it("says both happened, with the note Today's check-out gives", () => {
    const response = {
      row: { checkOutAt: '2026-09-30T13:02:00.000Z' },
      reportPending: false,
      presentMinutes: 540,
      breakMinutes: 45,
      workedMinutes: 495,
      loggedMinutes: 480,
      gapWarning: false,
    };
    expect(submittedAndCheckedOutToast(response, 'Asia/Kolkata')).toEqual({
      title: 'Report submitted. Checked out at 6:32 PM',
      body: 'You worked 8h 15m (45m of breaks).',
    });
    const noBreaks = { ...response, breakMinutes: 0, workedMinutes: 540 };
    expect(submittedAndCheckedOutToast(noBreaks, 'Asia/Kolkata').body).toBeUndefined();
  });
});
