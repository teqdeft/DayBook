// My tasks' pure view (CONTRACT 28, My tasks: sidebar, page and home cards; Tests, M): `whenOf` for
// overdue, today, the rest of the week up to Sunday, later and no date, and on a Sunday (nothing
// is "This week", Monday is "Later"); the groups in order with the empty ones left out; by project
// A to Z; the project select and the search ("#61", "61", a title); the home card's first 6 rows
// under their group headings with "2 more"; and the tick's hold (a ticked row keeps its place until
// it leaves, a left row stays out until the page stops listing it). mineTick.test.js has the tick
// itself and where the focus goes.
import { describe, expect, it } from 'vitest';
import {
  ALL_PROJECTS,
  WHEN_GROUPS,
  cardRows,
  filterMine,
  groupByProject,
  groupByWhen,
  groupsFor,
  mineOrder,
  phaseName,
  projectChoices,
  searchMatches,
  whenOf,
  withTicks,
} from '@/app/(app)/my-tasks/myTasksView.js';
import { backTick, holdTick, leftTick, listedTick } from '@/app/(app)/my-tasks/useMineTick.js';

const WEDNESDAY = '2026-11-25'; // the company's week: Monday 23 to Sunday 29 November
const SUNDAY = '2026-11-29';

const ACME = { id: 12, name: 'acme-store', color: 'green', status: 'active' };
const TOOL = { id: 4, name: 'internal-tool', color: 'violet', status: 'active' };
const WELL = { id: 7, name: 'iwilltillimwell', color: 'orange', status: 'on_hold' };

const task = (id, title, dueDate, extra = {}) => ({
  id,
  title,
  priority: 'p2',
  phase: 'testing',
  dueDate,
  project: ACME,
  canManage: true,
  fileCount: 0,
  ...extra,
});

/** The prototype's eight tasks, in listMine's order (due date, none last, then P1 to P3). */
const MINE = [
  task(34, 'Get the payment gateway keys from Acme', '2026-11-19', { priority: 'p1' }),
  task(61, 'Check the homepage text', WEDNESDAY, { priority: 'p1', project: WELL }),
  task(37, 'Write the test plan', '2026-11-27'),
  task(39, 'Acme testing round', '2026-12-10', { priority: 'p1' }),
  task(64, 'Client review of the site', '2026-12-10', { project: WELL }),
  task(72, 'HR tries the leave form', '2026-12-14', { project: TOOL }),
  task(75, 'Release to the whole company', '2026-12-25', { priority: 'p1', project: TOOL }),
  task(77, 'Plan the January support rota', null, { priority: 'p3', project: TOOL }),
];

const summary = (groups) => groups.map((group) => [group.label, group.tasks.map((t) => t.id)]);

describe('whenOf', () => {
  it('says overdue, today, this week up to Sunday, later and no date', () => {
    expect(whenOf('2026-11-24', WEDNESDAY)).toBe('overdue');
    expect(whenOf('2026-10-01', WEDNESDAY)).toBe('overdue');
    expect(whenOf(WEDNESDAY, WEDNESDAY)).toBe('today');
    expect(whenOf('2026-11-26', WEDNESDAY)).toBe('week');
    expect(whenOf('2026-11-29', WEDNESDAY)).toBe('week');
    expect(whenOf('2026-11-30', WEDNESDAY)).toBe('later');
    expect(whenOf(null, WEDNESDAY)).toBe('none');
    expect(whenOf(undefined, WEDNESDAY)).toBe('none');
  });

  it('on a Sunday has no "This week": Monday is Later', () => {
    expect(whenOf('2026-11-28', SUNDAY)).toBe('overdue');
    expect(whenOf(SUNDAY, SUNDAY)).toBe('today');
    expect(whenOf('2026-11-30', SUNDAY)).toBe('later');
    expect(groupByWhen(MINE, SUNDAY).map((group) => group.key)).not.toContain('week');
  });

  it('on a Monday counts the whole week to Sunday', () => {
    expect(whenOf('2026-11-29', '2026-11-23')).toBe('week');
    expect(whenOf('2026-11-30', '2026-11-23')).toBe('later');
  });
});

describe('the groups', () => {
  it('come in order, Overdue in red, keeping the order given', () => {
    const groups = groupByWhen(MINE, WEDNESDAY);
    expect(summary(groups)).toEqual([
      ['Overdue', [34]],
      ['Today', [61]],
      ['This week', [37]],
      ['Later', [39, 64, 72, 75]],
      ['No date', [77]],
    ]);
    expect(groups.map((group) => group.tone)).toEqual(['red', null, null, null, null]);
    expect(WHEN_GROUPS.map((group) => group.label)).toEqual([
      'Overdue',
      'Today',
      'This week',
      'Later',
      'No date',
    ]);
  });

  it('leave out a group with nothing', () => {
    const groups = groupByWhen([MINE[2], MINE[7]], WEDNESDAY);
    expect(groups.map((group) => group.label)).toEqual(['This week', 'No date']);
    expect(groupByWhen([], WEDNESDAY)).toEqual([]);
  });

  it('by project go A to Z, each by date', () => {
    expect(summary(groupByProject(MINE))).toEqual([
      ['acme-store', [34, 37, 39]],
      ['internal-tool', [72, 75, 77]],
      ['iwilltillimwell', [61, 64]],
    ]);
    expect(summary(groupsFor(MINE, { by: 'project', today: WEDNESDAY }))[0][0]).toBe('acme-store');
    expect(summary(groupsFor(MINE, { by: 'when', today: WEDNESDAY }))[0][0]).toBe('Overdue');
  });
});

describe('the project select and the search', () => {
  it('offer All projects, then the projects of my tasks A to Z', () => {
    expect(projectChoices(MINE)).toEqual([
      { value: ALL_PROJECTS, label: 'All projects' },
      { value: '12', label: 'acme-store' },
      { value: '4', label: 'internal-tool' },
      { value: '7', label: 'iwilltillimwell' },
    ]);
  });

  it('keep one project, a title, "#61" and "61"', () => {
    const ids = (filters) => filterMine(MINE, filters).map((one) => one.id);
    expect(ids({ projectId: '4' })).toEqual([72, 75, 77]);
    expect(ids({ query: 'TEST' })).toEqual([37, 39]);
    expect(ids({ query: '#61' })).toEqual([61]);
    expect(ids({ query: '61' })).toEqual([61]);
    expect(ids({ query: '#6' })).toEqual([]);
    expect(ids({ projectId: '12', query: 'plan' })).toEqual([37]);
    expect(ids({ projectId: ALL_PROJECTS, query: '  ' })).toHaveLength(8);
    expect(searchMatches({ id: 404, title: 'Fix the 404 page' }, '404')).toBe(true);
    expect(searchMatches({ id: 9, title: 'Fix the 404 page' }, '#404')).toBe(false);
  });
});

describe("the home card's rows", () => {
  it('are the first 6 by date under their headings, each heading counting its group', () => {
    const { groups, total, more } = cardRows(MINE, 6, WEDNESDAY);
    expect(groups.map((group) => [group.label, group.count, group.tasks.length])).toEqual([
      ['Overdue', 1, 1],
      ['Today', 1, 1],
      ['This week', 1, 1],
      ['Later', 4, 3],
    ]);
    expect(total).toBe(8);
    expect(more).toBe(2);
  });

  it('show every task when there are 6 or fewer, with nothing more', () => {
    const { groups, more } = cardRows(MINE.slice(0, 2), 6, WEDNESDAY);
    expect(groups.map((group) => group.label)).toEqual(['Overdue', 'Today']);
    expect(more).toBe(0);
    expect(cardRows([], 6, WEDNESDAY)).toEqual({ groups: [], total: 0, more: 0 });
  });

  it('name a phase, or "No phase yet"', () => {
    expect(phaseName('testing')).toBe('Testing');
    expect(phaseName(null)).toBe('No phase yet');
  });
});

describe('the tick hold', () => {
  const none = { held: new Map(), gone: new Set() };

  it('changes nothing without a tick', () => {
    expect(withTicks(MINE, none)).toBe(MINE);
  });

  it('keeps a ticked row in its place, ticked, while the refresh leaves it out', () => {
    const without = MINE.filter((one) => one.id !== 39);
    const rows = withTicks(without, { held: new Map([[39, MINE[3]]]), gone: new Set() });
    expect(rows.map((one) => one.id)).toEqual(MINE.map((one) => one.id));
    expect(rows.find((one) => one.id === 39).ticking).toBe(true);
    expect(rows.filter((one) => one.ticking)).toHaveLength(1);
  });

  it('marks a ticked row still listed, and hides a row that left', () => {
    const rows = withTicks(MINE, { held: new Map([[34, MINE[0]]]), gone: new Set([77]) });
    expect(rows[0]).toMatchObject({ id: 34, ticking: true });
    expect(rows.map((one) => one.id)).not.toContain(77);
  });

  it("puts a held row back by listMine's order: due date, none last, P1 first, then older", () => {
    expect([MINE[7], MINE[3], MINE[0]].sort(mineOrder).map((one) => one.id)).toEqual([34, 39, 77]);
    const sameDay = [task(5, 'B', '2026-12-10'), task(3, 'A', '2026-12-10', { priority: 'p1' })];
    expect(sameDay.sort(mineOrder).map((one) => one.id)).toEqual([3, 5]);
  });
});

describe("the tick's state, through a refresh and an Undo", () => {
  const start = (tasks) => ({
    held: new Map(),
    gone: new Set(),
    open: new Set(),
    listed: tasks,
  });
  const shownIds = (state, tasks) => withTicks(tasks, state).map((one) => one.id);
  const done = MINE.filter((one) => one.id !== 34); // the refresh after the tick

  it('the refresh lands before the leave: the row is held, then simply gone', () => {
    let state = holdTick(start(MINE), MINE[0]);
    state = listedTick(state, done);
    expect(shownIds(state, done)[0]).toBe(34); // held in its place
    state = leftTick(state, 34);
    expect(state.gone.has(34)).toBe(false); // the page already left it out
    expect(shownIds(state, done)).not.toContain(34);
    // Undo reopens it: the next refresh lists it again, and it shows.
    state = listedTick(state, MINE);
    expect(shownIds(state, MINE)[0]).toBe(34);
  });

  it('the leave comes first: the row stays hidden until the refresh, then until an Undo', () => {
    let state = leftTick(holdTick(start(MINE), MINE[0]), 34);
    expect(state.gone.has(34)).toBe(true);
    expect(shownIds(state, MINE)).not.toContain(34);
    state = listedTick(state, done);
    expect(state.gone.size).toBe(0);
    state = listedTick(state, MINE);
    expect(shownIds(state, MINE)).toContain(34);
  });

  it('unticking, or a failed save, puts the row back as it was', () => {
    const state = backTick(holdTick(start(MINE), MINE[0]), 34);
    expect(withTicks(MINE, state)).toEqual(MINE);
    expect(shownIds(backTick(leftTick(holdTick(start(MINE), MINE[0]), 34), 34), MINE)).toContain(
      34,
    );
  });
});
