// The Phases tab against the real modules (CONTRACT 22): the manager's board with tasks in phases, a
// task from before phases, done ones and the files and notes of the open phase; another PM's board,
// which never reads documents (the service would answer NOT_FOUND) and has no document in its props;
// and the writes the board makes: an edit that sends only what changed keeps the details, a delete
// sent twice answers NOT_FOUND (the board treats it as gone), and dates end before start.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { projectPlan } from '@/modules/projectPlan';
import { END_BEFORE_START } from '@/modules/projectPlan/schemas';
import { projects } from '@/modules/projects';
import { projectSummaries } from '@/modules/projectSummaries';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => '/projects/1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const { default: PhasesTab } = await import('@/app/(app)/projects/[id]/PhasesTab.jsx');

const T0 = '2026-10-30T06:00:00Z'; // Friday 30 October 2026, 11:30 AM in Kolkata
const TODAY = '2026-10-30';
const SECRET_TITLE = 'Acme pricing and contacts';

let pm;
let otherPm;
let neha;
let project;
const ids = {};

const IP = '10.0.0.1';
const add = (input) => projectTasks.create({ user: pm, projectId: project.id, input, ip: IP });
const noTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

async function board(user) {
  const plan = await projectPlan.getPlan(project.id);
  const head = await projects.findById(project.id);
  return PhasesTab({
    user,
    project: head,
    plan,
    forecast: {},
    today: TODAY,
    canManage: projects.canManage(user, head),
  });
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  await setSettings({ timezone: 'Asia/Kolkata' });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Vikram Sethi', role: 'pm', tracksAttendance: false });
  neha = await createUser({ name: 'Neha Arora' });
  project = await createProject(pm, { name: 'acme-booking' });
  await addMembers(project, [neha]);

  await projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'design', ip: IP });
  await projectPlan.setPhaseDates({
    user: pm,
    projectId: project.id,
    phase: 'design',
    plannedStart: '2026-10-26',
    plannedEnd: '2026-11-20',
    ip: IP,
  });
  ids.provider = (
    await add({
      title: 'Choose the payment provider',
      priority: 'p1',
      phase: 'design',
      dueDate: '2026-11-06',
      details: 'Stripe or Razorpay',
      assigneeId: pm.id,
    })
  ).id;
  ids.screens = (
    await add({ title: 'Design the booking screens', phase: 'design', assigneeId: neha.id })
  ).id;
  ids.wireframes = (await add({ title: 'Wireframes', phase: 'design' })).id;
  await projectTasks.setStatus({ user: pm, id: ids.wireframes, status: 'done', ip: IP });
  ids.legacy = (await add({ title: 'Fix login timeout', priority: 'p1' })).id;
  await projectSummaries.addDocument({
    user: pm,
    projectId: project.id,
    input: { phase: 'design', kind: 'note', title: SECRET_TITLE, text: 'Call Acme at 9 am.' },
    ip: IP,
  });
});

describe("the manager's board", () => {
  it('shows the open phase with its tasks, its files and notes and No phase yet', async () => {
    const text = noTags(renderToStaticMarkup(await board(pm)));
    expect(text).toContain('Design Current Planned 26 Oct to 20 Nov Started 4 days late');
    expect(text).toContain('1 of 3 tasks');
    expect(text.indexOf('Choose the payment provider')).toBeLessThan(
      text.indexOf('Design the booking screens'),
    );
    expect(text).toContain('Stripe or Razorpay');
    expect(text).toContain('Show 1 done task');
    expect(text).toContain(SECRET_TITLE);
    expect(text).toContain('No phase yet 0 of 1 task');
    expect(text).toContain('Move to Development');
  });

  it('offers the PM and the members as owners', async () => {
    const element = await board(pm);
    expect(element.props.owners.map((owner) => owner.name)).toEqual(['Neha Arora', 'Riya Kapoor']);
    expect(element.props.documents.map((document) => document.title)).toEqual([SECRET_TITLE]);
    expect(element.props.documents[0]).toMatchObject({ phase: 'design', addedOn: TODAY });
    expect(element.props.documents[0].body).toBeUndefined();
  });
});

describe("another PM's board", () => {
  it('renders without reading documents, and has none in its props or markup', async () => {
    const element = await board(otherPm);
    expect(element.props.canManage).toBe(false);
    expect(element.props.documents).toBeUndefined();
    expect(element.props.owners).toEqual([]);
    expect(JSON.stringify(element.props)).not.toContain(SECRET_TITLE);
    const text = noTags(renderToStaticMarkup(element));
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).toContain('Only Riya Kapoor and Admins can edit phases.');
    expect(text).toContain('Files and notes are only for Riya Kapoor and Admins.');
    expect(text).toContain('Choose the payment provider');
  });

  it('really is refused the documents by the service', async () => {
    await expect(
      projectSummaries.listDocuments({ user: otherPm, projectId: project.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('what the board writes', () => {
  it('keeps the details and phase when an edit sends only what changed', async () => {
    await projectTasks.update({
      user: pm,
      id: ids.provider,
      input: { title: 'Pick the payment provider', dueDate: '2026-11-09' },
    });
    const task = await projectTasks.findById(ids.provider);
    expect(task).toMatchObject({
      title: 'Pick the payment provider',
      details: 'Stripe or Razorpay',
    });
    const [row] = (await projectTasks.listForProject({ viewer: pm, projectId: project.id })).filter(
      (one) => one.id === ids.provider,
    );
    expect(row).toMatchObject({ phase: 'design', dueDate: '2026-11-09' });
  });

  it('files a task from before phases into a phase', async () => {
    await projectTasks.update({ user: pm, id: ids.legacy, input: { phase: 'design' } });
    const text = noTags(renderToStaticMarkup(await board(pm)));
    expect(text).not.toContain('No phase yet');
    expect(text).toContain('1 of 4 tasks');
  });

  it('answers NOT_FOUND to a second delete, which the board treats as gone', async () => {
    await projectTasks.remove({ user: pm, id: ids.screens });
    await expect(projectTasks.remove({ user: pm, id: ids.screens })).rejects.toMatchObject({
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
      () => projectTasks.update({ user: otherPm, id: ids.provider, input: { title: 'Nope' } }),
      () => projectTasks.remove({ user: otherPm, id: ids.provider }),
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
