// GET /api/attendance-corrections?status=pending — requests for HR.
// POST /api/attendance-corrections — a person asks HR to fix their attendance.
import { listResult, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { correctionListSchema, correctionRequestSchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'attendance.correct', query: correctionListSchema },
  async ({ query }) => {
    const { items, total } = await attendance.listCorrections(query);
    return listResult(items, { limit: query.limit, offset: query.offset, total });
  },
);

export const POST = withRoute(
  { permission: 'attendance.self', body: correctionRequestSchema, status: 201 },
  async ({ user, body }) => attendance.requestCorrection({ user, ...body }),
);
