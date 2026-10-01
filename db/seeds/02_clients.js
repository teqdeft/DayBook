// The "Internal" client that internal projects point to. Safe to run twice.
export async function seed(knex) {
  const internal = await knex('clients').where({ name: 'Internal' }).first();
  if (!internal) await knex('clients').insert({ name: 'Internal', isInternal: true });
}
