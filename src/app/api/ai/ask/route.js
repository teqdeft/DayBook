// POST /api/ai/ask { question, history? } — Ask Daybook (CONTRACT 20): answers a question about
// hours, tasks and attendance from the asker's own scope → { answer }. Admin, PM and HR (team.view
// or attendance.view_all, checked in the service); AI_OFF while Ask Daybook is off, RATE_LIMITED
// past 12 questions a minute for one person.
import { checkRateLimit, withRoute } from '@/lib/route';
import { aiAsk } from '@/modules/aiAsk';
import { askBodySchema } from '@/modules/aiAsk/schemas';

// Per person, not per IP: behind the office network everyone shares one address, so one person
// asking quickly must not block the others. Each question can make up to six Gemini requests;
// the daily caps are the real limit, this only stops a stuck page or script.
const PER_PERSON = { key: 'ai-ask', limit: 12, windowMs: 60_000 };

export const POST = withRoute(
  { permission: 'signed_in', body: askBodySchema },
  async ({ user, body }) => {
    checkRateLimit(PER_PERSON, '/api/ai/ask', `user:${user.id}`);
    return aiAsk.ask({ user, ...body });
  },
);
