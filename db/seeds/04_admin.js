// The first Admin (the CEO), from SEED_ADMIN_EMAIL. Safe to run twice.
import { env } from '../../src/lib/env.js';

export async function seed(knex) {
  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  if (!email) {
    console.warn('SEED_ADMIN_EMAIL is empty, so no Admin was created.');
    return;
  }
  const existing = await knex('users').where({ email }).first();
  if (existing) return;
  const leadership = await knex('departments').where({ name: 'Leadership' }).first();
  await knex('users').insert({
    name: env.SEED_ADMIN_NAME.trim() || 'Admin',
    email,
    designation: 'CEO',
    departmentId: leadership.id,
    role: 'admin',
    tracksAttendance: false, // check-in is optional for the CEO
    status: 'active',
  });
}
