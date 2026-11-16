// "Paste your to-do" (CONTRACT 24), pure: the owner's Slack list and the prototype's sample give 3
// projects and 5 tasks; a heading matched exactly, closely or not at all; Skip; Change; lines
// already in the to-do; a line equal to a suggestion ("From Wednesday", carried); "(Done)";
// tasks before any heading, also pasted into a project's "Add a task" (they go to it); what is
// left out; the button (counting tasks still waiting for a project) and the bulk body's plan.
import { describe, expect, it } from 'vitest';
import { pickables } from '@/app/(app)/today/todoModel';
import { SKIP, pasteModel, pastedText } from '@/app/(app)/today/todoPaste';

const PICKER = {
  urgent: [],
  mine: [
    { id: 3, name: 'Pine Tree Lane', color: 'green' },
    { id: 5, name: 'Studio Ubique', color: 'violet' },
    { id: 8, name: 'Dotado', color: 'orange' },
    { id: 9, name: 'Riverkraft', color: 'yellow' },
  ],
  others: [{ id: 12, name: 'Acme booking app', color: 'blue' }],
  requests: [],
};
const PICKABLES = pickables(PICKER);

const OWNER = `Name: Priya Sharma
Date: 12-11-2026
Project— Pine Tree lane
* Monitoring google ads campaign and removing irrelevant search terms
Project- Studioubique
* 1 web blog publish
* Analysing the gsc stats to improve web blog content
* 1 listicle content post on linkedin
Project: Dotado
* 2 Web blog topic research`;

// The prototype's ownerText() and paste2Text().
const PROTO_OWNER =
  'Project— Pine Tree lane\n\n* Monitoring google ads campaign and removing irrelevant search terms\n\nProject- Studioubique\n\n* 1 web blog publish\n* Analysing the gsc stats to improve web blog content\n* 1 listicle content post on linkedin\n\nProject— Dotado\n\n* 2 Web blog topic research';
const PASTE2 =
  'Project: Pine Tree lane\n* Monitoring google ads campaign and removing irrelevant search terms\n\nProject- Riverkraft website\n* Keyword list for the new service pages (Done)\n\nProject: Blue Harbour\n* 3 product descriptions\n\nProject— Dotado\n* 2 Web blog topic research\n* x';

// The prototype's "today-paste2": the to-do already has Pine Tree Lane's line.
const TODO_GROUPS = [
  {
    entryId: 1,
    project: { id: 3, name: 'Pine Tree Lane', color: 'green' },
    minutes: 0,
    lines: [
      { id: 11, title: 'Monitoring google ads campaign and removing irrelevant search terms' },
    ],
  },
];

const model = (text, extra = {}) =>
  pasteModel({ text, pickables: PICKABLES, groups: [], ...extra });

describe('the owner’s list', () => {
  it.each([
    ['the owner’s Slack format', OWNER],
    ['the prototype’s sample', PROTO_OWNER],
  ])('%s gives 3 projects and 5 tasks, all matched exactly', (_, text) => {
    const result = model(text);
    expect(result.summary).toBe('We found 3 projects and 5 tasks.');
    expect(result.groups.map((group) => [group.kind, group.target?.name, group.exactView])).toEqual(
      [
        ['exact', 'Pine Tree Lane', true],
        ['exact', 'Studio Ubique', true],
        ['exact', 'Dotado', true],
      ],
    );
    expect(result.groups.every((group) => group.note === null)).toBe(true);
    expect(result).toMatchObject({ fresh: 5, unresolved: false, disabled: false });
    expect(result.button).toBe('Add 5 tasks');
    expect(result.plan.map((entry) => [entry.target.key, entry.lines.length])).toEqual([
      ['p3', 1],
      ['p5', 3],
      ['p8', 1],
    ]);
    expect(result.plan[1].lines[0]).toEqual({
      title: '1 web blog publish',
      status: 'in_progress',
      carriedFrom: null,
    });
  });

  it('says how many were added', () => {
    expect(pastedText(5)).toBe('Added 5 tasks.');
    expect(pastedText(1)).toBe('Added 1 task.');
  });
});

describe('matching headings', () => {
  const second = () => model(PASTE2, { groups: TODO_GROUPS });

  it('shows an exact, a close and a missing project, and what is already in the to-do', () => {
    const result = second();
    const [pine, river, blue, dotado] = result.groups;
    expect(pine).toMatchObject({ kind: 'exact', exactView: true, note: null });
    expect(pine.lines[0]).toMatchObject({
      dup: true,
      tag: { text: 'Already in your to-do', tone: 'neutral' },
    });
    expect(river).toMatchObject({ kind: 'close', choice: 'p9', exactView: false, bad: false });
    expect(river.note).toEqual({ text: 'Matched from “Riverkraft website”', tone: 'muted' });
    expect(river.lines[0]).toMatchObject({
      title: 'Keyword list for the new service pages',
      tag: { text: 'Done', tone: 'green' },
    });
    expect(blue).toMatchObject({ kind: 'none', choice: '', bad: true });
    expect(blue.note).toEqual({ text: 'No project called “Blue Harbour”.', tone: 'red' });
    expect(dotado.lines.map((item) => item.title)).toEqual(['2 Web blog topic research']);
    expect(result.summary).toBe('We found 4 projects and 4 tasks.');
    expect(result.notes).toEqual(['1 line was too short or too long and left out.']);
    // Blue Harbour has no project yet: the button stays off, but counts its task already, as the
    // prototype's "today-paste2" draws it ("Add 3 tasks"), so the count doesn't jump on a pick.
    expect(result).toMatchObject({ fresh: 2, unresolved: true, disabled: true });
    expect(result.button).toBe('Add 3 tasks');
    expect(model(PASTE2, { groups: TODO_GROUPS, choices: { 2: 'p12' } }).button).toBe(
      'Add 3 tasks',
    );
  });

  it('skips a group, or takes the project picked for it', () => {
    const skipped = model(PASTE2, { groups: TODO_GROUPS, choices: { 2: SKIP } });
    expect(skipped.groups[2]).toMatchObject({ skip: true, bad: false });
    expect(skipped.groups[2].note).toEqual({ text: 'These tasks will be skipped.', tone: 'muted' });
    expect(skipped.groups[2].lines[0]).toMatchObject({ skip: true, tag: null });
    expect(skipped).toMatchObject({ fresh: 2, disabled: false, button: 'Add 2 tasks' });
    expect(skipped.plan[0].lines[0].status).toBe('done');

    const picked = model(PASTE2, { groups: TODO_GROUPS, choices: { 2: 'p12' } });
    expect(picked.groups[2].note).toBeNull();
    expect(picked.groups[2].target.name).toBe('Acme booking app');
    expect(picked).toMatchObject({ fresh: 3, disabled: false, button: 'Add 3 tasks' });
  });

  it('opens an exact match in the Select with Change, still set to it', () => {
    const result = model(OWNER, { changing: { 1: true } });
    expect(result.groups[1]).toMatchObject({ exactView: false, choice: 'p5', note: null });
  });

  it('needs a project for tasks before any heading', () => {
    const result = model('* Call the client\n* Fix the footer');
    expect(result.groups[0]).toMatchObject({ heading: null, bad: true });
    expect(result.groups[0].note).toEqual({ text: 'These tasks have no project.', tone: 'red' });
    expect(result.summary).toBe('We found 0 projects and 2 tasks.');
    expect(result.disabled).toBe(true);
    expect(result.button).toBe('Add 2 tasks');
    const placed = model('* Call the client\n* Fix the footer', { choices: { 0: 'p5' } });
    expect(placed.plan).toHaveLength(1);
    expect(placed.disabled).toBe(false);
  });

  it('counts a repeat once in a group with no project yet, and nothing in a skipped one', () => {
    const waiting = model('* Call the client\n* call the  client\n* Fix the footer');
    expect(waiting.groups[0].lines[1]).toMatchObject({
      dup: true,
      tag: { text: 'Already in your to-do', tone: 'neutral' },
    });
    expect(waiting).toMatchObject({ fresh: 0, disabled: true, button: 'Add 2 tasks' });
    const skipped = model('* Call the client\n* Fix the footer', { choices: { 0: SKIP } });
    expect(skipped).toMatchObject({ fresh: 0, disabled: true, button: 'Add tasks' });
  });
});

describe('pasted into a project’s "Add a task"', () => {
  const field = (text, extra = {}) => model(text, { fieldKey: 'p5', ...extra });

  it('puts the tasks before any heading on that project, shown with Change', () => {
    const result = field('* Audit the sitemap\n* Fix broken links\n* Redirect map for old URLs');
    expect(result.groups[0]).toMatchObject({
      heading: null,
      kind: 'exact',
      choice: 'p5',
      exactView: true,
      bad: false,
      note: null,
    });
    expect(result.groups[0].target.name).toBe('Studio Ubique');
    expect(result.summary).toBe('We found 1 project and 3 tasks.');
    expect(result).toMatchObject({ fresh: 3, disabled: false, button: 'Add 3 tasks' });
    expect(result.plan.map((entry) => [entry.target.key, entry.lines.length])).toEqual([['p5', 3]]);
  });

  it('keeps the project in the Select after Change, without the red note, and can move them', () => {
    const changed = field('* Audit the sitemap', { changing: { 0: true } });
    expect(changed.groups[0]).toMatchObject({ exactView: false, choice: 'p5', note: null });
    const moved = field('* Audit the sitemap', { choices: { 0: 'p8' } });
    expect(moved.plan[0].target.key).toBe('p8');
    expect(moved.groups[0].note).toBeNull();
    const skipped = field('* Audit the sitemap', { choices: { 0: SKIP } });
    expect(skipped.groups[0].note).toEqual({ text: 'These tasks will be skipped.', tone: 'muted' });
  });

  it('still reads the headings in the text, and skips what the project already has', () => {
    const studio = {
      entryId: 2,
      project: { id: 5, name: 'Studio Ubique', color: 'violet' },
      lines: [{ id: 21, title: '1 web blog publish' }],
    };
    const result = field(`* Audit the sitemap\n${OWNER}`, { groups: [studio] });
    expect(result.groups.map((group) => group.target?.key)).toEqual(['p5', 'p3', 'p5', 'p8']);
    expect(result.summary).toBe('We found 3 projects and 6 tasks.');
    expect(result.groups[2].lines[0]).toMatchObject({ title: '1 web blog publish', dup: true });
    expect(result.fresh).toBe(5);
  });

  it('is left out for a project that can no longer be picked', () => {
    const result = model('* Audit the sitemap', { fieldKey: 'p99' });
    expect(result.groups[0]).toMatchObject({ bad: true, choice: '' });
    expect(result.groups[0].note).toEqual({ text: 'These tasks have no project.', tone: 'red' });
  });
});

describe('what each line does', () => {
  it('carries a line equal to a suggestion and tags it with its day', () => {
    const suggestions = {
      p5: [
        {
          taskId: 41,
          title: 'Analysing the gsc stats to improve web blog content',
          status: 'blocked',
          workDate: '2026-11-11',
          dayLabel: 'From Wednesday',
        },
      ],
    };
    const result = model(OWNER, { suggestions });
    expect(result.groups[1].lines[1].tag).toEqual({ text: 'From Wednesday', tone: 'neutral' });
    expect(result.plan[1].lines[1]).toEqual({
      title: 'Analysing the gsc stats to improve web blog content',
      status: 'blocked',
      carriedFrom: { workDate: '2026-11-11', dayLabel: 'From Wednesday' },
    });
  });

  it('adds nothing when every line is already there, and repeats count once', () => {
    const result = model(
      'Project: Pine Tree Lane\n* Monitoring google ads campaign and removing irrelevant search terms',
      { groups: TODO_GROUPS },
    );
    expect(result).toMatchObject({ fresh: 0, disabled: true, button: 'Add tasks' });
    const twice = model('Project: Dotado\n* Same task\n* same  task');
    expect(twice.groups[0].lines[1].tag.text).toBe('Already in your to-do');
    expect(twice.fresh).toBe(1);
  });

  it('shows Blocked, and asks for tasks when there are none', () => {
    expect(
      model('Project: Dotado\n* Waiting on the client (Blocked)').groups[0].lines[0].tag,
    ).toEqual({ text: 'Blocked', tone: 'red' });
    expect(model('Project: Dotado').summary).toBe('No tasks yet. Start each task with * or •.');
    expect(model('   ').hasText).toBe(false);
  });

  it('says what the limits left out', () => {
    const lines = Array.from({ length: 52 }, (_, index) => `* Task number ${index + 1}`);
    const result = model(`Project: Dotado\n${lines.join('\n')}`);
    expect(result.notes).toEqual([
      '2 tasks were left out. A report can have up to 20 projects, each with up to 50 tasks.',
    ]);
    expect(result.fresh).toBe(50);
  });
});
