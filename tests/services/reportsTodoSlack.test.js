// "Post to Slack" on today's to-do (CONTRACT 24): reports.queueTodoPost with the fake Slack
// transport and the real outbox. Posting off answers 409, an empty list "Add a task first.", a
// post then an update edit the same message, two quick posts send one message, `changed` follows
// edits and not ticks, a failed delivery shows failed. Before migration 017 (deploy before
// migrate) every to-do write and the report itself still work, the post shows as not posted and
// posting answers TODO_UNAVAILABLE.
import { WebAPIPlatformError } from '@slack/web-api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { planHash, planOf } from '@/modules/reports/todoView';
import { slack } from '@/modules/slack';
import { setSlackClientForTests } from '@/modules/slack/client';
import { escapeSlackText } from '@/modules/slack/format';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { caught, setClock, TODAY } from './timersKit.js';

const TODO_CHANNEL = 'C0TODO';
const REPORT_CHANNEL = 'C0REPORTS';
const MIGRATION = '017_todo.js';

let pm;
let emp;
let pine;
let studio;

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

async function outboxRows() {
  return (await db('slack_outbox').orderBy('id')).map((row) => ({
    ...row,
    payload: parseJson(row.payload),
  }));
}

const add = (title, project = pine) =>
  reports.addTodoLine({ user: emp, projectId: project.id, title });
const post = () => reports.queueTodoPost({ user: emp, ip: '10.0.0.5' });

/** The owner's morning: 2 projects, 2 lines. */
async function ownersPlan() {
  const first = await add('Monitoring google ads campaign');
  const second = await add('1 web blog publish', studio);
  return { first: first.lineId, second: second.lineId };
}

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = {
    ...(await createUser({ name: 'Priya Sharma', avatarUrl: 'https://example.com/priya.png' })),
    initials: 'PS',
  };
  pine = await createProject(pm, { name: 'Pine Tree Lane' });
  studio = await createProject(pm, { name: 'Studio Ubique' });
  await addMembers(pine, [emp]);
  await addMembers(studio, [emp]);
});

beforeEach(async () => {
  setClock('09:41');
  for (const table of ['slack_outbox', 'auditLogs', 'reportTasks', 'reportEntries']) {
    await db(table).del();
  }
  for (const table of ['reportRevisions', 'dailyReports', 'timeEntries', 'attendance']) {
    await db(table).del();
  }
  await setSettings({
    slack_enabled: true,
    slack_post_reports: true,
    slack_report_channel_id: REPORT_CHANNEL,
    slack_todo_channel_id: TODO_CHANNEL,
    slack_todo_channel_name: 'morning-todo',
    timers_mode: 'optional',
  });
  setSlackClientForTests(fakeClient());
});

afterEach(() => {
  setSlackClientForTests(null);
});

describe('queueTodoPost', () => {
  it('answers 409 while posting is off, and the button is hidden', async () => {
    await ownersPlan();
    setSlackClientForTests(null); // no bot token
    expect((await reports.getTodo({ user: emp })).slack.canPost).toBe(false);
    let error = await caught(post());
    expect(error).toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'Slack posting is off.',
    });

    setSlackClientForTests(fakeClient());
    await setSettings({ slack_todo_channel_id: null, slack_todo_channel_name: null });
    expect((await reports.getTodo({ user: emp })).slack.canPost).toBe(false);
    error = await caught(post());
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'Slack posting is off.' });
    expect(await outboxRows()).toEqual([]);
    expect(await db('auditLogs').where({ action: 'report.todo_post' })).toEqual([]);
  });

  it('answers "Add a task first." with no line, and shows no button', async () => {
    expect(await caught(post())).toMatchObject({ code: 'CONFLICT', message: 'Add a task first.' });
    const { lineId, groups } = await add('Monitoring google ads campaign');
    await reports.removeTodoLine({ user: emp, id: lineId });
    const todo = await reports.getTodo({ user: emp });
    expect(todo).toMatchObject({ total: 0, slack: { canPost: false } });
    expect(todo.groups.map((group) => group.entryId)).toEqual([groups[0].entryId]);
    expect(await caught(post())).toMatchObject({ message: 'Add a task first.' });
  });

  it('posts as the person to the to-do channel, then updates the same message', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    const { first, second } = await ownersPlan();
    await reports.updateTodoLine({ user: emp, id: second, done: true });
    expect((await reports.getTodo({ user: emp })).slack.canPost).toBe(true);

    const queued = await post();
    expect(queued.queued).toBe('post');
    expect(queued.todo.post).toMatchObject({ state: 'sending', changed: false });
    const [row] = await outboxRows();
    const text = [
      'Name: Priya Sharma',
      'Date: 30-09-2026',
      "Today's to-do",
      '',
      'Project: Pine Tree Lane',
      '• Monitoring google ads campaign',
      '',
      'Project: Studio Ubique',
      '• 1 web blog publish (Done)',
    ].join('\n');
    expect(row).toMatchObject({
      kind: 'todo_post',
      channel: TODO_CHANNEL,
      relatedType: 'todo',
      relatedId: queued.todo.reportId,
    });
    expect(row.payload).toMatchObject({
      text: escapeSlackText(text),
      username: 'Priya Sharma',
      icon_url: 'https://example.com/priya.png',
    });
    const audit = await db('auditLogs').where({ action: 'report.todo_post' }).first();
    expect(audit).toMatchObject({ entityType: 'daily_report', entityId: queued.todo.reportId });

    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    let todo = await reports.getTodo({ user: emp });
    expect(todo.post).toEqual({
      state: 'sent',
      at: '2026-09-30T04:11:00.000Z',
      changed: false,
      postedAt: '2026-09-30T04:11:00.000Z',
    });
    const view = await reports.openForDate({ user: emp, workDate: TODAY });
    const stored = await db('dailyReports').where({ id: view.id }).first();
    expect(stored.todoPostHash).toBe(planHash(planOf(view.entries)));

    // A tick doesn't ask for an update; a new title does.
    await reports.updateTodoLine({ user: emp, id: first, done: true });
    expect((await reports.getTodo({ user: emp })).post.changed).toBe(false);
    await reports.updateTodoLine({ user: emp, id: first, title: 'Monitoring the ads campaign' });
    todo = await reports.getTodo({ user: emp });
    expect(todo.post).toMatchObject({ state: 'sent', changed: true });

    setClock('10:15');
    expect((await post()).queued).toBe('update');
    expect((await outboxRows())[1]).toMatchObject({ kind: 'todo_update', channel: TODO_CHANNEL });
    expect(await slack.processOutbox()).toMatchObject({ sent: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.update).toHaveBeenCalledTimes(1);
    expect(client.chat.update.mock.calls[0][0]).toMatchObject({
      channel: TODO_CHANNEL,
      ts: '1790000000.000001',
    });
    todo = await reports.getTodo({ user: emp });
    expect(todo.post).toMatchObject({
      state: 'sent',
      changed: false,
      at: '2026-09-30T04:45:00.000Z',
    });
  });

  it('sends one message for two quick posts', async () => {
    const client = fakeClient();
    setSlackClientForTests(client);
    await ownersPlan();
    await post();
    await add('2 Web blog topic research', studio);
    await post();
    expect(await slack.processOutbox()).toMatchObject({ sent: 1, skipped: 1 });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage.mock.calls[0][0].text).toContain('2 Web blog topic research');
    expect((await reports.getTodo({ user: emp })).post).toMatchObject({
      state: 'sent',
      changed: false,
    });
  });

  it('shows a failed delivery as failed, and Try again posts', async () => {
    const client = fakeClient();
    client.chat.postMessage.mockRejectedValueOnce(
      new WebAPIPlatformError({ ok: false, error: 'not_in_channel' }),
    );
    setSlackClientForTests(client);
    await ownersPlan();
    await post();
    await slack.processOutbox();
    const failed = await reports.getTodo({ user: emp });
    expect(failed.post).toMatchObject({ state: 'failed', changed: false, postedAt: null });
    expect(failed.post.at).toEqual(expect.any(String));

    expect((await post()).queued).toBe('post');
    await slack.processOutbox();
    expect((await reports.getTodo({ user: emp })).post.state).toBe('sent');
  });
});

describe('before migration 017 (deploy before migrate)', () => {
  it('keeps every to-do write and the report working, shows not posted and refuses posting', async () => {
    await db.migrate.down({ name: MIGRATION });
    try {
      await checkIn(emp, TODAY, { in: '09:00' });
      const { first, second } = await ownersPlan();
      const { todo: pasted } = await reports.addTodoLines({
        user: emp,
        groups: [{ projectId: studio.id, lines: [{ title: 'Analysing the gsc stats' }] }],
      });
      expect(pasted.total).toBe(3);
      await reports.updateTodoLine({ user: emp, id: first, done: true });
      await reports.removeTodoLine({ user: emp, id: second });
      await reports.startTodoTimer({
        user: emp,
        id: pasted.groups[1].lines[1].id,
      });
      let todo = await reports.getTodo({ user: emp });
      expect(todo).toMatchObject({ done: 1, total: 2 });
      expect(todo.post).toEqual({ state: 'none', at: null, changed: false, postedAt: null });
      expect(todo.groups[1].lines[0].now).toBe(true);

      const error = await caught(post());
      expect(error).toMatchObject({
        code: 'TODO_UNAVAILABLE',
        status: 503,
        message: 'This needs the latest database update. Ask an Admin.',
      });
      expect(await outboxRows()).toEqual([]);

      // The report itself (REPORT_COLUMNS) opens, saves and submits.
      const view = await reports.openForDate({ user: emp, workDate: TODAY });
      const entries = view.entries.map((entry) => ({
        id: entry.id,
        projectId: entry.projectId,
        minutes: entry.projectId === pine.id ? 60 : 0,
        tasks: entry.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
      }));
      const parsed = saveReportSchema.parse({ entries }).entries;
      await reports.saveReport({ user: emp, reportId: view.id, entries: parsed });
      const submitted = await reports.submitReport({ user: emp, reportId: view.id });
      expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 60 });
      todo = await reports.getTodo({ user: emp });
      expect(todo).toMatchObject({ submitted: true, total: 2 });
      const removeEntry = reports.removeTodoProject({
        user: emp,
        entryId: todo.groups[1].entryId,
      });
      expect(await caught(removeEntry)).toMatchObject({ code: 'REPORT_LOCKED' });
    } finally {
      await db.migrate.up({ name: MIGRATION });
    }
    // Works once migrated, with no restart.
    expect((await reports.getTodo({ user: emp })).post.state).toBe('none');
  });
});
