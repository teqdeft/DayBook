// The Leave page's data (CONTRACT 25, item 9): the payroll month switcher keeps the Person filter
// (?userId=) when it walks to another month, as the filter and the pager do.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { loadLeave } from '@/app/(app)/attendance/leave/leaveData';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let neha;
let vishal;

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ working_days: [1, 2, 3, 4, 5], payroll_month_start_day: 1 });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  vishal = await createUser({ name: 'Vishal Saini' });
});

afterEach(() => setNowForTests(null));

describe('loadLeave switcher', () => {
  it('keeps the person filter on the previous and next month links', async () => {
    setNowForTests('2026-11-19T06:30:00Z');
    const data = await loadLeave({ user: neha, month: '2026-11', userId: String(vishal.id) });
    expect(data.userId).toBe(vishal.id);
    expect(data.switcher).toMatchObject({
      prevHref: `/attendance/leave?month=2026-10&userId=${vishal.id}`,
      nextHref: `/attendance/leave?month=2026-12&userId=${vishal.id}`,
    });
  });

  it('links the month alone for everyone, and none past the window', async () => {
    setNowForTests('2026-11-19T06:30:00Z');
    const data = await loadLeave({ user: neha, month: '2027-12' });
    expect(data.userId).toBeNull();
    expect(data.switcher).toMatchObject({
      prevHref: '/attendance/leave?month=2027-11',
      nextHref: undefined,
      nextLabel: 'No later months',
    });
  });
});
