import { describe, expect, it } from 'vitest';
import { escapeSlackText, formatReport, formatSlackHours } from '@/modules/slack/format';

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
        'Hours: 2',
        'Tasks',
        '• Content changes (Done)',
        '',
        'Project: internal-tool',
        'Hours: 6',
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
      'Project: alpha\nHours: 1.5\nTasks\n• One (Done)\n• Two (In Progress)\n• Three (Blocked)',
    );
    expect(text).toContain('Project: beta\nHours: 0.25\nTasks\n• Four (Done)');
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
      'Name: Vishal Saini\nDate: 30-09-2026\n\nProject: internal-tool\nHours: 2.5\nTasks\n• Fix the login (Done)',
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
    expect(formatSlackHours(120)).toBe('2');
    expect(formatSlackHours(90)).toBe('1.5');
    expect(formatSlackHours(15)).toBe('0.25');
    expect(formatSlackHours(0)).toBe('0');
  });
});

describe('escapeSlackText', () => {
  it('escapes only &, < and >', () => {
    expect(escapeSlackText('R&D <b> "x" > y')).toBe('R&amp;D &lt;b&gt; "x" &gt; y');
  });
});
