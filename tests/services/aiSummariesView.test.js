// The /summaries pages' reads (CONTRACT 20): a person's own summaries, newest first with paging,
// one summary as blocks (someone else's is NOT_FOUND), and the text rules for Gemini's answers.
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { aiSummaries } from '@/modules/aiSummaries';
import { createUser, resetDatabase } from '../helpers/db.js';

let pm;
let hr;
let weekly;
let daily;

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
  pm = await createUser({ name: 'Priya Sharma', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hema Rao', role: 'hr' });
  // 21 daily summaries for the PM, one a day, then a weekly note for HR.
  for (let day = 0; day < 21; day += 1) {
    const date = addDays('2026-09-01', day);
    setNowForTests(`${date}T13:30:00Z`);
    daily = await ai.saveSummary({
      kind: 'pm_daily',
      recipientId: pm.id,
      periodFrom: date,
      periodTo: date,
      title: `Day ${day + 1} on your projects`,
      body: `Summary ${day + 1}.\nacme-store\nDone:\n- Fixed the login bug\n  - Tested on Safari`,
    });
  }
  setNowForTests('2026-10-02T13:40:00Z');
  weekly = await ai.saveSummary({
    kind: 'hr_weekly',
    recipientId: hr.id,
    periodFrom: '2026-09-28',
    periodTo: '2026-10-02',
    title: 'A calm week',
    body: 'A calm week overall.\nCheck in with:\n- Neha Kapoor: present 2 of 5 days.',
  });
});

describe('listMine', () => {
  it("lists the person's own summaries, newest first, 20 to a page", async () => {
    const first = await aiSummaries.listMine({ user: pm });
    expect(first).toMatchObject({ total: 21, page: 1, pages: 2 });
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toMatchObject({
      id: daily,
      kind: 'pm_daily',
      kindLabel: 'Daily project summary',
      tone: 'primary',
      title: 'Day 21 on your projects',
      periodLabel: 'Mon, 21 Sep',
      // Like the bell: no list dashes, lines joined with " · ", a label runs on into its item.
      excerpt: 'Summary 21. · acme-store · Done: Fixed the login bug · Tested on Safari',
    });
    const last = await aiSummaries.listMine({ user: pm, page: 99 });
    expect(last.page).toBe(2);
    expect(last.items.map((item) => item.title)).toEqual(['Day 1 on your projects']);
  });

  it('shows a week as a range and nothing of anyone else', async () => {
    const list = await aiSummaries.listMine({ user: hr });
    expect(list).toMatchObject({ total: 1, page: 1, pages: 1 });
    expect(list.items[0]).toMatchObject({
      id: weekly,
      kindLabel: 'Weekly attendance notes',
      tone: 'violet',
      periodLabel: 'Mon, 28 Sep – Fri, 2 Oct',
    });
    const nobody = await createUser({ name: 'Meera Joshi' });
    expect(await aiSummaries.listMine({ user: nobody })).toEqual({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });
  });
});

describe('getMine', () => {
  it('gives the summary as paragraphs, labels and lists', async () => {
    const summary = await aiSummaries.getMine({ user: hr, id: String(weekly) });
    expect(summary).toMatchObject({
      title: 'A calm week',
      kindLabel: 'Weekly attendance notes',
      dateLabel: 'Mon, 28 Sep – Fri, 2 Oct',
    });
    expect(summary.blocks).toEqual([
      { type: 'paragraph', text: 'A calm week overall.' },
      { type: 'label', text: 'Check in with:' },
      { type: 'list', items: [{ text: 'Neha Kapoor: present 2 of 5 days.', sub: false }] },
    ]);
    const day = await aiSummaries.getMine({ user: pm, id: daily });
    expect(day.dateLabel).toBe('Monday, 21 September');
    expect(day.blocks.at(-1)).toEqual({
      type: 'list',
      items: [
        { text: 'Fixed the login bug', sub: false },
        { text: 'Tested on Safari', sub: true },
      ],
    });
  });

  it("answers NOT_FOUND for someone else's summary or a bad id", async () => {
    await expectAppError(aiSummaries.getMine({ user: pm, id: weekly }), 'NOT_FOUND');
    await expectAppError(aiSummaries.getMine({ user: hr, id: 'abc' }), 'NOT_FOUND');
    await expectAppError(aiSummaries.getMine({ user: hr, id: 999999 }), 'NOT_FOUND');
  });
});

describe("summaries after a person's role changes", () => {
  it('a person moved to Employee no longer reads HR notes or PM summaries', async () => {
    const former = await createUser({ name: 'Ritu Das', role: 'hr' });
    const notes = await ai.saveSummary({
      kind: 'hr_weekly',
      recipientId: former.id,
      periodFrom: '2026-10-05',
      periodTo: '2026-10-09',
      title: 'Late days this week',
      body: 'Check in with:\n- Vishal Saini: late 4 of 5 days.',
    });
    const project = await ai.saveSummary({
      kind: 'pm_daily',
      recipientId: former.id,
      periodFrom: '2026-10-09',
      periodTo: '2026-10-09',
      title: 'Today on your projects',
      body: 'acme-store\nHours:\n- Vishal Saini: 8h',
    });
    // As HR they read the notes, but not a PM's project summary.
    expect((await aiSummaries.listMine({ user: former })).items.map((item) => item.id)).toEqual([
      notes,
    ]);
    expect(await aiSummaries.countMine(former)).toBe(1);
    await expectAppError(aiSummaries.getMine({ user: former, id: project }), 'NOT_FOUND');

    const employee = { ...former, role: 'employee' };
    expect(aiSummaries.readableKinds(employee)).toEqual([]);
    expect(await aiSummaries.listMine({ user: employee })).toMatchObject({ items: [], total: 0 });
    expect(await aiSummaries.countMine(employee)).toBe(0);
    await expectAppError(aiSummaries.getMine({ user: employee, id: notes }), 'NOT_FOUND');

    // As Admin both are theirs to read again.
    const admin = { ...former, role: 'admin' };
    expect(aiSummaries.readableKinds(admin)).toEqual(['pm_daily', 'hr_weekly']);
    expect(await aiSummaries.countMine(admin)).toBe(2);
    await expect(aiSummaries.getMine({ user: admin, id: project })).resolves.toMatchObject({
      kind: 'pm_daily',
    });
  });
});

describe('text rules', () => {
  it('cleanBody drops Markdown, writes bullets as "- " and cuts at a line', () => {
    const body = '## Today\r\n**Done:**\n* Fixed it\n1. Shipped\n    • Nested\n\n\n\nEnd';
    expect(aiSummaries.cleanBody(body, 500)).toBe(
      'Today\nDone:\n- Fixed it\n- Shipped\n  - Nested\n\nEnd',
    );
    const lines = Array.from({ length: 30 }, (_, n) => `- Line ${n} of the summary`).join('\n');
    const cut = aiSummaries.cleanBody(lines, 200);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith('of the summary')).toBe(true);
    const long = `Short line.\n${'word '.repeat(100)}`;
    const cutLong = aiSummaries.cleanBody(long, 100);
    expect(cutLong.length).toBeLessThanOrEqual(100);
    expect(cutLong).toMatch(/^Short line\.\nword word .*…$/);
  });

  it('cleanTitle keeps one short plain line', () => {
    expect(aiSummaries.cleanTitle('  "## **Busy** day"  ')).toBe('Busy day');
    expect(aiSummaries.cleanTitle('')).toBe('');
    expect(aiSummaries.cleanTitle('word '.repeat(40)).length).toBeLessThanOrEqual(120);
  });

  it('bellBody is the first 300 characters on one line', () => {
    expect(aiSummaries.bellBody('Good day.\nDone:\n- A\n- B\nHours:\n- 2h')).toBe(
      'Good day. · Done: A · B · Hours: 2h',
    );
    const long = aiSummaries.bellBody(`Start.\n${'- a fairly long task line\n'.repeat(30)}`);
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith('…')).toBe(true);
  });

  it('periodLabel reads one day, a week in a month, and a week across months', () => {
    expect(aiSummaries.periodLabel('2026-09-30', '2026-09-30')).toBe('Wed, 30 Sep');
    expect(aiSummaries.periodLabel('2026-10-26', '2026-10-30')).toBe('Mon, 26 – Fri, 30 Oct');
    expect(aiSummaries.periodLabel('2026-09-28', '2026-10-02')).toBe('Mon, 28 Sep – Fri, 2 Oct');
  });
});
