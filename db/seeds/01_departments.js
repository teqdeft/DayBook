// Safe to run twice: inserts only the departments that are missing.
export const DEPARTMENTS = ['Development', 'SEO', 'Delivery', 'HR', 'Sales', 'Leadership'];

export async function seed(knex) {
  const existing = new Set((await knex('departments').select('name')).map((row) => row.name));
  const missing = DEPARTMENTS.filter((name) => !existing.has(name)).map((name) => ({ name }));
  if (missing.length > 0) await knex('departments').insert(missing);
}
