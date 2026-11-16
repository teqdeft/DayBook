// The pasted to-do (CONTRACT 24 "Paste a list"): parseTodoText, matchProject, the normalisers and
// dayLabel. Pure: no database.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  MAX_TASK_LENGTH,
  MAX_TASKS_PER_ENTRY,
  TASK_STATUSES,
} from '@/modules/reports/schemas';
import {
  TODO_LIMITS,
  dayLabel,
  matchProject,
  normalizeName,
  normalizeTitle,
  parseTodoText,
} from '@/modules/reports/todoText';
import { formatReport } from '@/modules/slack/format';

const PROJECTS = [
  { id: 1, name: 'Pine Tree Lane', color: 'green' },
  { id: 2, name: 'Studio Ubique', color: 'violet' },
  { id: 3, name: 'Dotado', color: 'orange' },
  { id: 4, name: 'Acme booking app', color: 'blue' },
  { id: 5, name: 'Riverkraft', color: 'yellow' },
  { id: 6, name: 'internal-tool', color: 'teal' },
];

/** The owner's own Slack post (12 Nov 2026). */
const OWNER_TEXT = [
  'Name: Priya Sharma',
  'Date: 12-11-2026',
  'Project— Pine Tree lane',
  '* Monitoring google ads campaign and removing irrelevant search terms',
  'Project- Studioubique',
  '* 1 web blog publish',
  '* Analysing the gsc stats to improve web blog content',
  '* 1 listicle content post on linkedin',
  'Project: Dotado',
  '* 2 Web blog topic research',
].join('\n');

/** The prototype's sample paste (todo-and-colours-prototype.html, ownerText). */
const PROTOTYPE_TEXT = [
  'Project— Pine Tree lane',
  '',
  '* Monitoring google ads campaign and removing irrelevant search terms',
  '',
  'Project- Studioubique',
  '',
  '* 1 web blog publish',
  '* Analysing the gsc stats to improve web blog content',
  '* 1 listicle content post on linkedin',
  '',
  'Project— Dotado',
  '',
  '* 2 Web blog topic research',
].join('\n');

/** The prototype's second sample (paste2Text): a close match, no match, a Done line and "x". */
const PROTOTYPE_TEXT_2 = [
  'Project: Pine Tree lane',
  '* Monitoring google ads campaign and removing irrelevant search terms',
  '',
  'Project- Riverkraft website',
  '* Keyword list for the new service pages (Done)',
  '',
  'Project: Blue Harbour',
  '* 3 product descriptions',
  '',
  'Project— Dotado',
  '* 2 Web blog topic research',
  '* x',
].join('\n');

const OWNER_GROUPS = [
  {
    heading: 'Pine Tree lane',
    lines: [
      {
        title: 'Monitoring google ads campaign and removing irrelevant search terms',
        status: 'in_progress',
      },
    ],
  },
  {
    heading: 'Studioubique',
    lines: [
      { title: '1 web blog publish', status: 'in_progress' },
      { title: 'Analysing the gsc stats to improve web blog content', status: 'in_progress' },
      { title: '1 listicle content post on linkedin', status: 'in_progress' },
    ],
  },
  { heading: 'Dotado', lines: [{ title: '2 Web blog topic research', status: 'in_progress' }] },
];

/** [heading, [titles]] per group. */
function shape(result) {
  return result.groups.map((group) => [group.heading, group.lines.map((line) => line.title)]);
}

function taskCount(result) {
  return result.groups.reduce((sum, group) => sum + group.lines.length, 0);
}

/** The matched project id and kind per group. */
function matches(result, projects = PROJECTS) {
  return result.groups.map((group) => {
    const match = matchProject(group.heading, projects);
    return [match.kind, match.project?.id ?? null];
  });
}

describe('parseTodoText: the owner and prototype texts', () => {
  it("reads the owner's Slack text as 3 projects and 5 tasks", () => {
    const result = parseTodoText(OWNER_TEXT, { projects: PROJECTS });
    expect(result).toEqual({
      groups: OWNER_GROUPS,
      loose: [],
      skipped: 0,
      overLimit: 0,
      truncated: false,
    });
    expect(taskCount(result)).toBe(5);
    expect(matches(result)).toEqual([
      ['exact', 1],
      ['exact', 2],
      ['exact', 3],
    ]);
  });

  it("reads the prototype's sample the same way", () => {
    const result = parseTodoText(PROTOTYPE_TEXT, { projects: PROJECTS });
    expect(result.groups).toEqual(OWNER_GROUPS);
    expect(result.skipped).toBe(0);
    expect(matches(result)).toEqual([
      ['exact', 1],
      ['exact', 2],
      ['exact', 3],
    ]);
  });

  it("reads the prototype's second sample: close, none, Done and a skipped line", () => {
    const result = parseTodoText(PROTOTYPE_TEXT_2, { projects: PROJECTS });
    expect(shape(result)).toEqual([
      ['Pine Tree lane', ['Monitoring google ads campaign and removing irrelevant search terms']],
      ['Riverkraft website', ['Keyword list for the new service pages']],
      ['Blue Harbour', ['3 product descriptions']],
      ['Dotado', ['2 Web blog topic research']],
    ]);
    expect(result.groups[1].lines[0].status).toBe('done');
    expect(result.skipped).toBe(1);
    expect(matches(result)).toEqual([
      ['exact', 1],
      ['close', 5],
      ['none', null],
      ['exact', 3],
    ]);
  });

  it("reads Daybook's own Slack report back into its projects, tasks and statuses", () => {
    const text = formatReport({
      userName: 'Priya Sharma',
      workDate: '2026-11-12',
      entries: [
        {
          projectName: 'Studio Ubique',
          minutes: 135,
          tasks: [
            { title: 'Content changes', status: 'done' },
            { title: 'Working on backend', status: 'in_progress' },
          ],
        },
        {
          projectName: 'internal-tool',
          minutes: 0,
          tasks: [{ title: 'Login', status: 'blocked' }],
        },
      ],
    });
    expect(parseTodoText(text).groups).toEqual([
      {
        heading: 'Studio Ubique',
        lines: [
          { title: 'Content changes', status: 'done' },
          { title: 'Working on backend', status: 'in_progress' },
        ],
      },
      { heading: 'internal-tool', lines: [{ title: 'Login', status: 'blocked' }] },
    ]);
  });
});

describe('parseTodoText: headings', () => {
  it('takes "Project" and an em dash, en dash, hyphen or colon as a heading', () => {
    const text = [
      'Project— Alpha',
      '* a1',
      'Project – Beta',
      '* b1',
      'Project-Gamma',
      '* c1',
      'Project : Delta:',
      '* d1',
      'PROJECT: Echo',
      '* e1',
    ].join('\n');
    expect(shape(parseTodoText(text))).toEqual([
      ['Alpha', ['a1']],
      ['Beta', ['b1']],
      ['Gamma', ['c1']],
      ['Delta', ['d1']],
      ['Echo', ['e1']],
    ]);
  });

  it('takes "Project" and a space as a heading only when the rest names a project exactly', () => {
    const text = [
      'Project Dotado',
      '* Research',
      'Project kickoff call with client',
      'Project Dota',
    ].join('\n');
    expect(shape(parseTodoText(text, { projects: PROJECTS }))).toEqual([
      ['Dotado', ['Research', 'Project kickoff call with client', 'Project Dota']],
    ]);
    expect(parseTodoText('Project Dotado\n* Research').loose).toEqual([
      { title: 'Project Dotado', status: 'in_progress' },
      { title: 'Research', status: 'in_progress' },
    ]);
  });

  it('takes a ":" line as a heading before the first heading or when it names a project', () => {
    const text = [
      'Pine Tree lane:',
      '* Ads',
      'Follow up with the client about:',
      '* Pricing',
      'Dotado:',
      '* Research',
      'Riverkraft website :',
      '* Keywords',
    ].join('\n');
    expect(shape(parseTodoText(text, { projects: PROJECTS }))).toEqual([
      ['Pine Tree lane', ['Ads', 'Follow up with the client about:', 'Pricing']],
      ['Dotado', ['Research']],
      ['Riverkraft website', ['Keywords']],
    ]);
    // Without the projects, only the first ":" line can be a heading.
    expect(shape(parseTodoText('Plan:\n* a1\nDotado:\n* b1'))).toEqual([
      ['Plan', ['a1', 'Dotado:', 'b1']],
    ]);
  });

  it('leaves out headings with no lines', () => {
    const text = 'Project: Alpha\nProject: Beta\n* b1\nProject: Gamma\n\n';
    expect(shape(parseTodoText(text))).toEqual([['Beta', ['b1']]]);
  });

  it('gives two groups, in order, for a heading written twice (as the prototype does)', () => {
    const text = 'Project: Dotado\n* a1\nProject: Pine Tree lane\n* b1\nProject: Dotado\n* c1';
    const result = parseTodoText(text, { projects: PROJECTS });
    expect(shape(result)).toEqual([
      ['Dotado', ['a1']],
      ['Pine Tree lane', ['b1']],
      ['Dotado', ['c1']],
    ]);
    expect(matches(result)).toEqual([
      ['exact', 3],
      ['exact', 1],
      ['exact', 3],
    ]);
  });
});

describe('parseTodoText: lines', () => {
  it('drops every bullet; a sign needs no space after it, a number does', () => {
    const signs = ['*', '•', '◦', '▪', '‣', '+', '-', '–', '—', '·'];
    const bullets = [...signs, '1.', '2)', '10.'];
    const titles = (lines) =>
      parseTodoText(['Project: Dotado', ...lines].join('\n')).groups[0].lines.map(
        (line) => line.title,
      );
    expect(titles(bullets.map((bullet) => `${bullet} Task`))).toEqual(bullets.map(() => 'Task'));
    expect(titles(signs.map((sign) => `${sign}Task`))).toEqual(signs.map(() => 'Task'));
    expect(titles(['1.Task', '2)Task'])).toEqual(['1.Task', '2)Task']);
  });

  it('drops the bullet of a nested line', () => {
    const result = parseTodoText('Project: Dotado\n* Main task\n    ◦ nested sub task');
    expect(shape(result)).toEqual([['Dotado', ['Main task', 'nested sub task']]]);
  });

  it('keeps numbers that are not bullets', () => {
    const text = [
      'Project: Dotado',
      '1.5h keyword audit',
      '2.0 launch checklist',
      '* 1 web blog publish',
      '1 web blog publish',
      '1. Write the intro',
      '2) Send the invoice',
    ].join('\n');
    expect(shape(parseTodoText(text))).toEqual([
      [
        'Dotado',
        [
          '1.5h keyword audit',
          '2.0 launch checklist',
          '1 web blog publish',
          '1 web blog publish',
          'Write the intro',
          'Send the invoice',
        ],
      ],
    ]);
  });

  it("ignores Daybook's own lines anywhere and the name line before the first heading", () => {
    const text = [
      'Name: Priya Sharma',
      'Date: 12-11-2026',
      "Today's to-do",
      'Tasks',
      'Project: Dotado',
      'Hours: 2h 15m',
      'Hours: 0h',
      'Hours: 15m',
      'Tasks',
      'Today’s to-do',
      'Date: 1-2-2026',
      'Name: Ravi',
      'Date: confirm launch date with client',
      'Date: 12/11/2026',
      '* Research',
    ].join('\n');
    const result = parseTodoText(text);
    expect(result.loose).toEqual([]);
    expect(shape(result)).toEqual([
      [
        'Dotado',
        ['Name: Ravi', 'Date: confirm launch date with client', 'Date: 12/11/2026', 'Research'],
      ],
    ]);
  });

  it('reads (Done), (In progress) and (Blocked) in any case, with spaces before them', () => {
    const text = [
      'Project: Dotado',
      '* Publish the blog (Done)',
      '* Publish the post (done)',
      '* Send it    (DONE)',
      '* Check it ( Done )',
      '* Fix the build (In progress)',
      '* Fix the tests (in-progress)',
      '* Wait for access (blocked)',
      '* Done is not a status here',
      '* (Done) first',
    ].join('\n');
    expect(parseTodoText(text).groups[0].lines).toEqual([
      { title: 'Publish the blog', status: 'done' },
      { title: 'Publish the post', status: 'done' },
      { title: 'Send it', status: 'done' },
      { title: 'Check it', status: 'done' },
      { title: 'Fix the build', status: 'in_progress' },
      { title: 'Fix the tests', status: 'in_progress' },
      { title: 'Wait for access', status: 'blocked' },
      { title: 'Done is not a status here', status: 'in_progress' },
      { title: '(Done) first', status: 'in_progress' },
    ]);
  });

  it('puts the tasks before any heading in loose', () => {
    const result = parseTodoText(
      '* First thing\nSecond thing (Blocked)\nProject: Dotado\n* Research',
    );
    expect(result.loose).toEqual([
      { title: 'First thing', status: 'in_progress' },
      { title: 'Second thing', status: 'blocked' },
    ]);
    expect(shape(result)).toEqual([['Dotado', ['Research']]]);
  });

  it('reads Windows line endings and tabs', () => {
    const text = [
      'Project:\tPine Tree lane',
      '*\tMonitoring\t\tads',
      '',
      '\t• Second   task ',
      'Project- Dotado',
      '1)\tResearch',
      '',
    ].join('\r\n');
    expect(text).toContain('\r\n');
    expect(shape(parseTodoText(text))).toEqual([
      ['Pine Tree lane', ['Monitoring ads', 'Second task']],
      ['Dotado', ['Research']],
    ]);
  });

  it('keeps accents and emoji in headings and titles', () => {
    const result = parseTodoText('Project: Café Noir 🚀\n* Launch 🚀 post\n* Résumé review ✅');
    expect(shape(result)).toEqual([['Café Noir 🚀', ['Launch 🚀 post', 'Résumé review ✅']]]);
    const match = matchProject(result.groups[0].heading, [{ id: 9, name: 'Cafe Noir' }]);
    expect(match).toEqual({ kind: 'exact', project: { id: 9, name: 'Cafe Noir' } });
  });

  it('skips titles under 2 or over 500 characters and counts them', () => {
    const text = [
      'Project: Dotado',
      '* x',
      `* ${'a'.repeat(501)}`,
      '* (Done)',
      '* ab',
      `* ${'b'.repeat(500)}`,
    ].join('\n');
    const result = parseTodoText(text);
    expect(result.groups[0].lines.map((line) => line.title)).toEqual(['ab', 'b'.repeat(500)]);
    expect(result.skipped).toBe(3);
    expect(result.overLimit).toBe(0);
  });
});

describe('parseTodoText: limits', () => {
  it('reads a long run of colons as a task too long to keep', () => {
    const text = `Project: Dotado\n${':'.repeat(19000)} ab:\n* Research`;
    const result = parseTodoText(text, { projects: PROJECTS });
    expect(shape(result)).toEqual([['Dotado', ['Research']]]);
    expect(result.skipped).toBe(1);
  });

  it('keeps the first 20 projects and counts the 21st in skipped', () => {
    const text = Array.from({ length: 21 }, (_, i) => `Project: P${i + 1}\n* Task\n* Other`).join(
      '\n',
    );
    const result = parseTodoText(text);
    expect(result.groups).toHaveLength(20);
    expect(result.groups.at(-1).heading).toBe('P20');
    expect(result.skipped).toBe(2);
    expect(result.overLimit).toBe(2);
  });

  it('keeps the first 50 tasks of a project and of the loose lines', () => {
    const tasks = Array.from({ length: 51 }, (_, i) => `* Task ${i + 1}`);
    const result = parseTodoText([...tasks, 'Project: Dotado', ...tasks, '* x'].join('\n'));
    expect(result.loose).toHaveLength(50);
    expect(result.groups[0].lines).toHaveLength(50);
    expect(result.groups[0].lines.at(-1).title).toBe('Task 50');
    expect(result.skipped).toBe(3);
    expect(result.overLimit).toBe(2);
  });

  /** 'Project: Dotado\n' then 49 task lines of 400 characters, then `last`. */
  function longText(last) {
    const lines = Array.from(
      { length: 49 },
      (_, i) => `* ${String(i).padStart(3, '0')}${'x'.repeat(394)}\n`,
    );
    return `Project: Dotado\n${lines.join('')}${last}`;
  }

  it('reads only the first 20,000 characters of a longer text', () => {
    const text = longText(`* ${'a'.repeat(383)}`);
    expect(text).toHaveLength(20001);
    const result = parseTodoText(text);
    expect(result.truncated).toBe(true);
    expect(result).toEqual({ ...parseTodoText(text.slice(0, 20000)), truncated: true });
    expect(result.groups[0].lines).toHaveLength(50);
    expect(result.groups[0].lines.at(-1).title).toBe('a'.repeat(382));
    expect(parseTodoText(text.slice(0, 20000)).truncated).toBe(false);
  });

  it('does not cut an emoji in two at the limit', () => {
    const text = longText(`* ${'a'.repeat(381)}🚀 tail`);
    expect(text.charCodeAt(19999)).toBe('🚀'.charCodeAt(0));
    expect(parseTodoText(text).groups[0].lines.at(-1).title).toBe('a'.repeat(381));
  });
});

describe('matchProject', () => {
  it('matches exactly after normalising', () => {
    expect(matchProject('Studioubique', PROJECTS)).toEqual({ kind: 'exact', project: PROJECTS[1] });
    expect(matchProject('pine tree LANE', PROJECTS).project).toBe(PROJECTS[0]);
    expect(matchProject('Internal Tool', PROJECTS)).toEqual({
      kind: 'exact',
      project: PROJECTS[5],
    });
    expect(matchProject('Dótádo!', PROJECTS).kind).toBe('exact');
  });

  it('matches closely by prefix, either way, both at least 4 characters', () => {
    expect(matchProject('Riverkraft website', PROJECTS)).toEqual({
      kind: 'close',
      project: PROJECTS[4],
    });
    expect(matchProject('Acme booking', PROJECTS)).toEqual({ kind: 'close', project: PROJECTS[3] });
    expect(matchProject('Website SEO audit', [{ id: 7, name: 'SEO' }])).toEqual({
      kind: 'none',
      project: null,
    });
    expect(matchProject('Dot', PROJECTS).kind).toBe('none');
    expect(matchProject('Blue Harbour', PROJECTS).kind).toBe('none');
  });

  it('gives none for two close candidates', () => {
    const projects = [...PROJECTS, { id: 8, name: 'Acme website' }];
    expect(matchProject('Acme', projects)).toEqual({ kind: 'none', project: null });
    const both = [
      { id: 1, name: 'Riverkraft' },
      { id: 2, name: 'Riverkraft website redesign' },
    ];
    expect(matchProject('Riverkraft website', both).kind).toBe('none');
  });

  it('prefers the project written the same when several normalise the same', () => {
    const projects = [
      { id: 1, name: 'Cafe' },
      { id: 2, name: 'Café' },
    ];
    expect(matchProject('café', projects).project.id).toBe(2);
    expect(matchProject('CAFE', projects).project.id).toBe(1);
    expect(matchProject('Ca-fé', projects).project.id).toBe(1);
  });

  it('gives none for an empty or emoji-only heading and for no projects', () => {
    expect(matchProject('🚀', [{ id: 1, name: '🚀' }]).kind).toBe('none');
    expect(matchProject('', PROJECTS).kind).toBe('none');
    expect(matchProject('Dotado', null).kind).toBe('none');
    expect(matchProject('Dotado', [null, { id: 2 }]).kind).toBe('none');
  });
});

describe('normalizeTitle and normalizeName', () => {
  it('normalizeTitle trims, collapses white space and lowers the case', () => {
    expect(normalizeTitle('  Fix   the\tBuild \u00a0')).toBe('fix the build');
    expect(normalizeTitle('a b')).not.toBe(normalizeTitle('ab'));
    expect(normalizeTitle(null)).toBe('');
  });

  it('normalizeName drops case, accents and everything but letters and digits', () => {
    expect(normalizeName('Studio Ubique')).toBe('studioubique');
    expect(normalizeName('Studioubique')).toBe('studioubique');
    expect(normalizeName('Crème Brûlée')).toBe('cremebrulee');
    expect(normalizeName('Café Noir 🚀')).toBe('cafenoir');
    expect(normalizeName('internal-tool_2')).toBe('internaltool2');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('dayLabel', () => {
  // 13 Nov 2026 is a Friday.
  const today = '2026-11-13';

  it('names yesterday, a weekday within the week, else the date', () => {
    expect(dayLabel('2026-11-12', today)).toBe('From yesterday');
    expect(dayLabel('2026-11-11', today)).toBe('From Wednesday');
    expect(dayLabel('2026-11-07', today)).toBe('From Saturday');
    expect(dayLabel('2026-11-06', today)).toBe('From 6 Nov');
    expect(dayLabel('2026-11-02', today)).toBe('From 2 Nov');
  });

  it('counts across a month and a year', () => {
    expect(dayLabel('2026-10-31', '2026-11-01')).toBe('From yesterday');
    expect(dayLabel('2026-12-31', '2027-01-01')).toBe('From yesterday');
    expect(dayLabel('2026-12-28', '2027-01-04')).toBe('From 28 Dec');
  });

  it('gives null for today, a later day or a date that is not valid', () => {
    expect(dayLabel(today, today)).toBeNull();
    expect(dayLabel('2026-11-14', today)).toBeNull();
    expect(dayLabel('2026-02-31', today)).toBeNull();
    expect(dayLabel('12-11-2026', today)).toBeNull();
    expect(dayLabel('2026-11-12', null)).toBeNull();
  });
});

describe('limits and safety', () => {
  it("uses the report's own limits and statuses", () => {
    expect(TODO_LIMITS).toEqual({
      projects: MAX_ENTRIES,
      tasksPerProject: MAX_TASKS_PER_ENTRY,
      titleMin: 2,
      titleMax: MAX_TASK_LENGTH,
      textMax: 20000,
    });
    expect(Object.isFrozen(TODO_LIMITS)).toBe(true);
    const result = parseTodoText(PROTOTYPE_TEXT_2 + '\n* Wait (Blocked)');
    const statuses = new Set(result.groups.flatMap((group) => group.lines.map((l) => l.status)));
    expect([...statuses].every((status) => TASK_STATUSES.includes(status))).toBe(true);
    expect(statuses.size).toBe(3);
  });

  it('is safe in the browser: it imports only @/lib/time and never reads the clock', () => {
    const source = readFileSync('src/modules/reports/todoText.js', 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports).toEqual(['@/lib/time']);
    expect(source).not.toMatch(/new Date\(|Date\.now\(/);
  });
});
