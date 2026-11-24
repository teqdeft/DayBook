// The project page's real 404 (CONTRACT 27, company rule: anyone who is neither a `team.view`
// holder nor an active member gets a 404). The `[id]` layout checks who may open the page before
// anything streams: a Suspense fallback above it (a loading.js in `(app)/` or `(app)/projects/`)
// would send the HTTP 200 first, and a notFound() after that can only draw the not-found screen.
// So the list's loading.js lives in the `(list)` group, and the layout reads the same cached
// access check the page uses (loadProjectHead). The status itself is checked in the browser.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findById = vi.fn();
const isMember = vi.fn();
let viewer = null;

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/session', () => ({ requirePage: async () => viewer }));
vi.mock('@/modules/projects', () => ({
  projects: {
    findById: (...args) => findById(...args),
    isMember: (...args) => isMember(...args),
    canManage: () => false,
  },
}));
vi.mock('@/modules/projectFiles', () => ({ projectFiles: {} }));
vi.mock('@/modules/projectTasks', () => ({ projectTasks: {} }));
vi.mock('@/modules/projectPlan', () => ({ projectPlan: {} }));
vi.mock('@/modules/reports', () => ({ reports: {} }));
vi.mock('@/modules/settings', () => ({ settings: {} }));

const { default: ProjectLayout } = await import('@/app/(app)/projects/[id]/layout.js');

const PROJECT = { id: 5, name: 'acme-store', pmId: 7, status: 'active' };
const EMPLOYEE = { id: 9, role: 'employee', status: 'active' };
const HR = { id: 13, role: 'hr', status: 'active' };
const OTHER_PM = { id: 8, role: 'pm', status: 'active' };

const layout = (id) => ProjectLayout({ children: 'the page', params: Promise.resolve({ id }) });

beforeEach(() => {
  findById.mockReset().mockResolvedValue(PROJECT);
  isMember.mockReset().mockResolvedValue(false);
  viewer = EMPLOYEE;
});

describe('who gets past the project page’s layout', () => {
  it('lets an active member through to the page', async () => {
    isMember.mockResolvedValue(true);
    await expect(layout('5')).resolves.toBe('the page');
    expect(isMember).toHaveBeenCalledWith({ projectId: 5, userId: 9 });
  });

  it('lets a team.view holder through without asking about membership', async () => {
    viewer = OTHER_PM;
    await expect(layout('5')).resolves.toBe('the page');
    expect(isMember).not.toHaveBeenCalled();
  });

  it('answers 404 to someone not on the project, before reading anything about it', async () => {
    for (const person of [EMPLOYEE, HR]) {
      viewer = person;
      await expect(layout('5')).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(findById).not.toHaveBeenCalled();
  });

  it('answers 404 for a project that doesn’t exist and for an id that isn’t one', async () => {
    viewer = OTHER_PM;
    findById.mockResolvedValue(null);
    await expect(layout('999999')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(layout('abc')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(findById).toHaveBeenCalledTimes(1);
  });
});

describe('nothing streams before the layout decides', () => {
  const app = path.resolve(import.meta.dirname, '../../src/app/(app)');

  it('has no loading.js above the project page’s layout', () => {
    expect(existsSync(path.join(app, 'projects/[id]/layout.js'))).toBe(true);
    expect(existsSync(path.join(app, 'loading.js'))).toBe(false);
    expect(existsSync(path.join(app, 'projects/loading.js'))).toBe(false);
  });

  it('keeps the projects list’s own skeleton, in the (list) group beside [id]', () => {
    expect(existsSync(path.join(app, 'projects/(list)/page.js'))).toBe(true);
    expect(existsSync(path.join(app, 'projects/(list)/loading.js'))).toBe(true);
    expect(existsSync(path.join(app, 'projects/page.js'))).toBe(false);
  });
});
