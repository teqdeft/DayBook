// Ask Daybook's conversation (CONTRACT 20): the system instruction and follow-ups, tool argument
// checks (dates, at most 366 days, at most 200 rows), a failing tool answered gracefully, and the
// 5-round cap on function calls. Gemini is a fake; fetch is blocked.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { aiAsk } from '@/modules/aiAsk';
import { attendance } from '@/modules/attendance';
import { resetDatabase } from '../helpers/db.js';
import {
  answer,
  callTool,
  createCompany,
  enableAsk,
  MONDAY,
  NOW,
  requests,
  resultsIn,
  script,
  TODAY,
  toolResult,
} from './aiAskKit.js';

let people;
let projects;

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  ({ people, projects } = await createCompany());
  await enableAsk();
});

beforeEach(async () => {
  setNowForTests(NOW);
  await db('ai_usage').delete();
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => ai.setTransportForTests(null));

describe('the request to Gemini', () => {
  it('uses the smart model with every tool and rules against invented data', async () => {
    script(answer('acme-app had 19h 30m this week.'));
    const result = await aiAsk.ask({
      user: people.priya,
      question: 'Hours on acme-app this week?',
    });
    expect(result).toEqual({ answer: 'acme-app had 19h 30m this week.' });

    const [body] = requests;
    const system = body.systemInstruction.parts[0].text;
    expect(system).toContain('Today is Wednesday, 28 October 2026 (2026-10-28)');
    expect(system).toContain('This week runs 2026-10-26 to 2026-11-01');
    expect(system).toContain('You are answering Priya Sharma (Project manager)');
    expect(system).toContain('only the projects they manage');
    expect(system).toContain('Never invent or guess');
    expect(system).toContain('"I don\'t have that"');
    expect(system).toContain('"2h 15m"');
    expect(body.contents[0].parts[0].text).toBe('Hours on acme-app this week?');
    expect(body.tools[0].functionDeclarations.map((tool) => tool.name)).toEqual([
      'list_projects',
      'list_people',
      'hours_by_project',
      'hours_by_person',
      'report_tasks',
      'attendance_summary',
      'priority_tasks',
    ]);
    const usage = await db('ai_usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ feature: 'ask', userId: people.priya.id, ok: true });
  });

  it('sends earlier turns for follow-ups and returns plain text', async () => {
    script(answer('**Vishal Saini** logged the most:\n* acme-app 16h 30m'));
    const result = await aiAsk.ask({
      user: people.chief,
      question: 'And who logged the most?',
      history: [{ question: 'Hours on acme-app this week?', answer: '19h 30m.' }],
    });
    expect(result.answer).toBe('Vishal Saini logged the most:\n- acme-app 16h 30m');
    expect(requests[0].contents[0].parts[0].text).toBe(
      [
        'Earlier in this conversation:',
        'Question: Hours on acme-app this week?\nYour answer: 19h 30m.',
        '',
        'New question: And who logged the most?',
      ].join('\n'),
    );
  });

  it('is refused to people without team.view or attendance.view_all', async () => {
    await expectAppError(aiAsk.ask({ user: people.vishal, question: 'My hours?' }), 'FORBIDDEN');
    expect(await aiAsk.isAvailableFor(people.vishal)).toBe(false);
    expect(await aiAsk.isAvailableFor(people.neha)).toBe(true);
  });

  it('answers AI_OFF while Ask Daybook is off', async () => {
    await db('settings').where({ key: 'ai_ask_enabled' }).update({ value: 'false' });
    try {
      expect(await aiAsk.isAvailableFor(people.priya)).toBe(false);
      await expectAppError(aiAsk.ask({ user: people.priya, question: 'Hours?' }), 'AI_OFF');
    } finally {
      await enableAsk();
    }
  });
});

describe('tool arguments', () => {
  it('takes at most 366 days', async () => {
    const tooLong = await toolResult(people.chief, 'hours_by_project', {
      from: '2025-10-27',
      to: TODAY,
    });
    expect(tooLong).toEqual({
      error: 'The date range can be at most 366 days. Ask for a shorter period.',
    });
    const longest = await toolResult(people.chief, 'hours_by_project', {
      from: '2025-10-28',
      to: TODAY,
    });
    expect(longest.total.time).toBe('33h 30m');
    const summary = await toolResult(people.neha, 'attendance_summary', {
      from: '2024-01-01',
      to: TODAY,
    });
    expect(summary.error).toMatch(/at most 366 days/);
  });

  it('needs real dates in order', async () => {
    const bad = await toolResult(people.chief, 'report_tasks', { from: '2026-02-30', to: TODAY });
    expect(bad).toEqual({ error: 'Give from and to as dates like 2026-10-26.' });
    const missing = await toolResult(people.chief, 'hours_by_person', {});
    expect(missing.error).toMatch(/Give from and to/);
    const backwards = await toolResult(people.chief, 'hours_by_person', {
      from: TODAY,
      to: MONDAY,
    });
    expect(backwards).toEqual({ error: 'The from date must be on or before the to date.' });
  });

  it('returns at most 200 rows', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      projectId: projects.seo.id,
      title: `Bulk task ${index + 1}`,
      priority: 'p3',
      createdBy: people.bharat.id,
      createdAt: new Date(NOW),
    }));
    await db('projectTasks').insert(rows);
    try {
      const result = await toolResult(people.chief, 'priority_tasks', { status: 'open' });
      expect(result.tasks).toHaveLength(200);
      expect(result.tasks[0].task).toBe('Fix login timeout');
      expect(result.truncated).toEqual({ shown: 200, total: 'more than 200' });
    } finally {
      await db('projectTasks').where('title', 'like', 'Bulk task %').delete();
    }
  });
});

describe('when something goes wrong', () => {
  it('sends a failing tool back as an error and still answers', async () => {
    vi.spyOn(attendance, 'workedMinutes').mockImplementation(() => {
      throw new Error('database went away');
    });
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
    script(
      callTool('attendance_summary', { from: MONDAY, to: TODAY, personName: 'Vishal' }),
      answer("I couldn't read attendance just now. Try again in a moment."),
    );
    const result = await aiAsk.ask({ user: people.neha, question: 'Was Vishal late this week?' });
    expect(result.answer).toBe("I couldn't read attendance just now. Try again in a moment.");
    expect(resultsIn(requests[1])).toEqual([
      {
        name: 'attendance_summary',
        response: { error: "Daybook couldn't read this data just now." },
      },
    ]);
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls[0])).not.toContain('Vishal');
  });

  it('answers an unknown tool with an error', async () => {
    script(callTool('delete_everything', { really: true }), answer("I don't have that."));
    const result = await aiAsk.ask({ user: people.chief, question: 'Delete everything' });
    expect(result.answer).toBe("I don't have that.");
    expect(resultsIn(requests[1])[0].response).toEqual({ error: 'Unknown tool.' });
  });

  it('gives Gemini at most 5 rounds of tool calls, then asks for text', async () => {
    const call = callTool('list_projects');
    script(call, call, call, call, call, answer('There are 2 projects.'));
    const result = await aiAsk.ask({ user: people.chief, question: 'How many projects?' });
    expect(result.answer).toBe('There are 2 projects.');
    expect(requests).toHaveLength(6);
    expect(requests[4].toolConfig).toBeUndefined();
    expect(requests[5].toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    expect(await db('ai_usage').where({ feature: 'ask' })).toHaveLength(6);
  });

  it('stops with AI_ERROR when Gemini keeps calling tools', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    script(callTool('list_people'));
    await expectAppError(aiAsk.ask({ user: people.chief, question: 'Everyone?' }), 'AI_ERROR');
    expect(requests).toHaveLength(6);
  });
});
