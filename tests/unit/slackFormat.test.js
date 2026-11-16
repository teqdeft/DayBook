import { describe, expect, it } from 'vitest';
import {
  escapeSlackText,
  formatReport,
  formatSlackHours,
  formatTodo,
} from '@/modules/slack/format';

describe('formatReport', () => {
  it('matches the build guide example exactly', () => {
    const text = formatReport({
      userName: 'Vishal Saini',
      workDate: '2026-09-30',
      entries: [
        {
          projectName: 'iwilltillimwell',
          minutes: 120,
          tasks: [{ title: 'Content changes', status: 'done' }],
        },
        {
          projectName: 'internal-tool',
          minutes: 360,
          tasks: [{ title: 'Working on backend', status: 'in_progress' }],
        },
      ],
    });
    expect(text).toBe(
      [
        'Name: Vishal Saini',
        'Date: 30-09-2026',
        '',
        'Project: iwilltillimwell',
        'Hours: 2h',
        'Tasks',
        '• Content changes (Done)',
        '',
        'Project: internal-tool',
        'Hours: 6h',
        'Tasks',
        '• Working on backend (In Progress)',
      ].join('\n'),
    );
  });

  it('prints hours without trailing zeros and every status label', () => {
    const text = formatReport({
      userName: 'Neha Gupta',
      workDate: '2026-01-05',
      entries: [
        {
          projectName: 'alpha',
          minutes: 90,
          tasks: [
            { title: 'One', status: 'done' },
            { title: 'Two', status: 'in_progress' },
            { title: 'Three', status: 'blocked' },
          ],
        },
        { projectName: 'beta', minutes: 15, tasks: [{ title: 'Four', status: 'done' }] },
      ],
    });
    expect(text).toContain('Date: 05-01-2026');
    expect(text).toContain(
      'Project: alpha\nHours: 1h 30m\nTasks\n• One (Done)\n• Two (In Progress)\n• Three (Blocked)',
    );
    expect(text).toContain('Project: beta\nHours: 15m\nTasks\n• Four (Done)');
    expect(text.endsWith('\n')).toBe(false);
  });

  it('keeps drafts readable: blank tasks are skipped, hours may be given instead of minutes', () => {
    const text = formatReport({
      userName: 'Vishal Saini',
      workDate: '2026-09-30',
      entries: [
        {
          projectName: 'internal-tool',
          hours: '2.5',
          tasks: [
            { title: '  Fix   the\nlogin  ', status: 'done' },
            { title: '   ', status: 'in_progress' },
          ],
        },
      ],
    });
    expect(text).toBe(
      'Name: Vishal Saini\nDate: 30-09-2026\n\nProject: internal-tool\nHours: 2h 30m\nTasks\n• Fix the login (Done)',
    );
  });

  it('shows only the header when there are no entries', () => {
    expect(formatReport({ userName: 'A B', workDate: '2026-09-30', entries: [] })).toBe(
      'Name: A B\nDate: 30-09-2026',
    );
  });
});

describe('formatSlackHours', () => {
  it('drops trailing zeros', () => {
    expect(formatSlackHours(120)).toBe('2h');
    expect(formatSlackHours(90)).toBe('1h 30m');
    expect(formatSlackHours(15)).toBe('15m');
    expect(formatSlackHours(510)).toBe('8h 30m');
    expect(formatSlackHours(0)).toBe('0h');
  });
});

describe('escapeSlackText', () => {
  it('escapes only &, < and >', () => {
    expect(escapeSlackText('R&D <b> "x" > y')).toBe('R&amp;D &lt;b&gt; "x" &gt; y');
  });
});

describe('formatTodo', () => {
  const owner = {
    userName: 'Priya Sharma',
    workDate: '2026-11-12',
    entries: [
      {
        projectName: 'Pine Tree Lane',
        lines: [
          {
            title: 'Monitoring google ads campaign and removing irrelevant search terms',
            status: 'in_progress',
          },
        ],
      },
      {
        projectName: 'Studio Ubique',
        lines: [
          { title: '1 web blog publish', status: 'in_progress' },
          { title: 'Analysing the gsc stats to improve web blog content', status: 'in_progress' },
          { title: '1 listicle content post on linkedin', status: 'in_progress' },
        ],
      },
      {
        projectName: 'Dotado',
        lines: [{ title: '2 Web blog topic research', status: 'in_progress' }],
      },
    ],
  };

  it("matches the owner's layout in CONTRACT 24 byte for byte", () => {
    expect(formatTodo(owner)).toBe(
      [
        'Name: Priya Sharma',
        'Date: 12-11-2026',
        "Today's to-do",
        '',
        'Project: Pine Tree Lane',
        '• Monitoring google ads campaign and removing irrelevant search terms',
        '',
        'Project: Studio Ubique',
        '• 1 web blog publish',
        '• Analysing the gsc stats to improve web blog content',
        '• 1 listicle content post on linkedin',
        '',
        'Project: Dotado',
        '• 2 Web blog topic research',
      ].join('\n'),
    );
  });

  it('marks done and blocked lines, and nothing else', () => {
    const text = formatTodo({
      userName: 'Priya Sharma',
      workDate: '2026-11-12',
      entries: [
        {
          projectName: 'Dotado',
          lines: [
            { title: 'One', status: 'done' },
            { title: 'Two', status: 'blocked' },
            { title: 'Three', status: 'in_progress' },
          ],
        },
      ],
    });
    expect(text.split('\n').slice(4)).toEqual([
      'Project: Dotado',
      '• One (Done)',
      '• Two (Blocked)',
      '• Three',
    ]);
  });

  it('leaves out blank titles and projects with no line, and keeps each title on one line', () => {
    const text = formatTodo({
      userName: '  Priya   Sharma ',
      workDate: '2026-11-12',
      entries: [
        { projectName: 'Empty', lines: [] },
        { projectName: 'Blank lines', lines: [{ title: '   ', status: 'done' }] },
        { projectName: 'No lines' },
        { projectName: 'Pine\nTree  Lane', lines: [{ title: ' Fix  the\nads ', status: 'done' }] },
      ],
    });
    expect(text).toBe(
      "Name: Priya Sharma\nDate: 12-11-2026\nToday's to-do\n\nProject: Pine Tree Lane\n• Fix the ads (Done)",
    );
  });

  it('shows only the header when nothing is planned, and takes tasks instead of lines', () => {
    expect(formatTodo({ userName: 'A B', workDate: '2026-11-12', entries: [] })).toBe(
      "Name: A B\nDate: 12-11-2026\nToday's to-do",
    );
    expect(
      formatTodo({
        userName: 'A B',
        workDate: '2026-11-12',
        entries: [{ projectName: 'Dotado', tasks: [{ title: 'Research', status: 'blocked' }] }],
      }),
    ).toBe("Name: A B\nDate: 12-11-2026\nToday's to-do\n\nProject: Dotado\n• Research (Blocked)");
  });

  it('is escaped with escapeSlackText when queued: <, > and & show as typed', () => {
    const text = formatTodo({
      userName: 'Priya Sharma',
      workDate: '2026-11-12',
      entries: [{ projectName: 'R&D', lines: [{ title: 'Ping <!channel> > 2', status: 'done' }] }],
    });
    expect(escapeSlackText(text)).toContain(
      'Project: R&amp;D\n• Ping &lt;!channel&gt; &gt; 2 (Done)',
    );
  });
});
