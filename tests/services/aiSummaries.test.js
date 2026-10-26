// AI summaries (CONTRACT 20): what the worker saves for a PM or HR, and the person's own list.
import { beforeAll, describe, expect, it } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { createUser, resetDatabase } from '../helpers/db.js';

let pm;
let hr;

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
}

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Priya PM', role: 'pm' });
  hr = await createUser({ name: 'Hema HR', role: 'hr' });
});

describe('summaries', () => {
  it('saves one per kind, person and period; a re-run replaces the text', async () => {
    setNowForTests('2026-10-23T13:30:00Z');
    const friday = await ai.saveSummary({
      kind: 'pm_daily',
      recipientId: pm.id,
      periodFrom: '2026-10-23',
      periodTo: '2026-10-23',
      title: 'Today on your projects',
      body: '- Done: login fix',
    });
    setNowForTests('2026-10-26T13:30:00Z');
    const monday = await ai.saveSummary({
      kind: 'pm_daily',
      recipientId: pm.id,
      periodFrom: '2026-10-26',
      periodTo: '2026-10-26',
      title: 'Today on your projects',
      body: 'First draft',
    });
    const again = await ai.saveSummary({
      kind: 'pm_daily',
      recipientId: pm.id,
      periodFrom: '2026-10-26',
      periodTo: '2026-10-26',
      title: 'Today on your projects',
      body: `- Done: ${'checkout flow polish '.repeat(20)}`,
    });
    expect(again).toBe(monday);
    expect(friday).not.toBe(monday);

    const list = await ai.listSummaries(pm.id);
    expect(list.map((row) => row.id)).toEqual([monday, friday]);
    expect(list[0]).toMatchObject({
      kind: 'pm_daily',
      periodFrom: '2026-10-26',
      periodTo: '2026-10-26',
      title: 'Today on your projects',
    });
    expect(list[0].body).toBeUndefined();
    expect(list[0].excerpt.length).toBeLessThanOrEqual(200);
    expect(list[0].excerpt.endsWith('…')).toBe(true);
    expect(list[1].excerpt).toBe('Done: login fix');
    expect(await ai.countSummaries(pm.id)).toBe(2);
    expect(await ai.listSummaries(pm.id, { limit: 1, offset: 1 })).toHaveLength(1);
  });

  it("opens a person's own summary only", async () => {
    const id = await ai.saveSummary({
      kind: 'hr_weekly',
      recipientId: hr.id,
      periodFrom: '2026-10-26',
      periodTo: '2026-10-30',
      title: "This week's attendance notes",
      body: '- Mostly on time.\n- Two missing check-outs.',
    });
    const summary = await ai.getSummary({ userId: hr.id, id });
    expect(summary).toMatchObject({
      id,
      kind: 'hr_weekly',
      body: '- Mostly on time.\n- Two missing check-outs.',
    });
    expect(summary.recipientId).toBeUndefined();
    await expectAppError(ai.getSummary({ userId: pm.id, id }), 'NOT_FOUND');
    await expectAppError(ai.getSummary({ userId: hr.id, id: 999999 }), 'NOT_FOUND');
    await expectAppError(ai.getSummary({ userId: hr.id, id: 'abc' }), 'NOT_FOUND');
  });
});
