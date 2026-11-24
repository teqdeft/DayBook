// A project's notes and texts (CONTRACT 22 and 27): adding, the list without text, one with text,
// editing notes, deleting, the limits, places and who sees each (Whole project; Everyone or Only PM
// and Admins, which a body without it gets), the text of a project file (always Only PM and Admins,
// following its file), what the AI summary reads and when it goes stale, and before migration 019.
// Writes are only for the project's PM and Admin; members read Everyone notes and text-only
// documents; anyone else gets NOT_FOUND on reads, on the server, and FORBIDDEN on writes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { nowDate, setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { resetMigration019WarningsForTests } from '@/modules/projectFiles/migration019';
import { projectSummaries } from '@/modules/projectSummaries';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  addSampleDocuments,
  expectAppError,
  geminiAnswers,
  promptOf,
  SAMPLE_ANSWER,
  SOW_TEXT,
  T0,
} from './projectSummariesKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

const TOO_MANY = 'This project has 100 files and notes with text. Delete some first.';
const MIGRATION_019 = '019_project_files.js';

let admin;
let pm;
let otherPm;
let hr;
let member;
let projectCount = 0;

const newProject = () => {
  projectCount += 1;
  return createProject(pm, { name: `documents-${projectCount}` });
};

const note = (overrides = {}) => ({
  phase: 'design',
  kind: 'note',
  title: 'Notes',
  text: 'Some text.',
  ...overrides,
});

const add = (project, input = note(), user = pm) =>
  projectSummaries.addDocument({ user, projectId: project.id, input, ip: '10.0.0.1' });

const edit = (id, input, user = pm) => projectSummaries.updateDocument({ user, id, input });

/** The row as stored, `updated_at` included. */
const stored = (id) => db('project_documents').where({ id }).first();

let storedFiles = 0;

/**
 * A project_files row (no disk file: documents never read one). A task file needs `task`.
 * @returns {Promise<{ id: number, name: string }>}
 */
async function fileRow(project, { task = null, ...more } = {}) {
  storedFiles += 1;
  const row = {
    projectId: project.id,
    scope: task ? 'task' : 'project',
    taskId: task?.id ?? null,
    phase: task ? null : 'design',
    visibility: task ? 'managers' : 'everyone',
    status: 'active',
    name: `brief-${storedFiles}.pdf`,
    ext: 'pdf',
    sizeBytes: 2048,
    storageKey: `2026/11/${storedFiles.toString(16).padStart(32, '0')}`,
    createdBy: pm.id,
    createdAt: nowDate(),
    updatedAt: nowDate(),
    ...more,
  };
  const [id] = await db('project_files').insert(row);
  return { id, ...row };
}

async function taskRow(project, title = 'Fix the login page') {
  const [id] = await db('project_tasks').insert({
    projectId: project.id,
    title,
    phase: 'design',
    createdBy: pm.id,
  });
  return { id, title };
}

/** A's rename, move or delete of a file, which calls syncFileDocument inside its transaction. */
const sync = (change) => db.transaction((trx) => projectSummaries.syncFileDocument(change, trx));

/** The text of a project file, as the PM's browser posts it after the upload. */
const fileText = (file, more = {}) => ({
  kind: 'file',
  fileId: file.id,
  title: file.name,
  text: `${file.name} says the client approved the scope.`,
  pages: 1,
  pagesTotal: 1,
  ...more,
});

/** Rows straight into the table, to fill a project up. */
async function fill(project, count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    projectId: project.id,
    phase: 'design',
    kind: 'note',
    title: `Note ${index}`,
    body: 'x',
    charCount: 1,
    createdBy: pm.id,
    updatedBy: pm.id,
  }));
  await db('project_documents').insert(rows);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Omar Other', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  member = await createUser({ name: 'Mia Member' });
});

beforeEach(async () => {
  setNowForTests(T0);
  await setSettings({ ai_enabled: true, ai_project_summary_enabled: true });
});

afterEach(() => {
  ai.setTransportForTests(null);
});

describe('adding and reading', () => {
  it('stores a file with its pages and a note without, and the file never', async () => {
    const project = await newProject();
    const { file, note: saved } = await addSampleDocuments(pm, project);
    expect(file).toMatchObject({
      projectId: project.id,
      phase: 'requirement_gathering',
      kind: 'file',
      title: 'SOW-Acme-v3.pdf',
      pages: 4,
      pagesTotal: 4,
      charCount: SOW_TEXT.length,
      createdBy: pm.id,
      updatedBy: pm.id,
    });
    expect(file).not.toHaveProperty('body');
    expect(saved).toMatchObject({ kind: 'note', pages: null, pagesTotal: null });
    expect(saved).not.toHaveProperty('body');
  });

  it('lists newest first, without the text', async () => {
    const project = await newProject();
    const first = await add(project, note({ title: 'First' }));
    setNowForTests('2026-10-30T07:00:00Z');
    const second = await add(project, note({ title: 'Second' }));
    const third = await add(project, note({ title: 'Third, same second' }));
    const rows = await projectSummaries.listDocuments({ user: pm, projectId: project.id });
    expect(rows.map((row) => row.id)).toEqual([third.id, second.id, first.id]);
    for (const row of rows) expect(row).not.toHaveProperty('body');
  });

  it('gives one with its text, pages and all', async () => {
    const project = await newProject();
    const { file } = await addSampleDocuments(pm, project);
    const row = await projectSummaries.getDocument({ user: pm, id: file.id });
    expect(row.body).toBe(SOW_TEXT);
    expect(row.body.split('\f')).toHaveLength(4);
  });

  it("keeps a file's empty first page, so page numbers stay right", async () => {
    const project = await newProject();
    const file = await add(project, {
      phase: 'design',
      kind: 'file',
      title: 'Scan.pdf',
      text: '\fPage two has the go-live date.',
      pages: 2,
      pagesTotal: 2,
    });
    geminiAnswers({
      overview: 'A scan.',
      scope: [{ text: 'Go-live', doc: 'D1', quote: 'the go-live date' }],
    });
    const { body } = await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    expect(body.scope[0]).toMatchObject({ documentId: file.id, page: 2 });
  });

  it('keeps Hindi and Punjabi text as it came', async () => {
    const project = await newProject();
    const text = 'ग्राहक ने मंजूरी दी\fਗਾਹਕ ਨੇ ਮਨਜ਼ੂਰੀ ਦਿੱਤੀ';
    const file = await add(project, {
      phase: 'design',
      kind: 'file',
      title: 'ਨੋਟਸ.pdf',
      text,
      pages: 2,
    });
    expect((await projectSummaries.getDocument({ user: pm, id: file.id })).body).toBe(text);
    geminiAnswers({
      overview: 'The client approved.',
      risks: [{ text: 'Approved', kind: 'risk', doc: 'D1', quote: 'ਗਾਹਕ ਨੇ ਮਨਜ਼ੂਰੀ' }],
    });
    const { body } = await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    expect(body.risks[0]).toMatchObject({ source: 'ਨੋਟਸ.pdf, page 2', quote: 'ਗਾਹਕ ਨੇ ਮਨਜ਼ੂਰੀ' });
  });

  it('gives a project missing or a document missing as NOT_FOUND', async () => {
    await expectAppError(add({ id: 999_999 }), 'NOT_FOUND');
    await expectAppError(
      projectSummaries.listDocuments({ user: pm, projectId: 999_999 }),
      'NOT_FOUND',
    );
    await expectAppError(projectSummaries.getDocument({ user: pm, id: 999_999 }), 'NOT_FOUND');
    await expectAppError(projectSummaries.getDocument({ user: pm, id: 'abc' }), 'NOT_FOUND');
    await expectAppError(
      projectSummaries.updateDocument({ user: pm, id: 999_999, input: { title: 'x' } }),
      'NOT_FOUND',
    );
    await expectAppError(projectSummaries.removeDocument({ user: pm, id: 999_999 }), 'NOT_FOUND');
  });
});

describe('limits', () => {
  it('checks the title, text and phase', async () => {
    const project = await newProject();
    const fieldOf = async (input) =>
      Object.keys((await expectAppError(add(project, input), 'VALIDATION_FAILED')).fields);
    expect(await fieldOf(note({ title: 'x'.repeat(201) }))).toEqual(['title']);
    expect(await fieldOf(note({ title: '  ' }))).toEqual(['title']);
    expect(await fieldOf(note({ text: 'x'.repeat(200_001) }))).toEqual(['text']);
    expect(await fieldOf(note({ text: '   ' }))).toEqual(['text']);
    expect(await fieldOf(note({ phase: 'launched' }))).toEqual(['phase']);
    expect(await fieldOf(note({ kind: 'folder' }))).toEqual(['kind']);
    const longest = await add(project, note({ title: 'x'.repeat(200), text: 'y'.repeat(200_000) }));
    expect(longest.charCount).toBe(200_000);
  });

  it('stops at 100 documents per project, notes and texts together', async () => {
    const project = await newProject();
    await fill(project, 99);
    await add(project);
    const error = await expectAppError(add(project), 'TOO_MANY_DOCUMENTS');
    expect(error).toMatchObject({ status: 409, message: TOO_MANY });
    const file = await fileRow(project);
    await expectAppError(add(project, fileText(file)), 'TOO_MANY_DOCUMENTS');
    const rows = await projectSummaries.listDocuments({ user: pm, projectId: project.id });
    expect(rows).toHaveLength(100);
    await projectSummaries.removeDocument({ user: pm, id: rows[0].id });
    await add(project, fileText(file));
  });

  it('counts documents added at the same time', async () => {
    const project = await newProject();
    await fill(project, 98);
    const results = await Promise.allSettled([
      add(project),
      add(project),
      add(project),
      add(project),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    for (const result of results.filter((item) => item.status === 'rejected')) {
      expect(result.reason.code).toBe('TOO_MANY_DOCUMENTS');
    }
    expect(await db('project_documents').where({ projectId: project.id })).toHaveLength(100);
  });
});

describe('editing and deleting', () => {
  it('edits a note, only what was sent', async () => {
    const project = await newProject();
    const saved = await add(project, note({ title: 'Old title', text: 'Old text' }));
    setNowForTests('2026-10-30T07:00:00Z');
    const edited = await projectSummaries.updateDocument({
      user: pm,
      id: saved.id,
      input: { title: '  New title ' },
      ip: '10.0.0.1',
    });
    expect(edited).toMatchObject({ title: 'New title', charCount: 8 });
    expect(edited).not.toHaveProperty('body');
    expect(edited.updatedAt).toEqual(new Date('2026-10-30T07:00:00Z'));
    const again = await projectSummaries.updateDocument({
      user: admin,
      id: saved.id,
      input: { text: 'Newer text!', phase: 'launch' },
    });
    expect(again).toMatchObject({ title: 'New title', charCount: 11, phase: 'launch' });
    expect(again.updatedBy).toBe(admin.id);
    const row = await projectSummaries.getDocument({ user: pm, id: saved.id });
    expect(row.body).toBe('Newer text!');
  });

  it('changes nothing for the same words, so a summary stays fresh', async () => {
    const project = await newProject();
    const saved = await add(project, note({ title: 'Same', text: 'Same text' }));
    geminiAnswers(SAMPLE_ANSWER);
    await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    setNowForTests('2026-10-30T07:00:00Z');
    const edited = await projectSummaries.updateDocument({
      user: pm,
      id: saved.id,
      input: { title: 'Same', text: 'Same text' },
    });
    expect(edited.updatedAt).toEqual(new Date(T0));
    const summary = await projectSummaries.getSummary({ user: pm, projectId: project.id });
    expect(summary.stale).toBe(false);
    const logs = await db('audit_logs').where({
      action: 'project_document.update',
      entityId: saved.id,
    });
    expect(logs).toHaveLength(0);
  });

  it('checks an edit and refuses a file', async () => {
    const project = await newProject();
    const saved = await add(project);
    const edit = (id, input) => projectSummaries.updateDocument({ user: pm, id, input });
    await expectAppError(edit(saved.id, {}), 'VALIDATION_FAILED');
    await expectAppError(edit(saved.id, { text: ' ' }), 'VALIDATION_FAILED');
    await expectAppError(edit(saved.id, { title: 'x'.repeat(201) }), 'VALIDATION_FAILED');
    const { file } = await addSampleDocuments(pm, project);
    const error = await expectAppError(edit(file.id, { text: 'New' }), 'VALIDATION_FAILED');
    expect(error.fields.kind).toBe('Only notes can be edited.');
    expect((await projectSummaries.getDocument({ user: pm, id: file.id })).body).toBe(SOW_TEXT);
  });

  it('deletes a file or a note', async () => {
    const project = await newProject();
    const { file, note: saved } = await addSampleDocuments(pm, project);
    expect(
      await projectSummaries.removeDocument({ user: pm, id: file.id, ip: '10.0.0.1' }),
    ).toEqual({ id: file.id, deleted: true });
    await expectAppError(projectSummaries.getDocument({ user: pm, id: file.id }), 'NOT_FOUND');
    await projectSummaries.removeDocument({ user: admin, id: saved.id });
    expect(await projectSummaries.listDocuments({ user: pm, projectId: project.id })).toEqual([]);
  });

  it('goes when its project goes', async () => {
    const project = await newProject();
    const { note: saved } = await addSampleDocuments(pm, project);
    await db('projects').where({ id: project.id }).del();
    expect(await db('project_documents').where({ id: saved.id })).toEqual([]);
  });
});

describe('who may', () => {
  const outsiders = () => [
    ['another PM', otherPm],
    ['HR', hr],
    ['an employee on the project', member],
  ];

  /** A project with a file, a note and a summary. */
  async function fullProject() {
    const project = await newProject();
    await addMembers(project, [member]);
    const documents = await addSampleDocuments(pm, project);
    geminiAnswers(SAMPLE_ANSWER);
    const summary = await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    return { project, ...documents, summary };
  }

  it('lets the PM and an Admin do everything', async () => {
    const { project, note: saved, summary } = await fullProject();
    for (const user of [pm, admin]) {
      const rows = await projectSummaries.listDocuments({ user, projectId: project.id });
      expect(rows).toHaveLength(2);
      expect((await projectSummaries.getDocument({ user, id: saved.id })).id).toBe(saved.id);
      const read = await projectSummaries.getSummary({ user, projectId: project.id });
      expect(read.body.overview).toBe(summary.body.overview);
    }
    await projectSummaries.addActionAsTask({
      user: admin,
      projectId: project.id,
      actionKey: summary.body.actions[0].key,
    });
  });

  it('answers NOT_FOUND on reads to everyone else, with the same words as for nothing', async () => {
    const { project, file } = await fullProject();
    const missingProject = await expectAppError(
      projectSummaries.listDocuments({ user: pm, projectId: 999_999 }),
      'NOT_FOUND',
    );
    const missingDocument = await expectAppError(
      projectSummaries.getDocument({ user: pm, id: 999_999 }),
      'NOT_FOUND',
    );
    for (const [who, user] of outsiders()) {
      const list = await expectAppError(
        projectSummaries.listDocuments({ user, projectId: project.id }),
        'NOT_FOUND',
      );
      expect(list.message, who).toBe(missingProject.message);
      const one = await expectAppError(
        projectSummaries.getDocument({ user, id: file.id }),
        'NOT_FOUND',
      );
      expect(one.message, who).toBe(missingDocument.message);
      await expectAppError(
        projectSummaries.getSummary({ user, projectId: project.id }),
        'NOT_FOUND',
      );
    }
  });

  it('answers FORBIDDEN on writes to everyone else, and changes nothing', async () => {
    const { project, file, note: saved, summary } = await fullProject();
    const requests = geminiAnswers(SAMPLE_ANSWER);
    const documentsBefore = await db('project_documents').where({ projectId: project.id });
    for (const [who, user] of outsiders()) {
      const forbidden = (promise) => expectAppError(promise, 'FORBIDDEN');
      await forbidden(add(project, note(), user)).catch((error) => {
        throw new Error(`${who}: ${error.message}`);
      });
      await forbidden(
        projectSummaries.updateDocument({ user, id: saved.id, input: { text: 'Mine now' } }),
      );
      await forbidden(projectSummaries.removeDocument({ user, id: file.id }));
      await forbidden(projectSummaries.writeSummary({ user, projectId: project.id }));
      await forbidden(
        projectSummaries.addActionAsTask({
          user,
          projectId: project.id,
          actionKey: summary.body.actions[0].key,
        }),
      );
    }
    expect(requests).toHaveLength(0);
    expect(await db('project_documents').where({ projectId: project.id })).toEqual(documentsBefore);
    expect(await db('project_tasks').where({ projectId: project.id })).toEqual([]);
  });

  it('holds for a project whose PM changed', async () => {
    const { project, file } = await fullProject();
    await db('projects').where({ id: project.id }).update({ pmId: otherPm.id });
    await expectAppError(projectSummaries.getDocument({ user: pm, id: file.id }), 'NOT_FOUND');
    const row = await projectSummaries.getDocument({ user: otherPm, id: file.id });
    expect(row.body).toBe(SOW_TEXT);
  });
});

describe('places and who sees it', () => {
  /** A project with the employee and another PM on it, and HR not. */
  async function sharedProject() {
    const project = await newProject();
    await addMembers(project, [member, otherPm]);
    return project;
  }

  it('keeps a note for the Whole project, Everyone or Only PM and Admins', async () => {
    const project = await sharedProject();
    const whole = await add(project, note({ phase: null, visibility: 'everyone' }));
    expect(whole).toMatchObject({ phase: null, visibility: 'everyone', fileId: null });
    const quiet = await add(project, note({ visibility: 'managers' }));
    expect(quiet).toMatchObject({ phase: 'design', visibility: 'managers' });
    await expectAppError(add(project, note({ visibility: 'friends' })), 'VALIDATION_FAILED');
    const missing = await expectAppError(
      add(project, note({ phase: undefined })),
      'VALIDATION_FAILED',
    );
    expect(missing.fields.phase).toBe('Pick a place from the list.');
  });

  it('stores a note sent without who sees it as Only PM and Admins: a member gets 404', async () => {
    const project = await sharedProject();
    const saved = await add(project, note({ title: 'Kept close' }));
    expect(saved.visibility).toBe('managers');
    expect((await stored(saved.id)).visibility).toBe('managers');
    const error = await expectAppError(
      projectSummaries.getDocument({ user: member, id: saved.id }),
      'NOT_FOUND',
    );
    expect(error.message).toBe("We couldn't find that file or note.");
  });

  it('lets members read Everyone notes and text-only documents, nothing else', async () => {
    const project = await sharedProject();
    const shared = await add(project, note({ title: 'Shared', visibility: 'everyone' }));
    const quiet = await add(project, note({ title: 'Quiet' }));
    const old = await add(project, {
      phase: null,
      kind: 'file',
      title: 'Old-SOW.pdf',
      text: 'Scope page',
      pages: 1,
      visibility: 'everyone',
    });
    const file = await fileRow(project, { visibility: 'everyone' });
    const text = await add(project, fileText(file, { visibility: 'everyone' }));
    for (const user of [member, otherPm]) {
      const rows = await projectSummaries.listDocumentsFor({ viewer: user, projectId: project.id });
      expect(rows.map((row) => row.id).sort()).toEqual([shared.id, old.id].sort());
      expect(rows.find((row) => row.id === shared.id).createdByName).toBe('Riya Kapoor');
      expect((await projectSummaries.getDocument({ user, id: shared.id })).body).toBe('Some text.');
      expect((await projectSummaries.getDocument({ user, id: old.id })).body).toBe('Scope page');
      for (const id of [quiet.id, text.id]) {
        await expectAppError(projectSummaries.getDocument({ user, id }), 'NOT_FOUND');
      }
      await expectAppError(
        projectSummaries.listDocuments({ user, projectId: project.id }),
        'NOT_FOUND',
      );
    }
    for (const user of [pm, admin]) {
      const rows = await projectSummaries.listDocumentsFor({ viewer: user, projectId: project.id });
      expect(rows).toHaveLength(4);
      expect(rows.find((row) => row.id === text.id).fileId).toBe(file.id);
    }
    const outsider = await createUser({
      name: 'Ola Outsider',
      role: 'pm',
      tracksAttendance: false,
    });
    for (const user of [hr, outsider]) {
      const rows = await projectSummaries.listDocumentsFor({ viewer: user, projectId: project.id });
      expect(rows).toEqual([]);
      await expectAppError(projectSummaries.getDocument({ user, id: shared.id }), 'NOT_FOUND');
    }
    await db('project_members').where({ projectId: project.id, userId: member.id }).del();
    const removed = await projectSummaries.listDocumentsFor({
      viewer: member,
      projectId: project.id,
    });
    expect(removed).toEqual([]);
    await expectAppError(
      projectSummaries.getDocument({ user: member, id: shared.id }),
      'NOT_FOUND',
    );
    expect(await projectSummaries.listDocumentsFor({ viewer: pm, projectId: 999_999 })).toEqual([]);
  });

  it('moves a note or changes who sees it without making it newer', async () => {
    const project = await sharedProject();
    const saved = await add(project, note());
    const before = await stored(saved.id);
    setNowForTests('2026-10-30T07:00:00Z');
    const moved = await edit(saved.id, { phase: null, visibility: 'everyone' });
    expect(moved).toMatchObject({ phase: null, visibility: 'everyone', title: 'Notes' });
    expect((await stored(saved.id)).updatedAt).toEqual(before.updatedAt);
    const renamed = await edit(saved.id, { title: 'Renamed', phase: 'launch' });
    expect(renamed).toMatchObject({ title: 'Renamed', phase: 'launch' });
    expect((await stored(saved.id)).updatedAt).toEqual(new Date('2026-10-30T07:00:00Z'));
    await expectAppError(edit(saved.id, { phase: 'nowhere' }), 'VALIDATION_FAILED');
    await expectAppError(edit(saved.id, { visibility: 'all' }), 'VALIDATION_FAILED');
  });

  it('renames and moves a text-only document, but never changes its text', async () => {
    const project = await sharedProject();
    const { file: old } = await addSampleDocuments(pm, project);
    const edited = await edit(old.id, {
      title: 'SOW-Acme-final.pdf',
      phase: null,
      visibility: 'everyone',
    });
    expect(edited).toMatchObject({ title: 'SOW-Acme-final.pdf', phase: null, kind: 'file' });
    const error = await expectAppError(edit(old.id, { text: 'New' }), 'VALIDATION_FAILED');
    expect(error.fields.kind).toBe('Only notes can be edited.');
  });
});

describe('the text of a project file', () => {
  it('takes its place and name from the file and is always Only PM and Admins', async () => {
    const project = await newProject();
    const file = await fileRow(project, { name: 'brief.pdf', phase: 'testing' });
    const saved = await add(
      project,
      fileText(file, { title: 'other.pdf', visibility: 'everyone' }),
    );
    expect(saved).toMatchObject({
      kind: 'file',
      fileId: file.id,
      phase: 'testing',
      title: 'brief.pdf',
      visibility: 'managers',
    });
    const whole = await fileRow(project, { phase: null });
    expect((await add(project, fileText(whole))).phase).toBeNull();
  });

  it('refuses a second text, a task file, a deleted file and one of another project', async () => {
    const project = await newProject();
    const file = await fileRow(project);
    await add(project, fileText(file));
    const twice = await expectAppError(add(project, fileText(file)), 'CONFLICT');
    expect(twice.message).toBe("This file's text is already saved.");
    const task = await taskRow(project);
    const onTask = await fileRow(project, { task, name: 'secret-contract.pdf' });
    const refused = await expectAppError(add(project, fileText(onTask)), 'VALIDATION_FAILED');
    expect(refused.fields.fileId).toBe('Only project files are read for the AI summary.');
    const gone = await fileRow(project, { status: 'deleted', deletedAt: nowDate() });
    await expectAppError(add(project, fileText(gone)), 'NOT_FOUND');
    const elsewhere = await fileRow(await newProject());
    await expectAppError(add(project, fileText(elsewhere)), 'NOT_FOUND');
    // Another PM's file that has a text answers the same 404 as one without: an id says nothing.
    projectCount += 1;
    const theirs = await createProject(otherPm, { name: `documents-${projectCount}` });
    const withText = await fileRow(theirs, { createdBy: otherPm.id });
    await add(theirs, fileText(withText), otherPm);
    for (const id of [withText.id, elsewhere.id, 999999]) {
      const error = await expectAppError(add(project, fileText({ ...withText, id })), 'NOT_FOUND');
      expect(error.message).toBe("We couldn't find that file.");
    }
    const asNote = await expectAppError(
      add(project, note({ fileId: file.id })),
      'VALIDATION_FAILED',
    );
    expect(asNote.fields.fileId).toBe('Only project files are read for the AI summary.');
    expect(await db('project_documents').where({ projectId: project.id })).toHaveLength(1);
  });

  it('follows its file: no edits, and deleting it keeps the file', async () => {
    const project = await newProject();
    const file = await fileRow(project);
    const text = await add(project, fileText(file));
    for (const input of [{ title: 'x.pdf' }, { phase: null }, { visibility: 'everyone' }]) {
      const error = await expectAppError(edit(text.id, input), 'VALIDATION_FAILED');
      expect(error.fields.fileId).toBe('This text follows its file. Change the file instead.');
    }
    await projectSummaries.removeDocument({ user: pm, id: text.id });
    expect(await db('project_files').where({ id: file.id }).first()).toBeTruthy();
    expect((await add(project, fileText(file))).fileId).toBe(file.id);
  });

  it('is renamed, moved and deleted with its file, and goes when the file row goes', async () => {
    const project = await newProject();
    const file = await fileRow(project);
    const text = await add(project, fileText(file));
    await sync({ fileId: file.id, title: 'renamed.pdf', phase: null });
    expect(await stored(text.id)).toMatchObject({ title: 'renamed.pdf', phase: null });
    expect((await stored(text.id)).visibility).toBe('managers');
    await sync({ fileId: 999_999, title: 'nothing.pdf' });
    await sync({ fileId: file.id, remove: true });
    expect(await stored(text.id)).toBeUndefined();
    const other = await fileRow(project);
    const otherText = await add(project, fileText(other));
    await db('project_files').where({ id: other.id }).del();
    expect(await stored(otherText.id)).toBeUndefined();
  });
});

describe('the AI summary', () => {
  it('never reads a task file, nor its name', async () => {
    const project = await newProject();
    const task = await taskRow(project);
    const onTask = await fileRow(project, { task, name: 'secret-contract.pdf' });
    await expectAppError(add(project, fileText(onTask)), 'VALIDATION_FAILED');
    await add(project, note({ title: 'Kickoff', text: 'Client approved the scope.' }));
    const requests = geminiAnswers({ overview: 'Approved.' });
    await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0].body)).not.toContain('secret-contract');
    expect(promptOf(requests[0])).toContain('Client approved the scope.');
  });

  it('goes stale on a rename or a delete, not on a move or a change of who sees it', async () => {
    const project = await newProject();
    const file = await fileRow(project);
    const text = await add(project, fileText(file));
    const saved = await add(project, note());
    geminiAnswers({ overview: 'Fresh.' });
    await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    const stale = async () =>
      (await projectSummaries.getSummary({ user: pm, projectId: project.id })).stale;
    const before = (await stored(text.id)).updatedAt;
    setNowForTests('2026-10-31T06:00:00Z');
    await sync({ fileId: file.id, phase: 'launch' });
    await edit(saved.id, { visibility: 'everyone', phase: null });
    expect((await stored(text.id)).updatedAt).toEqual(before);
    expect(await stale()).toBe(false);
    await sync({ fileId: file.id, title: 'renamed.pdf' });
    expect(await stale()).toBe(true);
    await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    expect(await stale()).toBe(false);
    await sync({ fileId: file.id, remove: true });
    expect(await stale()).toBe(true);
  });

  it('says where to add documents first', async () => {
    const project = await newProject();
    geminiAnswers(SAMPLE_ANSWER);
    const error = await expectAppError(
      projectSummaries.writeSummary({ user: pm, projectId: project.id }),
      'NO_DOCUMENTS',
    );
    expect(error.message).toBe('Add a note, or a PDF, Word or text file, in Files first.');
  });
});

describe('before migration 019', () => {
  let warn;
  let project;
  let kept;

  beforeAll(async () => {
    project = await newProject();
    await addMembers(project, [member]);
    kept = await add(project, note({ title: 'Kept' }));
    await db.migrate.down({ name: MIGRATION_019 });
    resetMigration019WarningsForTests();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterAll(async () => {
    // Leave the test database migrated even when a test failed half way.
    await db.migrate.latest();
    warn.mockRestore();
  });

  it('reads every document as Only PM and Admins with no file', async () => {
    const rows = await projectSummaries.listDocuments({ user: pm, projectId: project.id });
    expect(rows).toEqual([expect.objectContaining({ id: kept.id, visibility: 'managers' })]);
    expect(rows[0].fileId).toBeNull();
    const one = await projectSummaries.getDocument({ user: pm, id: kept.id });
    expect(one).toMatchObject({ visibility: 'managers', fileId: null });
    const forPm = await projectSummaries.listDocumentsFor({ viewer: pm, projectId: project.id });
    expect(forPm).toHaveLength(1);
    const forMember = await projectSummaries.listDocumentsFor({
      viewer: member,
      projectId: project.id,
    });
    expect(forMember).toEqual([]);
    const warned = warn.mock.calls.map((call) => String(call[0]));
    expect(warned).toContain(
      'The 1.12 database update is missing (run the migrate line); documents is off',
    );
  });

  it('adds and edits a note without the new choices, as 1.11 did', async () => {
    const saved = await add(project, note({ title: 'Before' }));
    expect(saved).toMatchObject({ phase: 'design', visibility: 'managers', fileId: null });
    const quiet = await add(project, note({ visibility: 'managers' }));
    expect(quiet.visibility).toBe('managers');
    const moved = await edit(saved.id, { title: 'Before, renamed', phase: 'launch' });
    expect(moved).toMatchObject({ title: 'Before, renamed', phase: 'launch' });
    await edit(saved.id, { visibility: 'managers' });
    await projectSummaries.removeDocument({ user: pm, id: quiet.id });
  });

  it('answers UPDATE_NEEDED to Everyone, Whole project or a file, and saves nothing', async () => {
    const count = async () =>
      (await db('project_documents').where({ projectId: project.id })).length;
    const before = await count();
    const updateNeeded = async (promise) => {
      const error = await expectAppError(promise, 'UPDATE_NEEDED');
      expect(error).toMatchObject({
        status: 503,
        message: 'This needs the latest database update. Ask an Admin.',
      });
    };
    await updateNeeded(add(project, note({ visibility: 'everyone' })));
    await updateNeeded(add(project, note({ phase: null })));
    await updateNeeded(add(project, fileText({ id: 1, name: 'a.pdf' })));
    await updateNeeded(edit(kept.id, { visibility: 'everyone' }));
    await updateNeeded(edit(kept.id, { phase: null }));
    expect(await count()).toBe(before);
  });

  it('writes the AI summary as before', async () => {
    geminiAnswers({ overview: 'Still works.' });
    const summary = await projectSummaries.writeSummary({ user: pm, projectId: project.id });
    expect(summary.body.overview).toBe('Still works.');
  });
});
