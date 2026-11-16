// What the report draws for CONTRACT 24, rendered: the "Still open from past reports" box (title,
// help, each row's title, status and day tags and three buttons, "Add all to today" only with two
// or more rows, nothing when empty), the Still open dialog (grouped by project, "Nothing is still
// open. Nice." when empty, its help at 14/20), the picker's "2 still open" (only with showOpenCounts, usedLabel
// first), a planned card's note and its box, the notice above the cards, the reminder line, and
// the Slack preview without planned projects.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ current: null }));

vi.mock('@/app/(app)/report/ReportProvider', () => ({ useReport: () => ctx.current }));
vi.mock('@/app/(app)/report/PolishProvider', () => ({
  usePolish: () => ({ lines: { enabled: false, states: {} } }),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ open, title, description, footer, children }) =>
    open
      ? createElement('div', { role: 'dialog' }, [
          createElement('h2', { key: 't' }, title),
          createElement('p', { key: 'd' }, description),
          createElement('div', { key: 'b' }, children),
          createElement('div', { key: 'f' }, footer),
        ])
      : null,
}));

const { default: CarrySuggestions } = await import('@/app/(app)/report/CarrySuggestions.jsx');
const { default: StillOpenDialog } = await import('@/app/(app)/report/StillOpenDialog.jsx');
const { default: ProjectPicker } = await import('@/app/(app)/report/ProjectPicker.jsx');
const { default: ProjectCard } = await import('@/app/(app)/report/ProjectCard.jsx');
const { default: SlackPreview } = await import('@/app/(app)/report/SlackPreview.jsx');
const { default: StillOpenReminder, HoursNotice } =
  await import('@/app/(app)/report/StillOpenReminder.jsx');
const { NO_ERRORS, newEntry, newTask } = await import('@/app/(app)/report/reportState');

const render = (type, props = {}) => renderToStaticMarkup(createElement(type, props));
/** Visible text: tags and React's text separators dropped, apostrophes decoded. */
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const labels = (html) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]);

const item = (taskId, title, status = 'in_progress', dayLabel = 'From Wednesday') => ({
  taskId,
  title,
  status,
  workDate: '2026-11-11',
  dayLabel,
});
const META = item(31, 'Meta descriptions for the 12 service pages');
const LINKS = item(32, 'Fix the broken links from the old blog', 'blocked', 'From Monday');
const GSC = item(51, 'Analysing the gsc stats to improve web blog content');

const PICKER = {
  urgent: [],
  mine: [
    { id: 3, name: 'Acme booking app', color: 'orange', isUrgent: false },
    { id: 5, name: 'Studio Ubique', color: 'violet', isUrgent: false },
  ],
  others: [],
  requests: [{ requestId: 4, name: 'Riverkraft website' }],
};

function row(projectId, name, lines, hours = '') {
  return {
    ...newEntry({ projectId, name }),
    hours,
    tasks: lines.map(([title, status]) => ({ ...newTask(status), title })),
  };
}

/** The report context the components read (ReportProvider is mocked). */
function report({ entries = [], suggestions = {}, status = 'draft', readOnly = false } = {}) {
  ctx.current = {
    data: {
      picker: PICKER,
      suggestions: {},
      preferences: {},
      user: { name: 'Priya Sharma', initials: 'PS' },
      slackLines: { draft: 'Posts to #daily-reports when you submit', submitted: '' },
      previewTime: '6:28 PM',
    },
    entries,
    report: { status, workDate: '2026-11-12', editable: !readOnly },
    errors: NO_ERRORS,
    readOnly,
    submitting: false,
    change: () => {},
    updateEntry: () => {},
    timers: null,
    carry: {
      suggestions,
      counts: Object.fromEntries(Object.entries(suggestions).map(([k, v]) => [k, v.length])),
      onClosed: () => {},
      onRestored: () => {},
    },
  };
}

describe('CarrySuggestions', () => {
  it('draws the box with every row, its tags and its buttons', () => {
    const html = render(CarrySuggestions, { items: [META, LINKS] });
    expect(html).toMatch(/role="region" aria-labelledby="[^"]+"/);
    expect(text(html)).toContain(
      "Still open from past reports Add the ones you'll work on today. Mark the rest done or not needed. Add all to today",
    );
    expect(text(html)).toContain(
      'Meta descriptions for the 12 service pages In progress From Wednesday',
    );
    expect(text(html)).toContain('Fix the broken links from the old blog Blocked From Monday');
    expect(labels(html)).toEqual([
      'Add to today: Meta descriptions for the 12 service pages',
      'Done already: Meta descriptions for the 12 service pages',
      'Not needed: Meta descriptions for the 12 service pages',
      'Add to today: Fix the broken links from the old blog',
      'Done already: Fix the broken links from the old blog',
      'Not needed: Fix the broken links from the old blog',
    ]);
    // In progress is primary soft, Blocked red soft, both with the design's 8 px sides (as the day
    // tag); Done already is secondary, Not needed text.
    expect(html).toMatch(/_primary_[^"]*" style="--tag-pad-x:8px">In progress/);
    expect(html).toMatch(/_red_[^"]*" style="--tag-pad-x:8px">Blocked/);
    expect(html).toMatch(/_neutral_[^"]*" style="--tag-pad-x:8px">From Wednesday/);
    expect(html).toMatch(/_secondary_[^>]*aria-label="Done already: Meta/);
    expect(html).toMatch(/_text_[^>]*aria-label="Not needed: Meta/);
    expect(html).toContain('lucide-check');
  });

  it('offers Add all to today only with two or more rows, and is gone when empty', () => {
    expect(text(render(CarrySuggestions, { items: [META] }))).not.toContain('Add all to today');
    expect(render(CarrySuggestions, { items: [] })).toBe('');
    expect(render(CarrySuggestions, {})).toBe('');
  });

  it('turns every button off while the report is submitting', () => {
    const html = render(CarrySuggestions, { items: [META, LINKS], disabled: true });
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(7);
  });
});

describe('StillOpenDialog', () => {
  const groups = [
    {
      key: 'p3',
      project: { id: 3, name: 'Acme booking app', color: 'orange' },
      items: [META, LINKS],
    },
    { key: 'r4', request: { id: 4, name: 'Riverkraft website' }, items: [GSC] },
    { key: 'p5', project: { id: 5, name: 'Studio Ubique', color: 'violet' }, items: [] },
  ];

  it('lists every suggestion grouped by project, with Close', () => {
    const html = render(StillOpenDialog, { open: true, onClose: () => {}, groups });
    const visible = text(html);
    expect(visible).toContain('Still open from past reports');
    expect(visible).toContain(
      "Add the ones you'll work on today. Mark the rest done or not needed.",
    );
    expect(html).toContain('<section class="_group_');
    expect(labels(html).filter((label) => label.startsWith('Add to today'))).toHaveLength(3);
    expect(visible.indexOf('Acme booking app')).toBeLessThan(visible.indexOf('Meta descriptions'));
    expect(visible.indexOf('Riverkraft website')).toBeLessThan(visible.indexOf('Analysing'));
    // A project with nothing left is not shown.
    expect(visible).not.toContain('Studio Ubique');
    expect(visible.endsWith('Close')).toBe(true);
  });

  it('draws its help at the design’s 14/20, not the dialog description’s 15 px', () => {
    const html = render(StillOpenDialog, { open: true, onClose: () => {}, groups });
    expect(html).toMatch(
      /<span class="_help_[^"]*">Add the ones you&#x27;ll work on today\. Mark the rest done or not needed\.<\/span>/,
    );
    const css = readFileSync(
      new URL('../../src/app/(app)/report/StillOpenDialog.module.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(
      /^\.help \{\n {2}display: block;\n {2}font-size: 14px;\n {2}line-height: 20px;\n\}/m,
    );
  });

  it('says so when nothing is still open, and draws nothing while closed', () => {
    expect(text(render(StillOpenDialog, { open: true, onClose: () => {}, groups: [] }))).toContain(
      'Nothing is still open. Nice.',
    );
    expect(render(StillOpenDialog, { open: false, onClose: () => {}, groups })).toBe('');
  });
});

describe('ProjectPicker', () => {
  const picker = (props) =>
    render(ProjectPicker, {
      picker: PICKER,
      onPick: () => {},
      onClose: () => {},
      anchorRef: { current: null },
      ...props,
    });

  it('says "2 still open" beside a project with suggestions, after "In your to-do"', () => {
    const html = picker({
      used: new Set(['p5']),
      usedLabel: 'In your to-do',
      openCounts: { p3: 2, p5: 1, r4: 1 },
      showOpenCounts: true,
    });
    const visible = text(html);
    expect(visible).toContain('Acme booking app 2 still open');
    expect(visible).toContain('Studio Ubique In your to-do');
    expect(visible).not.toContain('1 still open Studio');
    expect(visible).toContain('Riverkraft website 1 still open');
    expect(html).toMatch(/_note_[^"]*">2 still open/);
  });

  it('shows no counts without showOpenCounts (the timer form)', () => {
    const visible = text(picker({ openCounts: { p3: 2, r4: 1 } }));
    expect(visible).not.toContain('still open');
    expect(visible).toContain('Riverkraft website Waiting for approval');
  });
});

describe('ProjectCard', () => {
  const props = (entry) => ({
    entry,
    used: new Set(),
    onRequestProject: () => {},
    focusRequestRef: { current: null },
  });
  const NOTE = 'Not worked on today. Its tasks stay open.';

  it('says a planned project is not worked on today, and shows its suggestions', () => {
    const entry = row(3, 'Acme booking app', [['Write the FAQ', 'in_progress']]);
    report({ entries: [entry], suggestions: { p3: [META, LINKS] } });
    const html = render(ProjectCard, props(entry));
    expect(text(html)).toContain(NOTE);
    expect(html).toContain('lucide-info');
    // The box sits between the Task / Status header and the lines.
    const box = html.indexOf('role="region"');
    expect(box).toBeGreaterThan(html.indexOf('>Status<'));
    expect(box).toBeLessThan(html.indexOf('Write the FAQ'));
    expect(text(html)).toContain('Add all to today');
  });

  it('has no note with hours or a Done line, and no box without suggestions', () => {
    const worked = row(3, 'Acme booking app', [['Write the FAQ', 'in_progress']], '1h');
    const done = row(3, 'Acme booking app', [['Shipped it', 'done']]);
    report({ entries: [worked, done], suggestions: { p5: [GSC] } });
    for (const entry of [worked, done]) {
      const html = render(ProjectCard, props(entry));
      expect(text(html)).not.toContain(NOTE);
      expect(html).not.toContain('role="region"');
    }
  });
});

describe('the notice and the reminder line', () => {
  const planned = row(5, 'Studio Ubique', [['1 web blog publish', 'in_progress']]);
  const NOTICE =
    'Add the hours for each project and check each status. Tasks you ticked on Today are Done.';

  it('shows the notice while a draft has a line and a project at 0 minutes', () => {
    report({ entries: [planned] });
    const html = render(HoursNotice);
    expect(text(html)).toBe(NOTICE);
    expect(html).toContain('role="note"');
    report({ entries: [planned], status: 'submitted' });
    expect(render(HoursNotice)).toBe('');
    report({ entries: [planned], readOnly: true });
    expect(render(HoursNotice)).toBe('');
  });

  it('names each project with suggestions that is not in the report', () => {
    report({ entries: [planned], suggestions: { p3: [META, LINKS], p5: [GSC], r4: [GSC] } });
    const html = render(StillOpenReminder);
    expect(text(html)).toBe(
      'Still open from past reports: Acme booking app (2) Riverkraft website (1)',
    );
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('is not there without suggestions or on a report that can’t change', () => {
    report({ entries: [planned], suggestions: { p5: [GSC] } });
    expect(render(StillOpenReminder)).toBe('');
    report({ entries: [], suggestions: { p3: [META] }, readOnly: true });
    expect(render(StillOpenReminder)).toBe('');
  });
});

describe('SlackPreview', () => {
  it('leaves planned projects out, as the post does', () => {
    const worked = row(9, 'Pine Tree Lane', [['Monitoring google ads', 'done']], '2h');
    const planned = row(7, 'Dotado', [['2 Web blog topic research', 'in_progress']]);
    report({ entries: [worked, planned] });
    const visible = text(render(SlackPreview));
    expect(visible).toContain('Project: Pine Tree Lane');
    expect(visible).toContain('Monitoring google ads (Done)');
    expect(visible).not.toContain('Dotado');
  });
});
