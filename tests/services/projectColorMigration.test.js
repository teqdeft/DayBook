// Deploy before migrate (CONTRACT 23): until migration 016 has run, projects.color is the old
// six-value ENUM. Yellow and custom colours are refused with a clear message before anything is
// written, also where sql_mode isn't strict (the database would store '' with only a warning), and
// they work once the migration has run, without a restart. Then 016 is rolled back and forward.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
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

const MIGRATION = '016_project_color.js';
const T0 = '2026-11-12T05:00:00Z';
const PLUM = '#9c3fb8';
const OLD_COLUMN =
  'This colour needs the latest database update. Pick one of the first six for now.';
const OLD_ENUM = "enum('blue','green','violet','orange','teal','pink')";

const warnings = [];
let pm;
let alice;
let teal;

async function column() {
  const [rows] = await db.raw(
    'SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS fallback ' +
      'FROM information_schema.columns ' +
      "WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'color'",
  );
  const { type, nullable, fallback } = rows[0];
  // MariaDB quotes a text default ('blue'), MySQL 8 doesn't.
  return { type: type.toLowerCase(), nullable, fallback: String(fallback).replace(/'/g, '') };
}

/** Everything a refused write could have touched. */
async function snapshot() {
  const count = async (table) => (await db(table).count({ total: '*' }).first()).total;
  return {
    projects: await db('projects').orderBy('id'),
    clients: await count('clients'),
    members: await count('projectMembers'),
    audits: await count('auditLogs'),
    requests: await db('projectRequests').orderBy('id'),
  };
}

/** Runs `write` and expects the old-column refusal, with nothing written. */
async function expectOldColumnRefusal(write) {
  const before = await snapshot();
  const error = await write().then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({
    code: 'VALIDATION_FAILED',
    message: OLD_COLUMN,
    fields: { color: OLD_COLUMN },
  });
  expect(await snapshot()).toEqual(before);
}

function newProject(overrides = {}) {
  return {
    name: 'lyra',
    clientName: 'Lyra Labs',
    pmId: pm.id,
    memberIds: [alice.id],
    ...overrides,
  };
}

/** Runs every connection the code takes from the pool in a non-strict sql_mode. */
function nonStrictSessions() {
  const acquire = db.client.acquireConnection.bind(db.client);
  return vi.spyOn(db.client, 'acquireConnection').mockImplementation(async () => {
    const connection = await acquire();
    await new Promise((resolve, reject) => {
      connection.query("SET SESSION sql_mode = ''", (error) => (error ? reject(error) : resolve()));
    });
    return connection;
  });
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  pm = await createUser({ name: 'Paul Manager', role: 'pm', tracksAttendance: false });
  alice = await createUser({ name: 'Alice Dev', reportsToId: pm.id });
  teal = await projects.create({ user: pm, input: newProject({ name: 'teal', color: 'teal' }) });
  // The deploy ran before `npm run migrate`: no projects code has asked about the column yet.
  await db.migrate.down({ name: MIGRATION });
  expect((await column()).type).toBe(OLD_ENUM);
  vi.spyOn(logger, 'warn').mockImplementation((...args) => {
    warnings.push(args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('before migration 016', () => {
  it('still saves the first six colours', async () => {
    const edited = await projects.update({ user: pm, id: teal.id, input: { color: 'pink' } });
    expect(edited.color).toBe('pink');
    const back = await projects.update({ user: pm, id: teal.id, input: { color: 'teal' } });
    expect(back.color).toBe('teal');
  });

  it('refuses yellow and a custom colour on an edit, with the message, writing nothing', async () => {
    for (const color of ['yellow', PLUM, '#2F86D6']) {
      await expectOldColumnRefusal(() =>
        projects.update({ user: pm, id: teal.id, input: { color, memberIds: [] } }),
      );
    }
    expect((await projects.findById(teal.id)).color).toBe('teal');
  });

  it('refuses them on a new project and on an approved request', async () => {
    await expectOldColumnRefusal(() =>
      projects.create({ user: pm, input: newProject({ color: PLUM }) }),
    );
    const { request } = await projects.createRequest({
      user: alice,
      input: { name: 'nova', note: 'For the Nova client' },
    });
    await expectOldColumnRefusal(() =>
      projects.approveRequest({
        user: pm,
        id: request.id,
        input: newProject({ name: 'nova', clientName: 'Nova', color: 'yellow' }),
      }),
    );
    expect((await db('projectRequests').where({ id: request.id }).first()).status).toBe('pending');
  });

  it('refuses them where sql_mode is not strict, which would otherwise store an empty colour', async () => {
    const spy = nonStrictSessions();
    try {
      // What the check prevents: the old column takes yellow as '' with only a warning.
      await db
        .transaction(async (trx) => {
          await trx('projects').where({ id: teal.id }).update({ color: 'yellow' });
          expect((await trx('projects').where({ id: teal.id }).first('color')).color).toBe('');
          throw new Error('roll back');
        })
        .catch((error) => expect(error.message).toBe('roll back'));
      await expectOldColumnRefusal(() =>
        projects.update({ user: pm, id: teal.id, input: { color: PLUM } }),
      );
      await expectOldColumnRefusal(() =>
        projects.create({ user: pm, input: newProject({ color: 'yellow' }) }),
      );
    } finally {
      spy.mockRestore();
      // New connections, back on the server's own sql_mode.
      await db.destroy();
      db.initialize();
    }
    expect((await projects.findById(teal.id)).color).toBe('teal');
  });

  it('logs one warning for the process', () => {
    const colorWarnings = warnings.filter(([text]) => String(text).includes('projects.color'));
    expect(colorWarnings).toHaveLength(1);
  });
});

describe('after migration 016, without a restart', () => {
  beforeAll(async () => {
    await db.migrate.up({ name: MIGRATION });
  });

  it('changes the column and keeps the stored colours', async () => {
    expect(await column()).toEqual({ type: 'varchar(7)', nullable: 'NO', fallback: 'blue' });
    expect((await projects.findById(teal.id)).color).toBe('teal');
  });

  it('asks again once 60 seconds have passed, and then takes yellow and custom colours', async () => {
    // The last answer (the old ENUM) is kept for 60 seconds.
    setNowForTests('2026-11-12T05:00:30Z');
    await expectOldColumnRefusal(() =>
      projects.update({ user: pm, id: teal.id, input: { color: PLUM } }),
    );
    setNowForTests('2026-11-12T05:01:31Z');
    expect((await projects.update({ user: pm, id: teal.id, input: { color: PLUM } })).color).toBe(
      PLUM,
    );
    const yellow = await projects.create({ user: pm, input: newProject({ color: 'yellow' }) });
    expect(yellow.color).toBe('yellow');
  });
});

describe('rolling 016 back and forward', () => {
  it('down turns yellow and custom colours blue and restores the ENUM; up keeps the rest', async () => {
    const pinkProject = await projects.create({
      user: pm,
      input: newProject({ name: 'rose', clientName: 'Rose', color: 'pink' }),
    });
    const colors = async () =>
      Object.fromEntries(
        (await db('projects').orderBy('id').select('name', 'color')).map((row) => [
          row.name,
          row.color,
        ]),
      );
    expect(await colors()).toEqual({ teal: PLUM, lyra: 'yellow', rose: 'pink' });
    expect(pinkProject.color).toBe('pink');

    await db.migrate.down({ name: MIGRATION });
    expect(await column()).toEqual({ type: OLD_ENUM, nullable: 'NO', fallback: 'blue' });
    expect(await colors()).toEqual({ teal: 'blue', lyra: 'blue', rose: 'pink' });

    await db.migrate.up({ name: MIGRATION });
    expect(await column()).toEqual({ type: 'varchar(7)', nullable: 'NO', fallback: 'blue' });
    expect(await colors()).toEqual({ teal: 'blue', lyra: 'blue', rose: 'pink' });
    await db('projects').where({ name: 'rose' }).update({ color: '#5d6b85' });
    expect((await colors()).rose).toBe('#5d6b85');
  });
});
