// The world of projectFileLinks.test.js (CONTRACT 28, Tests "projectFileLinks"): every viewer row of
// the two tables of Who sees on one project, three tasks (Vishal's, Simran's and an Anyone task),
// the matrix files and their links, the files the rules cases link, and what each viewer gets from
// every read. Files are made through storeFile (projectFilesKit.js); task file rows for the 20-file
// cases are written straight into the table (they are never read from disk).
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { projectFiles } from '@/modules/projectFiles';
import { createUser } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  createTask,
  jpegBytes,
  linkFile,
  pngBytes,
  projectFile,
  taskFile,
} from './projectFilesKit.js';

/** Every person of the tables: the project's PM, two Admins, members, HR, other PMs, leavers. */
async function makePeople() {
  const user = (name, role = 'employee') => createUser({ name, role, tracksAttendance: false });
  return {
    pm: await user('Riya Kapoor', 'pm'),
    adminMember: await user('Meera Pillai', 'admin'),
    adminOutside: await user('Arvind Menon', 'admin'),
    vishal: await user('Vishal Saini'),
    simran: await user('Simran Kaur'),
    sneha: await user('Sneha Patil'),
    hrMember: await user('Neha Kapoor', 'hr'),
    hrOutside: await user('Hari Outside', 'hr'),
    otherPm: await user('Omar Other', 'pm'),
    otherPmMember: await user('Pia Member', 'pm'),
    takenOff: await user('Tom Taken'),
    deactivated: await user('Dev Gone'),
  };
}

/** The matrix files: a picture and a PDF only for PM and Admins (linked), an Everyone file, and
 * one only for PM and Admins that is never linked. */
async function matrixFiles(pm, project) {
  const managers = { user: pm, projectId: project.id, visibility: 'managers' };
  return {
    picture: await projectFile({
      ...managers,
      name: 'contract-scan.png',
      bytes: pngBytes(400, 300),
      thumb: jpegBytes(400, 300),
    }),
    everyone: await projectFile({
      user: pm,
      projectId: project.id,
      phase: 'design',
      name: 'design-brief.pdf',
    }),
    anyone: await projectFile({ ...managers, phase: 'testing', name: 'server-keys.pdf' }),
    unlinked: await projectFile({ ...managers, name: 'payroll.pdf' }),
  };
}

/**
 * The project, its people, tasks, files and links. The picture is linked to Vishal's task, the
 * Everyone file to Simran's, the "server keys" to the Anyone task (each with its confirm); then
 * Tom is taken off the project and Dev is deactivated.
 */
export async function matrixSetup() {
  const people = await makePeople();
  const { pm } = people;
  const project = await createProject(pm, { name: 'acme-store' });
  await addMembers(project, [
    people.adminMember,
    people.vishal,
    people.simran,
    people.sneha,
    people.hrMember,
    people.otherPmMember,
    people.takenOff,
    people.deactivated,
  ]);
  const otherProject = await createProject(people.otherPm, { name: 'internal-tool' });
  const tasks = {
    vishal: await createTask(project, { assigneeId: people.vishal.id, phase: 'development' }),
    simran: await createTask(project, {
      title: 'Payment settings page',
      assigneeId: people.simran.id,
      phase: 'testing',
    }),
    anyone: await createTask(project, { title: 'Write the release notes', phase: 'testing' }),
    spare: await createTask(project, { title: 'Spare task', assigneeId: pm.id }),
  };
  const deleted = await projectFile({ user: pm, projectId: project.id, name: 'gone.pdf' });
  await projectFiles.removeFile({ user: pm, id: deleted.id });
  const files = {
    everyone: await projectFile({
      user: pm,
      projectId: project.id,
      name: 'acme-brand-guide.pdf',
    }),
    spare: await projectFile({
      user: pm,
      projectId: project.id,
      visibility: 'managers',
      name: 'acme-store-contract-signed.pdf',
    }),
    ownTask: await taskFile({ user: pm, projectId: project.id, taskId: tasks.spare.id }),
    otherProject: await projectFile({
      user: people.otherPm,
      projectId: otherProject.id,
      name: 'other.pdf',
    }),
    deleted,
    matrix: await matrixFiles(pm, project),
  };
  const link = (task, file, shareWith) =>
    linkFile({ user: pm, project, task, fileIds: file.id, shareConfirmed: true, shareWith });
  await link(tasks.vishal, files.matrix.picture, people.vishal.id);
  await link(tasks.simran, files.matrix.everyone);
  await link(tasks.anyone, files.matrix.anyone, '');
  await db('projectMembers').where({ projectId: project.id, userId: people.takenOff.id }).del();
  await db('users').where({ id: people.deactivated.id }).update({ status: 'deactivated' });
  people.deactivated = { ...people.deactivated, status: 'deactivated' };
  return { people, project, otherProject, tasks, files };
}

/** `n` active task file rows on a task (the 20-file cases; never read from disk). */
export async function fileRows(w, task, n) {
  const at = new Date('2026-11-24T06:00:00Z');
  const rows = Array.from({ length: n }, (_, index) => ({
    projectId: w.project.id,
    scope: 'task',
    taskId: task.id,
    phase: null,
    visibility: 'managers',
    status: 'active',
    name: `part-${index + 1}.pdf`,
    ext: 'pdf',
    sizeBytes: 10,
    storageKey: `2026/11/${crypto.randomBytes(16).toString('hex')}`,
    isPicture: false,
    hasThumb: false,
    createdBy: w.people.pm.id,
    createdAt: at,
    updatedAt: at,
  }));
  await db('projectFiles').insert(rows);
}

/** The `project_file.link` audit rows of a file on a task. */
export async function linkAudits(fileId, taskId) {
  const rows = await db('auditLogs')
    .where({ action: 'project_file.link', entityType: 'project_file', entityId: fileId })
    .orderBy('id');
  return rows.filter((row) => JSON.parse(row.after).taskId === taskId);
}

// ---------- what each viewer gets (the two tables of Who sees, as data) ----------

const KINDS = ['picture', 'everyone', 'anyone', 'unlinked'];

/** The download route per matrix file, plus /view and /thumb of the picture. */
function routesFor(open) {
  const routes = Object.fromEntries(KINDS.map((kind) => [kind, open.includes(kind) ? 200 : 404]));
  routes.view = open.includes('picture') ? 200 : 404;
  routes.thumb = routes.view;
  return routes;
}

/**
 * One viewer's expected answers: `open` the matrix files they may download, `on` the tasks
 * ('vishal', 'simran', 'anyone') whose linked file they see on that task, `memberCount` My
 * projects' count (undefined: none).
 */
function expected({ open, on, memberCount }) {
  return (w) => {
    const { tasks, files, project } = w;
    const linkedTo = { vishal: 'picture', simran: 'everyone', anyone: 'anyone' };
    const onTask = Object.fromEntries(
      Object.entries(linkedTo).map(([task, kind]) => [
        task,
        on.includes(task) ? [files.matrix[kind].name] : [],
      ]),
    );
    const counts = Object.fromEntries(on.map((task) => [tasks[task].id, 1]));
    return {
      routes: routesFor(open),
      onTask,
      counts,
      chips: counts,
      tab: open.map((kind) => files.matrix[kind].name).sort(),
      tabLinks: on.map((task) => `${files.matrix[linkedTo[task]].id}:${tasks[task].id}`).sort(),
      member: memberCount ? { [project.id]: memberCount } : {},
    };
  };
}

const MANAGER = { open: KINDS, on: ['vishal', 'simran', 'anyone'] };
const MEMBER = { open: ['everyone', 'anyone'], on: ['anyone'], memberCount: 1 };
const NOBODY = { open: [], on: [] };

/** Every viewer row of the tables. */
export const VIEWERS = {
  pm: expected(MANAGER),
  adminMember: expected({ ...MANAGER, memberCount: 1 }),
  adminOutside: expected(MANAGER),
  vishal: expected({
    open: ['picture', 'everyone', 'anyone'],
    on: ['vishal', 'anyone'],
    memberCount: 2,
  }),
  simran: expected({ open: ['everyone', 'anyone'], on: ['simran', 'anyone'], memberCount: 2 }),
  sneha: expected(MEMBER),
  hrMember: expected(MEMBER),
  otherPmMember: expected(MEMBER),
  hrOutside: expected(NOBODY),
  otherPm: expected(NOBODY),
  takenOff: expected(NOBODY),
  deactivated: expected(NOBODY),
};
