// Project colours (CONTRACT 23): yellow, the "More colours" palette and any custom hex are saved,
// trimmed and lowercased; colours that can't be seen in one theme and anything that isn't a colour
// are refused with a message for the colour field, and nothing changes.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projects } from '@/modules/projects';
import { createUser, resetDatabase } from '../helpers/db.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
    getMinutesByProject: vi.fn(async () => ({})),
    getLastReportDateByProject: vi.fn(async () => ({})),
  },
}));

const T0 = '2026-11-12T05:00:00Z';
const PLUM = '#9c3fb8';

let pm;
let alice;
let project;

function newProject(overrides = {}) {
  return {
    name: 'riverkraft',
    clientName: 'Riverkraft',
    pmId: pm.id,
    memberIds: [alice.id],
    color: 'yellow',
    ...overrides,
  };
}

async function refusal(promise) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  return error.fields?.color;
}

async function storedColor(id) {
  return (await db('projects').where({ id }).first('color')).color;
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  pm = await createUser({ name: 'Paul Manager', role: 'pm', tracksAttendance: false });
  alice = await createUser({ name: 'Alice Dev', reportsToId: pm.id });
  project = await projects.create({ user: pm, input: newProject() });
});

beforeEach(() => {
  setNowForTests(T0);
});

describe('saving a colour', () => {
  it('creates a yellow project and shows yellow wherever the colour is read', async () => {
    expect(project.color).toBe('yellow');
    expect(await storedColor(project.id)).toBe('yellow');
    const picker = await projects.getPickerFor(alice.id);
    expect(picker.mine).toEqual([
      { id: project.id, name: 'riverkraft', color: 'yellow', isUrgent: false },
    ]);
  });

  it('saves a palette colour and audits the change', async () => {
    const edited = await projects.update({ user: pm, id: project.id, input: { color: PLUM } });
    expect(edited.color).toBe(PLUM);
    expect(await storedColor(project.id)).toBe(PLUM);
    const log = await db('auditLogs')
      .where({ action: 'project.update', entityId: project.id })
      .orderBy('id', 'desc')
      .first();
    expect(parseJson(log.before).color).toBe('yellow');
    expect(parseJson(log.after).color).toBe(PLUM);
  });

  it('trims and lowercases a typed hex', async () => {
    const edited = await projects.update({
      user: pm,
      id: project.id,
      input: { color: '  #2F86D6 ' },
    });
    expect(edited.color).toBe('#2f86d6');
    expect(await storedColor(project.id)).toBe('#2f86d6');
  });

  it('shows a custom colour on the urgent lists', async () => {
    await projects.update({
      user: pm,
      id: project.id,
      input: { color: PLUM, isUrgent: true, urgentNote: 'Launch on Friday' },
    });
    expect((await projects.listUrgentForMember(alice.id)).map((item) => item.color)).toEqual([
      PLUM,
    ]);
  });

  it('still starts a new project blue', async () => {
    const plain = await projects.create({
      user: pm,
      input: newProject({ name: 'plain', color: undefined }),
    });
    expect(plain.color).toBe('blue');
  });
});

describe('refusing a colour', () => {
  const cases = [
    ['#ffffff', 'This colour is too light to see. Pick a darker one.'],
    ['#FAFAFA', 'This colour is too light to see. Pick a darker one.'],
    ['#000000', 'This colour is too dark to see in the dark theme. Pick a lighter one.'],
    ['#1a1e3a', 'This colour is too dark to see in the dark theme. Pick a lighter one.'],
    ['black', 'Pick a colour label.'],
    ['red; background:url(x)', 'Pick a colour label.'],
    ['#9c3fb', 'Pick a colour label.'],
    ['', 'Pick a colour label.'],
    [null, 'Pick a colour label.'],
    [42, 'Pick a colour label.'],
  ];

  it.each(cases)('refuses %j on an edit and keeps the old colour', async (color, message) => {
    const before = await db('projects').where({ id: project.id }).first();
    const audits = await db('auditLogs').count({ total: '*' }).first();
    expect(await refusal(projects.update({ user: pm, id: project.id, input: { color } }))).toBe(
      message,
    );
    expect(await db('projects').where({ id: project.id }).first()).toEqual(before);
    expect(await db('auditLogs').count({ total: '*' }).first()).toEqual(audits);
  });

  it('refuses a colour that cannot be seen when creating, and creates nothing', async () => {
    const count = await db('projects').count({ total: '*' }).first();
    const pale = (color) => newProject({ name: 'pale', clientName: 'Pale client', color });
    expect(await refusal(projects.create({ user: pm, input: pale('#fff') }))).toBe(
      'Pick a colour label.',
    );
    expect(await refusal(projects.create({ user: pm, input: pale('#f8f8f8') }))).toBe(
      'This colour is too light to see. Pick a darker one.',
    );
    expect(await db('projects').count({ total: '*' }).first()).toEqual(count);
    expect(await db('clients').where({ name: 'Pale client' }).first()).toBeUndefined();
  });
});
