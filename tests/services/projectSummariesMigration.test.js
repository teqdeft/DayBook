// Deploy before migrate (CONTRACT 22): until `npm run migrate` has added migration 015, files, notes
// and summaries read as empty and writes answer a clear error. Once it has run they work, without a
// restart.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { projectSummaries } from '@/modules/projectSummaries';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';
import { geminiAnswers, T0 } from './projectSummariesKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

const MIGRATION = '015_project_plan.js';
const NOTE = { phase: 'design', kind: 'note', title: 'Notes', text: 'Words' };

let warn;
let pm;
let project;
let requests;

async function expectUnavailable(promise) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({
    code: 'PLAN_UNAVAILABLE',
    status: 503,
    message: "Files and notes can't be saved yet. Please try again later.",
  });
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  setNowForTests(T0);
  await setSettings({ ai_enabled: true, ai_project_summary_enabled: true });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  project = await createProject(pm, { name: 'lyra' });
  requests = geminiAnswers({ overview: 'A short overview.' });
  await db.migrate.down({ name: MIGRATION });
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterAll(async () => {
  // Leave the test database migrated even when a test failed half way.
  await db.migrate.latest();
  warn.mockRestore();
  ai.setTransportForTests(null);
});

describe('before migration 015', () => {
  it('reads as nothing yet', async () => {
    const args = { user: pm, projectId: project.id };
    expect(await projectSummaries.listDocuments(args)).toEqual([]);
    expect(await projectSummaries.getSummary(args)).toBeNull();
    await expect(projectSummaries.getDocument({ user: pm, id: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers a clear error on writes, and asks no AI', async () => {
    const projectId = project.id;
    await expectUnavailable(projectSummaries.addDocument({ user: pm, projectId, input: NOTE }));
    await expectUnavailable(
      projectSummaries.updateDocument({ user: pm, id: 1, input: { title: 'x' } }),
    );
    await expectUnavailable(projectSummaries.removeDocument({ user: pm, id: 1 }));
    await expectUnavailable(projectSummaries.writeSummary({ user: pm, projectId }));
    await expectUnavailable(
      projectSummaries.addActionAsTask({ user: pm, projectId, actionKey: 'abc' }),
    );
    expect(requests).toHaveLength(0);
  });

  it('still answers everyone else as usual', async () => {
    const other = await createUser({ name: 'Omar Other', role: 'pm', tracksAttendance: false });
    await expect(
      projectSummaries.listDocuments({ user: other, projectId: project.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      projectSummaries.addDocument({ user: other, projectId: project.id, input: NOTE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('after migration 015', () => {
  it('works at once', async () => {
    await db.migrate.latest();
    const projectId = project.id;
    await projectSummaries.addDocument({ user: pm, projectId, input: NOTE });
    expect(await projectSummaries.listDocuments({ user: pm, projectId })).toHaveLength(1);
    const summary = await projectSummaries.writeSummary({ user: pm, projectId });
    expect(summary.body.overview).toBe('A short overview.');
  });
});
