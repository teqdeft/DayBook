// Guide 14: never log report text. A failing query must not carry its bound values into the log.
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { serializeError } from '@/lib/logger';

const SECRET = 'Fixed the checkout bug for the client demo';

async function failingQuery() {
  try {
    await db('table_that_does_not_exist').insert({ title: SECRET });
  } catch (error) {
    return error;
  }
  throw new Error('the query should have failed');
}

describe('database errors in logs', () => {
  it('keep placeholders, not values, in the message', async () => {
    const error = await failingQuery();
    expect(error.message).toContain('insert into `table_that_does_not_exist`');
    expect(error.message).not.toContain(SECRET);
  });

  it('drop the SQL text mysql2 attaches to the error', async () => {
    const error = await failingQuery();
    const logged = JSON.stringify(serializeError(error));
    expect(logged).not.toContain(SECRET);
    expect(logged).toContain('ER_NO_SUCH_TABLE');
  });

  it('also when the database error is the cause of another error', async () => {
    const cause = await failingQuery();
    const wrapped = new Error('could not save the draft', { cause });
    wrapped.inner = cause;
    expect(JSON.stringify(serializeError(wrapped))).not.toContain(SECRET);
  });
});
