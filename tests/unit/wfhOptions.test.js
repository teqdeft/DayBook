// Today's work-from-home pieces (CONTRACT 17): what the check-in card offers with and without
// "Office from anywhere" and HR's approval, the request lines under the links with their Cancel
// wording, and the request dialog's dates.
import { describe, expect, it } from 'vitest';
import {
  cancelledToast,
  cancelWording,
  checkInOptions,
  firstName,
  followFrom,
  lastToDate,
  nextWorkingDay,
  wfhLines,
  wfhToday,
} from '@/app/(app)/today/wfhOptions';

const NO_APPROVAL = { needsApproval: false, approved: false, approvedBy: null, pending: false };
const NEEDS = { ...NO_APPROVAL, needsApproval: true };
const APPROVED = { ...NEEDS, approved: true, approvedBy: 'Neha' };
const PENDING = { ...NEEDS, pending: true };

const options = (overrides) =>
  checkInOptions({
    picked: null,
    onOfficeNetwork: false,
    officeAnywhere: false,
    allowUnverifiedOffice: true,
    wfh: NO_APPROVAL,
    ...overrides,
  });

const request = (overrides) => ({
  id: 1,
  fromDate: '2026-10-14',
  toDate: '2026-10-14',
  days: 'Wed, 14 Oct',
  status: 'pending',
  ...overrides,
});

describe('wfhToday', () => {
  it('reads who approved today and whether a request is waiting', () => {
    const mine = {
      wfhNeedsApproval: true,
      wfh: {
        required: true,
        approved: { id: 3, handledBy: { id: 9, name: 'Neha Gupta' } },
        pending: [{ id: 4 }],
      },
    };
    expect(wfhToday(mine)).toEqual({
      needsApproval: true,
      approved: true,
      approvedBy: 'Neha',
      pending: true,
    });
  });

  it('copes with no WFH data at all (settings off, older server)', () => {
    expect(wfhToday({})).toEqual(NO_APPROVAL);
  });
});

describe('checkInOptions', () => {
  it('keeps the old card when both settings are off: on the network only Office', () => {
    const result = options({ onOfficeNetwork: true, picked: 'wfh' });
    expect(result.choice).toBe('office');
    expect(result.network).toBe('on');
    expect(result.wifi).toBeNull();
    expect(result.office).toMatchObject({ hint: "You're on the office Wi-Fi", disabled: false });
    expect(result.wfh).toEqual({
      hint: 'Not while on the office Wi-Fi',
      disabled: true,
      ask: false,
    });
  });

  it('keeps the old card when both settings are off: off the network WFH, Wi-Fi is down', () => {
    const result = options({});
    expect(result.choice).toBe('wfh');
    expect(result.network).toBe('off');
    expect(result.wifi).toBe('offer');
    expect(result.office).toMatchObject({ hint: 'Only on the office Wi-Fi', disabled: true });
    expect(result.wfh.hint).toBe('Or anywhere outside the office');

    const unverified = options({ picked: 'unverified' });
    expect(unverified.choice).toBe('unverified');
    expect(unverified.wifi).toBe('unverified');
    expect(unverified.office).toMatchObject({ value: 'unverified', title: 'Office, unverified' });

    const notAllowed = options({ picked: 'unverified', allowUnverifiedOffice: false });
    expect(notAllowed.choice).toBe('wfh');
    expect(notAllowed.wifi).toBe('officeOnly');
  });

  it('with Office from anywhere picks Office first, from any network, without network talk', () => {
    const result = options({ officeAnywhere: true, wfh: APPROVED });
    expect(result.choice).toBe('office');
    expect(result.office).toEqual({
      value: 'office',
      title: 'Office',
      hint: 'Check in from anywhere for now',
      disabled: false,
    });
    expect(result.network).toBeNull();
    expect(result.wifi).toBeNull();
    // An approved day still lets the person pick WFH.
    expect(options({ officeAnywhere: true, wfh: APPROVED, picked: 'wfh' }).choice).toBe('wfh');
    // "Wi-Fi is down" is not needed: a stale pick of it becomes Office.
    expect(options({ officeAnywhere: true, picked: 'unverified' }).choice).toBe('office');
  });

  it('offers WFH on an approved day with who approved it', () => {
    const result = options({ wfh: APPROVED });
    expect(result.choice).toBe('wfh');
    expect(result.wfh).toEqual({ hint: 'Approved by Neha', disabled: false, ask: false });
    expect(options({ wfh: { ...APPROVED, approvedBy: null } }).wfh.hint).toBe('Approved by HR');
  });

  it('closes WFH without approval and offers Ask HR, or says HR has it', () => {
    const result = options({ wfh: NEEDS, picked: 'wfh' });
    expect(result.wfh).toEqual({ hint: "Needs HR's approval", disabled: true, ask: true });
    expect(result.wfhOpen).toBe(false);
    // Off the network with no Office: nothing is picked until "Wi-Fi is down" is.
    expect(result.choice).toBeNull();
    expect(result.wifi).toBe('offer');
    expect(options({ wfh: NEEDS, picked: 'unverified' }).choice).toBe('unverified');
    expect(options({ wfh: NEEDS, allowUnverifiedOffice: false }).wifi).toBe('officeOnly');

    expect(options({ wfh: PENDING }).wfh).toEqual({
      hint: 'Waiting for HR',
      disabled: true,
      ask: false,
    });
  });

  it('never asks for WFH on the office network, whatever the approval', () => {
    for (const wfh of [NEEDS, APPROVED, PENDING]) {
      const result = options({ onOfficeNetwork: true, wfh, picked: 'wfh' });
      expect(result.choice).toBe('office');
      expect(result.wfh).toEqual({
        hint: 'Not while on the office Wi-Fi',
        disabled: true,
        ask: false,
      });
    }
  });

  it('turns Office and WFH into Office from anywhere and Ask HR together', () => {
    const result = options({ officeAnywhere: true, wfh: NEEDS });
    expect(result.choice).toBe('office');
    expect(result.office.disabled).toBe(false);
    expect(result.wfh.ask).toBe(true);
  });
});

describe('wfhLines', () => {
  it('lists waiting requests, then approved ones, that are not over, soonest first', () => {
    const lines = wfhLines(
      [
        request({
          id: 1,
          fromDate: '2026-10-20',
          toDate: '2026-10-21',
          days: 'Tue, 20 – Wed, 21 Oct',
        }),
        request({ id: 2 }),
        request({
          id: 3,
          status: 'approved',
          fromDate: '2026-10-13',
          toDate: '2026-10-13',
          days: 'Tue, 13 Oct',
        }),
        request({
          id: 4,
          status: 'approved',
          fromDate: '2026-10-09',
          toDate: '2026-10-12',
          days: 'Fri, 9 – Mon, 12 Oct',
        }),
        request({ id: 5, status: 'declined', days: 'Thu, 15 Oct' }),
        request({ id: 6, status: 'cancelled', days: 'Fri, 16 Oct' }),
        // Nobody decided before its day: out of date, no line.
        request({ id: 7, fromDate: '2026-10-12', toDate: '2026-10-12', days: 'Mon, 12 Oct' }),
        request({
          id: 8,
          status: 'approved',
          fromDate: '2026-10-12',
          toDate: '2026-10-16',
          days: 'Mon, 12 – Fri, 16 Oct',
        }),
      ],
      '2026-10-13',
    );
    expect(lines).toEqual([
      {
        id: 2,
        status: 'pending',
        days: 'Wed, 14 Oct',
        started: false,
        text: 'Waiting for HR: Working from home on Wed, 14 Oct.',
      },
      {
        id: 1,
        status: 'pending',
        days: 'Tue, 20 – Wed, 21 Oct',
        started: false,
        text: 'Waiting for HR: Working from home on Tue, 20 – Wed, 21 Oct.',
      },
      {
        id: 8,
        status: 'approved',
        days: 'Mon, 12 – Fri, 16 Oct',
        started: true,
        text: 'Working from home approved for Mon, 12 – Fri, 16 Oct.',
      },
      {
        id: 3,
        status: 'approved',
        days: 'Tue, 13 Oct',
        started: true,
        text: 'Working from home approved for Tue, 13 Oct.',
      },
    ]);
  });

  it('has no lines without requests', () => {
    expect(wfhLines([], '2026-10-13')).toEqual([]);
  });
});

describe('cancelling a request from Today', () => {
  it('asks in words that fit a waiting, an approved and a started request', () => {
    expect(cancelWording({ status: 'pending', days: 'Wed, 14 Oct', started: false })).toEqual({
      title: 'Cancel this request?',
      description: "You asked to work from home on Wed, 14 Oct. HR won't need to decide on it.",
      confirm: 'Cancel request',
    });
    expect(cancelWording({ status: 'approved', days: 'Wed, 14 Oct', started: false })).toEqual({
      title: 'Cancel working from home?',
      description:
        'HR approved working from home on Wed, 14 Oct. ' +
        'To work from home on those days after all, ask again.',
      confirm: 'Cancel it',
    });
    const started = { status: 'approved', days: 'Mon, 12 – Fri, 16 Oct', started: true };
    expect(cancelWording(started)).toMatchObject({
      title: 'Cancel the rest?',
      confirm: 'Cancel the rest',
    });
    expect(cancelWording(started).description).toBe(
      'HR approved working from home on Mon, 12 – Fri, 16 Oct. The days from today on are ' +
        "cancelled; today stays if you've already checked in from home.",
    );
  });

  it('says what was cancelled, and what stays approved when a started one ends early', () => {
    expect(cancelledToast({ status: 'pending' }, { status: 'cancelled' })).toEqual({
      title: 'Request cancelled',
    });
    expect(cancelledToast({ status: 'approved' }, { status: 'cancelled' })).toEqual({
      title: 'Working from home cancelled',
    });
    const ended = { status: 'approved', days: 'Mon, 12 Oct' };
    expect(cancelledToast({ status: 'approved' }, ended)).toEqual({
      title: 'The rest is cancelled',
      body: 'Working from home stays approved for Mon, 12 Oct.',
    });
  });
});

describe('request dialog dates', () => {
  it('starts "another day" on the next working day', () => {
    const monToFri = [1, 2, 3, 4, 5];
    expect(nextWorkingDay('2026-10-13', monToFri)).toBe('2026-10-14');
    // Friday -> Monday
    expect(nextWorkingDay('2026-10-16', monToFri)).toBe('2026-10-19');
    // Saturdays too
    expect(nextWorkingDay('2026-10-16', [1, 2, 3, 4, 5, 6])).toBe('2026-10-17');
    expect(nextWorkingDay('2026-10-16', [])).toBe('2026-10-17');
  });

  it('moves To with From until the person picks To, and never leaves it before From', () => {
    expect(followFrom({ toDate: '2026-10-14', toTouched: false }, '2026-10-16')).toBe('2026-10-16');
    expect(followFrom({ toDate: '2026-10-20', toTouched: true }, '2026-10-16')).toBe('2026-10-20');
    expect(followFrom({ toDate: '2026-10-15', toTouched: true }, '2026-10-16')).toBe('2026-10-16');
    expect(followFrom({ toDate: '', toTouched: true }, '2026-10-16')).toBe('2026-10-16');
  });

  it('allows at most 14 days', () => {
    expect(lastToDate('2026-10-14')).toBe('2026-10-27');
    expect(lastToDate('')).toBe('');
  });
});

describe('firstName', () => {
  it('keeps placeholder names whole', () => {
    expect(firstName('Neha Gupta')).toBe('Neha');
    expect(firstName('[CEO name]')).toBe('[CEO name]');
    expect(firstName(null)).toBe('');
  });
});
