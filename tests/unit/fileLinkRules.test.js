// The three link rules the browser and the server share (CONTRACT 28, Links: who sees a linked
// file): `canSeeLinkedOnTask` ("through that task only"), `needsShareConfirm` and
// `isProjectManager`. Pure, from access.js.
import { describe, expect, it } from 'vitest';
import { ROLES } from '@/lib/permissions';
import {
  canSeeFile,
  canSeeLinkedOnTask,
  isProjectManager,
  needsShareConfirm,
} from '@/modules/projectFiles/access';
import { canManageProject } from '@/modules/projects/shared';

const PROJECT = 12;
const VISHAL = 7;
const SIMRAN = 9;
const PM = 3;
const project = { id: PROJECT, pmId: PM };

const ctxOf = (extra) => ({
  projectId: PROJECT,
  userId: VISHAL,
  active: true,
  manages: false,
  member: true,
  ...extra,
});
const vishalTask = { assigneeId: VISHAL };
const simranTask = { assigneeId: SIMRAN };
const anyoneTask = { assigneeId: null };
const onBoth = [
  { taskId: 1, assigneeId: VISHAL, projectId: PROJECT },
  { taskId: 2, assigneeId: SIMRAN, projectId: PROJECT },
];
const fileOf = (visibility) => ({
  projectId: PROJECT,
  scope: 'project',
  status: 'active',
  visibility,
  links: onBoth,
});

describe('canSeeLinkedOnTask', () => {
  it("a managers-only file on Vishal's and Simran's tasks: Vishal sees it on his task only", () => {
    const file = fileOf('managers');
    const vishal = ctxOf();
    expect(canSeeLinkedOnTask(vishal, file, vishalTask)).toBe(true);
    expect(canSeeLinkedOnTask(vishal, file, simranTask)).toBe(false);
    const simran = ctxOf({ userId: SIMRAN });
    expect(canSeeLinkedOnTask(simran, file, simranTask)).toBe(true);
    expect(canSeeLinkedOnTask(simran, file, vishalTask)).toBe(false);
  });

  it('managers see it on both tasks', () => {
    const pm = ctxOf({ userId: PM, manages: true, member: false });
    expect(canSeeLinkedOnTask(pm, fileOf('managers'), vishalTask)).toBe(true);
    expect(canSeeLinkedOnTask(pm, fileOf('managers'), simranTask)).toBe(true);
  });

  it("an Everyone file on both: Vishal sees it on his task, not on Simran's, and still opens it", () => {
    const file = fileOf('everyone');
    const vishal = ctxOf();
    expect(canSeeLinkedOnTask(vishal, file, vishalTask)).toBe(true);
    expect(canSeeLinkedOnTask(vishal, file, simranTask)).toBe(false);
    expect(canSeeFile(vishal, file)).toBe(true);
  });

  it('shows on an Anyone task to every member, never without a task or to an outsider', () => {
    const file = { ...fileOf('managers'), links: [{ taskId: 3, assigneeId: null }] };
    expect(canSeeLinkedOnTask(ctxOf({ userId: SIMRAN }), file, anyoneTask)).toBe(true);
    expect(canSeeLinkedOnTask(ctxOf(), file, null)).toBe(false);
    expect(canSeeLinkedOnTask(ctxOf({ member: false }), file, anyoneTask)).toBe(false);
    expect(canSeeLinkedOnTask(ctxOf({ active: false }), file, anyoneTask)).toBe(false);
  });
});

describe('needsShareConfirm and isProjectManager', () => {
  const managers = { visibility: 'managers' };
  const person = (id, role = 'employee', status = 'active') => ({ id, role, status });

  it('asks for a managers-only file given to someone who is not a manager', () => {
    expect(needsShareConfirm(managers, person(VISHAL), project)).toBe(true);
    expect(needsShareConfirm(managers, null, project)).toBe(true); // anyone on the project
    expect(needsShareConfirm(managers, person(PM, 'pm'), project)).toBe(false);
    expect(needsShareConfirm(managers, person(40, 'admin'), project)).toBe(false);
    expect(needsShareConfirm(managers, person(40, 'admin', 'deactivated'), project)).toBe(true);
    expect(needsShareConfirm(managers, person(41, 'pm'), project)).toBe(true); // another PM
    expect(needsShareConfirm({ visibility: 'everyone' }, person(VISHAL), project)).toBe(false);
    expect(needsShareConfirm({ visibility: 'everyone' }, null, project)).toBe(false);
  });

  it("is the project's PM or an active Admin, ids compared as numbers", () => {
    const asText = { id: PROJECT, pmId: String(PM) };
    expect(isProjectManager(person(PM, 'pm'), project)).toBe(true);
    expect(isProjectManager(person(String(PM), 'pm'), asText)).toBe(true);
    expect(isProjectManager(person(40, 'admin'), project)).toBe(true);
    expect(isProjectManager(person(PM, 'pm', 'deactivated'), project)).toBe(false);
    expect(isProjectManager(person(41, 'pm'), project)).toBe(false);
    expect(isProjectManager(person(VISHAL), project)).toBe(false);
    expect(isProjectManager(null, project)).toBe(false);
    expect(isProjectManager(person(PM, 'pm'), { id: PROJECT, pmId: null })).toBe(false);
  });

  it("isn't someone who still holds pm_id after a move to employee or HR: a member, so it asks", () => {
    for (const role of ['employee', 'hr', null]) {
      const former = person(PM, role);
      expect(isProjectManager(former, project)).toBe(false);
      expect(needsShareConfirm(managers, former, project)).toBe(true);
    }
  });

  it('agrees with canManageProject (ctx.manages) for every role, status and project', () => {
    for (const role of ROLES) {
      for (const status of ['active', 'deactivated']) {
        for (const id of [PM, VISHAL]) {
          const who = person(id, role, status);
          const seen = { role, status, id, manages: isProjectManager(who, project) };
          expect(seen).toEqual({ role, status, id, manages: canManageProject(who, project) });
        }
      }
    }
  });
});
