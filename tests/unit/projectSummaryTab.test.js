// The Summary, Timeline and Hours tabs and the PM view's head (CONTRACT 22 and 27), really rendered
// with the database-backed modules mocked: every state of the health box, Critical tasks and the AI
// summary card, the AI phase line (only when it names the next phase; never for another PM or on a
// Completed project), "Go to files" and the new empty prompt, and that another PM's page (a member
// of the project or not) never gets files, notes, summary text or AI lines. Client parts render
// their first state only: the dialogs, the task window and toasts open in the browser
// (tests/e2e/project-plan.spec.js).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

const SECRET = 'The client wants this kept quiet';

const isAvailable = vi.fn();
const listDocuments = vi.fn();
const getSummary = vi.fn();
const listForProject = vi.fn();
const progressByProject = vi.fn();
const listAssigneeOptions = vi.fn();
const getProjectReport = vi.fn();
const getPlan = vi.fn();
const findById = vi.fn();
const isMember = vi.fn();
const viewerContext = vi.fn();
const limits = vi.fn();
let storage = { ready: true, problem: null };
const getMinutesByProject = vi.fn();
let sessionUser = null;

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => sessionUser }));
vi.mock('@/modules/ai', () => ({ ai: { isAvailable: (...args) => isAvailable(...args) } }));
vi.mock('@/modules/projectSummaries', () => ({
  projectSummaries: {
    listDocuments: (...args) => listDocuments(...args),
    getSummary: (...args) => getSummary(...args),
  },
}));
vi.mock('@/modules/projectTasks', () => ({
  projectTasks: {
    listForProject: (...args) => listForProject(...args),
    progressByProject: (...args) => progressByProject(...args),
    listAssigneeOptions: (...args) => listAssigneeOptions(...args),
  },
}));
vi.mock('@/modules/dashboard', () => ({
  dashboard: { getProjectReport: (...args) => getProjectReport(...args) },
}));
vi.mock('@/modules/projectPlan', () => ({
  projectPlan: { getPlan: (...args) => getPlan(...args) },
}));
vi.mock('@/modules/projects', () => ({
  projects: {
    findById: (...args) => findById(...args),
    isMember: (...args) => isMember(...args),
    canManage: (user, project) => user.role === 'admin' || project.pmId === user.id,
  },
}));
vi.mock('@/modules/projectFiles', () => ({
  projectFiles: {
    viewerContext: (...args) => viewerContext(...args),
    limits: (...args) => limits(...args),
    storageStatus: async () => storage,
  },
}));
vi.mock('@/modules/reports', () => ({
  reports: { getMinutesByProject: (...args) => getMinutesByProject(...args) },
}));
vi.mock('@/modules/settings', () => ({
  settings: { getAll: async () => ({ timezone: 'Asia/Kolkata' }) },
}));

const { loadProjectHead } = await import('@/app/(app)/projects/[id]/projectHead.js');
const { default: SummaryTab } = await import('@/app/(app)/projects/[id]/SummaryTab.jsx');
const { default: HealthBox } = await import('@/app/(app)/projects/[id]/HealthBox.jsx');
const { default: HoursTab } = await import('@/app/(app)/projects/[id]/HoursTab.jsx');
const { default: TimelineTab } = await import('@/app/(app)/projects/[id]/TimelineTab.jsx');
const { criticalTasks, seeAllHref } =
  await import('@/app/(app)/projects/[id]/CriticalTasksCard.jsx');

const TODAY = '2026-10-30';
const PM = { id: 7, role: 'pm', status: 'active' };
const OTHER_PM = { id: 8, role: 'pm', status: 'active' };
const LIMITS = { maxFileBytes: 524288000, maxTaskFiles: 20, pickMax: 50 };

const planOf = (currentPhase = 'requirement_gathering', deadline = '2026-12-15', dates = {}) => ({
  currentPhase,
  deadline,
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

const FORECAST = {
  kind: 'off',
  pill: 'Off track',
  title: 'Off track: will miss the deadline by about 14 days',
  body: 'At the current speed (4 tasks a week) the work ends around 29 Dec.',
  pct: 32,
  done: 16,
  total: 50,
  finishOn: '2026-12-29',
};

const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  priority: 'p1',
  status: 'open',
  phase: 'design',
  dueDate: null,
  assignee: null,
  ...more,
});

const FILE = { id: 1, kind: 'file', title: 'SOW.pdf' };
const NOTE = { id: 2, kind: 'note', title: 'Kickoff call notes' };

const summaryOf = (more = {}) => ({
  body: {
    overview: `A booking app. ${SECRET}.`,
    scope: [{ text: 'Patient booking', notInScope: false, source: 'SOW.pdf, page 3' }],
    deadlines: [{ text: 'Go-live', dateAsWritten: '15 December', source: 'SOW.pdf, page 9' }],
    risks: [
      { text: 'Payment provider not chosen yet', kind: 'risk', source: 'Kickoff call notes' },
    ],
    actions: [
      {
        key: 'a1',
        owner: 'client',
        text: 'Send logo and brand files',
        dueAsWritten: 'Friday',
        taskId: null,
      },
      { key: 'a2', owner: 'us', text: 'Share the wireframes', dueAsWritten: null, taskId: 30 },
    ],
    nextPhase: {
      phase: 'design',
      quote: 'Client approved the scope on the call',
      source: 'Kickoff call notes',
    },
  },
  stale: false,
  truncated: false,
  updatedAt: new Date('2026-10-28T10:00:00Z'),
  updatedByName: 'Riya Kapoor',
  sources: { files: 1, notes: 1 },
  ...more,
});

const HEAD = {
  project: { id: 5, status: 'active', pmName: 'Riya Kapoor' },
  plan: planOf(),
  forecast: FORECAST,
  today: TODAY,
  canManage: true,
  access: 'manage',
  filesAccess: 'manage',
};

async function summaryTab(more = {}, user = PM) {
  const element = await SummaryTab({ head: { ...HEAD, ...more }, user });
  return renderToStaticMarkup(element);
}

const noTags = (html) => html.replace(/<[^>]*>/g, '');

beforeEach(() => {
  sessionUser = PM;
  isAvailable.mockReset().mockResolvedValue(true);
  listDocuments.mockReset().mockResolvedValue([FILE, NOTE]);
  getSummary.mockReset().mockResolvedValue(summaryOf());
  listForProject.mockReset().mockResolvedValue([]);
  getProjectReport.mockReset();
});

describe('loadProjectHead for the PM view', () => {
  const PROJECT = {
    id: 5,
    name: 'Acme',
    pmId: 7,
    status: 'active',
    createdAt: new Date('2026-08-01T04:00:00Z'),
  };
  const ctxOf = (manages, member) => ({ projectId: 5, userId: 7, active: true, manages, member });

  beforeEach(() => {
    setNowForTests('2026-10-30T06:30:00Z'); // noon in Asia/Kolkata
    findById.mockReset().mockResolvedValue(PROJECT);
    isMember.mockReset().mockResolvedValue(false);
    getPlan.mockReset().mockResolvedValue(planOf('design', '2026-12-15'));
    progressByProject
      .mockReset()
      .mockResolvedValue({ 5: { total: 50, done: 16, doneByWeek: [4, 4, 4] } });
    viewerContext.mockReset().mockResolvedValue(ctxOf(true, false));
    limits.mockReset().mockResolvedValue(LIMITS);
    listAssigneeOptions.mockReset().mockResolvedValue([{ id: 9, name: 'Vishal Saini' }]);
    getMinutesByProject.mockReset().mockResolvedValue({ 5: 600 });
  });

  afterEach(() => setNowForTests(null));

  it('works out the health for the tabs and the tag', async () => {
    const head = await loadProjectHead(5, PM);
    expect(head.today).toBe(TODAY);
    expect(head.canManage).toBe(true);
    expect(head.access).toBe('manage');
    expect(head.project.statusLabel).toBe('Active');
    expect(head.forecast).toMatchObject({
      kind: 'off',
      pill: 'Off track',
      pct: 32,
      left: 34,
      finishOn: '2026-12-29',
    });
  });

  it('counts the last 3 full weeks', async () => {
    await loadProjectHead(5, PM);
    const [ids, { weeks }] = progressByProject.mock.calls[0];
    expect(ids).toEqual([5]);
    expect(weeks).toHaveLength(3);
    expect(weeks[0].to.toISOString()).toBe('2026-10-25T18:30:00.000Z'); // this Monday in Kolkata
  });

  it('carries the file rights, the uploaders’ limits and the people list for the PM', async () => {
    const head = await loadProjectHead(5, PM);
    expect(head.filesAccess).toBe('manage');
    expect(head.limits).toEqual(LIMITS);
    expect(head.storageReady).toBe(true);
    expect(head.options).toEqual([{ id: 9, name: 'Vishal Saini' }]);
    expect(viewerContext).toHaveBeenCalledWith({ viewer: PM, project: PROJECT });
    expect(listAssigneeOptions).toHaveBeenCalledWith({ viewer: PM, projectId: 5 });
    expect(head).not.toHaveProperty('hoursThisMonth');
  });

  it('tells the task form when file storage is not set up', async () => {
    storage = { ready: false, problem: 'not_set' };
    expect((await loadProjectHead(5, PM)).storageReady).toBe(false);
    storage = { ready: true, problem: null };
  });

  it('gives an Admin the PM view with every right', async () => {
    const head = await loadProjectHead(5, { id: 1, role: 'admin', status: 'active' });
    expect(head.access).toBe('manage');
    expect(head.canManage).toBe(true);
  });

  it('knows another PM cannot manage it, and gives them no limits or people', async () => {
    viewerContext.mockResolvedValue(ctxOf(false, false));
    const head = await loadProjectHead(5, OTHER_PM);
    expect(head.canManage).toBe(false);
    expect(head.access).toBe('team');
    expect(head.filesAccess).toBe('none');
    expect(head.forecast.pill).toBe('Off track');
    expect(head).not.toHaveProperty('limits');
    expect(head).not.toHaveProperty('options');
    expect(head).not.toHaveProperty('storageReady');
    expect(limits).not.toHaveBeenCalled();
    expect(listAssigneeOptions).not.toHaveBeenCalled();
  });

  it('gives a PM who is a member the PM view with a member’s file rights', async () => {
    viewerContext.mockResolvedValue(ctxOf(false, true));
    const head = await loadProjectHead(5, OTHER_PM);
    expect(head.access).toBe('team');
    expect(head.filesAccess).toBe('member');
  });

  it('never asks a team.view holder for membership', async () => {
    await loadProjectHead(5, OTHER_PM);
    expect(isMember).not.toHaveBeenCalled();
    expect(getMinutesByProject).not.toHaveBeenCalled();
  });

  it('reads No plan yet with no plan and no tasks', async () => {
    getPlan.mockResolvedValue(planOf(null, null));
    progressByProject.mockResolvedValue({ 5: { total: 0, done: 0, doneByWeek: [0, 0, 0] } });
    const head = await loadProjectHead(5, PM);
    expect(head.forecast.pill).toBe('No plan yet');
  });

  it('answers null with no such project, without reading further', async () => {
    findById.mockResolvedValue(null);
    expect(await loadProjectHead(99, PM)).toBeNull();
    expect(getPlan).not.toHaveBeenCalled();
    expect(viewerContext).not.toHaveBeenCalled();
  });
});

describe('the health box', () => {
  const box = (kind) =>
    renderToStaticMarkup(
      createElement(HealthBox, { forecast: { kind, title: 'A title', body: 'A body' } }),
    );

  it('says what the forecast says, as a status', () => {
    const html = box('off');
    expect(html).toContain('role="status"');
    expect(html).toContain('A title');
    expect(html).toContain('A body');
  });

  it.each([
    ['off', 'lucide-triangle-alert', 'healthRed'],
    ['risk', 'lucide-triangle-alert', 'healthMarigold'],
    ['on', 'lucide-circle-check', 'healthGreen'],
    ['nodata', 'lucide-circle-alert', 'healthNeutral'],
    ['nodeadline', 'lucide-circle-alert', 'healthNeutral'],
    ['noplan', 'lucide-circle-alert', 'healthNeutral'],
    ['hold', 'lucide-circle-alert', 'healthNeutral'],
    ['completed', 'lucide-circle-alert', 'healthNeutral'],
  ])('draws %s with its icon and colour', (kind, icon, tone) => {
    expect(box(kind)).toContain(icon);
    expect(box(kind)).toContain(tone);
  });

  it('heads the Summary tab', async () => {
    const html = await summaryTab();
    expect(html.indexOf(FORECAST.title)).toBeLessThan(html.indexOf('Critical tasks'));
    expect(noTags(html)).toContain(FORECAST.body);
  });
});

describe('the Critical tasks card', () => {
  it('orders open P1s by due date, tasks without a date last', () => {
    const tasks = [
      task(1),
      task(2, { dueDate: '2026-11-06' }),
      task(3, { priority: 'p2', dueDate: '2026-10-01' }),
      task(4, { dueDate: '2026-10-28' }),
      task(5, { status: 'done', dueDate: '2026-10-01' }),
      task(6),
    ];
    expect(criticalTasks(tasks).map((row) => row.id)).toEqual([4, 2, 1, 6]);
  });

  it('shows at most 5 and counts them all', async () => {
    listForProject.mockResolvedValue([1, 2, 3, 4, 5, 6, 7].map((id) => task(id)));
    const html = noTags(await summaryTab());
    expect(html).toContain('7 open');
    expect(html).toContain('Task 5');
    expect(html).not.toContain('Task 6');
  });

  it('asks only for open tasks, as the viewer', async () => {
    await summaryTab();
    expect(listForProject).toHaveBeenCalledWith({ viewer: PM, projectId: 5, status: 'open' });
  });

  it('reads the viewer from the session when the page doesn’t pass one', async () => {
    sessionUser = OTHER_PM;
    renderToStaticMarkup(await SummaryTab({ head: { ...HEAD, canManage: false } }));
    expect(listForProject).toHaveBeenCalledWith({ viewer: OTHER_PM, projectId: 5, status: 'open' });
  });

  it('shows the phase, owner and due tag, with a box that only names the task', async () => {
    listForProject.mockResolvedValue([
      task(1, {
        title: 'Scope signed off',
        phase: 'requirement_gathering',
        dueDate: TODAY,
        assignee: { name: 'Riya Kapoor' },
      }),
      task(2, { title: 'Pick a host', phase: null }),
    ]);
    const html = await summaryTab();
    const text = noTags(html);
    expect(text).toContain('Requirement gathering · Riya Kapoor');
    expect(text).toContain('Due today');
    expect(text).toContain('No phase yet · Anyone on the project');
    expect(text).toContain('No due date');
    expect(html).toMatch(
      /<label[^>]*><input[^>]*aria-label="Done: Scope signed off"[^>]*\/><\/label>/,
    );
  });

  it('makes each title a button that opens the task window', async () => {
    listForProject.mockResolvedValue([task(1, { title: 'Scope signed off' })]);
    const html = await summaryTab();
    expect(html).toMatch(
      /<button type="button" class="[^"]*criticalTitle[^"]*">Scope signed off<\/button>/,
    );
  });

  it('says so with none open, and links to the Board with Critical pressed', async () => {
    const html = await summaryTab();
    expect(noTags(html)).toContain('0 open');
    expect(noTags(html)).toContain('No critical tasks open.');
    expect(seeAllHref(5)).toBe('/projects/5?tab=board&show=critical');
    expect(html).toContain('href="/projects/5?tab=board&amp;show=critical"');
    expect(noTags(html)).toContain('See all tasks');
  });
});

describe('the AI summary card', () => {
  it('asks for files or a note when there are none, and goes to the Files tab', async () => {
    listDocuments.mockResolvedValue([]);
    getSummary.mockResolvedValue(null);
    const html = await summaryTab();
    expect(noTags(html)).toContain(
      'Upload a PDF, Word or text file, or write a note, in Files, and AI writes a summary here.',
    );
    expect(noTags(html)).toContain('Go to files');
    expect(html).toContain('href="/projects/5?tab=files"');
    expect(noTags(html)).not.toContain('Go to phases');
    expect(html).not.toContain('tab=phases');
  });

  it.each([
    [[FILE, NOTE], '1 file and 1 note are ready.'],
    [[FILE], '1 file is ready.'],
    [[NOTE, { ...NOTE, id: 3 }], '2 notes are ready.'],
  ])('offers to write one from %#', async (documents, words) => {
    listDocuments.mockResolvedValue(documents);
    getSummary.mockResolvedValue(null);
    const html = noTags(await summaryTab());
    expect(html).toContain(words);
    expect(html).toContain('Write summary');
  });

  it('shows a summary with its action items, risk and footer', async () => {
    const html = noTags(await summaryTab());
    expect(html).toContain('Action items');
    expect(html).toContain('Client: Send logo and brand files · Friday');
    expect(html).toContain('Add to tasks');
    expect(html).toContain('Us: Share the wireframes · No date given');
    expect(html).toContain('Added');
    expect(html).toContain(SECRET);
    expect(html).toContain('Risk: Payment provider not chosen yet');
    expect(html).toContain('Read full summary');
    expect(html).toContain('From 1 file and 1 note. Written by AI, check anything important.');
    expect(html).not.toContain('Update summary');
  });

  it('takes no new tasks on a completed project', async () => {
    const html = noTags(await summaryTab({ project: { id: 5, status: 'completed' } }));
    expect(html).toContain('Send logo and brand files');
    expect(html).not.toContain('Add to tasks');
  });

  it('offers an update when the files or notes changed', async () => {
    getSummary.mockResolvedValue(summaryOf({ stale: true }));
    const html = noTags(await summaryTab());
    expect(html).toContain('Files or notes changed since this summary.');
    expect(html).toContain('Update summary');
    expect(html).not.toContain('Written by AI');
    expect(html).toContain(SECRET);
  });

  it('says when only part of the text was read', async () => {
    getSummary.mockResolvedValue(summaryOf({ truncated: true }));
    expect(noTags(await summaryTab())).toContain('Only the first 50,000 characters were read.');
  });

  it('says AI is off, with nothing to write', async () => {
    isAvailable.mockResolvedValue(false);
    getSummary.mockResolvedValue(null);
    const html = noTags(await summaryTab());
    expect(html).toContain('AI summary is off. An Admin can turn it on in Settings → AI.');
    expect(html).not.toContain('Write summary');
    expect(html).not.toContain('Go to files');
  });

  it('keeps a summary readable when AI is off, with no update', async () => {
    isAvailable.mockResolvedValue(false);
    getSummary.mockResolvedValue(summaryOf({ stale: true }));
    const html = noTags(await summaryTab());
    expect(html).toContain(SECRET);
    expect(html).toContain('AI summary is off.');
    expect(html).toContain('Files or notes changed since this summary.');
    expect(html).not.toContain('Update summary');
  });

  it('treats a failed availability check as off', async () => {
    isAvailable.mockRejectedValue(new Error('settings are down'));
    getSummary.mockResolvedValue(null);
    expect(noTags(await summaryTab())).toContain('AI summary is off.');
  });

  it('does not send the text of a summary whose documents are all gone', async () => {
    listDocuments.mockResolvedValue([]);
    const html = await summaryTab();
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain('AI suggests');
    expect(noTags(html)).toContain('Go to files');
  });

  it('never says Gemini', async () => {
    expect(await summaryTab()).not.toMatch(/gemini/i);
  });

  it('answers as empty before the migration has run', async () => {
    const missing = Object.assign(new Error('no such table'), { errno: 1146 });
    listDocuments.mockRejectedValue(missing);
    getSummary.mockRejectedValue(missing);
    const html = noTags(await summaryTab());
    expect(html).toContain('Go to files');
    expect(html).not.toContain(SECRET);
  });

  it('lets other database errors through', async () => {
    listDocuments.mockRejectedValue(Object.assign(new Error('down'), { errno: 2006 }));
    await expect(summaryTab()).rejects.toThrow('down');
  });

  it('sits beside the health box and Critical tasks', async () => {
    const html = await summaryTab();
    expect(html).toMatch(/class="[^"]*_summary_[^"]*"/);
    expect(html).not.toMatch(/class="[^"]*_single_[^"]*"/);
    expect(html.indexOf('Critical tasks')).toBeLessThan(html.indexOf('AI summary'));
  });
});

describe('the AI phase line', () => {
  it('shows its quote and source in the AI card, under the action items', async () => {
    const html = await summaryTab();
    const text = noTags(html);
    expect(text).toContain('AI suggests moving on: “Client approved the scope on the call”');
    expect(text).toContain('· Kickoff call notes');
    const card = html.slice(html.indexOf('id="summary-ai"'));
    expect(card).toContain('AI suggests moving on');
    expect(card.indexOf('Action items')).toBeLessThan(card.indexOf('AI suggests moving on'));
    expect(card.indexOf('AI suggests moving on')).toBeLessThan(card.indexOf(SECRET));
  });

  it('shows without action items too', async () => {
    getSummary.mockResolvedValue(summaryOf({ body: { ...summaryOf().body, actions: [] } }));
    const html = noTags(await summaryTab());
    expect(html).not.toContain('Action items');
    expect(html).toContain('AI suggests moving on');
  });

  it('shows only when it names the next phase', async () => {
    expect(await summaryTab({ plan: planOf('design') })).not.toContain('AI suggests');
    const later = summaryOf({
      body: { ...summaryOf().body, nextPhase: { phase: 'testing', quote: 'Ready', source: 'x' } },
    });
    getSummary.mockResolvedValue(later);
    expect(await summaryTab()).not.toContain('AI suggests');
  });

  it('never shows on a completed project', async () => {
    const completed = await summaryTab({ project: { id: 5, status: 'completed' } });
    expect(completed).not.toContain('AI suggests');
  });

  it('moves nothing: no Move button anywhere on the tab', async () => {
    const html = noTags(await summaryTab());
    expect(html).not.toContain('Move to');
    expect(html).not.toContain('Start Requirement gathering');
  });
});

describe("another PM's Summary tab", () => {
  beforeEach(() => {
    listForProject.mockResolvedValue([task(1, { title: 'Scope signed off', dueDate: TODAY })]);
  });

  const other = (more = {}) =>
    summaryTab({ canManage: false, access: 'team', filesAccess: 'none', ...more }, OTHER_PM);

  it('never asks for files, notes, summaries or whether AI is on', async () => {
    await other();
    await other({ filesAccess: 'member' });
    expect(listDocuments).not.toHaveBeenCalled();
    expect(getSummary).not.toHaveBeenCalled();
    expect(isAvailable).not.toHaveBeenCalled();
  });

  it.each([['none'], ['member']])(
    'has no summary text, AI line or summary card (file rights %s)',
    async (filesAccess) => {
      const html = await other({ filesAccess });
      expect(html).not.toContain(SECRET);
      expect(html).not.toContain('AI suggests');
      expect(html).not.toContain('Client approved');
      expect(html).not.toContain('AI summary');
      expect(html).not.toContain('summary-ai');
    },
  );

  it('has no ticks', async () => {
    const html = await other();
    expect(html).not.toContain('type="checkbox"');
  });

  it('gets the health box and Critical tasks at full width', async () => {
    const html = await other();
    expect(html).toMatch(/class="[^"]*_single_[^"]*"/);
    const text = noTags(html);
    expect(text).toContain(FORECAST.title);
    expect(text).toContain('Scope signed off');
    expect(text).toContain('See all tasks');
  });
});

describe('the Timeline tab', () => {
  const dated = {
    requirement_gathering: {
      plannedStart: '2026-10-06',
      plannedEnd: '2026-10-23',
      actualStart: '2026-10-06',
    },
  };
  const timeline = (plan, canManage = true) =>
    renderToStaticMarkup(
      createElement(TimelineTab, {
        project: { id: 5 },
        plan,
        forecast: FORECAST,
        today: TODAY,
        canManage,
      }),
    );

  it('draws the chart with its legend and summary', () => {
    const html = timeline(planOf('requirement_gathering', '2026-12-15', dated));
    const text = noTags(html);
    expect(text).toContain('1 phase behind plan: Requirement gathering is 7 days late.');
    expect(text).toContain('Planned');
    expect(text).toContain('Actual');
    expect(text).toContain('Late');
    expect(text).toContain('Today 30 Oct');
    expect(text).toContain('Deadline 15 Dec');
    expect(text).toContain('Expected finish 29 Dec');
  });

  it('leaves the summary line out when nothing is late', () => {
    const html = timeline(
      planOf('design', null, { design: { plannedStart: '2026-11-02', plannedEnd: '2026-11-20' } }),
    );
    expect(noTags(html)).not.toContain('behind plan');
    expect(noTags(html)).not.toContain('late so far');
    expect(noTags(html)).not.toContain('No phases are late');
  });

  it('points the PM to the Board with no planned dates', () => {
    const html = timeline(planOf());
    expect(noTags(html)).toContain('No planned dates yet.');
    expect(noTags(html)).toContain('Add dates to each phase from its menu on the Board.');
    expect(noTags(html)).toContain('Go to the board');
    expect(html).toContain('href="/projects/5?tab=board"');
    expect(html).not.toContain('tab=phases');
  });

  it('has nothing to do for another PM with no planned dates', () => {
    const html = timeline(planOf(), false);
    expect(noTags(html)).toContain('No planned dates yet.');
    expect(noTags(html)).not.toContain('menu on the Board');
    expect(html).not.toContain('href="/projects/5?tab=board"');
  });
});

describe('the Hours tab', () => {
  const REPORT = {
    project: { id: 5, name: 'Acme', color: 'blue' },
    range: {
      key: 'all',
      label: 'All time',
      when: 'yet',
      sub: 'all time',
      from: '2026-10-01',
      to: TODAY,
      end: TODAY,
    },
    totals: { minutes: 0, hours: '0h', members: 0, people: 0 },
    today: TODAY,
    exportHref: '/api/projects/5/report?format=xlsx',
    kpis: [{ key: 'hours', label: 'Hours logged', value: '0h' }],
    byPerson: [],
    byPeriod: [],
    periodUnit: 'week',
    tasks: [],
    entries: [],
    entriesPage: { limit: 25, offset: 0, total: 0 },
  };

  const hours = async (query = {}) => {
    getProjectReport.mockResolvedValue(REPORT);
    return renderToStaticMarkup(await HoursTab({ user: PM, projectId: 5, query }));
  };

  it('keeps tab=hours on every range link', async () => {
    const html = (await hours()).replaceAll('&amp;', '&');
    expect(html).toContain('href="/projects/5?tab=hours&range=week"');
    expect(html).toContain('href="/projects/5?tab=hours&range=month"');
    expect(html).toContain('href="/projects/5?tab=hours"');
    expect(html).toContain(
      'href="/projects/5?tab=hours&range=custom&from=2026-10-01&to=2026-10-30"',
    );
  });

  it('keeps tab=hours through the custom range form', async () => {
    const html = await hours({ range: 'custom', from: '2026-10-01', to: '2026-10-30' });
    expect(html).toContain('action="/projects/5"');
    expect(html).toMatch(/<input type="hidden" name="tab" value="hours"\/>/);
    expect(getProjectReport).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 5, range: 'custom', viewer: PM }),
    );
  });

  it('has the report and Download Excel, and no Priority tasks card', async () => {
    const html = await hours();
    expect(noTags(html)).toContain('Download Excel');
    expect(noTags(html)).toContain('Hours logged');
    expect(noTags(html)).toContain('Hours by person');
    expect(noTags(html)).toContain('Hours over time');
    expect(noTags(html)).toContain('Daily log');
    expect(noTags(html)).not.toContain('Priority tasks');
  });

  it('asks for all time by default', async () => {
    await hours();
    expect(getProjectReport).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 5, range: 'all' }),
    );
  });

  it('answers 404 when the report has no project', async () => {
    const { AppError } = await import('@/lib/errors');
    getProjectReport.mockRejectedValue(new AppError('NOT_FOUND'));
    await expect(HoursTab({ user: PM, projectId: 5, query: {} })).rejects.toThrow('NOT_FOUND');
  });
});
