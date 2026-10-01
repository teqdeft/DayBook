// Uptime check: answers { ok: true } when the database responds, 503 otherwise. Public, and
// deliberately not wrapped in { data } so any uptime monitor can read it.
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { withRoute } from '@/lib/route';

const NO_STORE = { 'Cache-Control': 'no-store' };
const TIMEOUT_MS = 5000;

/** select 1, or an error when the database doesn't answer within TIMEOUT_MS. */
async function pingDatabase() {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('database ping timed out')), TIMEOUT_MS);
  });
  try {
    await Promise.race([db.raw('select 1'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const GET = withRoute({ permission: 'public' }, async () => {
  try {
    await pingDatabase();
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    logger.error({ err: error }, 'health check: database is not answering');
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
});
