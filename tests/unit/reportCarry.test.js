// Unfinished-task suggestions in the report editor (CONTRACT 24, reportCarry.js, reportPlanned.js
// and reportState.js): a suggestion disappears once a line is carried from it, repeats its title on
// its project or is closed; "Add to today" makes a carried line keeping its status; a typed title
// equal to a suggestion's makes the line carried (a saved draft line as a new row, given back its
// id if the title moves on before the save); new lines send carriedFromTaskId; a carry the server
// refused is dropped; the reminder line and the dialog's groups; planned projects leave the Slack
// preview and get the note and the notice.
import { describe, expect, it } from 'vitest';
import { formatReport } from '@/modules/slack/format';
import { isPlannedEntry } from '@/modules/reports/planned';
import { saveReportSchema } from '@/modules/reports/schemas';
import {
  carriedTask,
  claimedTaskIds,
  linkTypedTitles,
  openCounts,
  openSuggestions,
  pickOf,
  pickerIndex,
  reminderItems,
  suggestionGroups,
  withCarriedTasks,
  withRestored,
} from '@/app/(app)/report/reportCarry';
import { isPlannedRow, showsHoursNotice, showsPlannedNote } from '@/app/(app)/report/reportPlanned';
import {
  applySavedIds,
  entriesFromView,
  newEntry,
  newTask,
  previewEntries,
  serialize,
  unlinkTasks,
} from '@/app/(app)/report/reportState';

const item = (taskId, title, status = 'in_progress', workDate = '2026-11-11') => ({
  taskId,
  title,
  status,
  workDate,
  dayLabel: 'From yesterday',
});

const ALL = {
  p3: [
    item(31, 'Meta descriptions for the 12 service pages'),
    item(32, 'Fix broken links', 'blocked'),
  ],
  p5: [item(51, 'Analysing the gsc stats')],
  r4: [item(41, 'Kickoff notes')],
};

const PICKER = {
  urgent: [{ id: 9, name: 'Pine Tree Lane', color: 'green', isUrgent: true }],
  mine: [
    { id: 3, name: 'Acme booking app', color: 'orange', isUrgent: false },
    { id: 5, name: 'Studio Ubique', color: 'violet', isUrgent: false },
  ],
  others: [],
  requests: [{ requestId: 4, name: 'Riverkraft website' }],
};

/** An editor row for a project, with lines { title, status?, id?, ... }. */
function card(projectId, lines, hours = '') {
  const entry = newEntry({ projectId, name: `Project ${projectId}` });
  return {
    ...entry,
    hours,
    savedMinutes: 0,
    tasks: lines.map((line) => ({ ...newTask(line.status), ...line })),
  };
}

const retitle = (entries, taskKey, title) =>
  entries.map((entry) => ({
    ...entry,
    tasks: entry.tasks.map((task) => (task.key === taskKey ? { ...task, title } : task)),
  }));

describe('openSuggestions', () => {
  it('leaves out what a line carries, what a line on the project repeats and what was closed', () => {
    const rows = [
      card(3, [{ title: '  META descriptions for the 12   service pages ' }]),
      card(5, [{ title: 'Something else', carriedFromTaskId: 41 }]),
    ];
    expect(openSuggestions(ALL, rows)).toEqual({ p3: [ALL.p3[1]], p5: ALL.p5 });
    expect(openSuggestions(ALL, rows, new Set([32]))).toEqual({ p5: ALL.p5 });
    // The same title on another project hides nothing.
    expect(openSuggestions(ALL, [card(5, [{ title: 'Fix broken links' }])]).p3).toHaveLength(2);
    expect(openCounts(openSuggestions(ALL, []))).toEqual({ p3: 2, p5: 1, r4: 1 });
    expect(openSuggestions(undefined, rows)).toEqual({});
  });

  it('lists every carried task id', () => {
    const rows = [card(3, [{ title: 'A', carriedFromTaskId: 31 }, { title: 'B' }])];
    expect([...claimedTaskIds(rows)]).toEqual([31]);
  });
});

describe('Add to today', () => {
  it('makes a carried line that keeps the suggestion’s status', () => {
    expect(carriedTask(item(32, 'Fix broken links', 'blocked'))).toMatchObject({
      id: null,
      title: 'Fix broken links',
      status: 'blocked',
      carried: true,
      carriedFromTaskId: 32,
      projectTaskId: null,
    });
  });

  it('takes the place of the card’s blank rows and goes after its written lines', () => {
    const blank = newTask();
    const written = { ...newTask(), title: 'Kept' };
    const added = [carriedTask(ALL.p3[0]), carriedTask(ALL.p3[1])];
    const tasks = withCarriedTasks([written, blank], added);
    expect(tasks.map((task) => task.title)).toEqual([
      'Kept',
      'Meta descriptions for the 12 service pages',
      'Fix broken links',
    ]);
    expect(withCarriedTasks([blank], added.slice(0, 1))).toEqual(added.slice(0, 1));
  });

  it('sends carriedFromTaskId for new lines only, in a body the API accepts', () => {
    const rows = [card(3, [{ id: 7, title: 'Saved', carriedFromTaskId: 30 }])];
    rows[0].hours = '1h';
    rows[0].tasks.push(carriedTask(ALL.p3[0]));
    const { body } = serialize(rows);
    expect(body[0].tasks[0].carriedFromTaskId).toBeUndefined();
    expect(body[0].tasks[1].carriedFromTaskId).toBe(31);
    const parsed = saveReportSchema.parse({ entries: body });
    expect(parsed.entries[0].tasks[1].carriedFromTaskId).toBe(31);
  });

  it('reads the link back from the API and marks the line carried', () => {
    const [entry] = entriesFromView({
      entries: [
        {
          id: 1,
          projectId: 3,
          projectName: 'Acme',
          minutes: 0,
          tasks: [{ id: 9, title: 'X', status: 'in_progress', carriedFromTaskId: 31 }],
        },
      ],
    });
    expect(entry.tasks[0]).toMatchObject({ carried: true, carriedFromTaskId: 31 });
    expect(newTask()).toMatchObject({ carried: false, carriedFromTaskId: null });
  });
});

describe('linkTypedTitles', () => {
  it('carries a new line typed with a suggestion’s title, keeping the line’s own status', () => {
    const before = [card(3, [{ title: '', status: 'done' }])];
    const key = before[0].tasks[0].key;
    const after = retitle(before, key, 'fix BROKEN  links');
    const linked = linkTypedTitles(before, after, ALL);
    expect(linked[0].tasks[0]).toMatchObject({
      id: null,
      title: 'fix BROKEN  links',
      status: 'done',
      carried: true,
      carriedFromTaskId: 32,
    });
    expect(serialize(linked).body[0].tasks[0].carriedFromTaskId).toBe(32);
  });

  it('leaves lines that weren’t touched, closed suggestions and other projects alone', () => {
    const rows = [card(3, [{ id: 7, title: 'Fix broken links' }])];
    expect(linkTypedTitles(rows, [...rows], ALL, { reinsert: true })).toEqual(rows);
    const before = [card(3, [{ title: '' }])];
    const after = retitle(before, before[0].tasks[0].key, 'Fix broken links');
    expect(linkTypedTitles(before, after, ALL, { closed: new Set([32]) })).toBe(after);
    const elsewhere = [card(5, [{ title: '' }])];
    const typed = retitle(elsewhere, elsewhere[0].tasks[0].key, 'Fix broken links');
    expect(linkTypedTitles(elsewhere, typed, ALL)).toBe(typed);
    expect(linkTypedTitles(before, after, undefined)).toBe(after);
  });

  it('lets one line claim a suggestion, never two', () => {
    const before = [card(3, [{ title: '' }, { title: '' }])];
    const [a, b] = before[0].tasks;
    const after = retitle(retitle(before, a.key, 'Fix broken links'), b.key, 'Fix broken links');
    const linked = linkTypedTitles(before, after, ALL);
    expect(linked[0].tasks.map((task) => task.carriedFromTaskId)).toEqual([32, null]);
  });

  it('sends a saved draft line again as a new row, and gives its id back if the title moves on', () => {
    const before = [{ ...card(3, [{ id: 7, title: 'Fix broken' }]), id: 1 }];
    const key = before[0].tasks[0].key;
    const matched = linkTypedTitles(before, retitle(before, key, 'Fix broken links'), ALL, {
      reinsert: true,
    });
    expect(matched[0].tasks[0]).toMatchObject({ id: null, replacedId: 7, carriedFromTaskId: 32 });
    expect(serialize(matched).body[0].tasks[0]).toMatchObject({
      id: undefined,
      carriedFromTaskId: 32,
    });

    // A save that was already on its way with the old id doesn't give it back.
    const { keys } = serialize(before);
    const view = { entries: [{ id: 1, tasks: [{ id: 7, carriedFromTaskId: null }] }] };
    expect(applySavedIds(matched, keys, view)).toBe(matched);

    // The title moves on before the save: the line is its old self again.
    const moved = linkTypedTitles(matched, retitle(matched, key, 'Fix broken links today'), ALL, {
      reinsert: true,
    });
    expect(moved[0].tasks[0]).toMatchObject({ id: 7, carried: false, carriedFromTaskId: null });
    expect(moved[0].tasks[0]).not.toHaveProperty('replacedId');
  });

  it('never resends a saved line of a submitted report (no reinsert)', () => {
    const before = [card(3, [{ id: 7, title: 'Fix broken' }])];
    const after = retitle(before, before[0].tasks[0].key, 'Fix broken links');
    expect(linkTypedTitles(before, after, ALL)).toBe(after);
  });

  it('carries the lines of a card moved onto the suggestion’s project', () => {
    const before = [card(5, [{ title: 'Fix broken links' }])];
    const after = [{ ...before[0], projectId: 3 }];
    expect(linkTypedTitles(before, after, ALL)[0].tasks[0].carriedFromTaskId).toBe(32);
  });
});

describe('saving and moving carried lines', () => {
  it('drops a carry the save refused, keeps one it accepted', () => {
    const rows = [card(3, [{ title: 'A' }, { title: 'B' }])];
    rows[0].tasks = [carriedTask(ALL.p3[0]), carriedTask(ALL.p3[1])];
    const { keys } = serialize(rows);
    const view = {
      entries: [
        {
          id: 1,
          tasks: [
            { id: 10, carriedFromTaskId: 31 },
            { id: 11, carriedFromTaskId: null },
          ],
        },
      ],
    };
    const next = applySavedIds(rows, keys, view);
    expect(next[0].tasks[0]).toMatchObject({ id: 10, carried: true, carriedFromTaskId: 31 });
    expect(next[0].tasks[1]).toMatchObject({ id: 11, carried: false, carriedFromTaskId: null });
  });

  it('loses an unsaved carry when the card moves to another project, a saved one stays', () => {
    const unsaved = carriedTask(ALL.p3[0]);
    const saved = { ...carriedTask(ALL.p3[1]), id: 12 };
    const moved = unlinkTasks([unsaved, saved]);
    expect(moved[0]).toMatchObject({ carried: false, carriedFromTaskId: null });
    expect(moved[1]).toBe(saved);
  });
});

describe('the reminder line and the Still open dialog', () => {
  const index = pickerIndex(PICKER);

  it('groups the suggestions by project in their order, with what the picker knows', () => {
    const groups = suggestionGroups({ ...ALL, p77: [item(1, 'Gone')] }, index);
    expect(groups.map((group) => group.key)).toEqual(['p3', 'p5', 'r4']);
    expect(groups[0]).toMatchObject({
      project: { id: 3, name: 'Acme booking app', color: 'orange' },
    });
    expect(groups[2]).toMatchObject({ request: { id: 4, name: 'Riverkraft website' } });
    expect(pickOf(groups[0])).toEqual({
      projectId: 3,
      name: 'Acme booking app',
      color: 'orange',
      isUrgent: false,
    });
    expect(pickOf(groups[2])).toEqual({
      projectRequestId: 4,
      name: 'Riverkraft website',
      color: null,
    });
  });

  it('names each project not in the report with its count', () => {
    const groups = suggestionGroups(ALL, index);
    expect(reminderItems(groups, [card(5, [{ title: 'x' }])])).toEqual([
      { key: 'p3', label: 'Acme booking app (2)' },
      { key: 'r4', label: 'Riverkraft website (1)' },
    ]);
  });

  it('puts back a suggestion Undo restored after the page was read again, newest first', () => {
    const back = item(30, 'Older one', 'in_progress', '2026-11-12');
    const merged = withRestored(ALL, { p3: [back, ALL.p3[0]] });
    expect(merged.p3.map((one) => one.taskId)).toEqual([30, 31, 32]);
    expect(withRestored(ALL, {})).toBe(ALL);
  });
});

describe('planned projects', () => {
  const task = (title, status = 'in_progress') => ({ title, status });

  it('follows the server’s rule on the editor’s rows', () => {
    const rows = [
      card(1, [task('Plan')]),
      card(2, [task('Shipped', 'done')]),
      card(3, [task('Worked')], '1h 30m'),
      card(4, [task('  ', 'done')]),
      card(5, []),
    ];
    const server = rows.map((row) => ({ minutes: row.hours ? 90 : 0, tasks: row.tasks }));
    expect(rows.map(isPlannedRow)).toEqual(server.map(isPlannedEntry));
    expect(rows.map(isPlannedRow)).toEqual([true, false, false, true, true]);
    expect(rows.map(showsPlannedNote)).toEqual([true, false, false, false, false]);
  });

  it('leaves planned projects out of the Slack preview', () => {
    const rows = [
      card(1, [task('Monitoring google ads')], '2h'),
      card(2, [task('2 Web blog topic research')]),
    ];
    rows[0].projectName = 'Pine Tree Lane';
    rows[1].projectName = 'Dotado';
    const text = formatReport({
      userName: 'Priya Sharma',
      workDate: '2026-11-12',
      entries: previewEntries(rows),
    });
    expect(text).toContain('Project: Pine Tree Lane');
    expect(text).not.toContain('Dotado');
  });

  it('shows the notice while a draft has a line and a project at 0 minutes', () => {
    const planned = [card(1, [task('Plan')]), card(2, [task('Done', 'done')], '1h')];
    expect(showsHoursNotice(planned, 'draft')).toBe(true);
    expect(showsHoursNotice(planned, 'submitted')).toBe(false);
    expect(showsHoursNotice([card(1, [task('Worked')], '1h')], 'draft')).toBe(false);
    expect(showsHoursNotice([card(1, [task('')])], 'draft')).toBe(false);
  });
});
