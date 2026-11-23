// The payroll month (CONTRACT 25, item 4). Pure, no database.
import { describe, expect, it } from 'vitest';
import { payrollMonthOf, payrollPeriod, resolvePayrollMonth } from '@/modules/attendance/payroll';

const TZ = 'Asia/Kolkata';

describe('payrollPeriod', () => {
  it('start day 1 is the calendar month', () => {
    expect(payrollPeriod('2026-11', 1)).toEqual({
      month: '2026-11',
      from: '2026-11-01',
      to: '2026-11-30',
      label: 'November 2026',
      rangeLabel: null,
    });
    expect(payrollPeriod('2028-02', 1)).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('start day 26 runs from the 26th to the 25th, named after the month it ends in', () => {
    expect(payrollPeriod('2026-11', 26)).toEqual({
      month: '2026-11',
      from: '2026-10-26',
      to: '2026-11-25',
      label: 'November 2026',
      rangeLabel: '26 Oct to 25 Nov',
    });
    expect(payrollPeriod('2027-01', 26)).toMatchObject({ from: '2026-12-26', to: '2027-01-25' });
    expect(payrollPeriod('2026-03', 28)).toMatchObject({ from: '2026-02-28', to: '2026-03-27' });
  });
});

describe('payrollMonthOf', () => {
  it('names the period a date belongs to', () => {
    expect(payrollMonthOf('2026-11-25', 26)).toBe('2026-11');
    expect(payrollMonthOf('2026-11-26', 26)).toBe('2026-12');
    expect(payrollMonthOf('2026-12-26', 26)).toBe('2027-01');
    expect(payrollMonthOf('2026-11-30', 1)).toBe('2026-11');
    expect(payrollMonthOf('2026-02-28', 28)).toBe('2026-03');
    expect(payrollMonthOf('2026-02-27', 28)).toBe('2026-02');
  });
});

describe('resolvePayrollMonth', () => {
  const settings = { payrollMonthStartDay: 26, timezone: TZ };

  it('clamps a later month and bad input to the current one', () => {
    const today = '2026-11-19';
    expect(resolvePayrollMonth('2027-03', settings, { today })).toMatchObject({
      month: '2026-11',
      isCurrent: true,
      nextMonth: null,
      prevMonth: '2026-10',
    });
    expect(resolvePayrollMonth('nope', settings, { today }).month).toBe('2026-11');
    expect(resolvePayrollMonth('2026-13', settings, { today }).month).toBe('2026-11');
    expect(resolvePayrollMonth('2019-05', settings, { today })).toMatchObject({
      month: '2020-01',
      prevMonth: null,
    });
    expect(resolvePayrollMonth('2026-09', settings, { today })).toMatchObject({
      month: '2026-09',
      from: '2026-08-26',
      to: '2026-09-25',
      isCurrent: false,
      nextMonth: '2026-10',
      defaulted: null,
    });
  });

  it('without a month, the first 3 days of a period open the previous one', () => {
    for (const today of ['2026-11-26', '2026-11-27', '2026-11-28']) {
      expect(resolvePayrollMonth(undefined, settings, { today })).toMatchObject({
        month: '2026-11',
        isCurrent: false,
        nextMonth: '2026-12',
        defaulted: 'previous',
      });
    }
    expect(resolvePayrollMonth(undefined, settings, { today: '2026-11-29' })).toMatchObject({
      month: '2026-12',
      isCurrent: true,
      defaulted: null,
    });
    const calendar = { payrollMonthStartDay: 1, timezone: TZ };
    expect(resolvePayrollMonth(null, calendar, { today: '2026-12-03' })).toMatchObject({
      month: '2026-11',
      defaulted: 'previous',
    });
    expect(resolvePayrollMonth(null, calendar, { today: '2026-12-04' }).month).toBe('2026-12');
    // An asked month is never moved.
    expect(resolvePayrollMonth('2026-12', calendar, { today: '2026-12-02' })).toMatchObject({
      month: '2026-12',
      isCurrent: true,
      defaulted: null,
    });
  });
});
