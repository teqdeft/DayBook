// withRoute's validation answer (src/lib/route.js): each field named with its first message, also
// when the field is called like an Object method ("toString", "constructor").
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { withRoute } from '@/lib/route';

// Any key besides `name` fails under its own name.
const schema = z
  .object({ name: z.string({ error: 'Name is required.' }) })
  .catchall(
    z.unknown().refine(() => false, { error: (issue) => `"${issue.path.at(-1)}" isn't allowed.` }),
  );
const route = withRoute({ permission: 'public', body: schema }, async ({ body }) => body);

async function post(body) {
  const response = await route(
    new Request('http://localhost:3000/api/example', {
      method: 'POST',
      headers: { Origin: env.appOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, ...(await response.json()) };
}

describe('withRoute validation', () => {
  it('names every field with its first message', async () => {
    const answer = await post({ toString: 1, constructor: 2 });
    expect(answer.status).toBe(400);
    expect(answer.error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Name is required.',
      fields: {
        name: 'Name is required.',
        toString: '"toString" isn\'t allowed.',
        constructor: '"constructor" isn\'t allowed.',
      },
    });
  });

  it('passes a valid body to the handler', async () => {
    expect(await post({ name: 'Daybook' })).toEqual({ status: 200, data: { name: 'Daybook' } });
  });
});
