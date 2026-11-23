// reports.listSubmittedDays and reports.listSubmittedUserIds (CONTRACT 25): yes-or-no reads for
// HR's attendance screens. One query each, dates and ids only, never the report.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { createUser, resetDatabase } from '../helpers/db.js';

let priya;
let vishal;
let karan;

/** Counts the daily_reports selects run while `read` runs. */
async function countSelects(read) {
  let selects = 0;
  const listener = (query) => {
    if (/^select/i.test(query.sql) && query.sql.includes('daily_reports')) selects += 1;
  };
  db.on('query', listener);
  try {
    return { result: await read(), selects };
  } finally {
    db.off('query', listener);
  }
}

function report(user, workDate, status = 'submitted') {
  return {
    userId: user.id,
    workDate,
    status,
    totalMinutes: 480,
    submittedAt: status === 'submitted' ? new Date(`${workDate}T13:00:00Z`) : null,
    locksAt: new Date(`${workDate}T23:59:00Z`),
  };
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-11-19T04:00:00Z');
  priya = await createUser({ name: 'Priya Sharma', email: 'priya@example.com' });
  vishal = await createUser({ name: 'Vishal Saini', email: 'vishal@example.com' });
  karan = await createUser({ name: 'Karan Mehta', email: 'karan@example.com' });
  await db('dailyReports').insert([
    report(priya, '2026-10-30'),
    report(priya, '2026-11-02'),
    report(priya, '2026-11-13'),
    report(priya, '2026-11-03', 'draft'),
    report(vishal, '2026-11-13'),
    report(vishal, '2026-11-25'),
    report(karan, '2026-11-16', 'draft'),
  ]);
});

describe('reports.listSubmittedDays', () => {
  it('answers each person submitted dates in the range, oldest first, in one query', async () => {
    const { result, selects } = await countSelects(() =>
      reports.listSubmittedDays({
        userIds: [priya.id, vishal.id, karan.id],
        from: '2026-11-01',
        to: '2026-11-25',
      }),
    );
    expect(selects).toBe(1);
    // Drafts are not submitted; Karan has none, so he is left out.
    expect(result).toEqual({
      [priya.id]: ['2026-11-02', '2026-11-13'],
      [vishal.id]: ['2026-11-13', '2026-11-25'],
    });
  });

  it('reads only the people asked for, and both ends of the range', async () => {
    expect(
      await reports.listSubmittedDays({
        userIds: [String(priya.id), priya.id],
        from: '2026-10-30',
        to: '2026-11-02',
      }),
    ).toEqual({ [priya.id]: ['2026-10-30', '2026-11-02'] });
  });

  it('answers {} without a query for no people or no range', async () => {
    const { result, selects } = await countSelects(async () => [
      await reports.listSubmittedDays({ userIds: [], from: '2026-11-01', to: '2026-11-25' }),
      await reports.listSubmittedDays({
        userIds: [priya.id],
        from: '2026-11-25',
        to: '2026-11-01',
      }),
      await reports.listSubmittedDays({ userIds: [priya.id], from: 'November' }),
      await reports.listSubmittedDays(),
    ]);
    expect(result).toEqual([{}, {}, {}, {}]);
    expect(selects).toBe(0);
  });
});

describe('reports.listSubmittedUserIds', () => {
  it('answers which of the people submitted for the day', async () => {
    const ids = await reports.listSubmittedUserIds([priya.id, vishal.id, karan.id], '2026-11-13');
    expect(ids.sort((a, b) => a - b)).toEqual([priya.id, vishal.id].sort((a, b) => a - b));
    expect(await reports.listSubmittedUserIds([karan.id], '2026-11-16')).toEqual([]);
    expect(await reports.listSubmittedUserIds([], '2026-11-13')).toEqual([]);
    expect(await reports.listSubmittedUserIds([priya.id], 'today')).toEqual([]);
  });
});
