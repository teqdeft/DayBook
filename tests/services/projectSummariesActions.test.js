// A summary over time (CONTRACT 22): stale after a document is added, edited or deleted, the 50,000
// character total, and an action item added as a task once. Fake transport only; fetch is blocked.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { projectPlan } from '@/modules/projectPlan';
import { projectSummaries } from '@/modules/projectSummaries';
import { MAX_SENT_CHARACTERS } from '@/modules/projectSummaries/prompt';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  addSampleDocuments,
  expectAppError,
  geminiAnswers,
  promptOf,
  SAMPLE_ANSWER,
  sentDocument,
  T0,
} from './projectSummariesKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

const CHANGED = 'The summary changed. Reload the page.';

let admin;
let pm;
let neha;
let projectCount = 0;

const write = (project, user = pm) =>
  projectSummaries.writeSummary({ user, projectId: project.id, ip: '10.0.0.1' });
const read = (project) => projectSummaries.getSummary({ user: pm, projectId: project.id });
const addTask = (project, actionKey, user = pm) =>
  projectSummaries.addActionAsTask({ user, projectId: project.id, actionKey, ip: '10.0.0.1' });
const tasksOf = (project) => projectTasks.listForProject({ viewer: pm, projectId: project.id });

async function newProject() {
  projectCount += 1;
  const project = await createProject(pm, { name: `over-time-${projectCount}` });
  await addMembers(project, [neha]);
  return project;
}

/** A project with the sample documents and a summary of them. */
async function summarised() {
  const project = await newProject();
  const documents = await addSampleDocuments(pm, project);
  geminiAnswers(SAMPLE_ANSWER);
  const summary = await write(project);
  return { project, ...documents, summary };
}

const later = (minutes) =>
  setNowForTests(new Date(Date.parse(T0) + minutes * 60_000).toISOString());

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  neha = await createUser({ name: 'Neha Arora' });
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('ai_usage').delete();
  await setSettings({ ai_enabled: true, ai_daily_limit: 500, ai_project_summary_enabled: true });
});

afterEach(() => {
  ai.setTransportForTests(null);
});

describe('stale', () => {
  it('is fresh right after writing', async () => {
    const { project, summary } = await summarised();
    expect(summary.stale).toBe(false);
    expect((await read(project)).stale).toBe(false);
  });

  it('turns stale when a document is added', async () => {
    const { project } = await summarised();
    later(1);
    await projectSummaries.addDocument({
      user: pm,
      projectId: project.id,
      input: { phase: 'design', kind: 'note', title: 'More', text: 'More words.' },
    });
    const summary = await read(project);
    expect(summary.stale).toBe(true);
    expect(summary.sources).toEqual({ files: 1, notes: 2 });
    expect(summary.body.overview).toBe(SAMPLE_ANSWER.overview);
  });

  it('turns stale when a note is edited', async () => {
    const { project, note } = await summarised();
    later(1);
    await projectSummaries.updateDocument({
      user: pm,
      id: note.id,
      input: { text: 'Different words now.' },
    });
    expect((await read(project)).stale).toBe(true);
  });

  it('turns stale when a document is deleted', async () => {
    const { project, file } = await summarised();
    later(1);
    await projectSummaries.removeDocument({ user: pm, id: file.id });
    const summary = await read(project);
    expect(summary.stale).toBe(true);
    expect(summary.sources).toEqual({ files: 0, notes: 1 });
  });

  it('turns stale when every document is deleted, and stays readable', async () => {
    const { project, file, note } = await summarised();
    await projectSummaries.removeDocument({ user: pm, id: file.id });
    await projectSummaries.removeDocument({ user: pm, id: note.id });
    const summary = await read(project);
    expect(summary.stale).toBe(true);
    expect(summary.sources).toEqual({ files: 0, notes: 0 });
  });

  it('is fresh again after an update', async () => {
    const { project, note } = await summarised();
    later(1);
    await projectSummaries.updateDocument({ user: pm, id: note.id, input: { title: 'Renamed' } });
    expect((await read(project)).stale).toBe(true);
    later(2);
    geminiAnswers(SAMPLE_ANSWER);
    expect((await write(project)).stale).toBe(false);
  });

  it('reads as stale when a document changes while the AI is writing', async () => {
    const project = await newProject();
    const { note } = await addSampleDocuments(pm, project);
    ai.setTransportForTests(async () => {
      later(1);
      await projectSummaries.updateDocument({
        user: pm,
        id: note.id,
        input: { text: 'Changed during the call. Client approved the scope.' },
      });
      return { status: 200, data: ai.fakeGeminiResponse({ data: SAMPLE_ANSWER }) };
    });
    expect((await write(project)).stale).toBe(true);
  });

  it('depends only on the documents of this project', async () => {
    const { project } = await summarised();
    const other = await newProject();
    later(1);
    await addSampleDocuments(pm, other);
    expect((await read(project)).stale).toBe(false);
  });
});

describe('rewrites at the same time', () => {
  it('leaves one row when two first summaries arrive together', async () => {
    const project = await newProject();
    await addSampleDocuments(pm, project);
    geminiAnswers(SAMPLE_ANSWER);
    const results = await Promise.all([write(project), write(project, admin)]);
    expect(results.map((summary) => summary.stale)).toEqual([false, false]);
    expect(await db('project_summaries').where({ projectId: project.id })).toHaveLength(1);
  });

  it('keeps a task added by an earlier write when two rewrites arrive together', async () => {
    const { project, summary } = await summarised();
    const added = await addTask(project, summary.body.actions[0].key);
    geminiAnswers(SAMPLE_ANSWER);
    await Promise.all([write(project), write(project, admin)]);
    expect((await read(project)).body.actions[0].taskId).toBe(added.taskId);
  });
});

describe('the 50,000 character total', () => {
  const words = (word, length) => `${word} `.repeat(Math.ceil(length / (word.length + 1))).trim();
  const noteOf = (project, title, text) =>
    projectSummaries.addDocument({
      user: pm,
      projectId: project.id,
      input: { phase: 'design', kind: 'note', title, text },
    });

  it('reads the newest documents first and says when it stopped early', async () => {
    const project = await newProject();
    await noteOf(project, 'Oldest', 'Oldest sentence about the launch.');
    later(1);
    await noteOf(project, 'Middle', `${words('middle', 30_000)} Tail of the middle note.`);
    later(2);
    await noteOf(project, 'Newest', words('newest', 30_000));
    const requests = geminiAnswers({
      overview: 'A long project.',
      risks: [
        { text: 'Read', kind: 'risk', doc: 'D1', quote: 'newest newest newest' },
        { text: 'Read too', kind: 'risk', doc: 'D2', quote: 'middle middle middle' },
        { text: 'Past the cut', kind: 'risk', doc: 'D2', quote: 'Tail of the middle note' },
        { text: 'Never sent', kind: 'risk', doc: 'D3', quote: 'Oldest sentence' },
      ],
    });
    const summary = await write(project);

    expect(summary.truncated).toBe(true);
    expect(sentDocument(requests[0], 'D1')).toContain('Title: Newest');
    expect(sentDocument(requests[0], 'D2')).toContain('Title: Middle');
    expect(sentDocument(requests[0], 'D3')).toBeNull();
    expect(promptOf(requests[0])).not.toContain('Oldest sentence');
    const sentLength = ['D1', 'D2']
      .map((ref) => sentDocument(requests[0], ref))
      .reduce((sum, text) => sum + text.length, 0);
    expect(sentLength).toBeLessThanOrEqual(MAX_SENT_CHARACTERS + 200);

    expect(summary.body.risks.map((risk) => risk.text)).toEqual(['Read', 'Read too']);
    const row = await db('project_summaries').where({ projectId: project.id }).first();
    expect(row).toMatchObject({ truncated: true, droppedCount: 2 });
  });

  it('leaves out a document that does not fit even with room left by masks', async () => {
    const project = await newProject();
    await noteOf(project, 'Old', 'Old words.');
    later(1);
    await noteOf(project, 'New', words('mail ravi@acme.com', 60_000));
    const requests = geminiAnswers({ overview: 'A long note.' });
    const summary = await write(project);
    expect(summary.truncated).toBe(true);
    expect(promptOf(requests[0])).not.toContain('Old words');
    expect(promptOf(requests[0])).not.toContain('ravi@acme.com');
  });

  it('is not truncated when everything fits', async () => {
    const project = await newProject();
    await noteOf(project, 'Fits', 'x'.repeat(MAX_SENT_CHARACTERS));
    geminiAnswers({ overview: 'Exactly enough.' });
    expect((await write(project)).truncated).toBe(false);
  });

  it('can rewrite a summary that is no longer truncated', async () => {
    const project = await newProject();
    const big = await noteOf(project, 'Big', words('big', 60_000));
    geminiAnswers({ overview: 'Long.' });
    expect((await write(project)).truncated).toBe(true);
    await projectSummaries.removeDocument({ user: pm, id: big.id });
    await noteOf(project, 'Small', 'Small words.');
    geminiAnswers({ overview: 'Short.' });
    expect((await write(project)).truncated).toBe(false);
  });
});

describe('adding an action item as a task', () => {
  it('creates one P2 task with its text, in the current phase, with no due date', async () => {
    const { project, summary } = await summarised();
    await projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'design' });
    const [action] = summary.body.actions;
    const added = await addTask(project, action.key);
    expect(added.key).toBe(action.key);
    expect(added.task).toMatchObject({
      id: added.taskId,
      title: 'Send logo and brand files',
      priority: 'p2',
      status: 'open',
      phase: 'design',
      dueDate: null,
      assigneeId: null,
    });
    const after = await read(project);
    expect(after.body.actions[0].taskId).toBe(added.taskId);
    expect(after.body.actions[1].taskId).toBeNull();
    expect(after.updatedAt).toEqual(summary.updatedAt);
    expect(after.stale).toBe(false);
  });

  it('has no phase while the project has none', async () => {
    const { project, summary } = await summarised();
    const added = await addTask(project, summary.body.actions[0].key);
    expect(added.task.phase).toBeNull();
  });

  it('adds it once: a second call answers the same task', async () => {
    const { project, summary } = await summarised();
    const { key } = summary.body.actions[0];
    const first = await addTask(project, key);
    const second = await addTask(project, key);
    expect(second.taskId).toBe(first.taskId);
    expect(await tasksOf(project)).toHaveLength(1);
  });

  it('adds it once when two clicks arrive together', async () => {
    const { project, summary } = await summarised();
    const { key } = summary.body.actions[0];
    const results = await Promise.all([addTask(project, key), addTask(project, key)]);
    expect(results[0].taskId).toBe(results[1].taskId);
    expect(await tasksOf(project)).toHaveLength(1);
  });

  it('adds two different items as two tasks, also together', async () => {
    const { project, summary } = await summarised();
    const [one, two] = summary.body.actions;
    await Promise.all([addTask(project, one.key), addTask(project, two.key)]);
    const tasks = await tasksOf(project);
    expect(tasks.map((task) => task.title).sort()).toEqual([
      'Send logo and brand files',
      'Share the clickable wireframes',
    ]);
    const { body } = await read(project);
    expect(body.actions.every((action) => action.taskId)).toBe(true);
  });

  it('answers 409 when the item or the summary is gone', async () => {
    const { project, summary } = await summarised();
    const error = await expectAppError(addTask(project, 'no-such-key'), 'SUMMARY_CHANGED');
    expect(error).toMatchObject({ status: 409, message: CHANGED });
    const empty = await newProject();
    await expectAppError(addTask(empty, summary.body.actions[0].key), 'SUMMARY_CHANGED');
    geminiAnswers({ ...SAMPLE_ANSWER, actions: [] });
    await write(project);
    await expectAppError(addTask(project, summary.body.actions[0].key), 'SUMMARY_CHANGED');
    expect(await tasksOf(project)).toEqual([]);
  });

  it('checks the key', async () => {
    const { project } = await summarised();
    for (const key of ['', ' ', 'x'.repeat(65), null, undefined, 5]) {
      await expectAppError(addTask(project, key), 'VALIDATION_FAILED');
    }
  });

  it('keeps the task through a rewrite when the item keeps its key', async () => {
    const { project, summary } = await summarised();
    const [action] = summary.body.actions;
    const added = await addTask(project, action.key);
    later(5);
    geminiAnswers({
      ...SAMPLE_ANSWER,
      actions: [
        { ...SAMPLE_ANSWER.actions[0], text: '  send LOGO and brand  files ' },
        {
          owner: 'us',
          text: 'A new thing to do',
          dueAsWritten: null,
          doc: 'D1',
          quote: 'Client approved the scope',
        },
      ],
    });
    const { body } = await write(project);
    expect(body.actions[0]).toMatchObject({ key: action.key, taskId: added.taskId });
    expect(body.actions[1].taskId).toBeNull();
    expect((await addTask(project, action.key)).taskId).toBe(added.taskId);
    expect(await tasksOf(project)).toHaveLength(1);
  });

  it('forgets a task once the item has left the summary', async () => {
    const { project, summary } = await summarised();
    const [action] = summary.body.actions;
    await addTask(project, action.key);
    geminiAnswers({ ...SAMPLE_ANSWER, actions: [SAMPLE_ANSWER.actions[1]] });
    await write(project);
    geminiAnswers(SAMPLE_ANSWER);
    const { body } = await write(project);
    expect(body.actions[0]).toMatchObject({ key: action.key, taskId: null });
  });

  it('can add it again once the task was deleted', async () => {
    const { project, summary } = await summarised();
    const { key } = summary.body.actions[0];
    const first = await addTask(project, key);
    await projectTasks.remove({ user: pm, id: first.taskId });
    expect((await read(project)).body.actions[0].taskId).toBeNull();
    const second = await addTask(project, key);
    expect(second.taskId).not.toBe(first.taskId);
    expect(await tasksOf(project)).toHaveLength(1);
  });

  it('adds nothing to a completed project', async () => {
    const { project, summary } = await summarised();
    await db('projects').where({ id: project.id }).update({ status: 'completed' });
    const { key } = summary.body.actions[0];
    await expectAppError(addTask(project, key), 'PROJECT_NOT_ACTIVE');
    expect((await read(project)).body.actions[0].taskId).toBeNull();
    expect(await tasksOf(project)).toEqual([]);
  });

  it('audits ids only', async () => {
    const { project, summary } = await summarised();
    const added = await addTask(project, summary.body.actions[0].key, admin);
    const row = await db('audit_logs')
      .where({ action: 'project_summary.add_task', entityId: project.id })
      .first();
    expect(row.actorId).toBe(admin.id);
    expect(parseJson(row.after)).toEqual({ taskId: added.taskId });
  });
});
