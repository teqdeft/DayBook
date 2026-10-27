// POST /api/ai/polish — body { lines: [{ key, title, projectName }] } (1-60 lines, titles up to
// 500 characters): clearer wording for the daily report's task lines from Gemini (CONTRACT 20,
// "Polish my tasks") → { lines: [{ key, title }] } with the same keys; a line Gemini can't improve
// comes back as it was. AI_OFF while Settings → AI has it off, AI_LIMIT past today's limits,
// RATE_LIMITED past 20 a minute for one person (CONTRACT 21: each task line has its own button).
import { checkRateLimit, withRoute } from '@/lib/route';
import { polishBodySchema, polishLines } from './polish';

// Per person, not per IP: behind the office network everyone shares one address. The daily cap
// (40) is the real limit; this only stops a stuck page or script.
const PER_PERSON = { key: 'ai-polish', limit: 20, windowMs: 60_000 };

export const POST = withRoute(
  { permission: 'report.self', body: polishBodySchema },
  async ({ user, body }) => {
    checkRateLimit(PER_PERSON, '/api/ai/polish', `user:${user.id}`);
    return polishLines({ user, lines: body.lines });
  },
);
