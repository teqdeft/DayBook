// "Fill report from timers" and the required-mode hours on the Daily report (CONTRACT 15): the
// pure merge of a day's timer summary into the editor rows.
import { describe, expect, it } from 'vitest';
import { entriesFromView, newEntry, serialize } from '@/app/(app)/report/reportState';
import {
  clearTimerErrors,
  hoursComeFromTimers,
  hoursFromMinutes,
  mergeTimerSummary,
  mergeTimerTasks,
  timerCardRows,
  timerHoursFor,
  timersChangedSince,
} from '@/app/(app)/report/reportTimers';

function view(entries) {
  return {
    entries: entries.map((entry, i) => ({
      id: 100 + i,
      projectId: null,
      projectRequestId: null,
      projectName: 'project',
      projectColor: 'blue',
      isUrgent: false,
      waitingForApproval: false,
      hours: 0,
      ...entry,
      tasks: (entry.tasks ?? []).map((task, j) => ({
        id: 1000 + i * 10 + j,
        status: 'in_progress',
        carriedFromTaskId: null,
        projectTaskId: null,
        ...task,
      })),
    })),
  };
}

function project(projectId, roundedMinutes, tasks = [], rest = {}) {
  return {
    projectId,
    projectName: `project-${projectId}`,
    projectColor: 'green',
    isUrgent: false,
    minutes: roundedMinutes,
    roundedMinutes,
    tasks,
    ...rest,
  };
}

function note(text) {
  return { note: text, projectTaskId: null, priority: null, projectTaskTitle: null };
}

function linked(projectTaskId, title, text = title) {
  return { note: text, projectTaskId, priority: 'p1', projectTaskTitle: title };
}

const titles = (entry) => entry.tasks.map((task) => task.title);

describe('mergeTimerSummary', () => {
  it('changes nothing without timer time', () => {
    const entries = entriesFromView(view([{ projectId: 1, hours: 2, tasks: [{ title: 'A' }] }]));
    expect(mergeTimerSummary(entries, null)).toBe(entries);
    expect(mergeTimerSummary(entries, { projects: [] })).toBe(entries);
    expect(mergeTimerSummary(entries, { projects: [project(1, 0, [note('B')])] })).toBe(entries);
  });

  it('sets the rounded timer hours on the matching card and keeps the card', () => {
    const entries = entriesFromView(
      view([{ projectId: 7, hours: 1, tasks: [{ title: 'Login' }] }]),
    );
    const [card] = mergeTimerSummary(entries, { projects: [project(7, 150)] });
    expect(card).toMatchObject({ key: entries[0].key, id: 100, hours: '2.5', savedHours: 2.5 });
    expect(card.tasks).toBe(entries[0].tasks);
  });

  it('matches cards by project, never a project request with the same number', () => {
    const entries = entriesFromView(
      view([{ projectRequestId: 7, projectName: 'acme-blog', hours: 3, tasks: [{ title: 'X' }] }]),
    );
    const next = mergeTimerSummary(entries, { projects: [project(7, 60)] });
    expect(next[0]).toBe(entries[0]);
    expect(next[1]).toMatchObject({ projectId: 7, projectRequestId: null, hours: '1' });
  });

  it('adds missing task lines as In progress, carrying the priority task', () => {
    const entries = entriesFromView(
      view([{ projectId: 7, hours: 2, tasks: [{ title: 'Login page', status: 'done' }] }]),
    );
    const [card] = mergeTimerSummary(entries, {
      projects: [project(7, 120, [note('Fix the build'), linked(55, 'Checkout bug')])],
    });
    expect(card.hours).toBe('2');
    expect(card.tasks[0]).toBe(entries[0].tasks[0]);
    expect(card.tasks.slice(1)).toMatchObject([
      {
        id: null,
        title: 'Fix the build',
        status: 'in_progress',
        carried: false,
        projectTaskId: null,
      },
      {
        id: null,
        title: 'Checkout bug',
        status: 'in_progress',
        projectTaskId: 55,
        priority: 'p1',
        projectTaskTitle: 'Checkout bug',
      },
    ]);
  });

  it('matches lines by priority task first, else by title in any case and spacing', () => {
    const entries = entriesFromView(
      view([
        {
          projectId: 7,
          hours: 2,
          tasks: [
            { title: 'Payment flow', projectTaskId: 55, priority: 'p2', projectTaskTitle: 'Pay' },
            { title: 'Login page' },
          ],
        },
      ]),
    );
    const next = mergeTimerSummary(entries, {
      projects: [project(7, 120, [linked(55, 'Pay', 'Other words'), note('  LOGIN page ')])],
    });
    expect(next).toBe(entries);
  });

  it('counts a linked timer line as there when an unlinked line has its title', () => {
    const entries = entriesFromView(view([{ projectId: 7, hours: 1, tasks: [{ title: 'Pay' }] }]));
    const [card] = mergeTimerSummary(entries, { projects: [project(7, 60, [linked(55, 'pay')])] });
    expect(titles(card)).toEqual(['Pay']);
  });

  it('replaces the lone empty line of a card, keeping its key and id', () => {
    const entries = entriesFromView(view([{ projectId: 7, hours: 0, tasks: [{ title: '' }] }]));
    const [card] = mergeTimerSummary(entries, {
      projects: [project(7, 45, [note('Homepage fixes'), note('Footer')])],
    });
    expect(card.tasks).toHaveLength(2);
    expect(card.tasks[0]).toMatchObject({
      key: entries[0].tasks[0].key,
      id: 1000,
      title: 'Homepage fixes',
      status: 'in_progress',
    });
    expect(card.tasks[1]).toMatchObject({ id: null, title: 'Footer' });
    expect(card.hours).toBe('0.75');
  });

  it('keeps an empty line that is not alone, or that is linked, and never removes lines', () => {
    const entries = entriesFromView(
      view([
        { projectId: 7, hours: 1, tasks: [{ title: 'Kept' }, { title: '' }] },
        {
          projectId: 8,
          hours: 1,
          tasks: [{ title: '', projectTaskId: 9, priority: 'p3', projectTaskTitle: 'Nine' }],
        },
      ]),
    );
    const [first, second] = mergeTimerSummary(entries, {
      projects: [project(7, 60, [note('New')]), project(8, 60, [note('Other')])],
    });
    expect(titles(first)).toEqual(['Kept', '', 'New']);
    expect(titles(second)).toEqual(['', 'Other']);
    expect(second.tasks[0].projectTaskId).toBe(9);
  });

  it('leaves cards without timer time alone and skips projects rounded to 0', () => {
    const entries = entriesFromView(
      view([
        { projectId: 1, hours: 3, tasks: [{ title: 'Typed by hand' }] },
        { projectId: 2, hours: 2, tasks: [{ title: 'Short' }] },
      ]),
    );
    const next = mergeTimerSummary(entries, {
      projects: [project(3, 60, [note('Timed')]), project(2, 0, [note('Too short')])],
    });
    expect(next.slice(0, 2)).toEqual(entries);
    expect(next[0]).toBe(entries[0]);
    expect(next[1]).toBe(entries[1]);
    expect(next).toHaveLength(3);
  });

  it('adds missing projects at the end in the summary order', () => {
    const entries = entriesFromView(view([{ projectId: 1, hours: 1, tasks: [{ title: 'A' }] }]));
    const next = mergeTimerSummary(entries, {
      projects: [
        project(5, 240, [note('Big one')], {
          projectName: 'acme-app',
          projectColor: 'orange',
          isUrgent: true,
        }),
        project(1, 60),
        project(6, 30),
      ],
    });
    expect(next[0]).toBe(entries[0]);
    expect(next.slice(1)).toMatchObject([
      {
        id: null,
        projectId: 5,
        projectRequestId: null,
        projectName: 'acme-app',
        projectColor: 'orange',
        isUrgent: true,
        waitingForApproval: false,
        hours: '4',
        savedHours: 4,
      },
      { projectId: 6, projectName: 'project-6', isUrgent: false, hours: '0.5' },
    ]);
    expect(titles(next[1])).toEqual(['Big one']);
    // A timed project without notes gets one empty line to type in.
    expect(titles(next[2])).toEqual(['']);
    expect(next[1].key).not.toBe(next[2].key);
  });

  it('fills only the first card of a project shown twice', () => {
    const entries = entriesFromView(
      view([
        { projectId: 7, hours: 1, tasks: [{ title: 'One' }] },
        { projectId: 7, hours: 1, tasks: [{ title: 'Two' }] },
      ]),
    );
    const next = mergeTimerSummary(entries, { projects: [project(7, 90, [note('Three')])] });
    expect(titles(next[0])).toEqual(['One', 'Three']);
    expect(next[1]).toBe(entries[1]);
    expect(next).toHaveLength(2);
  });

  it('skips timer lines without any title', () => {
    const entries = entriesFromView(view([{ projectId: 7, hours: 1, tasks: [{ title: 'A' }] }]));
    const blank = { note: null, projectTaskId: null, priority: null, projectTaskTitle: null };
    const [card] = mergeTimerSummary(entries, { projects: [project(7, 60, [blank])] });
    expect(card).toBe(entries[0]);
  });

  it('is idempotent: a second fill changes nothing', () => {
    const summary = {
      projects: [project(7, 75, [note('Login'), linked(3, 'Bug')]), project(8, 30, [note('X')])],
    };
    const entries = entriesFromView(view([{ projectId: 7, hours: 0, tasks: [{ title: '' }] }]));
    const once = mergeTimerSummary(entries, summary);
    expect(mergeTimerSummary(once, summary)).toBe(once);
  });

  it('treats hours typed differently but equal as already right', () => {
    const entries = entriesFromView(view([{ projectId: 7, hours: 2.5, tasks: [{ title: 'A' }] }]));
    entries[0].hours = '2.50';
    expect(mergeTimerSummary(entries, { projects: [project(7, 150)] })).toBe(entries);
    entries[0].hours = 'abc';
    expect(mergeTimerSummary(entries, { projects: [project(7, 150)] })[0].hours).toBe('2.5');
  });

  it('serializes the filled rows for the save, links included', () => {
    const entries = entriesFromView(view([{ projectId: 7, hours: 0, tasks: [{ title: '' }] }]));
    const next = mergeTimerSummary(entries, {
      projects: [project(7, 105, [linked(55, 'Checkout bug')]), project(9, 15, [note('Call')])],
    });
    expect(serialize(next).body).toEqual([
      {
        id: 100,
        projectId: 7,
        projectRequestId: undefined,
        hours: 1.75,
        tasks: [{ id: 1000, title: 'Checkout bug', status: 'in_progress', projectTaskId: 55 }],
      },
      {
        id: undefined,
        projectId: 9,
        projectRequestId: undefined,
        hours: 0.25,
        tasks: [{ id: undefined, title: 'Call', status: 'in_progress', projectTaskId: undefined }],
      },
    ]);
  });
});

describe('mergeTimerSummary with hoursOnly (required mode, on load)', () => {
  it('only changes the hours of cards already in the report', () => {
    const entries = entriesFromView(
      view([
        { projectId: 7, hours: 1, tasks: [{ title: '' }] },
        { projectId: 8, hours: 2, tasks: [{ title: 'B' }] },
      ]),
    );
    const next = mergeTimerSummary(
      entries,
      { projects: [project(7, 90, [note('New line')]), project(9, 60), project(8, 0)] },
      { hoursOnly: true },
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ hours: '1.5', savedHours: 1.5 });
    expect(next[0].tasks).toBe(entries[0].tasks);
    expect(next[1]).toBe(entries[1]);
  });

  it('returns the same rows when the hours already match', () => {
    const entries = entriesFromView(view([{ projectId: 7, hours: 1.5, tasks: [{ title: 'A' }] }]));
    const summary = { projects: [project(7, 90, [note('Other')]), project(9, 60)] };
    expect(mergeTimerSummary(entries, summary, { hoursOnly: true })).toBe(entries);
  });
});

describe('mergeTimerTasks', () => {
  it('returns the same lines when every timer line is there', () => {
    const lines = entriesFromView(view([{ projectId: 1, tasks: [{ title: 'Same' }] }]))[0].tasks;
    expect(mergeTimerTasks(lines, [note('same')])).toBe(lines);
    expect(mergeTimerTasks(lines, undefined)).toBe(lines);
  });

  it('uses the priority task title when a linked line has no note', () => {
    const lines = newEntry({ projectId: 1, name: 'x' }).tasks;
    const [line] = mergeTimerTasks(lines, [
      { note: null, projectTaskId: 4, priority: 'p2', projectTaskTitle: 'From the task' },
    ]);
    expect(line).toMatchObject({ title: 'From the task', projectTaskId: 4, priority: 'p2' });
  });
});

describe('required-mode hours', () => {
  const summary = { projects: [project(7, 135), project(8, 0)] };

  it('only applies where the server checks the hours (required mode, a checked day)', () => {
    expect(hoursComeFromTimers({ mode: 'required', required: true, summary })).toBe(true);
    expect(hoursComeFromTimers({ mode: 'optional', required: false, summary })).toBe(false);
    expect(hoursComeFromTimers(null)).toBe(false);
  });

  it('leaves typed hours on an earlier day nobody timed, even in required mode', () => {
    // What the page gets for yesterday's report before it locks, or a day opened by an edit
    // request: the server takes typed hours there, so the editor must let people type them.
    const untimed = { mode: 'required', required: false, summary: { projects: [] } };
    expect(hoursComeFromTimers(untimed)).toBe(false);
    expect(timerHoursFor(untimed, { projectId: 7 })).toBeNull();
    const rows = entriesFromView(view([{ projectId: 7, hours: 3, tasks: [{ title: 'A' }] }]));
    expect(timersChangedSince(rows, untimed)).toBe(false);
  });

  it("gives a picked project its timer hours, '' without any", () => {
    const timers = { mode: 'required', required: true, summary };
    expect(timerHoursFor(timers, { projectId: 7 })).toEqual({ hours: '2.25', savedHours: 2.25 });
    expect(timerHoursFor(timers, { projectId: 8 })).toEqual({ hours: '', savedHours: 0 });
    expect(timerHoursFor(timers, { projectId: 99 })).toEqual({ hours: '', savedHours: 0 });
  });

  it('leaves project requests and optional mode alone', () => {
    const required = { mode: 'required', required: true, summary };
    expect(timerHoursFor(required, { projectRequestId: 3 })).toBeNull();
    expect(
      timerHoursFor({ mode: 'optional', required: false, summary }, { projectId: 7 }),
    ).toBeNull();
    expect(timerHoursFor(null, { projectId: 7 })).toBeNull();
  });

  it('turns minutes into the hours a card shows', () => {
    expect(hoursFromMinutes(90)).toEqual({ hours: '1.5', savedHours: 1.5 });
    expect(hoursFromMinutes(0)).toEqual({ hours: '', savedHours: 0 });
  });
});

describe('timersChangedSince (a submitted report in required mode)', () => {
  const timers = (projects) => ({ mode: 'required', required: true, summary: { projects } });

  it('is false while every card has its timer hours and no timed project is missing', () => {
    const rows = entriesFromView(view([{ projectId: 7, hours: 2.25, tasks: [{ title: 'A' }] }]));
    expect(timersChangedSince(rows, timers([project(7, 135), project(8, 0)]))).toBe(false);
  });

  it('is true once a running timer moved a card past a quarter hour', () => {
    const rows = entriesFromView(view([{ projectId: 7, hours: 2.25, tasks: [{ title: 'A' }] }]));
    expect(timersChangedSince(rows, timers([project(7, 150)]))).toBe(true);
  });

  it('is true when a project timed since is not in the report', () => {
    const rows = entriesFromView(view([{ projectId: 7, hours: 2.25, tasks: [{ title: 'A' }] }]));
    expect(timersChangedSince(rows, timers([project(7, 135), project(9, 30)]))).toBe(true);
  });

  it('is false in optional mode and without timers', () => {
    const rows = entriesFromView(view([{ projectId: 7, hours: 1, tasks: [{ title: 'A' }] }]));
    const optional = {
      mode: 'optional',
      required: false,
      summary: { projects: [project(7, 150)] },
    };
    expect(timersChangedSince(rows, optional)).toBe(false);
    expect(timersChangedSince(rows, null)).toBe(false);
  });
});

describe('timerCardRows', () => {
  it('lists each timed project with its notes and the rounded total', () => {
    const timers = {
      mode: 'optional',
      summary: {
        projects: [
          project(1, 150, [note('Login page'), linked(5, 'Bug', 'Bug fix')]),
          project(2, 0),
        ],
      },
    };
    expect(timerCardRows(timers)).toEqual({
      rows: [
        {
          projectId: 1,
          projectName: 'project-1',
          projectColor: 'green',
          roundedMinutes: 150,
          notes: 'Login page, Bug fix',
        },
        {
          projectId: 2,
          projectName: 'project-2',
          projectColor: 'green',
          roundedMinutes: 0,
          notes: '',
        },
      ],
      totalMinutes: 150,
    });
  });

  it('is empty when nothing was tracked', () => {
    expect(timerCardRows(null)).toEqual({ rows: [], totalMinutes: 0 });
    expect(timerCardRows({ mode: 'optional', summary: { projects: [] } }).rows).toEqual([]);
  });
});

describe('clearTimerErrors', () => {
  it('drops hours and report-wide errors and keeps task errors', () => {
    const errors = {
      general: ['acme-app has 1h 30m on your timers. Fill the report from timers.'],
      entries: { e1: { hours: 'Hours come from your timers (2h).', project: 'Pick one.' } },
      tasks: { t1: 'Write at least 2 characters.' },
    };
    expect(clearTimerErrors(errors)).toEqual({
      general: [],
      entries: { e1: { project: 'Pick one.' } },
      tasks: { t1: 'Write at least 2 characters.' },
    });
  });
});
