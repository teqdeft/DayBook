// My tasks drawn (CONTRACT 28, My tasks: sidebar, page and home cards; Every message, My tasks;
// Tests, M), rendered with react-dom/server: the home card's heading and "8 open", its first 6
// rows under their group headings ("Overdue 1" in red), "2 more" and "See all my tasks (8)", ticks
// only for a manager of the task's project, each row's number-free line (project, "On hold",
// phase, due tag, P tag, paperclip), the empty sentence without a foot; the page's toolbar (Group
// by When | Project, the project select, "Search my tasks"), its table ("My tasks", the hidden
// "Done" header, the columns, group rows, "#34"), the phone's headings and lists, "No tasks
// match." never on first draw, the empty sentence and "Showing the first 200 tasks."; both give the
// task window the viewer, so a task of theirs says "(you)".
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/team',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));

const windows = vi.hoisted(() => []);
vi.mock('@/components/task/TaskWindowProvider', async (original) => {
  const real = await original();
  return {
    ...real,
    TaskWindowProvider: (props) => {
      windows.push(props);
      return createElement(real.TaskWindowProvider, props);
    },
  };
});

const { default: MyTasksCard } = await import('@/app/(app)/my-tasks/MyTasksCard.jsx');
const { default: MyTasksView } = await import('@/app/(app)/my-tasks/MyTasksView.jsx');

const TODAY = '2026-11-25';
const ACME = { id: 12, name: 'acme-store', color: 'green', status: 'active' };
const TOOL = { id: 4, name: 'internal-tool', color: 'violet', status: 'active' };
const SEO = { id: 9, name: 'acme-seo', color: 'violet', status: 'on_hold' };

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

const MINE = [
  task(34, 'Get the payment gateway keys from Acme', '2026-11-19', {
    priority: 'p1',
    phase: 'development',
  }),
  task(61, 'Check the homepage text', TODAY, { priority: 'p1', canManage: false }),
  task(37, 'Write the test plan', '2026-11-27', { fileCount: 2 }),
  task(39, 'Acme testing round', '2026-12-10', { priority: 'p1' }),
  task(64, 'Read the SEO audit', '2026-12-10', { project: SEO, priority: 'p3' }),
  task(72, 'HR tries the leave form', '2026-12-14', { project: TOOL }),
  task(75, 'Release to the whole company', '2026-12-25', { project: TOOL }),
  task(77, 'Plan the January support rota', null, { project: TOOL, phase: null }),
];

const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const labels = (html) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
const titles = (html) =>
  [...html.matchAll(/data-mine-title="true">([^<]*)</g)].map((match) => match[1]);
const VIEWER = 7;
const mineOf = (tasks, more = false) => ({ tasks, more, today: TODAY, viewerId: VIEWER });
const card = (tasks = MINE) =>
  renderToStaticMarkup(createElement(MyTasksCard, { mine: mineOf(tasks) }));
const page = (tasks = MINE, more = false) =>
  renderToStaticMarkup(createElement(MyTasksView, { mine: mineOf(tasks, more) }));

describe('the home card', () => {
  it('says "My tasks" and "8 open" with its sub line', () => {
    const words = text(card());
    expect(words).toContain('My tasks 8 open');
    expect(words).toContain('Tasks you took or were given, on all your projects');
  });

  it('lists the first 6 rows by date under their group headings', () => {
    const html = card();
    expect(titles(html)).toEqual([
      'Get the payment gateway keys from Acme',
      'Check the homepage text',
      'Write the test plan',
      'Acme testing round',
      'Read the SEO audit',
      'HR tries the leave form',
    ]);
    const words = text(html);
    expect(words).toContain('Overdue 1');
    expect(words).toContain('Today 1');
    expect(words).toContain('This week 1');
    expect(words).toContain('Later 4');
    expect(words).not.toContain('No date');
    expect(html).toMatch(/data-flip="mine:34"/);
    expect(html).toMatch(/class="[^"]*red[^"]*" data-flip="mine-group:overdue"/);
  });

  it('ends with "2 more" and "See all my tasks (8)"', () => {
    const html = card();
    expect(text(html)).toContain('2 more');
    expect(html).toContain('href="/my-tasks"');
    expect(text(html)).toContain('See all my tasks (8)');
  });

  it('has no "more" when every task shows', () => {
    const html = card(MINE.slice(0, 3));
    expect(text(html)).not.toMatch(/\d more/);
    expect(text(html)).toContain('See all my tasks (3)');
  });

  it('ticks only tasks of projects the viewer manages', () => {
    const ticks = labels(card()).filter((label) => label.startsWith('Done: '));
    expect(ticks).toHaveLength(5);
    expect(ticks).not.toContain('Done: Check the homepage text');
    expect(ticks).toContain('Done: Get the payment gateway keys from Acme');
  });

  it('draws each row: project, On hold, phase, due tag, P tag and the paperclip', () => {
    const words = text(card());
    expect(words).toContain('acme-seo On hold Testing Due 10 Dec');
    expect(words).toContain('6 days late');
    expect(words).toContain('Due today');
    expect(words).toContain('Development');
    expect(labels(card())).toContain('2 files');
    expect(labels(card())).not.toContain('0 files');
  });

  it('says the empty sentence, with no list and no foot', () => {
    const html = card([]);
    expect(text(html)).toContain(
      'My tasks 0 open Tasks you took or were given, on all your projects No tasks for you. Use Assign to me on any task to see it here.',
    );
    expect(html).not.toContain('See all my tasks');
    expect(html).not.toContain('data-mine-list');
  });
});

describe('the task window of My tasks', () => {
  it.each([
    ['the home card', card],
    ['the page', page],
  ])('knows the viewer on %s ("(you)" after their own name)', (name, draw) => {
    windows.length = 0;
    draw();
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ mode: 'mine', viewerId: VIEWER, today: TODAY });
  });
});

describe('the page', () => {
  it('has the toolbar: Group by When | Project, the project select and the search', () => {
    const html = page();
    expect(text(html)).toContain('Group by');
    expect(html).toMatch(/aria-pressed="true"[^>]*>When</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Project</);
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="[^"]+-by"/);
    const options = [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => m[2]);
    expect(options).toEqual(['All projects', 'acme-seo', 'acme-store', 'internal-tool']);
    expect(text(html)).toContain('Project');
    expect(html).toContain('placeholder="Search my tasks"');
    expect(text(html)).toContain('Search my tasks');
  });

  it('draws one table, "My tasks", with its columns and group rows', () => {
    const html = page();
    expect(html).toMatch(/<table[^>]*aria-label="My tasks"[^>]*tabindex="-1"/);
    const head = text(html.slice(html.indexOf('<thead>'), html.indexOf('</thead>')));
    expect(head).toBe('Done # Task Project Phase Due Priority Files');
    expect(html).toContain('<span class="visually-hidden">Done</span>');
    expect((html.match(/scope="rowgroup"/g) ?? []).length).toBe(5);
    expect(text(html)).toContain('#34 Get the payment gateway keys from Acme');
    expect(text(html)).toContain('No date 1');
    expect(text(html)).toContain('No phase yet');
  });

  it('draws the phone list: the groups as headings over lists of rows', () => {
    const html = page();
    const headings = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((m) => text(m[1]));
    expect(headings).toEqual(['Overdue 1', 'Today 1', 'This week 1', 'Later 4', 'No date 1']);
  });

  it('says the empty sentence when there are no tasks, never "No tasks match."', () => {
    const words = text(page([]));
    expect(words).toContain('No tasks for you. Use Assign to me on any task to see it here.');
    expect(words).not.toContain('No tasks match.');
    expect(page([])).not.toContain('<table');
  });

  it('says "Showing the first 200 tasks." only past 200', () => {
    expect(text(page(MINE, true))).toContain('Showing the first 200 tasks.');
    expect(text(page(MINE, false))).not.toContain('Showing the first');
  });
});
