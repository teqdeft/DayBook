// Weekly HR notes (CONTRACT 20): the week's numbers per person (tokens, never names; no Admin's
// attendance, CONTRACT 16; 'auto' check-outs are check-outs, CONTRACT 19), the notes saved for HR
// (or the Admins without HR), limits, and the ai-hr-notes job's week rules. A fake Gemini answers.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { aiSummaries } from '@/modules/aiSummaries';
import { aiHrNotesJob } from '@/worker/jobs/aiHrNotes';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  expectNothingPersonal,
  fakeGemini,
  promptData,
  requests,
  setUpAi,
  tearDownAi,
  tokenOf,
} from './aiSummariesKit.js';
import { at, FRI, MON, SAT, seedHrWeek, THU, WED } from './aiSummariesFixtures.js';

let hema;
let anil;
let people;

/** Notes built from the prompt's tokens, the way Gemini would write them. */
function notesAnswer({ prompt }) {
  const rows = promptData(prompt).people;
  const token = (match) => rows.find(match)?.person ?? 'Person 1';
  const wfh = tokenOf(rows, (row) => row.wfhDays === 1);
  const away = token((row) => row.workingDays === 5 && row.daysPresent === 2);
  const steady = token((row) => row.daysPresent === 5 && row.lateDays === 0);
  return {
    title: 'A calm week',
    body: [
      'A calm week overall.',
      'Patterns:',
      `- ${wfh} had one missing check-out and one auto check-out.`,
      'Check in with:',
      `- ${away}: present 2 of 5 working days.`,
      'Going well:',
      `- ${steady} was on time every day.`,
    ].join('\n'),
  };
}

const sent = () => promptData(requests[0].prompt);
const byNumbers = (match) => sent().people.find(match);

beforeAll(async () => {
  await resetDatabase();
  ({ hema, anil, people } = await seedHrWeek());
});

beforeEach(async () => {
  setNowForTests(at(FRI, '19:05'));
  forgetHandledKeysForTests();
  for (const table of ['aiSummaries', 'aiUsage', 'notifications', 'slackOutbox', 'jobRuns']) {
    await db(table).del();
  }
  await setUpAi();
  fakeGemini(notesAnswer);
});

afterEach(async () => {
  tearDownAi();
  vi.restoreAllMocks();
  await db('users').where({ id: hema.id }).update({ status: 'active' });
});

describe('sendHrNotes', () => {
  it("sends each person's week as numbers under a token, never a name or an Admin", async () => {
    expect(await aiSummaries.sendHrNotes(FRI)).toEqual({ written: true, recipients: 1, people: 4 });
    expectNothingPersonal(people);
    const [request] = requests;
    expect(request.system).toContain('"Person 1", "Person 2"');
    expect(request.system).toContain('never');
    const data = sent();
    expect(data.week).toBe('Mon, 28 Sep to Fri, 2 Oct');
    expect(data.rules).toEqual({
      officeHours: '9:30 AM to 6:30 PM',
      lateAfter: '9:30 AM',
      dailyBreakAllowance: '1h',
    });
    // Hema, Vishal, Neha and Arjun: not Anil (Admin), Priya (no attendance) or Ravi (gone).
    expect(data.people.map((row) => row.person)).toEqual([
      'Person 1',
      'Person 2',
      'Person 3',
      'Person 4',
    ]);
    expect(byNumbers((row) => row.wfhDays === 1)).toEqual({
      person: 'Person 2',
      workingDays: 5,
      daysPresent: 5,
      wfhDays: 1,
      lateDays: 2,
      totalLate: '35m',
      missingCheckOuts: 1,
      autoCheckOuts: 1,
      correctionRequests: 1,
      daysWithBreaksOverAllowance: 1,
      missingReports: 1,
    });
    expect(data.people[0]).toMatchObject({ daysPresent: 5, lateDays: 0, missingReports: 0 });
    expect(data.people[2]).toMatchObject({ workingDays: 5, daysPresent: 2, missingReports: 1 });
    // Arjun joined on Wednesday: three working days so far.
    expect(data.people[3]).toMatchObject({ workingDays: 3, daysPresent: 2, missingReports: 1 });
    expect(data.people.some((row) => row.totalLate === '5h')).toBe(false);
  });

  it("doesn't count today's report as missing before the report reminder", async () => {
    setNowForTests(at(FRI, '18:00'));
    await aiSummaries.sendHrNotes(FRI);
    expect(byNumbers((row) => row.wfhDays === 1).missingReports).toBe(0);
  });

  it('saves the notes with the names back for HR, with a bell notification', async () => {
    await aiSummaries.sendHrNotes(FRI);
    const rows = await db('aiSummaries');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'hr_weekly',
      recipientId: hema.id,
      periodFrom: MON,
      periodTo: FRI,
      title: 'A calm week',
    });
    expect(rows[0].body).toContain('- Vishal Saini had one missing check-out');
    expect(rows[0].body).toContain('- Neha Kapoor: present 2 of 5 working days.');
    expect(rows[0].body).toContain('- Hema Rao was on time every day.');

    const bell = await db('notifications');
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({
      userId: hema.id,
      type: 'ai.hr_notes',
      title: "This week's attendance notes",
      link: `/summaries/${rows[0].id}`,
    });
    expect(bell[0].body).toMatch(/^A calm week overall\. · Patterns: Vishal Saini had/);
    expect(await db('slackOutbox')).toHaveLength(0);
    const [usage] = await db('aiUsage');
    expect(usage).toMatchObject({ feature: 'hr_notes', userId: null, ok: true });
  });

  it('goes to the Admins when there is no HR, still without their attendance', async () => {
    await db('users').where({ id: hema.id }).update({ status: 'deactivated' });
    expect(await aiSummaries.sendHrNotes(FRI)).toMatchObject({ written: true, recipients: 1 });
    expect((await db('aiSummaries')).map((row) => row.recipientId)).toEqual([anil.id]);
    expect(sent().people).toHaveLength(3);
    expectNothingPersonal(people);
  });

  it('logs a reached limit and saves nothing, without failing', async () => {
    await setSettings({ ai_daily_limit: 0 });
    const warn = vi.spyOn(logger, 'warn');
    expect(await aiSummaries.sendHrNotes(FRI)).toEqual({
      written: false,
      recipients: 0,
      people: 4,
      code: 'AI_LIMIT',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'ai-hr-notes', code: 'AI_LIMIT' }),
      expect.any(String),
    );
    expect(await db('aiSummaries')).toHaveLength(0);
    expect(await db('notifications')).toHaveLength(0);
  });

  it('logs an answer without a body, or no answer at all, and saves nothing', async () => {
    fakeGemini(() => ({ title: 'Only a title' }));
    expect(await aiSummaries.sendHrNotes(FRI)).toMatchObject({ written: false, code: 'AI_ERROR' });
    fakeGemini(() => ({ status: 200, data: { candidates: [] } }));
    expect(await aiSummaries.sendHrNotes(FRI)).toMatchObject({ written: false, code: 'AI_ERROR' });
    fakeGemini(() => ({ status: 429, data: null }));
    expect(await aiSummaries.sendHrNotes(FRI)).toMatchObject({ written: false, code: 'AI_BUSY' });
    expect(await db('aiSummaries')).toHaveLength(0);
  });
});

describe('ai-hr-notes job', () => {
  it("runs once per ISO week, on the week's last working day from ai_hr_notes_at", async () => {
    setNowForTests(at(THU, '19:30'));
    expect(await aiHrNotesJob.tick()).toBeNull();
    setNowForTests(at(FRI, '18:59'));
    expect(await aiHrNotesJob.tick()).toBeNull();
    expect(requests).toHaveLength(0);

    setNowForTests(at(FRI, '19:00'));
    expect(await aiHrNotesJob.tick()).toEqual({
      status: 'done',
      result: { written: true, recipients: 1, people: 4 },
    });
    forgetHandledKeysForTests();
    setNowForTests(at(FRI, '19:09'));
    expect(await aiHrNotesJob.tick()).toEqual({ status: 'skipped' });
    // Later tries (10 minutes apart, three in all) find this week's notes written and do nothing.
    setNowForTests(at(FRI, '22:00'));
    expect(await aiHrNotesJob.tick()).toEqual({
      status: 'done',
      result: { written: false, recipients: 0, people: 0, already: true },
    });
    setNowForTests(at(FRI, '22:30'));
    expect(await aiHrNotesJob.tick()).toMatchObject({ status: 'done' });
    setNowForTests(at(FRI, '23:30'));
    expect(await aiHrNotesJob.tick()).toEqual({ status: 'skipped' });
    const runs = await db('jobRuns').where({ job: 'ai-hr-notes' }).orderBy('id');
    expect(runs.map((run) => run.runKey)).toEqual([
      'ai_hr_notes:2026-W40',
      'ai_hr_notes:2026-W40#2',
      'ai_hr_notes:2026-W40#3',
    ]);
    expect(requests).toHaveLength(1);
    expect(await db('aiSummaries')).toHaveLength(1);
  });

  it('follows the working days: with Saturdays on, Saturday is the last one', async () => {
    await setSettings({ working_days: [1, 2, 3, 4, 5, 6] });
    try {
      expect(await aiHrNotesJob.tick()).toBeNull();
      setNowForTests(at(SAT, '19:30'));
      expect(await aiHrNotesJob.tick()).toMatchObject({ status: 'done' });
      expect(sent().week).toBe('Mon, 28 Sep to Sat, 3 Oct');
    } finally {
      await setSettings({ working_days: [1, 2, 3, 4, 5] });
    }
  });

  it('waits while HR notes are off', async () => {
    await setSettings({ ai_hr_notes_enabled: false });
    expect(await aiHrNotesJob.tick()).toBeNull();
    expect(await db('jobRuns')).toHaveLength(0);
  });

  it('writes the notes on a later try when Gemini was busy the first time', async () => {
    fakeGemini(() => ({ status: 429, data: null }));
    setNowForTests(at(FRI, '19:00'));
    expect(await aiHrNotesJob.tick()).toMatchObject({
      status: 'done',
      result: { written: false, code: 'AI_BUSY' },
    });
    fakeGemini(notesAnswer);
    forgetHandledKeysForTests(); // a fresh cron process
    setNowForTests(at(FRI, '19:10'));
    expect(await aiHrNotesJob.tick()).toEqual({
      status: 'done',
      result: { written: true, recipients: 1, people: 4 },
    });
    expect(await db('aiSummaries').where({ kind: 'hr_weekly' })).toHaveLength(1);
    expect(await db('notifications').where({ type: 'ai.hr_notes' })).toHaveLength(1);
  });

  it('a reached limit marks the week done without an error', async () => {
    await setSettings({ ai_daily_limit: 0 });
    const error = vi.spyOn(logger, 'error');
    expect(await aiHrNotesJob.tick()).toMatchObject({
      status: 'done',
      result: { written: false, code: 'AI_LIMIT' },
    });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('week helpers', () => {
  it('isoWeekKey uses the ISO week and its own year', () => {
    expect(aiSummaries.isoWeekKey(FRI)).toBe('2026-W40');
    expect(aiSummaries.isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(aiSummaries.isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(aiSummaries.isoWeekKey('2024-12-30')).toBe('2025-W01');
    expect(aiSummaries.isoWeekKey('2021-01-03')).toBe('2020-W53');
  });

  it("lastWorkingDayOfWeek is the week's last working day", () => {
    expect(aiSummaries.lastWorkingDayOfWeek(WED, [1, 2, 3, 4, 5])).toBe(FRI);
    expect(aiSummaries.lastWorkingDayOfWeek(SAT, [1, 2, 3, 4, 5, 6])).toBe(SAT);
    expect(aiSummaries.lastWorkingDayOfWeek(MON, [1, 2, 3, 4])).toBe(THU);
    expect(aiSummaries.lastWorkingDayOfWeek(MON, [])).toBeNull();
  });
});
