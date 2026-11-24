// The task window (CONTRACT 27, Task window), its parts rendered on the server with the page's
// providers mocked: the header's phase and "Current" tag, the facts (owner with the away label or
// Anyone, Due, "critical" after P1, Added by), "No note.", the latest report line (Blocked in red,
// "No report on this task yet."), the footer of each mode (`today` and `member` never get Mark
// done, Reopen, Edit, Delete, the file X or Add files, even with `canManage`; Reopen on a done task
// in manage mode; the member's "Add to to-do" only while today's to-do takes lines; nothing for
// another PM), Files for a PM who is a member (`'team'` with `canSeeFiles`: files, no X), none
// without `canSeeFiles`, one "Add files" control for screen readers, the error state (a 404, and a
// task of another project) and where focus goes back on close. The window itself (portal, focus,
// Escape) opens in the browser; taskWindowFocus.test.js has its busy buttons.
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
vi.mock('@/components/files/TaskAttachProvider', () => ({
  useTaskAttach: () => page.attach,
  useTaskBatch: () => page.batch,
  TaskAttachProvider: ({ children }) => children,
}));

const { TaskContext, TaskFacts, TaskNote, TaskReport } =
  await import('@/components/task/TaskWindowParts.jsx');
const { default: TaskWindowFiles } = await import('@/components/task/TaskWindowFiles.jsx');
const { useTaskWindowFooter } = await import('@/components/task/TaskWindowFooter.jsx');
const view = await import('@/components/task/taskWindowView.js');

const TODAY = '2026-11-23';
const SIMRAN = {
  id: 11,
  name: 'Simran Kaur',
  initials: 'SK',
  avatarUrl: null,
  status: 'active',
  isMember: true,
};

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
  project: { id: 5, name: 'acme-store', color: 'green', status: 'active', isUrgent: false },
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
  latestReport: {
    status: 'in_progress',
    userId: 11,
    userName: 'Simran Kaur',
    workDate: '2026-11-20',
  },
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

describe('the header and the facts', () => {
  it('names the project and the phase, with "Current" only on the current phase', () => {
    const current = render(TaskContext, { task: details(), currentPhase: 'development' });
    expect(text(current)).toBe('acme-store Development Current');
    expect(text(render(TaskContext, { task: details(), currentPhase: 'testing' }))).toBe(
      'acme-store Development',
    );
    expect(text(render(TaskContext, { task: details({ phase: null }) }))).toBe(
      'acme-store No phase yet',
    );
  });

  it('shows the owner, the due date, "critical" after P1 and who added it', () => {
    const html = render(TaskFacts, { task: details(), today: TODAY });
    const shown = text(html);
    expect(shown).toContain('Owner SK Simran Kaur');
    expect(shown).toContain('Due Due 27 Nov');
    expect(shown).toContain('Priority P1 Priority 1, highest critical');
    expect(shown).toContain('Added by Riya Kapoor on Mon, 23 Nov');
    expect(html).toContain('<dl');
  });

  it('says Anyone on the project, the away label, and no "critical" after P2', () => {
    const anyone = text(render(TaskFacts, { task: details({ assignee: null }), today: TODAY }));
    expect(anyone).toContain('Owner Anyone on the project');
    const away = details({ assignee: { ...SIMRAN, isMember: false }, priority: 'p2' });
    const shown = text(render(TaskFacts, { task: away, today: TODAY }));
    expect(shown).toContain('Simran Kaur Not on the project');
    expect(shown).not.toContain('critical');
    const gone = details({ assignee: { ...SIMRAN, status: 'deactivated' } });
    expect(text(render(TaskFacts, { task: gone, today: TODAY }))).toContain('Deactivated');
  });

  it('leaves Added by out when the task does not say who added it', () => {
    const html = render(TaskFacts, { task: details({ createdBy: null }), today: TODAY });
    expect(text(html)).not.toContain('Added by');
    expect(view.addedByText(details({ createdBy: null }))).toBeNull();
  });
});

describe('the note and the latest report', () => {
  it('keeps the note with its line breaks, or says "No note."', () => {
    const html = render(TaskNote, { task: details(), headingId: 'n' });
    expect(html).toContain('Card payments fail on the last step.\nThe demo is on Friday.');
    expect(text(render(TaskNote, { task: details({ details: null }), headingId: 'n' }))).toBe(
      'Note No note.',
    );
  });

  it('shows the latest line with its status, Blocked in red', () => {
    const shown = text(render(TaskReport, { task: details(), today: TODAY, headingId: 'r' }));
    expect(shown).toBe('Latest report Simran, Fri, 20 Nov: In progress');
    const blocked = details({ latestReport: { ...details().latestReport, status: 'blocked' } });
    expect(view.reportParts(blocked.latestReport, TODAY)).toEqual({
      lead: 'Simran, Fri, 20 Nov',
      status: 'Blocked',
      tone: 'red',
    });
    const html = render(TaskReport, { task: blocked, today: TODAY, headingId: 'r' });
    expect(html).toMatch(/<span class="[^"]*red[^"]*">Blocked<\/span>/);
  });

  it('says there is no report yet (members only ever get their own line)', () => {
    const none = details({ latestReport: null });
    expect(text(render(TaskReport, { task: none, today: TODAY, headingId: 'r' }))).toBe(
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
    expect(labels(html).some((label) => label.startsWith('Add files'))).toBe(false);
    expect(html.match(/<button[^>]*>(?:(?!<\/button>).)*Add files/g)).toHaveLength(1);
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
