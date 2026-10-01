// Test database helpers. The test database is DB_NAME from .env.test.local (daybook_test).
import { db } from '@/lib/db';
import { seed as seedDepartments } from '../../db/seeds/01_departments.js';
import { seed as seedClients } from '../../db/seeds/02_clients.js';
import { seed as seedSettings } from '../../db/seeds/03_settings.js';

/** Migrates the test database fresh and seeds departments, the Internal client and settings. */
export async function resetDatabase() {
  if (!/test/.test(db.client.config.connection.database)) {
    throw new Error('Refusing to reset a database whose name does not contain "test".');
  }
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  await seedDepartments(db);
  await seedClients(db);
  await seedSettings(db);
}

let counter = 0;

/** Inserts a user and returns the full row (camelCase). */
export async function createUser(overrides = {}) {
  counter += 1;
  const department = await db('departments')
    .where({ name: overrides.department ?? 'Development' })
    .first();
  const row = {
    name: `Person ${counter}`,
    email: `person${counter}@example.com`,
    designation: 'Developer',
    departmentId: department.id,
    role: 'employee',
    tracksAttendance: true,
    status: 'active',
    ...overrides,
  };
  delete row.department;
  const [id] = await db('users').insert(row);
  return db('users').where({ id }).first();
}

/** Updates settings rows for a test (values are JSON-encoded). */
export async function setSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    await db('settings')
      .where({ key })
      .update({ value: JSON.stringify(value) });
  }
}
