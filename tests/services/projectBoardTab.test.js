// The Board tab against the real modules (CONTRACT 27 and 28, Board tab): the manager's board with
// tasks in phases, a task from before phases and done ones, and each card's per-viewer data (the
// files and chips the viewer may see, everyone's minutes from timers, the report lines and the
// newest one, the links to "Only PM and Admins" files) and the viewer's id; another PM who isn't on
// the project gets no file data in the props or the markup; a member gets only their tasks and
// Anyone tasks, only their own minutes and lines, no private link counts, a band that counts every
// task, and no other person's name; the remembered view and rail (cookies, `?view=` first); the
// board before migration 020 (links read as none); and the writes
// the board makes: a quick add (Anyone, P2, the column's phase), a move to another phase and its
// Undo back to No phase yet, an edit that sends only what changed keeps the details, a delete sent
// twice answers NOT_FOUND (the board treats it as gone), dates that end before they start, and
// another PM refused every write.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { can } from '@/lib/permissions';
import { setNowForTests } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { filesAccess } from '@/modules/projectFiles/access';
import { projectPlan } from '@/modules/projectPlan';
import { END_BEFORE_START } from '@/modules/projectPlan/schemas';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject, createReport } from './dashboardKit.js';
import { emptyFilesDir, linkFile, pdfBytes, projectFile, taskFile } from './projectFilesKit.js';

let viewer = null;
let cookieJar = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => '/projects/1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => viewer }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name) => (name in cookieJar ? { value: cookieJar[name] } : undefined),
  }),
}));
vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const { default: BoardTab } = await import('@/app/(app)/projects/[id]/BoardTab.jsx');

const T0 = '2026-11-23T06:00:00Z'; // Monday 23 November 2026, 11:30 AM in Kolkata
const TODAY = '2026-11-23';
const IP = '10.0.0.1';

let pm;
let otherPm;
let vishal;
let simran;
let project;
const ids = {};

const add = (input) => projectTasks.create({ user: pm, projectId: project.id, input, ip: IP });
const noTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/** What the page's head gives the Board for this person (loadProjectHead's fields it reads). */
async function headFor(user) {
  const row = await projects.findById(project.id);
  const manages = projects.canManage(user, row);
  const ctx = await projectFiles.viewerContext({ viewer: user, project: row });
  return {
    project: row,
    plan: await projectPlan.getPlan(row.id),
    today: TODAY,
    access: manages ? 'manage' : can(user, 'team.view') ? 'team' : 'member',
    filesAccess: filesAccess(ctx),
    viewerId: user.id,
    viewerName: user.name,
    forecast: { kind: 'nodata', title: 'Not enough data yet', body: 'Daybook works it out.' },
  };
}

async function board(user, query) {
  viewer = user;
  return BoardTab({ head: await headFor(user), query });
}

const cardOf = (element, id) => element.props.tasks.find((task) => task.id === id);

/** A finished timer of `minutes` on a task, on 20 November. */
const timer = (user, taskId, minutes) =>
  db('timeEntries').insert({
    userId: user.id,
    workDate: '2026-11-20',
    projectId: project.id,
    projectTaskId: taskId,
    startedAt: new Date('2026-11-20T04:00:00Z'),
    endedAt: new Date(Date.parse('2026-11-20T04:00:00Z') + minutes * 60000),
  });

/** A submitted report with one line per task (`status`: in_progress, blocked, done). */
async function reportLines(user, date, lines) {
  const entries = [
    {
      projectId: project.id,
      minutes: 60,
      tasks: lines.map(([, status]) => ({ title: 'Work', status })),
    },
  ];
  const { taskIds } = await createReport(user, date, { entries });
  for (const [index, [taskId]] of lines.entries()) {
    await db('reportTasks').where({ id: taskIds[index] }).update({ projectTaskId: taskId });
  }
}

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests(T0);
  await setSettings({ timezone: 'Asia/Kolkata' });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Vikram Sethi', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  project = await createProject(pm, { name: 'acme-store' });
  await addMembers(project, [vishal, simran]);

  await projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'design', ip: IP });
  await projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'development', ip: IP });
  ids.login = (
    await add({ title: 'Fix the login page', phase: 'design', assigneeId: vishal.id })
  ).id;
  ids.checkout = (
    await add({
      title: 'Checkout fix before client demo',
      priority: 'p1',
      phase: 'development',
      dueDate: '2026-11-27',
      details: 'Card payments fail on the last step.',
      assigneeId: simran.id,
    })
  ).id;
  ids.zoom = (await add({ title: 'Product image zoom', phase: 'development', priority: 'p3' })).id;
  ids.wireframes = (await add({ title: 'Wireframes', phase: 'design' })).id;
  await projectTasks.setStatus({ user: pm, id: ids.wireframes, status: 'done', ip: IP });
  ids.legacy = (await add({ title: 'Old login timeout', priority: 'p1' })).id;
  await taskFile({
    user: pm,
    projectId: project.id,
    taskId: ids.checkout,
    name: 'checkout-error-steps.pdf',
    bytes: pdfBytes(),
  });
  // A contract only for PM and Admins, linked to Vishal's task.
  ids.contract = (
    await projectFile({
      user: pm,
      projectId: project.id,
      name: 'contract.pdf',
      bytes: pdfBytes(),
      visibility: 'managers',
    })
  ).id;
  const login = await db('projectTasks').where({ id: ids.login }).first();
  await linkFile({
    user: pm,
    project,
    task: login,
    fileIds: ids.contract,
    shareConfirmed: true,
    shareWith: vishal.id,
  });
  // Time and report lines: Vishal on his task and the Anyone task, Simran on hers and on it later.
  await timer(vishal, ids.login, 45);
  await timer(vishal, ids.zoom, 30);
  await timer(simran, ids.zoom, 90);
  await timer(simran, ids.checkout, 340);
  await reportLines(vishal, '2026-11-19', [
    [ids.login, 'blocked'],
    [ids.zoom, 'in_progress'],
  ]);
  await reportLines(simran, '2026-11-20', [
    [ids.zoom, 'done'],
    [ids.checkout, 'in_progress'],
  ]);
});

describe("the manager's board", () => {
  it('shows the phases, the cards in order, No phase yet and the files line', async () => {
    const element = await board(pm);
    expect(element.props).toMatchObject({ access: 'manage', viewerId: pm.id, pmId: pm.id });
    const text = noTags(renderToStaticMarkup(element));
    expect(text).toContain('Development 2 open Current');
    expect(text).toContain('Design'); // past, with an open card: still a column
    expect(text.indexOf('Checkout fix before client demo')).toBeLessThan(
      text.indexOf('Product image zoom'),
    );
    expect(text).toContain(
      'No phase yet 1 open Tasks from before phases. Move each one to its phase.',
    );
    expect(text).toContain('Mine (0)');
    const checkout = cardOf(element, ids.checkout);
    expect(checkout).toMatchObject({ createdBy: { id: pm.id, name: 'Riya Kapoor' } });
    expect(checkout.assignee).toMatchObject({ id: simran.id, role: 'employee', isViewer: false });
  });

  it('gives each card its files and chips, own and linked, and private links to managers', async () => {
    const element = await board(pm);
    const checkout = cardOf(element, ids.checkout);
    expect(checkout.files.count).toBe(1);
    expect(checkout.files.chips.map((chip) => chip.name)).toEqual(['checkout-error-steps.pdf']);
    const login = cardOf(element, ids.login);
    expect(login.files.count).toBe(1);
    expect(login.files.chips[0]).toMatchObject({ id: ids.contract, name: 'contract.pdf' });
    expect(login.privateLinkCount).toBe(1);
    expect(checkout.privateLinkCount).toBe(0);
  });

  it("gives everyone's minutes and lines, the newest line as the status chip", async () => {
    const element = await board(pm);
    expect(cardOf(element, ids.checkout)).toMatchObject({
      minutes: 340,
      updateCount: 1,
      statusChip: { status: 'in_progress', workDate: '2026-11-20' },
    });
    expect(cardOf(element, ids.zoom)).toMatchObject({
      minutes: 120,
      updateCount: 2,
      statusChip: { status: 'done', workDate: '2026-11-20' },
    });
    expect(cardOf(element, ids.login).statusChip).toEqual({
      status: 'blocked',
      workDate: '2026-11-19',
    });
  });
});

describe('another PM who is not on the project', () => {
  it('gets no file data in the props or the markup, and no ticks or menus', async () => {
    const element = await board(otherPm);
    expect(element.props).toMatchObject({ access: 'team', filesAccess: 'none' });
    expect(element.props.tasks.every((task) => task.files.count === 0)).toBe(true);
    expect(element.props.tasks.every((task) => task.privateLinkCount === 0)).toBe(true);
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain('contract.pdf');
    expect(html).not.toContain('checkout-error-steps.pdf');
    expect(html).not.toContain('type="checkbox"');
    expect(noTags(html)).toContain('Only Riya Kapoor and Admins can change tasks and phases.');
    // team.view: everyone's minutes and lines
    expect(cardOf(element, ids.zoom)).toMatchObject({ minutes: 120, updateCount: 2 });
  });
});

describe("a member's board", () => {
  it('has only their tasks and Anyone tasks, and a band that counts every task', async () => {
    const element = await board(vishal);
    expect(element.props).toMatchObject({ access: 'member', viewerId: vishal.id });
    const titles = element.props.tasks.map((task) => task.title).sort();
    expect(titles).toEqual(
      ['Fix the login page', 'Product image zoom', 'Wireframes', 'Old login timeout'].sort(),
    );
    expect(JSON.stringify(element.props)).not.toContain('Simran Kaur');
    expect(JSON.stringify(element.props)).not.toContain('Checkout fix');
    expect(element.props.forecast).toBeNull();
    const text = noTags(renderToStaticMarkup(element));
    expect(text).toContain('1 of 5 tasks done');
    expect(text).toContain('Progress counts all 5 tasks.');
    expect(text).not.toContain('Not enough data yet');
  });

  it('gets only their own minutes and lines, even on an Anyone task someone else reported on', async () => {
    const element = await board(vishal);
    expect(cardOf(element, ids.zoom)).toMatchObject({
      minutes: 30,
      updateCount: 1,
      statusChip: { status: 'in_progress', workDate: '2026-11-19' },
    });
    expect(cardOf(element, ids.login).assignee.isViewer).toBe(true);
    expect(element.props.tasks.every((task) => task.privateLinkCount === 0)).toBe(true);
  });

  it('sees the contract through their own task only', async () => {
    const element = await board(vishal);
    expect(cardOf(element, ids.login).files.chips.map((chip) => chip.name)).toEqual([
      'contract.pdf',
    ]);
    expect(cardOf(element, ids.zoom).files.count).toBe(0);
  });
});

describe('the remembered view and rail', () => {
  it('opens the Table from a table cookie, and the rail open from an open cookie', async () => {
    cookieJar = { 'daybook.board.view': 'table', 'daybook.board.rail': 'open' };
    const element = await board(pm);
    expect(element.props).toMatchObject({ view: 'table', railOpen: true });
    expect(renderToStaticMarkup(element)).toContain('data-view="table"');
    cookieJar = {};
    expect((await board(pm)).props).toMatchObject({ view: 'board', railOpen: false });
  });

  it('lets ?view=table win over a board cookie', async () => {
    cookieJar = { 'daybook.board.view': 'board' };
    expect((await board(pm, { view: 'table' })).props.view).toBe('table');
    cookieJar = { 'daybook.board.view': 'table' };
    expect((await board(pm, { view: 'board' })).props.view).toBe('board');
    cookieJar = {};
  });
});

describe('before migration 020', () => {
  it('loads the board as 1.12: links read as none, own files still counted', async () => {
    await db.migrate.down({ name: '020_task_file_links.js' });
    try {
      const element = await board(pm);
      expect(cardOf(element, ids.login)).toMatchObject({ privateLinkCount: 0 });
      expect(cardOf(element, ids.login).files.count).toBe(0);
      expect(cardOf(element, ids.checkout).files.count).toBe(1);
      expect(noTags(renderToStaticMarkup(element))).toContain('Checkout fix before client demo');
    } finally {
      await db.migrate.latest();
    }
  });
});

describe('what the board writes', () => {
  it('adds a quick task for anyone, P2, in the column', async () => {
    const task = await add({
      title: 'Test on phones',
      phase: 'testing',
      priority: 'p2',
      assigneeId: null,
    });
    expect(task).toMatchObject({ phase: 'testing', priority: 'p2', assignee: null });
    ids.phones = task.id;
  });

  it('moves a card to another phase and back to No phase yet with Undo', async () => {
    await projectTasks.update({ user: pm, id: ids.legacy, input: { phase: 'testing' } });
    let text = noTags(renderToStaticMarkup(await board(pm)));
    expect(text).not.toContain('No phase yet');
    await projectTasks.update({ user: pm, id: ids.legacy, input: { phase: null } });
    text = noTags(renderToStaticMarkup(await board(pm)));
    expect(text).toContain('No phase yet');
  });

  it('keeps the details and phase when an edit sends only what changed', async () => {
    await projectTasks.update({
      user: pm,
      id: ids.checkout,
      input: { title: 'Checkout fix for the demo', dueDate: '2026-11-30' },
    });
    const [row] = (await projectTasks.listForProject({ viewer: pm, projectId: project.id })).filter(
      (one) => one.id === ids.checkout,
    );
    expect(row).toMatchObject({
      title: 'Checkout fix for the demo',
      details: 'Card payments fail on the last step.',
      phase: 'development',
      dueDate: '2026-11-30',
    });
  });

  it('answers NOT_FOUND to a second delete, which the board treats as gone', async () => {
    await projectTasks.remove({ user: pm, id: ids.phones });
    await expect(projectTasks.remove({ user: pm, id: ids.phones })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an end date before the start with the words the dialog shows', async () => {
    const error = await projectPlan
      .setPhaseDates({
        user: pm,
        projectId: project.id,
        phase: 'testing',
        plannedStart: '2026-12-10',
        plannedEnd: '2026-11-30',
      })
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(error.fields.plannedEnd).toBe(END_BEFORE_START);
  });

  it('refuses another PM every write the board offers', async () => {
    const tries = [
      () => projectTasks.create({ user: otherPm, projectId: project.id, input: { title: 'Nope' } }),
      () => projectTasks.update({ user: otherPm, id: ids.zoom, input: { phase: 'testing' } }),
      () => projectTasks.remove({ user: otherPm, id: ids.zoom }),
      () =>
        projectPlan.setPhaseDates({
          user: otherPm,
          projectId: project.id,
          phase: 'design',
          plannedStart: null,
          plannedEnd: null,
        }),
    ];
    for (const attempt of tries) {
      await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
