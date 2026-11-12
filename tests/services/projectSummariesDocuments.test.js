// A project's files and notes (CONTRACT 22): adding, the list without text, one with text, editing
// notes, deleting, the limits, and who may do any of it: only the project's PM and Admin. Reads answer
// NOT_FOUND to anyone else, on the server, and writes FORBIDDEN.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { projectSummaries } from '@/modules/projectSummaries';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  addSampleDocuments,
  expectAppError,
  geminiAnswers,
  SAMPLE_ANSWER,
  SOW_TEXT,
  T0,
} from './projectSummariesKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

const TOO_MANY = 'This project has too many files and notes. Delete some first.';

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

  it('stops at 40 documents per project', async () => {
    const project = await newProject();
    await fill(project, 39);
    await add(project);
    const error = await expectAppError(add(project), 'TOO_MANY_DOCUMENTS');
    expect(error).toMatchObject({ status: 409, message: TOO_MANY });
    const rows = await projectSummaries.listDocuments({ user: pm, projectId: project.id });
    expect(rows).toHaveLength(40);
    await projectSummaries.removeDocument({ user: pm, id: rows[0].id });
    await add(project);
  });

  it('counts documents added at the same time', async () => {
    const project = await newProject();
    await fill(project, 38);
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
    expect(await db('project_documents').where({ projectId: project.id })).toHaveLength(40);
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
    expect(again).toMatchObject({ title: 'New title', charCount: 11, phase: 'design' });
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
