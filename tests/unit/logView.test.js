// My log's number cards: every duration reads in hours and minutes (a company request), and the
// late average keeps the artboard's "14 minutes" until it reaches an hour.
import { describe, expect, it } from 'vitest';
import { kpiCards } from '@/app/(app)/log/logView';

function log(kpis) {
  return {
    month: '2026-09',
    today: '2026-09-30',
    kpis: {
      loggedMinutes: 0,
      loggedPercent: 0,
      daysPresent: 0,
      workingDays: 0,
      presentPercent: 0,
      lateDays: 0,
      lateAverageMinutes: 0,
      latePercent: 0,
      reportsSubmitted: 0,
      reportsExpected: 0,
      reportsPercent: 0,
      ...kpis,
    },
  };
}

const card = (cards, key) => cards.find((item) => item.key === key);

describe('kpiCards', () => {
  it('shows logged hours with their minutes', () => {
    expect(card(kpiCards(log({ loggedMinutes: 8550 })), 'hours').value).toBe('142h 30m');
    expect(card(kpiCards(log({ loggedMinutes: 8520 })), 'hours').value).toBe('142h');
  });

  it('shows the late average in minutes under an hour, then in hours and minutes', () => {
    const late = (minutes) =>
      card(kpiCards(log({ lateDays: 2, lateAverageMinutes: minutes })), 'late').sub;
    expect(late(14)).toBe('average 14 minutes');
    expect(late(1)).toBe('average 1 minute');
    expect(late(60)).toBe('average 1h');
    expect(late(97)).toBe('average 1h 37m');
    expect(card(kpiCards(log({ lateDays: 0 })), 'late').sub).toBe('on time every day');
  });
});
