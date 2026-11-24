// What Today's to-do draws (CONTRACT 24), rendered: the empty state, groups with their lines, tags,
// Play only where a timer can start, the header's count and buttons, every state of the Slack
// button, the card after submit, the suggestion box and the reminder line, the paste dialog's
// preview, the Priority tasks card's To-do column (and, CONTRACT 27, its paperclips, its title
// buttons that open the task window and the to-do the window uses) and the report strip's copy.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ current: null }));

vi.mock('@/app/(app)/today/TodoProvider', () => ({ useTodo: () => ctx.current }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ open, title, children, footer }) =>
    open
      ? createElement('div', { role: 'dialog' }, [
          createElement('h2', { key: 't' }, title),
          createElement('div', { key: 'b' }, children),
          createElement('div', { key: 'f' }, footer),
        ])
      : null,
}));

const { default: TodoCard } = await import('@/app/(app)/today/TodoCard.jsx');
const { default: TodoPasteDialog } = await import('@/app/(app)/today/TodoPasteDialog.jsx');
const { default: PriorityCard } = await import('@/app/(app)/today/PriorityCard.jsx');
const { ReportStrip } = await import('@/app/(app)/today/TodayCards.jsx');

const TZ = 'Asia/Kolkata';
const AT = '2026-11-13T04:11:00.000Z';
const PTL = { id: 3, name: 'Pine Tree Lane', color: 'green' };
const SU = { id: 5, name: 'Studio Ubique', color: 'violet' };
const ACME = { id: 12, name: 'Acme booking app', color: 'blue' };
const PICKER = { urgent: [], mine: [PTL, SU, ACME], others: [], requests: [] };

const line = (id, title, extra = {}) => ({
  id,
  title,
  status: 'in_progress',
  done: false,
  projectTaskId: null,
  now: false,
  carriedFrom: null,
  canStart: true,
  ...extra,
});
const suggestion = (taskId, title, status = 'in_progress') => ({
  taskId,
  title,
  status,
  workDate: '2026-11-11',
  dayLabel: 'From Wednesday',
});

const LIST = [
  {
    entryId: 1,
    project: PTL,
    minutes: 0,
    lines: [line(11, 'Monitoring google ads', { status: 'done', done: true, canStart: false })],
  },
  {
    entryId: 2,
    project: SU,
    minutes: 0,
    lines: [
      line(21, '1 web blog publish', { status: 'done', done: true, canStart: false }),
      line(22, 'Analysing the gsc stats', {
        carriedFrom: { workDate: '2026-11-11', dayLabel: 'From Wednesday' },
      }),
      line(23, '1 listicle content post', { now: true, canStart: false }),
      line(24, 'Waiting on the client', { status: 'blocked' }),
    ],
  },
  {
    entryId: 3,
    request: { id: 4, name: 'Blue Harbour' },
    minutes: 0,
    lines: [line(31, '3 product descriptions', { canStart: false })],
  },
];

function todo(extra = {}) {
  const groups = extra.groups ?? LIST;
  const lines = groups.flatMap((group) => group.lines);
  return {
    workDate: '2026-11-13',
    reportId: 9,
    editable: true,
    submitted: false,
    done: lines.filter((item) => item.done).length,
    total: lines.length,
    post: { state: 'none', at: null, changed: false, postedAt: null },
    slack: { canPost: true },
    timer: { canStart: true },
    groups,
    suggestions: {},
    ...extra,
  };
}

function render(state, props = {}) {
  ctx.current = {
    todo: state,
    usedKeys: new Set(
      state.groups.map((group) =>
        group.project ? `p${group.project.id}` : `r${group.request.id}`,
      ),
    ),
    posting: false,
    ...props.ctx,
  };
  return renderToStaticMarkup(
    createElement(TodoCard, { picker: PICKER, priority: {}, tz: TZ, ...props.card }),
  );
}

/** Visible text: tags and React's text separators dropped, entities decoded. */
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const labels = (html) =>
  [...html.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1].replace(/&#x27;/g, "'"));
const buttons = (html) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => text(match[1]));

describe('the empty to-do', () => {
  it('says Plan your day with Add project and Paste a list', () => {
    const html = render(todo({ groups: [] }));
    expect(text(html)).toBe(
      "Today's to-do What you'll work on today. It becomes your report. Plan your day Add what you'll work on today, by project. Your PM sees it, and it fills your report. Add project Paste a list",
    );
    expect(html).toContain('id="todo"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('shows the reminder line for projects with unfinished tasks', () => {
    const html = render(
      todo({
        groups: [],
        suggestions: { p12: [suggestion(31, 'Meta descriptions'), suggestion(32, 'Fix links')] },
      }),
    );
    expect(text(html)).toContain('Still open from past reports: Acme booking app (2)');
  });
});

describe('the list', () => {
  it('shows the count, the groups, the lines and their tags', () => {
    const html = render(todo());
    const shown = text(html);
    expect(shown).toContain("Today's to-do 2 of 6 done");
    expect(shown).toContain('Pine Tree Lane');
    expect(shown).toContain('Analysing the gsc stats From Wednesday');
    expect(shown).toContain('1 listicle content post Now');
    expect(shown).toContain('Waiting on the client Blocked');
    expect(shown).toContain('Add project');
    expect(buttons(html)).toContain('Paste a list');
    expect(labels(html)).toEqual(
      expect.arrayContaining([
        'Remove Pine Tree Lane',
        'Done: Monitoring google ads',
        'Edit task: Analysing the gsc stats',
        'Remove Analysing the gsc stats',
        'Add a task to Studio Ubique',
        'Remove Blue Harbour',
      ]),
    );
    // Done lines are muted and struck through (their row's class).
    expect(html).toMatch(/class="[^"]*_line_[^"]*_done_[^"]*" data-todo-line="11"/);
    expect(html).toMatch(/aria-label="Done: Monitoring google ads" checked=""/);
  });

  it('draws the line tags with the design’s 8 px sides', () => {
    const html = render(todo());
    const tags = [...html.matchAll(/<span class="[^"]*_tag_[^"]*"( style="([^"]*)")?/g)];
    // From Wednesday, Now and Blocked, each with --tag-pad-x 8px (the Tag default is 10).
    expect(tags.length).toBeGreaterThanOrEqual(3);
    expect(tags.every((match) => match[2]?.includes('--tag-pad-x:8px'))).toBe(true);
  });

  it('shows Play only where a timer can start (not Done, not Now, not a request)', () => {
    const plays = labels(render(todo())).filter((label) => label.startsWith('Start a timer'));
    expect(plays).toEqual([
      'Start a timer for Analysing the gsc stats',
      'Start a timer for Waiting on the client',
    ]);
    const noTimers = todo({
      groups: LIST.map((group) => ({
        ...group,
        lines: group.lines.map((item) => ({ ...item, canStart: false })),
      })),
    });
    expect(labels(render(noTimers)).some((label) => label.startsWith('Start a timer'))).toBe(false);
  });

  it('shows the suggestion box under a group with unfinished tasks', () => {
    const html = render(
      todo({ suggestions: { p5: [suggestion(41, 'Update the sitemap', 'blocked')] } }),
    );
    expect(text(html)).toContain(
      "Still open from past reports Add the ones you'll work on today. Mark the rest done or not needed. Update the sitemap Blocked From Wednesday",
    );
    expect(labels(html)).toContain('Add to today: Update the sitemap');
  });
});

describe('the Slack button', () => {
  const post = (extra) =>
    todo({ post: { state: 'none', at: null, changed: false, postedAt: null, ...extra } });
  const actions = (html) => buttons(html).filter((label) => label !== 'Paste a list');

  it('offers Post to Slack, then Posting… disabled', () => {
    expect(actions(render(post({})))).toContain('Post to Slack');
    const sending = render(post({ state: 'sending', at: AT }));
    expect(sending).toMatch(/disabled=""[^>]*><svg[^>]*>.*?<\/svg><span[^>]*>Posting…/s);
    expect(render(post({}), { ctx: { posting: true } })).toContain('Posting…');
  });

  it('says Posted at 9:41 AM, then Update post after a change, then Updating…', () => {
    const sent = render(post({ state: 'sent', at: AT, postedAt: AT }));
    expect(text(sent)).toContain('Posted at 9:41 AM');
    expect(sent).not.toContain('Update post');
    expect(text(render(post({ state: 'sent', at: AT, postedAt: AT, changed: true })))).toContain(
      'Posted at 9:41 AM Paste a list Update post',
    );
    expect(text(render(post({ state: 'sending', at: AT, postedAt: AT })))).toContain(
      'Posted at 9:41 AM Paste a list Updating…',
    );
  });

  it("says Couldn't post to Slack. with Try again", () => {
    const failed = render(post({ state: 'failed', at: AT }));
    expect(text(failed)).toContain("Couldn't post to Slack. Paste a list Try again");
    expect(failed).toContain('role="alert"');
  });

  it('is hidden while posting is off or the list is empty', () => {
    const off = render(todo({ slack: { canPost: false } }));
    expect(off).not.toContain('Post to Slack');
    expect(render(todo({ groups: [] }))).not.toContain('Post to Slack');
  });
});

describe('after submit', () => {
  it('is just the header with "2 of 6 done. Your report is in."', () => {
    const html = render(todo({ submitted: true, editable: true }));
    expect(text(html)).toBe("Today's to-do 2 of 6 done. Your report is in.");
    expect(html).not.toContain('<button');
  });
});

describe('the paste dialog', () => {
  it('previews the paste: exact, close, none, already there, Done, and the button off', () => {
    const html = renderToStaticMarkup(
      createElement(TodoPasteDialog, {
        initialText:
          'Project: Pine Tree lane\n* Monitoring google ads\n\nProject- Acme booking app website\n* Keyword list (Done)\n\nProject: Blue Harbour\n* 3 product descriptions',
        picker: PICKER,
        groups: [LIST[0]],
        suggestions: {},
        onAdd: () => null,
        onClose: () => {},
      }),
    );
    const shown = text(html);
    expect(shown).toContain('Paste your to-do Your list');
    expect(shown).toContain(
      'Start each project with “Project:” and each task with * or •. Your usual Slack list works as it is.',
    );
    expect(shown).toContain('We found 3 projects and 3 tasks.');
    expect(shown).toContain('Pine Tree Lane Change • Monitoring google ads Already in your to-do');
    expect(shown).toContain('Matched from “Acme booking app website”');
    expect(shown).toContain('• Keyword list Done');
    expect(shown).toContain('No project called “Blue Harbour”.');
    expect(html).toContain('<option value="">Pick a project</option>');
    expect(html).toContain('<option value="skip">Skip these tasks</option>');
    expect(html).toContain('rows="8"');
    expect(html).toContain('maxLength="20000"');
    // Off while Blue Harbour has no project, its task already counted (the prototype's paste2).
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span[^>]*>Add 2 tasks<\/span><\/button>/);
  });
});

describe('the Priority tasks card', () => {
  const priority = {
    initial: 6,
    rows: [
      {
        id: 7,
        priority: 'p1',
        title: 'Fix the booking form',
        projectId: 12,
        project: ACME,
        forYou: true,
      },
      {
        id: 8,
        priority: 'p3',
        title: 'Update the sitemap',
        projectId: 5,
        project: SU,
        forYou: false,
      },
    ],
  };
  const withTodo = (state) => {
    ctx.current = state ? { todo: state } : null;
    return renderToStaticMarkup(createElement(PriorityCard, { priority }));
  };

  it('adds a To-do column: Plus, or "In to-do" for a task a line links', () => {
    const linked = todo({
      groups: [
        {
          entryId: 2,
          project: SU,
          minutes: 0,
          lines: [line(21, 'Update the sitemap', { projectTaskId: 8 })],
        },
      ],
    });
    const html = withTodo(linked);
    expect(text(html)).toContain('To-do');
    expect(labels(html)).toContain('Add to to-do: Fix the booking form');
    expect(labels(html)).not.toContain('Add to to-do: Update the sitemap');
    expect(text(html)).toContain('In to-do');
  });

  it('has no Plus once the report is in, and no column without a to-do', () => {
    expect(
      labels(withTodo(todo({ submitted: true }))).some((label) => label.startsWith('Add to to-do')),
    ).toBe(false);
    expect(text(withTodo(null))).not.toContain('To-do');
  });
});

describe('the Priority tasks card with files (CONTRACT 27)', () => {
  const rows = [
    { id: 7, priority: 'p1', title: 'Fix the booking form', projectId: 12, project: ACME },
    { id: 8, priority: 'p2', title: 'Payment settings page', projectId: 5, project: SU },
  ];
  const render = (fileCounts) => {
    ctx.current = null;
    const priority = {
      initial: 6,
      today: '2026-11-13',
      rows: rows.map((row) => ({ ...row, forYou: true, fileCount: fileCounts[row.id] ?? 0 })),
    };
    return renderToStaticMarkup(createElement(PriorityCard, { priority }));
  };

  it('puts a paperclip and count after the title when the task has files', () => {
    const html = render({ 8: 2 });
    expect(labels(html)).toContain('2 files');
    expect(labels(html)).not.toContain('0 files');
    expect(labels(render({ 7: 1 }))).toContain('1 file');
  });

  it('makes each title a button that opens the task window', () => {
    const html = render({});
    expect(buttons(html)).toEqual(
      expect.arrayContaining(['Fix the booking form', 'Payment settings page']),
    );
    expect(html.match(/data-open-task/g)).toHaveLength(4); // the phone title and the Task cell
  });

  it("offers the window the to-do card's own adding, and no adding once the report is in", async () => {
    const { todoForWindow } = await import('@/app/(app)/today/PriorityCard.jsx');
    const added = [];
    const linked = todo({
      groups: [
        {
          entryId: 2,
          project: SU,
          minutes: 0,
          lines: [line(21, 'Update the sitemap', { projectTaskId: 8 })],
        },
      ],
    });
    const adapter = todoForWindow({ todo: linked, addLine: (...args) => added.push(args) });
    expect(adapter.has(8)).toBe(true);
    expect(adapter.has(7)).toBe(false);
    adapter.add({ id: 7, projectId: 12, title: 'Fix the booking form', project: ACME });
    expect(added).toEqual([
      [
        { project: { id: 12, name: ACME.name, color: ACME.color } },
        { title: 'Fix the booking form', projectTaskId: 7, added: 'Added to your to-do.' },
      ],
    ]);
    expect(todoForWindow({ todo: todo({ submitted: true }), addLine: () => {} }).add).toBeNull();
    expect(todoForWindow(null)).toBeNull();
  });
});

describe('the report strip', () => {
  const data = (total) => ({
    settings: { slackEnabled: false, reportReminderAt: '18:30' },
    reportStatus: 'draft',
    locksText: '12:00 PM tomorrow',
    todo: total === null ? null : { initialTodo: { total } },
  });

  it('says the to-do is already in the report once it has lines', () => {
    expect(text(renderToStaticMarkup(createElement(ReportStrip, { data: data(3) })))).toContain(
      'Your to-do is already in it. Add the hours and check each status.',
    );
    expect(text(renderToStaticMarkup(createElement(ReportStrip, { data: data(0) })))).toContain(
      'Your PM sees it here as soon as you submit it.',
    );
  });
});
