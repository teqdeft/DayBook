// The Phases tab (CONTRACT 22), really rendered with the database-backed modules mocked: the manager's
// board, another PM's read-only board (no files or notes anywhere in it), a project with no phase yet,
// one with no tasks, and the "No phase yet" section. Client parts render their first state only: the
// add row, dialogs and toasts open in the browser (tests/e2e/project-plan.spec.js).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

const SECRET = 'Acme pricing sheet';

const listForProject = vi.fn();
const listAssigneeOptions = vi.fn();
const listDocuments = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/modules/projectTasks', () => ({
  projectTasks: {
    listForProject: (...args) => listForProject(...args),
    listAssigneeOptions: (...args) => listAssigneeOptions(...args),
  },
}));
vi.mock('@/modules/projectSummaries', () => ({
  projectSummaries: { listDocuments: (...args) => listDocuments(...args) },
}));
vi.mock('@/modules/settings', () => ({
  settings: { getAll: async () => ({ timezone: 'Asia/Kolkata' }) },
}));

const { default: PhasesTab } = await import('@/app/(app)/projects/[id]/PhasesTab.jsx');
const { default: PhaseSection } = await import('@/app/(app)/projects/[id]/PhaseSection.jsx');
const { phaseSections } = await import('@/app/(app)/projects/[id]/phasesView.js');

const TODAY = '2026-10-30';
const PM = { id: 7, role: 'pm' };
const OTHER_PM = { id: 8, role: 'pm' };
const PROJECT = {
  id: 5,
  name: 'Acme booking app',
  status: 'active',
  pmId: 7,
  pmName: 'Riya Kapoor',
};

const planOf = (currentPhase = 'design', dates = {}) => ({
  currentPhase,
  deadline: '2026-12-15',
  phases: PROJECT_PHASES.map(({ key, label }) => ({
    key,
    label,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    ...dates[key],
  })),
});

const DATES = {
  requirement_gathering: {
    plannedStart: '2026-10-06',
    plannedEnd: '2026-10-23',
    actualStart: '2026-10-06',
    actualEnd: '2026-10-26',
  },
  design: { plannedStart: '2026-10-26', plannedEnd: '2026-11-20', actualStart: '2026-10-26' },
  development: { plannedStart: '2026-11-09', plannedEnd: '2026-12-04' },
};

const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  details: null,
  priority: 'p2',
  status: 'open',
  phase: 'design',
  dueDate: null,
  assignee: null,
  latestReport: null,
  ...more,
});

const TASKS = [
  task(1, { title: 'Design the staff calendar', dueDate: '2026-11-17' }),
  task(2, {
    title: 'Choose the payment provider',
    priority: 'p1',
    dueDate: '2026-11-06',
    details: 'Stripe or Razorpay',
    assignee: { id: 7, name: 'Riya Kapoor', status: 'active', isMember: true },
  }),
  task(3, {
    title: 'Plan the database tables',
    dueDate: '2026-10-28',
    assignee: { id: 12, name: 'Karan Mehta', status: 'active', isMember: false },
    latestReport: {
      status: 'in_progress',
      userId: 12,
      userName: 'Karan Mehta',
      workDate: '2026-10-29',
    },
  }),
  task(4, { title: 'Wireframes for the booking flow', status: 'done', dueDate: '2026-10-27' }),
  task(5, { title: 'Kickoff call with Acme', phase: 'requirement_gathering', status: 'done' }),
];

const DOCUMENTS = [
  { id: 1, phase: 'design', kind: 'file', title: 'Design-brief.pdf', createdAt: new Date() },
  { id: 2, phase: 'requirement_gathering', kind: 'note', title: SECRET, createdAt: new Date() },
];

async function render(props = {}) {
  const element = await PhasesTab({
    user: PM,
    project: PROJECT,
    plan: planOf('design', DATES),
    forecast: {},
    today: TODAY,
    canManage: true,
    ...props,
  });
  return renderToStaticMarkup(element);
}

const noTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const count = (html, text) => html.split(text).length - 1;

beforeEach(() => {
  listForProject.mockReset().mockResolvedValue(TASKS);
  listAssigneeOptions.mockReset().mockResolvedValue([
    { id: 7, name: 'Riya Kapoor', designation: 'PM', role: 'pm' },
    { id: 9, name: 'Neha Arora', designation: 'Designer', role: 'employee' },
  ]);
  listDocuments.mockReset().mockResolvedValue(DOCUMENTS);
});

describe("the manager's board", () => {
  it('asks for every task, who they can be for and the files and notes', async () => {
    await render();
    expect(listForProject).toHaveBeenCalledWith({ viewer: PM, projectId: 5 });
    expect(listAssigneeOptions).toHaveBeenCalledWith({ viewer: PM, projectId: 5 });
    expect(listDocuments).toHaveBeenCalledWith({ user: PM, projectId: 5 });
  });

  it('has a section per phase with only the current one open', async () => {
    const html = await render();
    for (const { label } of PROJECT_PHASES) expect(html).toContain(label);
    expect(count(html, 'aria-expanded="true"')).toBe(1);
    // 5 sections, "Show 1 done task" and the open phase's file (its name opens its text)
    expect(count(html, 'aria-expanded="false"')).toBe(7);
    expect(html).toContain('aria-controls="phases-design"');
    expect(html).not.toContain('No phase yet');
  });

  it('writes the header of each phase', async () => {
    const text = noTags(await render());
    expect(text).toContain('Requirement gathering Done Planned 6 to 23 Oct Actual 6 to 26 Oct');
    expect(text).toContain('Ended 3 days late');
    expect(text).toContain('Design Current Planned 26 Oct to 20 Nov Started 26 Oct');
    expect(text).toContain('Development Planned 9 Nov to 4 Dec');
    expect(text).toContain('Testing No planned dates');
    expect(text).toContain('1 of 4 tasks');
    expect(text).toContain('1 of 1 task');
    expect(count(text, 'No tasks yet')).toBe(4);
  });

  it('lists the open tasks P1 first, then by due date, with the done one folded away', async () => {
    const text = noTags(await render());
    const order = [
      'Choose the payment provider',
      'Plan the database tables',
      'Design the staff calendar',
      'Show 1 done task',
    ].map((title) => text.indexOf(title));
    expect(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]))).toBe(true);
    expect(text).not.toContain('Wireframes for the booking flow');
    expect(text).toContain('Task Owner Due Priority');
  });

  it('draws each row as the prototype, with what the old card showed', async () => {
    const html = await render();
    const text = noTags(html);
    expect(html).toContain('aria-label="Done: Choose the payment provider"');
    expect(html).toContain('aria-label="Edit task: Choose the payment provider"');
    expect(html).toContain('aria-label="Delete task: Choose the payment provider"');
    expect(text).toContain('Stripe or Razorpay');
    expect(text).toContain('Latest report: Karan, yesterday: In progress');
    expect(text).toContain('Karan Mehta Not on the project');
    expect(text).toContain('Owner: Anyone on the project');
    expect(text).toContain('2 days late');
    expect(text).toContain('Due 6 Nov');
    expect(text).toContain('Priority 1, highest');
  });

  it('has Add task, Edit dates, the files and notes of the open phase, and the move', async () => {
    const html = await render();
    const text = noTags(html);
    expect(count(text, 'Add task')).toBe(1);
    expect(count(text, 'Edit dates')).toBe(1);
    expect(text).toContain('Files and notes');
    expect(text).toContain('Design-brief.pdf');
    expect(text).not.toContain(SECRET); // another phase's, and that one is closed
    expect(text).toContain('Move to Development');
    expect(text).not.toContain('Only Riya Kapoor');
  });

  it('takes no new tasks on a completed project', async () => {
    const text = noTags(await render({ project: { ...PROJECT, status: 'completed' } }));
    expect(text).not.toContain('Add task');
    expect(text).toContain('Edit dates');
  });

  it('has no move button in Support, the last phase', async () => {
    const text = noTags(await render({ plan: planOf('support') }));
    expect(text).toContain('Support Current');
    expect(text).not.toContain('Move to');
    expect(text).not.toContain('Make this the current phase');
  });
});

describe("another PM's board", () => {
  const asOther = () => render({ user: OTHER_PM, canManage: false });

  it('never asks for files, notes or who a task can be for', async () => {
    await asOther();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(listAssigneeOptions).not.toHaveBeenCalled();
    expect(listForProject).toHaveBeenCalledWith({ viewer: OTHER_PM, projectId: 5 });
  });

  it('has no ticks, Add, Edit, Move, Edit dates or Delete', async () => {
    const html = await asOther();
    const text = noTags(html);
    expect(html).not.toContain('type="checkbox"');
    for (const word of [
      'Add task',
      'Edit dates',
      'Edit task',
      'Delete task',
      'Move to',
      'Make this',
    ]) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toContain('Design-brief.pdf');
    expect(text).not.toContain(SECRET);
  });

  it('says who can edit, and that files and notes are not for them', async () => {
    const text = noTags(await asOther());
    expect(text).toContain('Only Riya Kapoor and Admins can edit phases.');
    expect(count(text, 'Files and notes are only for Riya Kapoor and Admins.')).toBe(1);
  });

  it('still sees the phases, dates, tasks and who they are for', async () => {
    const text = noTags(await asOther());
    expect(text).toContain('Design Current Planned 26 Oct to 20 Nov');
    expect(text).toContain('Choose the payment provider');
    expect(text).toContain('Latest report: Karan, yesterday: In progress');
    expect(text).toContain('Task Owner Due Priority');
  });

  it('says Admins only on a project without a PM', async () => {
    const text = noTags(
      await render({ user: OTHER_PM, canManage: false, project: { ...PROJECT, pmName: null } }),
    );
    expect(text).toContain('Only Admins can edit phases.');
    expect(text).toContain('Files and notes are only for Admins.');
  });
});

describe('a project with no phase yet', () => {
  it('opens the first phase, marks none current and offers to start', async () => {
    const html = await render({ plan: planOf(null) });
    const text = noTags(html);
    expect(html).toContain('aria-controls="phases-requirement_gathering"');
    expect(text).not.toContain('Current');
    expect(text).not.toContain(' Done Planned');
    expect(text).toContain('Start Requirement gathering');
    expect(text).toContain(SECRET); // the open phase's note title
  });
});

describe('a project with no tasks', () => {
  it('says so in every section and draws no table', async () => {
    listForProject.mockResolvedValue([]);
    const html = await render({ plan: planOf('design') });
    const text = noTags(html);
    expect(count(text, 'No tasks yet')).toBe(7); // six counts and the open section's line
    expect(text).not.toContain('Task Owner Due Priority');
    expect(html).not.toContain('aria-label="Tasks in');
    expect(text).toContain('Add task');
  });

  it('says all tasks are done when they are', async () => {
    listForProject.mockResolvedValue([task(4, { status: 'done' })]);
    const text = noTags(await render());
    expect(text).toContain('All tasks are done.');
    expect(text).toContain('Show 1 done task');
    expect(text).not.toContain('Task Owner Due Priority');
  });
});

describe('the No phase yet section', () => {
  const legacy = [task(20, { title: 'Fix login timeout', phase: null, priority: 'p1' })];

  it('comes last and closed when some tasks have no phase', async () => {
    listForProject.mockResolvedValue([...TASKS, ...legacy]);
    const text = noTags(await render());
    expect(text.indexOf('No phase yet')).toBeGreaterThan(text.indexOf('Support'));
    expect(text).toContain('No phase yet 0 of 1 task');
    expect(text).not.toContain('Fix login timeout');
  });

  it('has no dates, files, Move or Edit dates when open', () => {
    const section = phaseSections({ plan: planOf('design'), tasks: legacy }).at(-1);
    const board = {
      project: PROJECT,
      plan: planOf('design'),
      today: TODAY,
      canManage: true,
      owners: [],
      managerName: 'Riya Kapoor',
      form: null,
      documentsFor: () => DOCUMENTS,
      isDoneShown: () => false,
      toggleDone: () => {},
      openForm: () => {},
      closeForm: () => {},
      editDates: () => {},
      deleteTask: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(PhaseSection, { section, open: true, onToggle: () => {}, board }),
    );
    const text = noTags(html);
    expect(text).toContain('No phase yet');
    expect(text).toContain('Fix login timeout');
    expect(text).toContain('Add task');
    for (const word of [
      'Planned',
      'No planned dates',
      'Edit dates',
      'Files and notes',
      'Move to',
    ]) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toContain('Make this the current phase');
    expect(text).not.toContain('Design-brief.pdf');
  });
});
