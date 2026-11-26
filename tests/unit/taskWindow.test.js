// The task window (CONTRACT 27 and 28, Task window), its parts rendered on the server with the
// page's providers mocked: the header ("#40", the phase and "Current"), the right rail (the face
// button and "Assign to me" only in manage mode on an open task that isn't the viewer's, "Move to
// phase…" only in manage mode on an open task, "(you)", the away labels, "None yet", "Your time"
// for a viewer without `team.view`, "critical" after P1, Added by), Updates ("Showing the newest
// 10.", the empty sentence) and Latest report (the first update), the footer of each mode (`mine`
// gets Open project and, with `canManage`, Mark done or Reopen, never Edit or Delete; `today` and
// `member` never change tasks), Files (linked rows with " · From Files: Design", the two X labels,
// the Add files menu only in manage mode on a project page), the error state and where focus goes
// back on close. The window itself (portal, focus, Escape, exit) opens in the browser;
// taskWindowFocus.test.js has its busy buttons, taskWindowLook.test.js its look.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ editor: null, attach: null, batch: null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider', () => ({
  useTaskEditor: () => page.editor,
  useSavedTask: () => null,
  TaskEditorProvider: ({ children }) => children,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskActionsProvider', () => ({
  useTaskActions: () => null,
}));
vi.mock('@/components/files/TaskAttachProvider', () => ({
  useTaskAttach: () => page.attach,
  useTaskBatch: () => page.batch,
  TaskAttachProvider: ({ children }) => children,
}));

const { TaskContext, TaskNote } = await import('@/components/task/TaskWindowParts.jsx');
const { default: TaskWindowRail } = await import('@/components/task/TaskWindowRail.jsx');
const { TaskLatest, TaskUpdates } = await import('@/components/task/TaskUpdates.jsx');
const { default: TaskWindowFiles } = await import('@/components/task/TaskWindowFiles.jsx');
const { useTaskWindowFooter } = await import('@/components/task/TaskWindowFooter.jsx');
const view = await import('@/components/task/taskWindowView.js');
const { nextPin } = await import('@/components/task/shownPerson.js');

const TODAY = '2026-11-23';
const SIMRAN = {
  id: 11,
  name: 'Simran Kaur',
  initials: 'SK',
  avatarUrl: null,
  role: 'employee',
  status: 'active',
  isMember: true,
};
const UPDATES = [
  {
    userId: 11,
    userName: 'Simran Kaur',
    initials: 'SK',
    avatarUrl: null,
    workDate: '2026-11-23',
    status: 'in_progress',
    title: "Found the cause: the bank's reply times out on the last step.",
  },
  {
    userId: 11,
    userName: 'Simran Kaur',
    initials: 'SK',
    avatarUrl: null,
    workDate: '2026-11-20',
    status: 'blocked',
    title: 'Reproduced the failure with a test card.',
  },
];

const file = (id, name, extra = {}) => ({
  id,
  projectId: 5,
  scope: 'task',
  taskId: 40,
  name,
  ext: name.split('.').pop(),
  sizeBytes: 348160,
  isPicture: false,
  thumbUrl: null,
  viewUrl: null,
  typeLabel: 'PDF',
  downloadUrl: `/api/project-files/${id}`,
  ...extra,
});
const PNG = file(1, 'card-payment-error.png', {
  isPicture: true,
  thumbUrl: '/api/project-files/1/thumb',
  viewUrl: '/api/project-files/1/view',
  typeLabel: 'Picture',
  sizeBytes: 1258291,
});
const PDF = file(2, 'checkout-error-steps.pdf');

const details = (extra = {}) => ({
  id: 40,
  projectId: 5,
  project: {
    id: 5,
    name: 'acme-store',
    color: 'green',
    status: 'active',
    isUrgent: false,
    pmId: 7,
  },
  title: 'Checkout fix before client demo',
  details: 'Card payments fail on the last step.\nThe demo is on Friday.',
  priority: 'p1',
  status: 'open',
  phase: 'development',
  dueDate: '2026-11-27',
  assignee: SIMRAN,
  createdBy: { id: 7, name: 'Riya Kapoor' },
  createdAt: '2026-11-23T06:30:00.000Z',
  doneAt: null,
  latestReport: UPDATES[0],
  updates: UPDATES,
  updateCount: 2,
  minutes: 340,
  privateLinkCount: 0,
  files: [PNG, PDF],
  fileCount: 2,
  canManage: true,
  canSeeFiles: true,
  ...extra,
});

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
const render = (type, props) => renderToStaticMarkup(createElement(type, props));

function Footer(props) {
  return createElement('footer', null, useTaskWindowFooter(props));
}
const footer = (props) => render(Footer, { onClose: () => {}, todo: null, ...props });

const removal = { remove: () => {}, isHidden: () => false };
const files = (props) => render(TaskWindowFiles, { headingId: 'files', removal, ...props });

beforeEach(() => {
  page.editor = null;
  page.attach = null;
  page.batch = null;
});

/** The rail as a mode draws it. */
const rail = (task, { mode = 'manage', viewerId = null, canAct = true } = {}) =>
  render(TaskWindowRail, {
    task,
    facts: view.railFacts(task, { mode, viewerId, canAct }),
    today: TODAY,
    faceRef: { current: null },
    onPeople: () => {},
    onTake: () => {},
    onMove: () => {},
  });

describe('the header', () => {
  it('names the task number, the project and the phase, with "Current" on the current phase', () => {
    const current = render(TaskContext, { task: details(), currentPhase: 'development' });
    expect(text(current)).toBe('#40 acme-store Development Current');
    expect(text(render(TaskContext, { task: details(), currentPhase: 'testing' }))).toBe(
      '#40 acme-store Development',
    );
    expect(text(render(TaskContext, { task: details({ phase: null }) }))).toBe(
      '#40 acme-store No phase yet',
    );
  });
});

describe('the right rail', () => {
  it('shows the facts: the person, the due date, "critical" after P1, the time, who added it', () => {
    const html = rail(details(), { mode: 'team' });
    const shown = text(html);
    expect(shown).toContain('Assigned to SK Simran Kaur');
    expect(shown).toContain('Due Due 27 Nov');
    expect(shown).toContain('Priority P1 Priority 1, highest critical');
    expect(shown).toContain('Phase Development');
    expect(shown).toContain('Time spent 5h 40m from timers');
    expect(shown).toContain('Added by Riya Kapoor on Mon, 23 Nov');
    expect(html).toContain('<dl');
    expect(shown).not.toMatch(/Assign to me|Move to phase/);
  });

  it('gives the manager the face button, Assign to me and Move to phase… on an open task', () => {
    const html = rail(details(), { viewerId: 7 });
    expect(labels(html)).toContain('Assigned to Simran Kaur. Change person');
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*data-face-button=""/);
    expect(text(html)).toContain('Assign to me');
    expect(text(html)).toContain('Move to phase…');
    const anyone = rail(details({ assignee: null }), { viewerId: 7 });
    expect(labels(anyone)).toContain('Assigned to anyone on the project. Change person');
  });

  it("leaves Assign to me out on the viewer's own task, and both out on a done task", () => {
    const own = text(rail(details(), { viewerId: 11 }));
    expect(own).not.toContain('Assign to me');
    expect(own).toContain('Move to phase…');
    const done = text(rail(details({ status: 'done' }), { viewerId: 7 }));
    expect(done).not.toMatch(/Assign to me|Move to phase/);
    // Without the page's task actions (no provider) nothing is offered.
    expect(text(rail(details(), { viewerId: 7, canAct: false }))).not.toMatch(/Assign to me/);
  });

  it('never offers the actions in the other modes, whatever canManage says', () => {
    for (const mode of ['team', 'member', 'today', 'mine']) {
      const html = rail(details(), { mode, viewerId: 7 });
      expect(text(html)).not.toMatch(/Assign to me|Move to phase/);
      expect(labels(html).some((label) => label.startsWith('Assigned to'))).toBe(false);
    }
  });

  it('says "(you)" after the viewer, Anyone, and the away labels', () => {
    expect(text(rail(details(), { mode: 'member' }))).toContain('Simran Kaur (you)');
    expect(text(rail(details(), { mode: 'team', viewerId: 11 }))).toContain('Simran Kaur (you)');
    expect(text(rail(details(), { mode: 'team', viewerId: 7 }))).not.toContain('(you)');
    // My tasks: every row is the viewer's own, until someone else takes it while it is open.
    expect(text(rail(details(), { mode: 'mine', viewerId: 11 }))).toContain('Simran Kaur (you)');
    expect(text(rail(details(), { mode: 'mine', viewerId: 7 }))).not.toContain('(you)');
    const anyone = text(rail(details({ assignee: null }), { mode: 'member' }));
    expect(anyone).toContain('Assigned to Anyone on the project');
    const away = details({ assignee: { ...SIMRAN, isMember: false }, priority: 'p2' });
    const shown = text(rail(away, { mode: 'team' }));
    expect(shown).toContain('Simran Kaur Not on the project');
    expect(shown).not.toContain('critical');
    const gone = details({ assignee: { ...SIMRAN, status: 'deactivated' } });
    expect(text(rail(gone, { mode: 'team' }))).toContain('Deactivated');
    expect(text(rail(gone, { viewerId: 7 }))).toContain('Deactivated');
  });

  it('labels a member\'s own minutes "Your time", and says "None yet" at 0', () => {
    const member = details({ canManage: false, minutes: 30 });
    expect(text(rail(member, { mode: 'member' }))).toContain('Your time 30m from timers');
    expect(text(rail(member, { mode: 'today' }))).toContain('Your time 30m from timers');
    expect(text(rail(details(), { mode: 'today' }))).toContain('Time spent 5h 40m');
    expect(text(rail(details({ minutes: 0 }), { mode: 'mine' }))).toContain('Time spent None yet');
    expect(rail(details({ minutes: 120 }), { mode: 'team' })).toMatch(
      /<span class="[^"]*number[^"]*">2h<\/span> from timers/,
    );
  });

  it('leaves Added by out when the task does not say who added it', () => {
    const html = rail(details({ createdBy: null }), { mode: 'team' });
    expect(text(html)).not.toContain('Added by');
    expect(view.addedByText(details({ createdBy: null }))).toBeNull();
  });
});

describe('the note, Updates and the latest report', () => {
  it('keeps the note with its line breaks, or says "No note."', () => {
    const html = render(TaskNote, { task: details(), headingId: 'n' });
    expect(html).toContain('Card payments fail on the last step.\nThe demo is on Friday.');
    expect(text(render(TaskNote, { task: details({ details: null }), headingId: 'n' }))).toBe(
      'Note No note.',
    );
  });

  it('lists the newest report lines with their status in its tone', () => {
    const html = render(TaskUpdates, { task: details(), headingId: 'u' });
    const shown = text(html);
    expect(shown).toContain('Updates (2)');
    expect(shown).toContain(
      "SK Simran Kaur · Mon, 23 Nov · In progress Found the cause: the bank's reply times out",
    );
    expect(shown).toContain('Simran Kaur · Fri, 20 Nov · Blocked Reproduced the failure');
    expect(html).toMatch(/<span class="[^"]*red[^"]*">Blocked<\/span>/);
    expect(shown).not.toContain('Showing the newest 10.');
  });

  it('says there are none yet, and when only the newest 10 show', () => {
    const none = details({ updates: [], updateCount: 0 });
    expect(text(render(TaskUpdates, { task: none, headingId: 'u' }))).toBe(
      'Updates (0) No updates yet. They come from the daily reports.',
    );
    const ten = Array.from({ length: 10 }, () => UPDATES[0]);
    const many = details({ updates: ten, updateCount: 12 });
    const shown = text(render(TaskUpdates, { task: many, headingId: 'u' }));
    expect(shown).toContain('Updates (12)');
    expect(shown.endsWith('Showing the newest 10.')).toBe(true);
  });

  it('shows the latest report: the first update, the same line as the status chip', () => {
    const shown = text(render(TaskLatest, { task: details(), headingId: 'r' }));
    expect(shown).toBe(
      "Latest report In progress · Mon, 23 Nov. Simran Kaur: Found the cause: the bank's reply times out on the last step.",
    );
    const blocked = details({ latestReport: UPDATES[1] });
    const html = render(TaskLatest, { task: blocked, headingId: 'r' });
    expect(html).toMatch(/<span class="[^"]*red[^"]*">Blocked · Fri, 20 Nov\.<\/span>/);
    expect(view.latestParts(UPDATES[1])).toEqual({
      head: 'Blocked · Fri, 20 Nov.',
      tone: 'red',
      text: 'Simran Kaur: Reproduced the failure with a test card.',
    });
  });

  it('says there is no report yet (members only ever get their own line)', () => {
    const none = details({ latestReport: null, updates: [] });
    expect(text(render(TaskLatest, { task: none, headingId: 'r' }))).toBe(
      'Latest report No report on this task yet.',
    );
  });
});

describe('the footer of each mode', () => {
  beforeEach(() => {
    page.editor = { openEdit: () => {}, remove: () => {} };
  });

  it('gives the manager Delete, Edit and Mark done on an open task', () => {
    const shown = text(footer({ task: details(), mode: 'manage' }));
    expect(shown).toBe('Delete Edit Mark done');
  });

  it('gives the manager the Done tag and Reopen on a done task', () => {
    const shown = text(footer({ task: details({ status: 'done' }), mode: 'manage' }));
    expect(shown).toBe('Delete Edit Done Reopen');
  });

  it('never changes tasks from Today or for a member, whatever canManage says', () => {
    const today = footer({
      task: details(),
      mode: 'today',
      todo: { has: () => false, add: () => {} },
    });
    expect(text(today)).toBe('Open project Add to to-do');
    expect(today).toContain('href="/projects/5?task=40"');
    const member = text(footer({ task: details(), mode: 'member', todoOpen: true }));
    expect(member).toBe('Add to to-do');
    for (const shown of [text(today), member]) {
      expect(shown).not.toMatch(/Mark done|Reopen|Edit|Delete/);
    }
  });

  it('shows "In to-do" for a task a line links, and no to-do button on a done task', () => {
    const linked = { has: () => true, add: () => {} };
    expect(text(footer({ task: details(), mode: 'today', todo: linked }))).toBe(
      'Open project In to-do',
    );
    const done = details({ status: 'done' });
    expect(text(footer({ task: done, mode: 'today', todo: linked }))).toBe('Open project');
    expect(text(footer({ task: done, mode: 'member', todoOpen: true }))).toBe('');
    const submitted = { has: () => false, add: null };
    expect(text(footer({ task: details(), mode: 'today', todo: submitted }))).toBe('Open project');
  });

  it("gives a member no to-do button once today's report is in, as on Today", () => {
    // The member's page says whether today's to-do still takes lines (head.todoOpen): after the
    // report is in, POST /api/me/todo/lines answers REPORT_LOCKED, so the button would never work.
    expect(text(footer({ task: details(), mode: 'member', todoOpen: false }))).toBe('');
    expect(text(footer({ task: details(), mode: 'member' }))).toBe('');
    expect(view.footerFor({ mode: 'member', task: details(), todoOpen: true }).todo).toBe(true);
    expect(view.footerFor({ mode: 'member', task: details(), todoOpen: false })).toEqual({
      kind: 'member',
      done: false,
      todo: false,
      status: false,
    });
  });

  it('gives My tasks Open project and, for a task the viewer manages, Mark done or Reopen', () => {
    const open = footer({ task: details(), mode: 'mine' });
    expect(text(open)).toBe('Open project Mark done');
    expect(open).toContain('href="/projects/5?task=40"');
    expect(text(footer({ task: details({ status: 'done' }), mode: 'mine' }))).toBe(
      'Open project Reopen',
    );
    // Another PM's project where the viewer is only a member: the task shows, without a tick.
    expect(text(footer({ task: details({ canManage: false }), mode: 'mine' }))).toBe(
      'Open project',
    );
    expect(text(open)).not.toMatch(/Edit|Delete|Add to to-do/);
    expect(view.footerFor({ mode: 'mine', task: details() })).toEqual({
      kind: 'mine',
      done: false,
      todo: false,
      status: true,
    });
  });

  it('has no footer for another PM, nor for manage mode without the task editor', () => {
    expect(view.footerFor({ mode: 'team', task: details() }).kind).toBe('none');
    expect(text(footer({ task: details(), mode: 'team' }))).toBe('');
    page.editor = null;
    expect(text(footer({ task: details(), mode: 'manage' }))).toBe('');
    expect(
      view.footerFor({ mode: 'manage', task: details({ canManage: false }), hasEditor: true }),
    ).toMatchObject({ kind: 'none' });
  });
});

describe('the Files part', () => {
  it('shows pictures as thumbnails and other files as rows with Download', () => {
    const html = files({ task: details(), mode: 'team' });
    expect(text(html)).toContain('Files (2)');
    expect(html).toContain('src="/api/project-files/1/thumb"');
    expect(labels(html)).toContain('Open card-payment-error.png');
    expect(labels(html)).toContain('Download checkout-error-steps.pdf');
    expect(text(html)).toContain('PDF · 340 KB');
  });

  it('gives a PM who is a member the files without any X or Add files', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    const html = files({ task: details({ canManage: false }), mode: 'team' });
    expect(labels(html).some((label) => label.startsWith('Remove'))).toBe(false);
    expect(text(html)).not.toContain('Add files');
  });

  it('never offers the X or Add files on Today or to a member, even with canManage', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    for (const mode of ['today', 'member']) {
      const html = files({ task: details(), mode });
      expect(labels(html).some((label) => label.startsWith('Remove'))).toBe(false);
      expect(text(html)).not.toContain('Add files');
    }
  });

  it('gives the manager on a project page the X on each file and Add files', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    const html = files({ task: details(), mode: 'manage' });
    expect(labels(html)).toEqual(
      expect.arrayContaining(['Remove card-payment-error.png', 'Remove checkout-error-steps.pdf']),
    );
    expect(text(html)).toContain('Add files');
  });

  it('has one "Add files" control for screen readers: the file input it opens is hidden', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    const html = files({ task: details(), mode: 'manage' });
    const [input] = html.match(/<input[^>]*type="file"[^>]*>/) ?? [];
    expect(input).toContain('aria-hidden="true"');
    expect(input).toContain('tabindex="-1"');
    expect(input).not.toContain('aria-label');
    expect(html.match(/<button[^>]*>(?:(?!<\/button>).)*Add files/g)).toHaveLength(1);
    // Its name is said once: the visible words are hidden from screen readers, the label isn't.
    const [button] = html.match(/<button[^>]*aria-haspopup="menu"[^>]*>.*?<\/button>/) ?? [];
    expect(button).toContain('<span aria-hidden="true">Add files</span>');
    expect(button).toContain('<span class="visually-hidden">Add files</span>');
  });

  it('warns on a program file and says when there are no files', () => {
    const program = file(3, 'setup.exe', { typeLabel: 'Program' });
    const html = files({ task: details({ files: [program], fileCount: 1 }), mode: 'member' });
    expect(text(html)).toContain('Program file. Open it only if you trust where it came from.');
    const empty = files({ task: details({ files: [], fileCount: 0 }), mode: 'member' });
    expect(text(empty)).toBe('Files (0) No files on this task.');
  });

  it('draws nothing about files without canSeeFiles (another PM not on the project)', () => {
    const html = files({ task: details({ files: [], canSeeFiles: false }), mode: 'team' });
    expect(html).toBe('');
  });

  it('says where a linked file sits in Files, and names the two X apart', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    const linked = file(5, 'checkout-flow.docx', {
      scope: 'project',
      taskId: null,
      phase: 'design',
      linked: true,
      typeLabel: 'Word',
    });
    const whole = file(6, 'acme-brand-guide.pdf', { scope: 'project', phase: null, linked: true });
    const task = details({ files: [PDF, linked, whole], fileCount: 3 });
    const html = files({ task, mode: 'manage' });
    expect(text(html)).toContain('Word · 340 KB · From Files: Design');
    expect(text(html)).toContain('PDF · 340 KB · From Files: Whole project');
    expect(text(html)).toMatch(/checkout-error-steps\.pdf PDF · 340 KB(?! ·)/); // its own file
    expect(labels(html)).toEqual(
      expect.arrayContaining([
        'Remove checkout-error-steps.pdf',
        'Remove checkout-flow.docx from this task',
        'Remove acme-brand-guide.pdf from this task',
      ]),
    );
    const member = files({ task, mode: 'member' });
    expect(text(member)).toContain('From Files: Design');
    expect(labels(member).some((label) => label.startsWith('Remove'))).toBe(false);
  });

  it('offers Add files as a menu only in manage mode on a project page, never in My tasks', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    const html = files({ task: details(), mode: 'manage' });
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>/);
    for (const mode of ['mine', 'team', 'today', 'member']) {
      const other = files({ task: details(), mode });
      expect(text(other)).not.toContain('Add files');
      expect(other).not.toContain('aria-haspopup="menu"');
    }
  });

  it('hides a linked file while its unlink waits behind its Undo', () => {
    const linked = file(5, 'checkout-flow.docx', {
      scope: 'project',
      phase: 'design',
      linked: true,
    });
    const task = details({ files: [PDF, linked], fileCount: 2 });
    const hiding = { ...removal, isLinkHidden: (taskId, fileId) => taskId === 40 && fileId === 5 };
    const html = files({ task, mode: 'manage', removal: hiding });
    expect(text(html)).toContain('Files (1)');
    expect(text(html)).not.toContain('checkout-flow.docx');
    // The same file id as an own file is a different file: only the link is hidden.
    expect(view.filesPart({ mode: 'manage', task, isLinkHidden: hiding.isLinkHidden }).count).toBe(
      1,
    );
  });

  it('hides a file whose removal waits behind its Undo', () => {
    const hiding = { ...removal, isHidden: (id) => id === 2 };
    const html = files({ task: details(), mode: 'manage', removal: hiding });
    expect(text(html)).toContain('Files (1)');
    expect(text(html)).not.toContain('checkout-error-steps.pdf');
  });
});

describe('the error state', () => {
  it("says the task isn't available for a 404 and for a task of another project", () => {
    expect(view.windowProblem({ error: { status: 404, code: 'NOT_FOUND' } })).toEqual({
      message: view.NOT_AVAILABLE,
      retry: false,
    });
    expect(view.windowProblem({ task: details({ projectId: 9 }), projectId: 5 })).toEqual({
      message: view.NOT_AVAILABLE,
      retry: false,
    });
    expect(view.windowProblem({ task: details(), projectId: 5 })).toBeNull();
    expect(view.windowProblem({ task: details({ projectId: 9 }) })).toBeNull();
    expect(view.NOT_AVAILABLE).toBe(
      "This task isn't available. It may have been deleted or given to someone else.",
    );
  });

  it("offers Try again with the API's words for any other failure", () => {
    const offline = { status: 0, code: 'NETWORK', message: "You're offline." };
    expect(view.windowProblem({ error: offline })).toEqual({
      message: "You're offline.",
      retry: true,
    });
  });
});

describe('focus when the window closes', () => {
  const element = (connected) => ({ isConnected: connected });

  it('goes back to the opener while it is on the page', () => {
    const opener = element(true);
    expect(view.returnTarget(opener, () => element(true))).toBe(opener);
  });

  it('goes to what the opener names when the opener has left the page', () => {
    // A card marked done in the window is drawn again under "› 6 done": its old title is gone.
    const drawnAgain = element(true);
    expect(view.returnTarget(element(false), () => drawnAgain)).toBe(drawnAgain);
    expect(view.returnTarget(null, () => drawnAgain)).toBe(drawnAgain);
  });

  it('goes nowhere when neither is there', () => {
    expect(view.returnTarget(element(false), () => null)).toBeNull();
    expect(view.returnTarget(element(false), null)).toBeNull();
    expect(view.returnTarget(null, undefined)).toBeNull();
  });
});

describe('the person while a change settles', () => {
  const simran = { id: 11, name: 'Simran Kaur' };
  const riya = { id: 7, name: 'Riya Kapoor' };

  it('shows the person on its way, then keeps it until the task has loaded again', () => {
    let step = nextPin(null, { overlay: riya, task: { assignee: simran }, loading: false });
    expect(step.assignee).toBe(riya);
    // The page refreshed: the overlay goes, the window's task still names Simran.
    step = nextPin(step.pin, { overlay: undefined, task: { assignee: simran }, loading: false });
    expect(step.assignee).toBe(riya);
    step = nextPin(step.pin, { overlay: undefined, task: { assignee: simran }, loading: true });
    expect(step.assignee).toBe(riya);
    step = nextPin(step.pin, { overlay: undefined, task: { assignee: riya }, loading: false });
    expect(step).toEqual({ pin: null, assignee: riya });
  });

  it('shows the task again when the change failed or was undone', () => {
    let step = nextPin(null, { overlay: riya, task: { assignee: simran }, loading: false });
    step = nextPin(step.pin, { overlay: undefined, task: { assignee: simran }, loading: false });
    step = nextPin(step.pin, { overlay: undefined, task: { assignee: simran }, loading: true });
    step = nextPin(step.pin, { overlay: undefined, task: { assignee: simran }, loading: false });
    expect(step).toEqual({ pin: null, assignee: simran });
    expect(
      nextPin(null, { overlay: undefined, task: { assignee: simran }, loading: false }),
    ).toEqual({ pin: null, assignee: simran });
  });
});
