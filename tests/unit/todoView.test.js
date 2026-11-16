// Today's to-do shaping (CONTRACT 24, reports/todoView.js), pure: the plan Slack gets and its hash
// (project ids and titles, never statuses or names), the post state, "Now", the timer note from a
// title (200 characters, never half an emoji), tick and untick, and the groups the card gets.
import { describe, expect, it } from 'vitest';
import {
  isNowLine,
  noteFromTitle,
  planHash,
  planOf,
  postState,
  tickedStatus,
  todoGroups,
} from '@/modules/reports/todoView';

const entry = (overrides = {}) => ({
  id: 7,
  projectId: 12,
  projectRequestId: null,
  projectName: 'Pine Tree Lane',
  projectColor: 'green',
  projectStatus: 'active',
  minutes: 0,
  tasks: [],
  ...overrides,
});
const task = (id, title, status = 'in_progress', rest = {}) => ({
  id,
  title,
  status,
  carriedFromTaskId: null,
  projectTaskId: null,
  timerNote: null,
  ...rest,
});

describe('planOf and planHash', () => {
  const entries = [
    entry({ tasks: [task(1, '  Monitoring   ads '), task(2, '   ')] }),
    entry({ id: 8, projectId: 13, projectName: 'Empty', tasks: [task(3, '')] }),
    entry({
      id: 9,
      projectId: null,
      projectRequestId: 4,
      projectName: 'acme-blog',
      tasks: [task(4, 'Blog post', 'done')],
    }),
  ];

  it('keeps projects with a written line, in order, with collapsed titles', () => {
    expect(planOf(entries)).toEqual([
      {
        key: 'p12',
        projectName: 'Pine Tree Lane',
        lines: [{ title: 'Monitoring ads', status: 'in_progress' }],
      },
      { key: 'r4', projectName: 'acme-blog', lines: [{ title: 'Blog post', status: 'done' }] },
    ]);
  });

  it('hashes project ids and titles only: a tick or a renamed project gives the same hash', () => {
    const hash = planHash(planOf(entries));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const ticked = entries.map((row) => ({
      ...row,
      projectName: `${row.projectName} (renamed)`,
      tasks: row.tasks.map((line) => ({ ...line, status: 'done' })),
    }));
    expect(planHash(planOf(ticked))).toBe(hash);
    const retitled = [entry({ tasks: [task(1, 'Monitoring the ads')] }), entries[2]];
    expect(planHash(planOf(retitled))).not.toBe(hash);
    const moved = [entry({ projectId: 99, tasks: entries[0].tasks }), entries[2]];
    expect(planHash(planOf(moved))).not.toBe(hash);
  });
});

describe('postState', () => {
  const hash = 'a'.repeat(64);
  const posted = { postedAt: new Date('2026-09-30T04:11:00Z'), hash, ts: '1.1' };

  it('is none until something was queued', () => {
    expect(postState({ todoPost: null, delivery: { status: 'none', at: null }, hash })).toEqual({
      state: 'none',
      at: null,
      changed: false,
      postedAt: null,
    });
  });

  it('follows the latest delivery, and the post the report remembers', () => {
    const queuedAt = new Date('2026-09-30T04:20:00Z');
    expect(
      postState({ todoPost: posted, delivery: { status: 'sending', at: queuedAt }, hash }),
    ).toEqual({
      state: 'sending',
      at: '2026-09-30T04:20:00.000Z',
      changed: false,
      postedAt: '2026-09-30T04:11:00.000Z',
    });
    expect(
      postState({ todoPost: posted, delivery: { status: 'failed', at: queuedAt }, hash: 'b' }),
    ).toMatchObject({ state: 'failed', changed: true, postedAt: '2026-09-30T04:11:00.000Z' });
    // Sent rows are cleaned up after a while: the report still says when it was posted.
    expect(
      postState({ todoPost: posted, delivery: { status: 'none', at: null }, hash }),
    ).toMatchObject({ state: 'sent', at: '2026-09-30T04:11:00.000Z', changed: false });
    // Before migration 017 the report remembers nothing: sent, never changed.
    expect(
      postState({ todoPost: null, delivery: { status: 'sent', at: queuedAt }, hash }),
    ).toMatchObject({ state: 'sent', at: '2026-09-30T04:20:00.000Z', changed: false });
  });
});

describe('isNowLine', () => {
  const running = { projectId: 12, note: '  monitoring ADS ' };

  it("matches the running timer's project and note by the timer note or the title", () => {
    expect(isNowLine({ title: 'Monitoring ads' }, 12, running)).toBe(true);
    expect(isNowLine({ title: 'Reworded', timerNote: 'Monitoring ads' }, 12, running)).toBe(true);
    expect(isNowLine({ title: 'Monitoring ads' }, 13, running)).toBe(false);
    expect(isNowLine({ title: 'Monitoring ads' }, null, running)).toBe(false);
    expect(isNowLine({ title: 'Monitoring ads' }, 12, { projectId: 12, note: null })).toBe(false);
    expect(isNowLine({ title: 'Monitoring ads' }, 12, null)).toBe(false);
  });
});

describe('noteFromTitle', () => {
  it('takes the first 200 characters, trimmed, never half an emoji', () => {
    expect(noteFromTitle('x'.repeat(300))).toHaveLength(200);
    expect(noteFromTitle('  Monitor ads  ')).toBe('Monitor ads');
    const emoji = `${'a'.repeat(199)}🚀tail`;
    expect(noteFromTitle(emoji)).toBe('a'.repeat(199));
    expect(noteFromTitle(`${'a'.repeat(198)}🚀tail`)).toBe(`${'a'.repeat(198)}🚀`);
    expect(noteFromTitle('   ')).toBeNull();
  });
});

describe('tickedStatus', () => {
  it('ticks to Done, unticks Done to In progress and leaves Blocked until ticked', () => {
    expect(tickedStatus('in_progress', true)).toBe('done');
    expect(tickedStatus('blocked', true)).toBe('done');
    expect(tickedStatus('done', false)).toBe('in_progress');
    expect(tickedStatus('blocked', false)).toBe('blocked');
    expect(tickedStatus('in_progress', false)).toBe('in_progress');
  });
});

describe('todoGroups', () => {
  it('shapes groups and lines with Now, the carried day and Play', () => {
    const entries = [
      entry({
        minutes: 90,
        tasks: [
          task(1, 'Monitoring ads', 'in_progress', { timerNote: 'Monitoring ads' }),
          task(2, 'Fix links', 'blocked', { carriedFromTaskId: 50, projectTaskId: 3 }),
          task(3, 'Shipped', 'done'),
          task(4, ' '),
        ],
      }),
      entry({
        id: 8,
        projectId: null,
        projectRequestId: 4,
        projectName: 'acme-blog',
        projectStatus: null,
        tasks: [task(5, 'Blog post')],
      }),
    ];
    const groups = todoGroups(entries, {
      today: '2026-09-30',
      running: { projectId: 12, note: 'Monitoring ads' },
      sourceDays: new Map([[50, '2026-09-28']]),
      canStart: true,
    });
    expect(groups).toEqual([
      {
        entryId: 7,
        project: { id: 12, name: 'Pine Tree Lane', color: 'green' },
        minutes: 90,
        lines: [
          {
            id: 1,
            title: 'Monitoring ads',
            status: 'in_progress',
            done: false,
            projectTaskId: null,
            now: true,
            carriedFrom: null,
            canStart: false,
          },
          {
            id: 2,
            title: 'Fix links',
            status: 'blocked',
            done: false,
            projectTaskId: 3,
            now: false,
            carriedFrom: { workDate: '2026-09-28', dayLabel: 'From Monday' },
            canStart: true,
          },
          {
            id: 3,
            title: 'Shipped',
            status: 'done',
            done: true,
            projectTaskId: null,
            now: false,
            carriedFrom: null,
            canStart: false,
          },
        ],
      },
      {
        entryId: 8,
        request: { id: 4, name: 'acme-blog' },
        minutes: 0,
        lines: [
          {
            id: 5,
            title: 'Blog post',
            status: 'in_progress',
            done: false,
            projectTaskId: null,
            now: false,
            carriedFrom: null,
            canStart: false,
          },
        ],
      },
    ]);
  });
});
