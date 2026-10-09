// Today's Working on card helpers (CONTRACT 15): priority tasks grouped by project for the task
// select, entry rows, the break the card shows as paused, Add time defaults and the toasts for
// breaks and check-out.
import { describe, expect, it } from 'vitest';
import {
  addTimeDefaults,
  breakEndedToast,
  checkOutBody,
  entryRange,
  findProject,
  pausedEntry,
  shortDuration,
  taskOptions,
  tasksByProject,
  timerAnnouncement,
  timerPicker,
} from '@/app/(app)/today/timerData';

const entry = (overrides) => ({
  id: 1,
  projectId: 3,
  projectName: 'acme-app',
  projectTaskId: null,
  priority: null,
  projectTaskTitle: null,
  note: null,
  startedAt: '2026-09-30T04:00:00.000Z',
  endedAt: '2026-09-30T04:45:00.000Z',
  minutes: 45,
  stopReason: 'stopped',
  startClock: '09:30',
  endClock: '10:15',
  ...overrides,
});

describe('tasksByProject', () => {
  it('groups open priority tasks by project, keeping their order (P1 first)', () => {
    const rows = [
      { id: 7, title: 'Fix login', priority: 'p1', projectId: 3 },
      { id: 9, title: 'Schema markup', priority: 'p3', project: { id: 4 } },
      { id: 8, title: 'Booking tests', priority: 'p2', projectId: 3 },
      { id: 10, title: 'No project', priority: 'p2' },
    ];
    expect(tasksByProject(rows)).toEqual({
      3: [
        { id: 7, title: 'Fix login', priority: 'p1' },
        { id: 8, title: 'Booking tests', priority: 'p2' },
      ],
      4: [{ id: 9, title: 'Schema markup', priority: 'p3' }],
    });
    expect(tasksByProject(null)).toEqual({});
  });
});

describe('taskOptions', () => {
  const tasks = [
    { id: 7, title: 'Fix login', priority: 'p1' },
    { id: 8, title: 'Booking tests', priority: 'p2' },
  ];

  it('starts with "No priority task" and labels each task with its priority', () => {
    expect(taskOptions(tasks)).toEqual([
      { value: '', label: 'No priority task' },
      { value: '7', label: 'P1 · Fix login' },
      { value: '8', label: 'P2 · Booking tests' },
    ]);
  });

  it('is empty for a project without open tasks', () => {
    expect(taskOptions(undefined)).toEqual([]);
    expect(taskOptions([])).toEqual([]);
  });

  it('keeps the task an entry links even when it is no longer open', () => {
    const linked = { projectTaskId: 5, priority: 'p3', projectTaskTitle: 'Old task' };
    expect(taskOptions([], linked)).toEqual([
      { value: '', label: 'No priority task' },
      { value: '5', label: 'P3 · Old task' },
    ]);
    expect(taskOptions(tasks, { projectTaskId: 7, priority: 'p1' })).toHaveLength(3);
  });
});

describe('the picker for timers', () => {
  const picker = {
    urgent: [{ id: 1, name: 'acme-store', color: 'green', isUrgent: true }],
    mine: [{ id: 4, name: 'acme-seo', color: 'violet', isUrgent: false }],
    others: [{ id: 6, name: 'acme-app', color: 'pink', isUrgent: false }],
    requests: [{ requestId: 2, name: 'new-thing' }],
  };

  it('drops pending project requests (timers time real projects only)', () => {
    expect(timerPicker(picker).requests).toEqual([]);
    expect(timerPicker(picker).mine).toBe(picker.mine);
    expect(timerPicker(null)).toEqual({ urgent: [], mine: [], others: [], requests: [] });
  });

  it('finds a project in any list', () => {
    expect(findProject(picker, 6).name).toBe('acme-app');
    expect(findProject(picker, '4').name).toBe('acme-seo');
    expect(findProject(picker, 99)).toBeNull();
    expect(findProject(picker, null)).toBeNull();
  });
});

describe('entry rows', () => {
  it('shows the time range, "now" while it runs', () => {
    expect(entryRange(entry())).toBe('9:30–10:15');
    expect(entryRange(entry({ startClock: '13:05', endClock: null }))).toBe('1:05–now');
  });

  it('shows minutes as durations, "0m" under a minute', () => {
    expect(shortDuration(0)).toBe('0m');
    expect(shortDuration(45)).toBe('45m');
    expect(shortDuration(345)).toBe('5h 45m');
  });
});

describe('pausedEntry', () => {
  const breakStartedAt = '2026-09-30T07:40:00.000Z';
  const paused = entry({ id: 2, endedAt: breakStartedAt, stopReason: 'break' });

  it('is the entry the open break stopped', () => {
    const state = { onBreak: true, breakStartedAt, entries: [entry(), paused] };
    expect(pausedEntry(state)).toBe(paused);
    expect(timerAnnouncement(state)).toBe('Timer paused for your break.');
  });

  it('is null when the break paused nothing (or an older break did)', () => {
    const older = entry({ endedAt: '2026-09-30T06:00:00.000Z', stopReason: 'break' });
    const state = { onBreak: true, breakStartedAt, entries: [older] };
    expect(pausedEntry(state)).toBeNull();
    expect(timerAnnouncement(state)).toBe("You're on a break.");
    expect(pausedEntry({ onBreak: false, breakStartedAt: null, entries: [paused] })).toBeNull();
  });

  it('announces a running timer and no timer', () => {
    expect(timerAnnouncement({ running: entry({ projectName: 'acme-seo' }) })).toBe(
      'Timer running on acme-seo.',
    );
    expect(timerAnnouncement({ running: null, onBreak: false })).toBe('No timer running.');
  });
});

describe('addTimeDefaults', () => {
  const done = (startClock, endClock) => entry({ startClock, endClock });
  const running = (startClock) => entry({ startClock, endClock: null, endedAt: null });

  it('starts at the end of the last finished entry and ends now', () => {
    const entries = [done('10:15', '11:00'), done('09:30', '10:15')];
    expect(addTimeDefaults({ entries, checkInClock: '09:20', nowClock: '12:30' })).toEqual({
      startClock: '11:00',
      endClock: '12:30',
    });
  });

  it('starts at the check-in without entries, and leaves From empty when it is not before now', () => {
    expect(addTimeDefaults({ entries: [], checkInClock: '09:20', nowClock: '12:30' })).toEqual({
      startClock: '09:20',
      endClock: '12:30',
    });
    const entries = [done('11:00', '12:30')];
    expect(addTimeDefaults({ entries, checkInClock: '09:20', nowClock: '12:30' }).startClock).toBe(
      '',
    );
  });

  it('ends where the running timer started, so the defaults never overlap it', () => {
    const entries = [done('10:00', '11:00'), running('14:18')];
    expect(addTimeDefaults({ entries, checkInClock: '09:20', nowClock: '14:20' })).toEqual({
      startClock: '11:00',
      endClock: '14:18',
    });
    // Nothing tracked before it: from the check-in.
    expect(
      addTimeDefaults({ entries: [running('11:05')], checkInClock: '09:20', nowClock: '14:20' }),
    ).toEqual({ startClock: '09:20', endClock: '11:05' });
  });

  it('leaves From empty when the running timer follows straight on', () => {
    const entries = [done('10:00', '11:00'), running('11:00')];
    expect(addTimeDefaults({ entries, checkInClock: '09:20', nowClock: '14:20' })).toEqual({
      startClock: '',
      endClock: '11:00',
    });
  });

  it('starts after a break that ended, and ends where an open break started', () => {
    // A timer stopped by a break at 14:22, the break 14:22-14:23, the timer running again.
    const entries = [done('14:18', '14:22'), running('14:23')];
    const breaks = [{ startClock: '14:22', endClock: '14:23' }];
    expect(addTimeDefaults({ entries, breaks, checkInClock: '14:18', nowClock: '14:25' })).toEqual({
      startClock: '',
      endClock: '14:23',
    });
    // Checked out after a break 14:43-14:44: from the break's end.
    const after = [{ startClock: '14:43', endClock: '14:44' }];
    expect(
      addTimeDefaults({
        entries: [done('14:30', '14:43')],
        breaks: after,
        checkInClock: '14:18',
        nowClock: '14:50',
      }),
    ).toEqual({ startClock: '14:44', endClock: '14:50' });
    // On a break now (it paused the 13:00 timer at 13:30): nothing free before it.
    const open = [{ startClock: '13:30', endClock: null }];
    expect(
      addTimeDefaults({
        entries: [done('13:00', '13:30')],
        breaks: open,
        checkInClock: '09:20',
        nowClock: '13:45',
      }),
    ).toEqual({ startClock: '', endClock: '13:30' });
    // A break that paused nothing: the time before it is free.
    expect(
      addTimeDefaults({
        entries: [done('10:00', '11:00')],
        breaks: open,
        checkInClock: '09:20',
        nowClock: '13:45',
      }),
    ).toEqual({ startClock: '11:00', endClock: '13:30' });
  });
});

describe('toasts', () => {
  it('says how long the break was, and how far over the allowance', () => {
    const ended = { startedAt: '2026-09-30T07:40:00.000Z', endedAt: '2026-09-30T08:05:30.000Z' };
    expect(breakEndedToast({ break: ended, overAllowanceMinutes: 0 })).toEqual({
      title: 'Break ended · 25m',
      body: undefined,
    });
    expect(breakEndedToast({ break: ended, overAllowanceMinutes: 15 }).body).toBe(
      'Over your daily allowance by 15m',
    );
    const short = { startedAt: ended.startedAt, endedAt: '2026-09-30T07:40:20.000Z' };
    expect(breakEndedToast({ break: short }).title).toBe('Break ended · 0m');
  });

  it('mentions worked time on check-out when there were breaks', () => {
    const base = { presentMinutes: 480, loggedMinutes: 0, gapWarning: false, reportPending: true };
    expect(checkOutBody({ ...base, workedMinutes: 435, breakMinutes: 45 })).toBe(
      "You worked 7h 15m (45m of breaks). Don't forget today's report.",
    );
    expect(checkOutBody({ ...base, workedMinutes: 480, breakMinutes: 0 })).toBe(
      "Don't forget today's report.",
    );
    expect(
      checkOutBody({ ...base, reportPending: false, workedMinutes: 480, breakMinutes: 0 }),
    ).toBeUndefined();
  });

  it('compares worked time with logged hours in the gap warning', () => {
    const data = {
      presentMinutes: 480,
      workedMinutes: 435,
      breakMinutes: 45,
      loggedMinutes: 300,
      gapWarning: true,
      reportPending: true,
    };
    expect(checkOutBody(data)).toBe(
      'You worked 7h 15m (45m of breaks) and logged 5h. Add any missing hours, then submit your report.',
    );
    expect(
      checkOutBody({ ...data, workedMinutes: 480, breakMinutes: 0, reportPending: false }),
    ).toBe('You were here 8h and logged 5h. Add any missing hours to your report.');
  });
});
