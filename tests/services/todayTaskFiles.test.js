// Today's Priority tasks card with files (CONTRACT 27, Today), against the real modules: each row
// carries the files on it this person may see (`fileCount`: their own task's and an Anyone task's
// files; a deleted file and a project file don't count), and the card gets the company's date for
// the task window. CONTRACT 28: linked project files count too (an Everyone file, and a
// managers-only file after the share confirm), each on its own and Anyone tasks only, never on
// someone else's task; an unlinked file stops counting at once. Before migration 019 the page
// still loads and every count reads as 0 (`countsForTasks` gives {}).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { createTask, emptyFilesDir, linkFile, projectFile, taskFile } from './projectFilesKit.js';

const { loadToday } = await import('@/app/(app)/today/todayData.js');

const NOW = '2026-11-23T06:30:00Z'; // Monday 23 November 2026, noon in Kolkata

let pm;
let vishal;
let simran;
let project;
let own;
let anyone;
let empty;
let others;

const rowsOf = async (user) => (await loadToday({ user, ip: null })).priority;
const countsBy = (priority) =>
  Object.fromEntries(priority.rows.map((row) => [row.title, row.fileCount]));

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests(NOW);
  await setSettings({ timezone: 'Asia/Kolkata' });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  project = await createProject(pm, { name: 'acme-store' });
  await addMembers(project, [vishal, simran]);
  own = await createTask(project, { title: 'Fix the login page', assigneeId: vishal.id });
  anyone = await createTask(project, { title: 'Product image zoom', priority: 'p3' });
  empty = await createTask(project, { title: 'SEO meta tags', assigneeId: vishal.id });
  others = await createTask(project, { title: 'Payment settings', assigneeId: simran.id });
  const on = (task, name) => taskFile({ user: pm, projectId: project.id, taskId: task.id, name });
  await on(own, 'brief.pdf');
  await on(own, 'error.png');
  const gone = await on(own, 'old.pdf');
  await db('projectFiles').where({ id: gone.id }).update({ status: 'deleted' });
  await on(anyone, 'zoom.docx');
  await on(others, 'payment.pdf');
  await projectFile({ user: pm, projectId: project.id, name: 'logo.png' });
});

afterAll(async () => {
  await db.migrate.latest();
  await emptyFilesDir();
});

describe("Today's priority rows", () => {
  it('carry the files on each task this person may see', async () => {
    const priority = await rowsOf(vishal);
    expect(countsBy(priority)).toEqual({
      'Fix the login page': 2,
      'SEO meta tags': 0,
      'Product image zoom': 1,
    });
    expect(priority.today).toBe('2026-11-23');
    expect(priority.rows.find((row) => row.id === empty.id)).toMatchObject({ fileCount: 0 });
  });

  it("count another member's view of the same Anyone task, never someone else's task", async () => {
    const priority = await rowsOf(simran);
    expect(countsBy(priority)).toEqual({ 'Payment settings': 1, 'Product image zoom': 1 });
  });

  it('count linked project files on the tasks they are linked to (CONTRACT 28)', async () => {
    const guide = await projectFile({ user: pm, projectId: project.id, name: 'guide.pdf' });
    const contract = await projectFile({
      user: pm,
      projectId: project.id,
      visibility: 'managers',
      name: 'contract.pdf',
    });
    const link = (task, fileIds, extra = {}) =>
      linkFile({ user: pm, project, task, fileIds, ...extra });
    await link(own, [guide.id]);
    await link(own, [contract.id], { shareConfirmed: true, shareWith: vishal.id });
    await link(anyone, [guide.id]);
    await link(others, [contract.id], { shareConfirmed: true, shareWith: simran.id });
    expect(countsBy(await rowsOf(vishal))).toEqual({
      'Fix the login page': 4,
      'SEO meta tags': 0,
      'Product image zoom': 2,
    });
    expect(countsBy(await rowsOf(simran))).toEqual({
      'Payment settings': 2,
      'Product image zoom': 2,
    });
    await projectFiles.unlinkFile({ user: pm, taskId: own.id, fileId: contract.id, ip: null });
    expect(countsBy(await rowsOf(vishal))['Fix the login page']).toBe(3);
  });

  it('read as 0 before migration 019, and the page still loads', async () => {
    await db.migrate.down({ name: '020_task_file_links.js' });
    await db.migrate.down({ name: '019_project_files.js' });
    const tasks = [{ id: own.id, projectId: project.id }];
    expect(await projectFiles.countsForTasks({ viewer: vishal, tasks })).toEqual({});
    const priority = await rowsOf(vishal);
    expect(countsBy(priority)).toEqual({
      'Fix the login page': 0,
      'SEO meta tags': 0,
      'Product image zoom': 0,
    });
    await db.migrate.latest();
  });
});
