// Today's to-do on Slack (CONTRACT 24): slack.queueTodoPost, the outbox delivery of todo_post and
// todo_update rows, slack.latestTodoDelivery, and the report columns that remember the message
// (reports.saveTodoSlackMessage and reports.findTodoPost), with the fake Slack transport.
import { createHash } from 'node:crypto';
import { WebAPIPlatformError } from '@slack/web-api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { slack } from '@/modules/slack';
import { setSlackClientForTests } from '@/modules/slack/client';
import { escapeSlackText, formatTodo } from '@/modules/slack/format';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const T0 = '2026-11-12T04:11:00Z'; // 9:41 AM in Kolkata
const T1 = '2026-11-12T05:30:00Z';
const TODO_CHANNEL = 'C0TODO';
const REPORT_CHANNEL = 'C0REPORTS';
const MIGRATION = '017_todo.js';

const hashOf = (value) => createHash('sha256').update(value).digest('hex');

const plan = (title = '1 web blog publish') =>
  formatTodo({
    userName: 'Priya Sharma',
    workDate: '2026-11-12',
    entries: [
      {
        projectName: 'Pine Tree Lane',
        lines: [{ title: 'Monitoring google ads campaign', status: 'in_progress' }],
      },
      { projectName: 'Studio Ubique', lines: [{ title, status: 'done' }] },
    ],
  });

let person;
let nextDay = 1;

/** A fake WebClient: every method is a vi.fn you can override per test. */
function fakeClient() {
  let counter = 0;
  return {
    chat: {
      postMessage: vi.fn(async ({ channel }) => {
        counter += 1;
        return { ok: true, channel, ts: `1790000000.00000${counter}` };
      }),
      update: vi.fn(async ({ channel, ts }) => ({ ok: true, channel, ts })),
    },
    auth: { test: vi.fn() },
    conversations: { list: vi.fn() },
    users: { lookupByEmail: vi.fn() },
  };
}

/** A draft report of its own for each test (earlier days, so they never collide). */
async function newReport() {
  const day = String(nextDay).padStart(2, '0');
  nextDay += 1;
  const [id] = await db('daily_reports').insert({
    userId: person.id,
    workDate: `2026-10-${day}`,
    status: 'draft',
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
  });
  return id;
}

async function outboxRows() {
  return (await db('slack_outbox').orderBy('id')).map((row) => ({
    ...row,
    payload: parseJson(row.payload),
  }));
}

function queue(reportId, { text = plan(), hash = hashOf(text), update = false, ...rest } = {}) {
  return slack.queueTodoPost({ reportId, userId: person.id, text, hash, update, ...rest });
}

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

beforeAll(async () => {
  await resetDatabase();
  person = await createUser({
    name: 'Priya Sharma',
    slackUserId: 'U0PRIYA',
    avatarUrl: 'https://example.com/priya.png',
  });
});

beforeEach(async () => {
  await db('slack_outbox').delete();
  await setSettings({
    slack_enabled: true,
    slack_post_reports: true,
    slack_report_channel_id: REPORT_CHANNEL,
    slack_report_channel_name: 'daily-reports',
    slack_todo_channel_id: TODO_CHANNEL,
    slack_todo_channel_name: 'morning-todo',
  });
  setNowForTests(T0);
});

afterEach(() => {
  setSlackClientForTests(null);
  vi.restoreAllMocks();
});

describe('queueTodoPost', () => {
  it('answers 409 "Slack posting is off." without a bot token, with Slack off or no to-do channel', async () => {
    const reportId = await newReport();
    // No bot token on the server.
    expect(await slack.canPostTodo()).toBe(false);
    let error = await expectAppError(queue(reportId), 'CONFLICT');
    expect(error).toMatchObject({ status: 409, message: 'Slack posting is off.' });

    setSlackClientForTests(fakeClient());
    expect(await slack.canPostTodo()).toBe(true);
    await setSettings({ slack_enabled: false });
    expect(await slack.canPostTodo()).toBe(false);
    error = await expectAppError(queue(reportId), 'CONFLICT');
    expect(error.status).toBe(409);

    // A report channel alone is not enough: to-dos never fall back to it.
    await setSettings({ slack_enabled: true, slack_todo_channel_id: null });
    expect(await slack.canPostTodo()).toBe(false);
    error = await expectAppError(queue(reportId), 'CONFLICT');
    expect(error.message).toBe('Slack posting is off.');
    expect(await outboxRows()).toHaveLength(0);
  });

  it('queues the to-do as the person, for the to-do channel only, escaped', async () => {
    setSlackClientForTests(fakeClient());
    const reportId = await newReport();
    const text = formatTodo({
      userName: 'Priya Sharma',
      workDate: '2026-11-12',
      entries: [
        {
          projectName: 'R&D <tools>',
          lines: [{ title: 'Ping <!channel> & ship', status: 'done' }],
        },
      ],
    });
    const id = await queue(reportId, { text, hash: hashOf('a') });
    const [row] = await outboxRows();
    expect(row).toMatchObject({
      id,
      kind: 'todo_post',
      channel: TODO_CHANNEL,
      status: 'pending',
      attempts: 0,
      relatedType: 'todo',
      relatedId: reportId,
    });
    expect(row.payload).toEqual({
      text: escapeSlackText(text),
      hash: hashOf('a'),
      username: 'Priya Sharma',
      icon_url: 'https://example.com/priya.png',
    });
    expect(row.payload.text).toContain(
      'Project: R&amp;D &lt;tools&gt;\n• Ping &lt;!channel&gt; &amp; ship (Done)',
    );
    expect(row.payload.text).not.toContain('<!channel>');

    // update: true marks the row as an update; a name given by the caller is used as it is.
    await queue(reportId, { update: true, userName: 'Priya S', avatarUrl: null });
    const [, second] = await outboxRows();
    expect(second).toMatchObject({ kind: 'todo_update', channel: TODO_CHANNEL });
    expect(second.payload.username).toBe('Priya S');
    expect(second.payload.icon_url).toBeUndefined();
  });

  it('rolls back with the caller transaction', async () => {
    setSlackClientForTests(fakeClient());
    const reportId = await newReport();
    await expect(
      db.transaction(async (trx) => {
        await slack.queueTodoPost(
          { reportId, userId: person.id, text: plan(), hash: hashOf('x'), update: false },
          trx,
        );
        throw new Error('post failed');
      }),
    ).rejects.toThrow('post failed');
    expect(await outboxRows()).toHaveLength(0);
  });
});

describe('to-do delivery', () => {
  it('posts, then updates the same message, and the report stores channel, ts, time and hash', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    const reportId = await newReport();
    expect(await slack.latestTodoDelivery(reportId)).toEqual({ status: 'none', at: null });
    expect(await reports.findTodoPost(reportId)).toBeNull();

    await queue(reportId, { hash: hashOf('first') });
    expect(await slack.latestTodoDelivery(reportId)).toEqual({
      status: 'sending',
      at: new Date(T0),
    });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1, failed: 0 });
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: TODO_CHANNEL,
        text: escapeSlackText(plan()),
        username: 'Priya Sharma',
        icon_url: 'https://example.com/priya.png',
      }),
    );
    const stored = await db('daily_reports').where({ id: reportId }).first();
    expect(stored).toMatchObject({
      todoSlackChannelId: TODO_CHANNEL,
      todoSlackTs: '1790000000.000001',
      todoPostedAt: new Date(T0),
      todoPostHash: hashOf('first'),
      // The report itself is untouched, so an open report tab never turns stale.
      updatedAt: new Date(T0),
      slackTs: null,
    });
    expect(await reports.findTodoPost(reportId)).toEqual({
      postedAt: new Date(T0),
      channelId: TODO_CHANNEL,
      ts: '1790000000.000001',
      hash: hashOf('first'),
    });
    expect(await slack.latestTodoDelivery(reportId)).toEqual({ status: 'sent', at: new Date(T0) });

    setNowForTests(T1);
    const changed = plan('2 web blog publish');
    await queue(reportId, { text: changed, hash: hashOf('second'), update: true });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: TODO_CHANNEL,
      ts: '1790000000.000001',
      text: escapeSlackText(changed),
    });
    expect((await outboxRows())[1]).toMatchObject({
      status: 'sent',
      kind: 'todo_update',
      resultTs: '1790000000.000001',
    });
    expect(await reports.findTodoPost(reportId)).toEqual({
      postedAt: new Date(T1),
      channelId: TODO_CHANNEL,
      ts: '1790000000.000001',
      hash: hashOf('second'),
    });
    expect(await slack.latestTodoDelivery(reportId)).toEqual({ status: 'sent', at: new Date(T1) });
  });

  it('two quick posts before the worker runs send one, up-to-date, message', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    const reportId = await newReport();
    await queue(reportId, { text: plan('Old title'), hash: hashOf('old') });
    await queue(reportId, { text: plan('New title'), hash: hashOf('new') });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1, skipped: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage.mock.calls[0][0].text).toContain('New title');
    expect((await reports.findTodoPost(reportId)).hash).toBe(hashOf('new'));
    expect(await slack.latestTodoDelivery(reportId)).toMatchObject({ status: 'sent' });
  });

  it('a post for a report that already has a to-do message updates that message', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    const reportId = await newReport();
    await reports.saveTodoSlackMessage({
      reportId,
      channelId: 'C0EARLIER',
      ts: '1780000000.000007',
      hash: hashOf('earlier'),
      at: new Date(T0),
    });
    await queue(reportId, { update: false });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C0EARLIER', ts: '1780000000.000007' }),
    );
  });

  it('posts again in the to-do channel when the old message can no longer be updated', async () => {
    const client = fakeClient();
    client.chat.update.mockRejectedValueOnce(
      new WebAPIPlatformError({ ok: false, error: 'message_not_found' }),
    );
    setSlackClientForTests(client);
    const reportId = await newReport();
    await reports.saveTodoSlackMessage({
      reportId,
      channelId: 'C0GONE',
      ts: '1780000000.000001',
      hash: hashOf('gone'),
      at: new Date(T0),
    });
    await queue(reportId, { update: true, hash: hashOf('again') });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage.mock.calls[0][0].channel).toBe(TODO_CHANNEL);
    expect((await outboxRows())[0]).toMatchObject({ kind: 'todo_post', channel: TODO_CHANNEL });
    expect(await reports.findTodoPost(reportId)).toMatchObject({
      channelId: TODO_CHANNEL,
      ts: '1790000000.000001',
      hash: hashOf('again'),
    });
  });

  it('never posts a to-do in the report channel, even when its own channel was cleared', async () => {
    const client = fakeClient();
    client.chat.update.mockRejectedValue(
      new WebAPIPlatformError({ ok: false, error: 'message_not_found' }),
    );
    setSlackClientForTests(client);
    const reportId = await newReport();
    await reports.saveTodoSlackMessage({ reportId, channelId: 'C0GONE', ts: '1780000000.000002' });
    await queue(reportId, { update: true });
    await setSettings({ slack_todo_channel_id: null, slack_todo_channel_name: null });
    expect(await slack.processOutbox()).toMatchObject({ retried: 1, sent: 0 });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(await slack.latestTodoDelivery(reportId)).toEqual({
      status: 'sending',
      at: new Date(T0),
    });
  });

  it('shows failed at once on an error a retry cannot fix', async () => {
    const client = fakeClient();
    client.chat.postMessage.mockRejectedValue(
      new WebAPIPlatformError({ ok: false, error: 'not_in_channel' }),
    );
    setSlackClientForTests(client);
    const reportId = await newReport();
    await queue(reportId);
    expect(await slack.processOutbox()).toMatchObject({ failed: 1, retried: 0 });
    expect((await outboxRows())[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'not_in_channel',
    });
    expect(await slack.latestTodoDelivery(reportId)).toEqual({
      status: 'failed',
      at: new Date(T0),
    });
    expect(await reports.findTodoPost(reportId)).toBeNull();

    // "Try again" queues a new row: sending again, then sent.
    client.chat.postMessage.mockResolvedValueOnce({ ok: true, channel: TODO_CHANNEL, ts: '1.2' });
    await queue(reportId);
    expect(await slack.latestTodoDelivery(reportId)).toMatchObject({ status: 'sending' });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(await slack.latestTodoDelivery(reportId)).toMatchObject({ status: 'sent' });
  });

  it('stays sending while it retries, and shows failed after the last retry', async () => {
    const client = fakeClient();
    client.chat.postMessage.mockRejectedValue(
      new WebAPIPlatformError({ ok: false, error: 'internal_error' }),
    );
    setSlackClientForTests(client);
    const reportId = await newReport();
    await queue(reportId);
    let at = new Date(T0).getTime();
    for (const waitMinutes of [1, 5, 15, 60]) {
      expect(await slack.processOutbox()).toMatchObject({ retried: 1 });
      expect(await slack.latestTodoDelivery(reportId)).toEqual({
        status: 'sending',
        at: new Date(T0),
      });
      at += waitMinutes * 60_000;
      setNowForTests(new Date(at).toISOString());
    }
    expect(await slack.processOutbox()).toMatchObject({ failed: 1 });
    expect((await outboxRows())[0]).toMatchObject({ status: 'failed', attempts: 5 });
    expect(await slack.latestTodoDelivery(reportId)).toEqual({
      status: 'failed',
      at: new Date(at),
    });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(5);
  });
});

describe('before migration 017 (deploy before migrate)', () => {
  it('findTodoPost answers null with one warning, saving throws TODO_UNAVAILABLE, posting still works', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    const reportId = await newReport();
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    await db.migrate.down({ name: MIGRATION });
    try {
      expect(await reports.findTodoPost(reportId)).toBeNull();
      expect(await reports.findTodoPost(reportId)).toBeNull();
      const warnings = warn.mock.calls.filter((call) =>
        call.some((part) => typeof part === 'string' && part.includes('to-do columns')),
      );
      expect(warnings).toHaveLength(1);

      const failure = await expectAppError(
        reports.saveTodoSlackMessage({ reportId, channelId: TODO_CHANNEL, ts: '1.1' }),
        'TODO_UNAVAILABLE',
      );
      expect(failure).toMatchObject({
        status: 503,
        message: 'This needs the latest database update. Ask an Admin.',
      });

      // The message still goes out; only remembering it on the report is logged as failed.
      await queue(reportId);
      expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ reportId }),
        'could not save the slack to-do message on the report',
      );
      expect(await slack.latestTodoDelivery(reportId)).toMatchObject({ status: 'sent' });
    } finally {
      await db.migrate.up({ name: MIGRATION });
    }
    // Works again once migrated, with no restart.
    await reports.saveTodoSlackMessage({ reportId, channelId: TODO_CHANNEL, ts: '1.1' });
    expect(await reports.findTodoPost(reportId)).toMatchObject({ channelId: TODO_CHANNEL });
  });
});
