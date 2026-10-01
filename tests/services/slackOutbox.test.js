import { WebAPIPlatformError, WebAPIRateLimitedError } from '@slack/web-api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { slack } from '@/modules/slack';
import { setSlackClientForTests } from '@/modules/slack/client';
import { formatReport } from '@/modules/slack/format';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

// The reports module belongs to another owner; the outbox only needs saveSlackMessage.
const { saveSlackMessage } = vi.hoisted(() => ({ saveSlackMessage: vi.fn() }));
vi.mock('@/modules/reports', () => ({ reports: { saveSlackMessage } }));

const T0 = '2026-09-30T13:00:00Z';
const CHANNEL = 'C0DAILY';
const entries = [
  {
    projectName: 'iwilltillimwell',
    minutes: 120,
    tasks: [{ title: 'Content changes', status: 'done' }],
  },
  {
    projectName: 'R&D <tools>',
    minutes: 90,
    tasks: [{ title: 'Working on backend', status: 'in_progress' }],
  },
];

let person;
let reportIds;

/** A fake WebClient: every method is a vi.fn you can override per test. */
function fakeClient() {
  let counter = 0;
  return {
    chat: {
      postMessage: vi.fn(async ({ channel }) => {
        counter += 1;
        return {
          ok: true,
          channel: channel.startsWith('U') ? 'D0DM' : channel,
          ts: `1790000000.00000${counter}`,
        };
      }),
      update: vi.fn(async ({ channel, ts }) => ({ ok: true, channel, ts })),
    },
    auth: {
      test: vi.fn(async () => ({
        ok: true,
        team: '[Company name]',
        team_id: 'T1',
        user_id: 'UBOT',
      })),
    },
    conversations: { list: vi.fn() },
    users: { lookupByEmail: vi.fn() },
  };
}

async function rows() {
  return (await db('slack_outbox').orderBy('id')).map((row) => ({
    ...row,
    payload: parseJson(row.payload),
  }));
}

async function insertReport(workDate) {
  const [id] = await db('daily_reports').insert({
    userId: person.id,
    workDate,
    status: 'submitted',
  });
  return id;
}

beforeAll(async () => {
  await resetDatabase();
  person = await createUser({
    name: 'Vishal Saini',
    slackUserId: 'U0VISHAL',
    avatarUrl: 'https://example.com/v.png',
  });
  reportIds = [];
  for (let day = 21; day <= 29; day += 1) reportIds.push(await insertReport(`2026-09-${day}`));
});

beforeEach(async () => {
  await db('slack_outbox').delete();
  await setSettings({
    slack_enabled: true,
    slack_post_reports: true,
    slack_remind: true,
    slack_report_channel_id: CHANNEL,
  });
  setNowForTests(T0);
  saveSlackMessage.mockReset();
});

afterEach(() => setSlackClientForTests(null));

describe('queueReportPost', () => {
  const report = () => ({
    id: reportIds[0],
    workDate: '2026-09-21',
    slackTs: null,
    slackChannelId: null,
  });

  it('does nothing without a report channel, or with posting or Slack turned off', async () => {
    await setSettings({ slack_report_channel_id: null });
    expect(
      await slack.queueReportPost({ report: report(), userName: 'Vishal Saini', entries }),
    ).toBeNull();
    await setSettings({ slack_report_channel_id: CHANNEL, slack_post_reports: false });
    expect(
      await slack.queueReportPost({ report: report(), userName: 'Vishal Saini', entries }),
    ).toBeNull();
    await setSettings({ slack_post_reports: true, slack_enabled: false });
    expect(
      await slack.queueReportPost({ report: report(), userName: 'Vishal Saini', entries }),
    ).toBeNull();
    expect(await rows()).toHaveLength(0);
  });

  it('queues a new post under the person name and photo, in the team format', async () => {
    const id = await slack.queueReportPost({
      report: report(),
      userName: 'Vishal Saini',
      userSlackUserId: 'U0VISHAL',
      avatarUrl: 'https://example.com/v.png',
      entries,
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      id,
      kind: 'report_post',
      channel: CHANNEL,
      status: 'pending',
      attempts: 0,
      relatedType: 'report',
      relatedId: reportIds[0],
    });
    expect(row.nextAttemptAt).toEqual(new Date(T0));
    const expected = formatReport({ userName: 'Vishal Saini', workDate: '2026-09-21', entries });
    expect(row.payload).toEqual({
      text: expected.replace('R&D <tools>', 'R&amp;D &lt;tools&gt;'),
      username: 'Vishal Saini',
      icon_url: 'https://example.com/v.png',
    });
  });

  it('queues an update of the same message when the report already has a Slack message', async () => {
    await slack.queueReportPost({
      report: { ...report(), slackTs: '1790000000.000001', slackChannelId: 'C0OLD' },
      userName: 'Vishal Saini',
      avatarUrl: null,
      entries,
    });
    const [row] = await rows();
    expect(row).toMatchObject({ kind: 'report_update', channel: 'C0OLD' });
    expect(row.payload).toMatchObject({ ts: '1790000000.000001', username: 'Vishal Saini' });
    expect(row.payload.icon_url).toBeUndefined();
  });

  it('rolls back with the caller transaction', async () => {
    await expect(
      db.transaction(async (trx) => {
        await slack.queueReportPost({ report: report(), userName: 'Vishal Saini', entries }, trx);
        throw new Error('submit failed');
      }),
    ).rejects.toThrow('submit failed');
    expect(await rows()).toHaveLength(0);
  });
});

describe('queueDm', () => {
  it('honours Slack and the named setting, and skips people without a Slack user ID', async () => {
    await setSettings({ slack_remind: false });
    expect(
      await slack.queueDm({ slackUserId: 'U0VISHAL', text: 'Hi', settingKey: 'slackRemind' }),
    ).toBeNull();
    await setSettings({ slack_remind: true });
    expect(
      await slack.queueDm({ slackUserId: null, text: 'Hi', settingKey: 'slackRemind' }),
    ).toBeNull();
    expect(
      await slack.queueDm({ slackUserId: 'U0VISHAL', text: 'Hi', settingKey: 'slackNoSuchThing' }),
    ).toBeNull();
    await setSettings({ slack_enabled: false });
    expect(await slack.queueDm({ slackUserId: 'U0VISHAL', text: 'Hi' })).toBeNull();
    expect(await rows()).toHaveLength(0);

    await setSettings({ slack_enabled: true });
    await slack.queueDm({
      slackUserId: 'U0VISHAL',
      text: "Your report for Wed, 30 Sep isn't in yet.",
      settingKey: 'slack_remind',
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      kind: 'dm',
      channel: 'U0VISHAL',
      payload: { text: "Your report for Wed, 30 Sep isn't in yet." },
    });
  });
});

describe('processOutbox', () => {
  it('leaves rows pending when no bot token is set', async () => {
    await slack.queueDm({ slackUserId: 'U0VISHAL', text: 'Hi' });
    const result = await slack.processOutbox();
    expect(result).toMatchObject({ configured: false, sent: 0 });
    expect((await rows())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('sends a new report post, saves result_ts and tells the report', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    await slack.queueReportPost({
      report: { id: reportIds[1], workDate: '2026-09-22' },
      userName: 'Vishal Saini',
      avatarUrl: 'https://example.com/v.png',
      entries,
    });
    await slack.queueDm({ slackUserId: 'U0VISHAL', text: 'Reminder' });

    expect(await slack.processOutbox()).toMatchObject({ sent: 2, retried: 0, failed: 0 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(client.chat.postMessage.mock.calls[0][0]).toMatchObject({
      channel: CHANNEL,
      username: 'Vishal Saini',
      icon_url: 'https://example.com/v.png',
    });
    expect(client.chat.postMessage.mock.calls[1][0]).toMatchObject({
      channel: 'U0VISHAL',
      text: 'Reminder',
    });

    const [post, dm] = await rows();
    expect(post).toMatchObject({
      status: 'sent',
      attempts: 1,
      resultTs: '1790000000.000001',
      channel: CHANNEL,
      lastError: null,
    });
    expect(post.sentAt).toEqual(new Date(T0));
    expect(dm).toMatchObject({
      status: 'sent',
      channel: 'U0VISHAL',
      resultTs: '1790000000.000002',
    });
    expect(saveSlackMessage).toHaveBeenCalledTimes(1);
    expect(saveSlackMessage).toHaveBeenCalledWith({
      reportId: reportIds[1],
      channelId: CHANNEL,
      ts: '1790000000.000001',
    });
    // Nothing left to send.
    expect(await slack.processOutbox()).toMatchObject({ sent: 0 });
  });

  it('updates the message in place for a resubmitted report', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    await slack.queueReportPost({
      report: {
        id: reportIds[2],
        workDate: '2026-09-23',
        slackTs: '1790000000.000009',
        slackChannelId: CHANNEL,
      },
      userName: 'Vishal Saini',
      entries,
    });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: CHANNEL,
      ts: '1790000000.000009',
      text: expect.stringContaining('Name: Vishal Saini'),
    });
    expect((await rows())[0]).toMatchObject({
      status: 'sent',
      kind: 'report_update',
      resultTs: '1790000000.000009',
    });
    expect(saveSlackMessage).not.toHaveBeenCalled();
  });

  it('never posts twice when a report is resubmitted before the first post went out', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    const report = { id: reportIds[3], workDate: '2026-09-24' };
    await slack.queueReportPost({ report, userName: 'Vishal Saini', entries: entries.slice(0, 1) });
    await slack.queueReportPost({ report, userName: 'Vishal Saini', entries });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1, skipped: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage.mock.calls[0][0].text).toContain('Hours: 1.5');

    // A third submit queued as a new post (the caller read the report before the ts was saved)
    // updates the message that was already posted.
    await slack.queueReportPost({ report, userName: 'Vishal Saini', entries: entries.slice(1) });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL, ts: '1790000000.000001' }),
    );
  });

  it('posts a new message when the old one can no longer be updated', async () => {
    const client = fakeClient();
    client.chat.update.mockRejectedValueOnce(
      new WebAPIPlatformError({ ok: false, error: 'message_not_found' }),
    );
    setSlackClientForTests(client);
    await slack.queueReportPost({
      report: {
        id: reportIds[4],
        workDate: '2026-09-25',
        slackTs: '1780000000.000001',
        slackChannelId: 'C0GONE',
      },
      userName: 'Vishal Saini',
      entries,
    });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL }),
    );
    expect((await rows())[0]).toMatchObject({
      kind: 'report_post',
      channel: CHANNEL,
      resultTs: '1790000000.000001',
    });
    expect(saveSlackMessage).toHaveBeenCalledWith({
      reportId: reportIds[4],
      channelId: CHANNEL,
      ts: '1790000000.000001',
    });
  });

  it('retries after 1, 5, 15 and 60 minutes, then marks the row failed', async () => {
    const client = fakeClient();
    client.chat.postMessage.mockRejectedValue(
      new WebAPIPlatformError({ ok: false, error: 'not_in_channel' }),
    );
    setSlackClientForTests(client);
    await slack.queueReportPost({
      report: { id: reportIds[5], workDate: '2026-09-26' },
      userName: 'Vishal Saini',
      entries,
    });

    let at = new Date(T0).getTime();
    for (const [attempt, waitMinutes] of [
      [1, 1],
      [2, 5],
      [3, 15],
      [4, 60],
    ]) {
      expect(await slack.processOutbox()).toMatchObject({ retried: 1 });
      const [row] = await rows();
      expect(row).toMatchObject({
        status: 'pending',
        attempts: attempt,
        lastError: 'not_in_channel',
      });
      expect(row.nextAttemptAt).toEqual(new Date(at + waitMinutes * 60_000));
      // Not due yet: nothing is sent a second early.
      setNowForTests(new Date(at + waitMinutes * 60_000 - 1000).toISOString());
      expect(await slack.processOutbox()).toMatchObject({ retried: 0, sent: 0, failed: 0 });
      at += waitMinutes * 60_000;
      setNowForTests(new Date(at).toISOString());
    }
    expect(await slack.processOutbox()).toMatchObject({ failed: 1 });
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'failed', attempts: 5, lastError: 'not_in_channel' });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(5);
    expect(saveSlackMessage).not.toHaveBeenCalled();
    // A failed row is never picked up again.
    setNowForTests('2026-10-02T00:00:00Z');
    expect(await slack.processOutbox()).toMatchObject({ sent: 0, failed: 0, retried: 0 });
  });

  it('waits the retry_after Slack asks for on a rate limit, for the rest of the batch too', async () => {
    const client = fakeClient();
    client.chat.postMessage.mockRejectedValueOnce(new WebAPIRateLimitedError(30));
    setSlackClientForTests(client);
    await slack.queueDm({ slackUserId: 'U0A', text: 'One' });
    await slack.queueDm({ slackUserId: 'U0B', text: 'Two' });

    expect(await slack.processOutbox()).toMatchObject({ retried: 1, sent: 0 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    for (const row of await rows()) {
      expect(row).toMatchObject({ status: 'pending', attempts: 0 });
      expect(row.nextAttemptAt).toEqual(new Date(new Date(T0).getTime() + 30_000));
    }
    setNowForTests('2026-09-30T13:00:30Z');
    expect(await slack.processOutbox()).toMatchObject({ sent: 2 });
  });

  it('claims each row once, even when two workers run at the same time', async () => {
    const client = fakeClient();
    const slowPost = client.chat.postMessage.getMockImplementation();
    client.chat.postMessage.mockImplementation(async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return slowPost(args);
    });
    setSlackClientForTests(client);
    for (let i = 0; i < 5; i += 1)
      await slack.queueDm({ slackUserId: `U0P${i}`, text: `Hello ${i}` });

    const [first, second] = await Promise.all([slack.processOutbox(), slack.processOutbox()]);
    expect(first.sent + second.sent).toBe(5);
    expect(client.chat.postMessage).toHaveBeenCalledTimes(5);
    expect((await rows()).every((row) => row.status === 'sent')).toBe(true);
  });

  it('drops direct messages that waited more than a day', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    await slack.queueDm({ slackUserId: 'U0OLD', text: 'Stale reminder' });
    setNowForTests('2026-10-01T13:00:00Z');
    expect(await slack.processOutbox()).toMatchObject({ failed: 1, sent: 0 });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({
      status: 'failed',
      lastError: 'expired: not sent within 24 hours',
    });
  });
});

describe('connection, channels, users and upkeep', () => {
  it('getConnection reports the workspace, and not connected when Slack is off or unset', async () => {
    slack.resetConnectionCacheForTests();
    expect(await slack.getConnection()).toEqual({
      configured: false,
      connected: false,
      teamName: null,
    });
    const client = fakeClient();
    setSlackClientForTests(client);
    expect(await slack.getConnection()).toEqual({
      configured: true,
      connected: true,
      teamName: '[Company name]',
    });
    await slack.getConnection();
    expect(client.auth.test).toHaveBeenCalledTimes(1);
    await setSettings({ slack_enabled: false });
    expect(await slack.getConnection()).toEqual({
      configured: true,
      connected: false,
      teamName: null,
    });

    slack.resetConnectionCacheForTests();
    await setSettings({ slack_enabled: true });
    client.auth.test.mockRejectedValueOnce(
      new WebAPIPlatformError({ ok: false, error: 'invalid_auth' }),
    );
    expect(await slack.getConnection()).toEqual({
      configured: true,
      connected: false,
      teamName: null,
    });
    slack.resetConnectionCacheForTests();
  });

  it('listChannels follows paging and keeps public channels the bot is in, by name', async () => {
    expect(await slack.listChannels()).toEqual([]);
    const client = fakeClient();
    client.conversations.list
      .mockResolvedValueOnce({
        ok: true,
        channels: [
          { id: 'C3', name: 'random', is_member: true },
          { id: 'C9', name: 'not-a-member', is_member: false },
        ],
        response_metadata: { next_cursor: 'page2' },
      })
      .mockResolvedValueOnce({
        ok: true,
        channels: [{ id: 'C1', name: 'daily-reports', is_member: true }],
        response_metadata: { next_cursor: '' },
      });
    setSlackClientForTests(client);
    expect(await slack.listChannels()).toEqual([
      { id: 'C1', name: 'daily-reports' },
      { id: 'C3', name: 'random' },
    ]);
    expect(client.conversations.list).toHaveBeenCalledTimes(2);
    expect(client.conversations.list.mock.calls[1][0]).toMatchObject({
      cursor: 'page2',
      types: 'public_channel',
    });

    client.conversations.list.mockRejectedValueOnce(
      new WebAPIPlatformError({ ok: false, error: 'missing_scope' }),
    );
    await expect(slack.listChannels()).rejects.toMatchObject({ code: 'SLACK_ERROR', status: 502 });
  });

  it('lookupUserIdByEmail returns the id, or null when Slack has nobody with that email', async () => {
    expect(await slack.lookupUserIdByEmail('a@example.com')).toBeNull();
    const client = fakeClient();
    client.users.lookupByEmail
      .mockResolvedValueOnce({ ok: true, user: { id: 'U0FOUND' } })
      .mockRejectedValueOnce(new WebAPIPlatformError({ ok: false, error: 'users_not_found' }));
    setSlackClientForTests(client);
    expect(await slack.lookupUserIdByEmail(' Neha@Company.com ')).toBe('U0FOUND');
    expect(client.users.lookupByEmail).toHaveBeenCalledWith({ email: 'neha@company.com' });
    expect(await slack.lookupUserIdByEmail('nobody@company.com')).toBeNull();
  });

  it('outboxHealth counts pending messages; deleteOldSent keeps pending and recent rows', async () => {
    expect(await slack.outboxHealth()).toEqual({
      pending: 0,
      oldestPendingAt: null,
      failedLastDay: 0,
    });
    setNowForTests('2026-06-01T00:00:00Z');
    await slack.queueDm({ slackUserId: 'U0OLDSENT', text: 'Old' });
    await db('slack_outbox').update({ status: 'sent' });
    await slack.queueDm({ slackUserId: 'U0OLDPENDING', text: 'Old but pending' });
    setNowForTests(T0);
    await slack.queueDm({ slackUserId: 'U0NEW', text: 'New' });

    expect(await slack.outboxHealth()).toEqual({
      pending: 2,
      oldestPendingAt: new Date('2026-06-01T00:00:00Z'),
      failedLastDay: 0,
    });
    expect(await slack.deleteOldSent(new Date('2026-07-02T00:00:00Z'))).toBe(1);
    expect((await rows()).map((row) => row.channel)).toEqual(['U0OLDPENDING', 'U0NEW']);
  });
});
