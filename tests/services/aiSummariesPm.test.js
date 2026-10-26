// The daily report summary for PMs (CONTRACT 20): what goes to Gemini (tokens, never names), the
// saved summary with the names back, the bell and the Slack DM, failures and limits, and the
// ai-pm-summary job's timing. A fake Gemini answers; the network is blocked.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { aiSummaries } from '@/modules/aiSummaries';
import { aiPmSummaryJob } from '@/worker/jobs/aiPmSummary';
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
import { at as atDate, PM_DAY as TODAY, seedPmDay } from './aiSummariesFixtures.js';

const at = (date, clock) => atDate(date, clock).toISOString();

let priya;
let rohan;
let people;

/** The answer for Priya's projects: tokens taken from the prompt. */
function priyaAnswer({ prompt }) {
  const store = promptData(prompt).projects.find((project) => project.project === 'acme-store');
  const fixer = tokenOf(store.people, (p) => p.tasks.some((t) => t.title.includes('checkout')));
  const waiting = tokenOf(store.blocked, (task) => task.title.includes('API keys'));
  return {
    title: `**Good progress on acme-store**`,
    body: [
      'A steady day on acme-store.',
      'acme-store',
      'Done:',
      `* ${fixer} fixed the checkout bug (P2)`,
      'Blocked:',
      `- ${waiting}: waiting for API keys since Mon, 28 Sep`,
      'Hours:',
      `- ${fixer}: 6h 30m`,
    ].join('\n'),
  };
}

function answerFor(request) {
  if (request.prompt.includes('acme-store')) return priyaAnswer(request);
  return { title: 'Quiet day', body: 'One report on internal-tool.\nHours:\n- Person 1: 1h' };
}

const summaries = () => db('aiSummaries').orderBy('id');
const notes = () => db('notifications').where({ type: 'ai.pm_summary' }).orderBy('id');
const dms = () => db('slackOutbox').where({ kind: 'dm' }).orderBy('id');

beforeAll(async () => {
  await resetDatabase();
  ({ priya, rohan, people } = await seedPmDay());
});

beforeEach(async () => {
  setNowForTests(at(TODAY, '19:05'));
  forgetHandledKeysForTests();
  aiSummaries.setRunBudgetForTests(null);
  for (const table of ['aiSummaries', 'aiUsage', 'notifications', 'slackOutbox', 'jobRuns']) {
    await db(table).del();
  }
  await setUpAi();
  fakeGemini(answerFor);
});

afterEach(() => {
  tearDownAi();
  vi.restoreAllMocks();
});

describe('sendPmSummaries', () => {
  it('sends people as tokens and saves the summary with their names back', async () => {
    expect(await aiSummaries.sendPmSummaries(TODAY)).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expectNothingPersonal(people);
    expect(requests).toHaveLength(2);

    const [priyaRequest] = requests.filter((request) => request.prompt.includes('acme-store'));
    expect(priyaRequest.system).toContain('"Person 1", "Person 2"');
    expect(priyaRequest.body.generationConfig.responseMimeType).toBe('application/json');
    const data = promptData(priyaRequest.prompt);
    expect(data.date).toBe('Wednesday, 30 September');
    // Only reported, active projects go to Gemini; the quiet one is the code's own line.
    expect(data.projects.map((project) => project.project)).toEqual(['acme-store']);
    const [store] = data.projects;
    expect(store.totalHours).toBe('9h 30m');
    expect(store.people.map((person) => person.hours)).toEqual(['6h 30m', '2h', '1h']);
    expect(store.people.map((person) => person.person)).toEqual([
      'Person 1',
      'Person 2',
      'Person 3',
    ]);
    expect(store.people[0].tasks).toEqual([
      { title: 'Fixed the checkout bug', status: 'done', priority: 'P2' },
      { title: 'Product page layout', status: 'in progress' },
    ]);
    expect(store.blocked).toEqual([
      {
        person: 'Person 2',
        title: 'Waiting for API keys',
        status: 'blocked',
        since: 'Mon, 28 Sep',
      },
    ]);
    expect(store.priorityTasksDoneToday).toEqual(['P1 Fix login timeout']);

    const [saved] = await db('aiSummaries').where({ recipientId: priya.id });
    expect(saved).toMatchObject({
      kind: 'pm_daily',
      periodFrom: TODAY,
      periodTo: TODAY,
      title: 'Good progress on acme-store',
    });
    expect(saved.body).toBe(
      [
        'A steady day on acme-store.',
        'acme-store',
        'Done:',
        '- Vishal Saini fixed the checkout bug (P2)',
        'Blocked:',
        '- Neha Kapoor: waiting for API keys since Mon, 28 Sep',
        'Hours:',
        '- Vishal Saini: 6h 30m',
        '',
        'No reports yet: acme-seo',
      ].join('\n'),
    );
  });

  it('rings the bell and sends the Slack DM, only to PMs with reports today', async () => {
    await aiSummaries.sendPmSummaries(TODAY);
    const rows = await summaries();
    expect(rows.map((row) => row.recipientId).sort()).toEqual([priya.id, rohan.id].sort());

    const bell = await notes();
    expect(bell.map((note) => note.userId).sort()).toEqual([priya.id, rohan.id].sort());
    const priyaNote = bell.find((note) => note.userId === priya.id);
    const priyaSummary = rows.find((row) => row.recipientId === priya.id);
    expect(priyaNote).toMatchObject({
      title: 'Today on your projects',
      link: `/summaries/${priyaSummary.id}`,
    });
    expect(priyaNote.body).toMatch(/^A steady day on acme-store\. · acme-store · Done: Vishal/);
    expect(priyaNote.body.length).toBeLessThanOrEqual(300);

    // Rohan has no Slack id: the bell only. Priya's DM carries the whole text and the link.
    const [dm] = await dms();
    expect(dm.channel).toBe('U0PRIYA001');
    const { text } = JSON.parse(dm.payload);
    expect(text).toContain('*Today on your projects* · Wed, 30 Sep');
    expect(text).toContain('- Neha Kapoor: waiting for API keys since Mon, 28 Sep');
    expect(text).toContain('No reports yet: acme-seo');
    expect(text).toContain(`/summaries/${priyaSummary.id}|Open in Daybook>`);
    expect(await dms()).toHaveLength(1);

    const usage = await db('aiUsage');
    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.feature === 'pm_summary' && row.userId === null)).toBe(true);
  });

  it('sends no Slack DM when the summary Slack setting is off', async () => {
    await setSettings({ ai_summary_slack: false });
    await aiSummaries.sendPmSummaries(TODAY);
    expect(await notes()).toHaveLength(2);
    expect(await dms()).toHaveLength(0);
  });

  it('cleans the answer and keeps the body within 1,500 characters', async () => {
    const line = (n) => `- Person 1 worked on step ${n} of the checkout rework, all fine`;
    fakeGemini(() => ({
      title: '  "## Busy day"  ',
      body: ['Opening line.', ...Array.from({ length: 60 }, (_, n) => line(n))].join('\n'),
    }));
    await aiSummaries.sendPmSummaries(TODAY);
    const saved = await db('aiSummaries').where({ recipientId: priya.id }).first();
    expect(saved.title).toBe('Busy day');
    expect(saved.body.length).toBeLessThanOrEqual(1500);
    expect(saved.body).toMatch(/all fine\n\nNo reports yet: acme-seo$/);
    expect(saved.body).toContain('- Vishal Saini worked on step 0');
  });

  it('logs an answer without a body and goes on with the next PM', async () => {
    const warn = vi.spyOn(logger, 'warn');
    fakeGemini((request) =>
      request.prompt.includes('acme-store') ? { title: 'Nothing' } : answerFor(request),
    );
    expect(await aiSummaries.sendPmSummaries(TODAY)).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect((await summaries()).map((row) => row.recipientId)).toEqual([rohan.id]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'ai-pm-summary', recipientId: priya.id, code: 'AI_ERROR' }),
      'AI summary not written',
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('acme-store');
    expect(logged).not.toContain('Vishal');
  });

  it('a Gemini error for one PM does not stop the others', async () => {
    fakeGemini((request) =>
      request.prompt.includes('acme-store') ? { status: 500, data: null } : answerFor(request),
    );
    expect(await aiSummaries.sendPmSummaries(TODAY)).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(await notes()).toHaveLength(1);
  });

  it('stops without failing once the daily limit is reached, and logs it', async () => {
    await setSettings({ ai_daily_limit: 1 });
    const warn = vi.spyOn(logger, 'warn');
    expect(await aiSummaries.sendPmSummaries(TODAY)).toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(requests).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'ai-pm-summary', code: 'AI_LIMIT' }),
      'AI summary not written; the rest of this run is skipped',
    );
  });

  it('skips the PMs left when the run is out of time', async () => {
    aiSummaries.setRunBudgetForTests(-1);
    expect(await aiSummaries.sendPmSummaries(TODAY)).toEqual({ sent: 1, failed: 0, skipped: 1 });
  });
});

describe('ai-pm-summary job', () => {
  it('runs once per working day from ai_pm_summary_at', async () => {
    setNowForTests(at(TODAY, '18:59'));
    expect(await aiPmSummaryJob.tick()).toBeNull();

    setNowForTests(at(TODAY, '19:00'));
    const first = await aiPmSummaryJob.tick();
    expect(first).toEqual({ status: 'done', result: { sent: 2, failed: 0, skipped: 0 } });
    expect(await aiPmSummaryJob.tick()).toEqual({ status: 'skipped' });
    const run = await db('jobRuns')
      .where({ runKey: `ai_pm_summary:${TODAY}` })
      .first();
    expect(run).toMatchObject({ job: 'ai-pm-summary', status: 'done' });
    expect(requests).toHaveLength(2);
  });

  it('does nothing on a non-working day', async () => {
    setNowForTests(at('2026-10-03', '19:30')); // Saturday
    expect(await aiPmSummaryJob.tick()).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('waits while the feature is off, and runs once it is turned on that day', async () => {
    await setSettings({ ai_pm_summary_enabled: false });
    expect(await aiPmSummaryJob.tick()).toBeNull();
    expect(await db('jobRuns')).toHaveLength(0);

    await setSettings({ ai_pm_summary_enabled: true });
    setNowForTests(at(TODAY, '21:10'));
    expect(await aiPmSummaryJob.tick()).toMatchObject({ status: 'done' });
  });

  it('never runs without a Gemini key', async () => {
    ai.setApiKeyForTests('');
    expect(await aiPmSummaryJob.tick()).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('tries again 10 minutes later for a PM a passing Gemini failure left out', async () => {
    fakeGemini((request) =>
      request.prompt.includes('acme-store') ? { status: 429, data: null } : answerFor(request),
    );
    setNowForTests(at(TODAY, '19:00'));
    expect(await aiPmSummaryJob.tick()).toEqual({
      status: 'done',
      result: { sent: 1, failed: 1, skipped: 0 },
    });
    expect((await summaries()).map((row) => row.recipientId)).toEqual([rohan.id]);

    // Not before 10 minutes, then only the PM still without a summary; a fresh process too.
    fakeGemini(answerFor);
    forgetHandledKeysForTests();
    setNowForTests(at(TODAY, '19:09'));
    expect(await aiPmSummaryJob.tick()).toEqual({ status: 'skipped' });
    setNowForTests(at(TODAY, '19:10'));
    expect(await aiPmSummaryJob.tick()).toEqual({
      status: 'done',
      result: { sent: 1, failed: 0, skipped: 0 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].prompt).toContain('acme-store');
    expect((await summaries()).map((row) => row.recipientId)).toEqual([rohan.id, priya.id]);
    expect(await notes()).toHaveLength(2);
    expect(await dms()).toHaveLength(1); // Priya's (Rohan has no Slack id)
  });

  it('writes the PMs a run had no time for on a later try, three tries a day at most', async () => {
    aiSummaries.setRunBudgetForTests(-1); // only the first PM fits in each run
    setNowForTests(at(TODAY, '19:00'));
    expect(await aiPmSummaryJob.tick()).toMatchObject({ result: { sent: 1, skipped: 1 } });
    setNowForTests(at(TODAY, '19:20'));
    expect(await aiPmSummaryJob.tick()).toMatchObject({ result: { sent: 1, skipped: 0 } });
    expect(await summaries()).toHaveLength(2);

    // The third try finds both written and asks Gemini nothing; there is no fourth.
    setNowForTests(at(TODAY, '19:40'));
    expect(await aiPmSummaryJob.tick()).toEqual({
      status: 'done',
      result: { sent: 0, failed: 0, skipped: 0 },
    });
    setNowForTests(at(TODAY, '21:00'));
    expect(await aiPmSummaryJob.tick()).toEqual({ status: 'skipped' });
    expect(requests).toHaveLength(2);
    const runs = await db('jobRuns').where({ job: 'ai-pm-summary' }).orderBy('id');
    expect(runs.map((run) => run.runKey)).toEqual([
      `ai_pm_summary:${TODAY}`,
      `ai_pm_summary:${TODAY}#2`,
      `ai_pm_summary:${TODAY}#3`,
    ]);
  });

  it('a limit reached during the run still marks the day done, without errors', async () => {
    await setSettings({ ai_daily_limit: 0 });
    const error = vi.spyOn(logger, 'error');
    expect(await aiPmSummaryJob.tick()).toEqual({
      status: 'done',
      result: { sent: 0, failed: 0, skipped: 2 },
    });
    expect(error).not.toHaveBeenCalled();
    expect(await summaries()).toHaveLength(0);
  });
});
