// zod schemas for HR's break fixes (CONTRACT 25, item 2): PATCH and DELETE
// /api/attendance/:id/breaks/:breakId. Messages are written for people; every string has a length
// check (MySQL 8.4 rejects over-long strings that local MariaDB would silently cut).
import { z } from 'zod';
import { clockString } from './schemas';

export const REASON_MAX = 500;

const reason = z
  .string({ error: 'Add a reason.' })
  .trim()
  .min(1, 'Add a reason.')
  .max(REASON_MAX, `Keep it to ${REASON_MAX} characters or fewer.`);

/** PATCH /api/attendance/:id/breaks/:breakId → { endClock: 'HH:mm', reason } */
export const breakChangeSchema = z.object({
  endClock: clockString('Enter the end time.'),
  reason,
});

/** DELETE /api/attendance/:id/breaks/:breakId (a body on DELETE) → { reason } */
export const breakDeleteSchema = z.object({ reason });

const ID_PATTERN = /^[1-9]\d{0,15}$/;

/**
 * The plain-digit ids of /api/attendance/:id/breaks(/:breakId), or null (the route answers 404).
 * @param {Record<string, string>} params
 * @returns {{ attendanceId: number, breakId: number | null } | null}
 */
export function breakRouteIds(params) {
  const ids = [params?.id, params?.breakId];
  if (!ID_PATTERN.test(String(ids[0] ?? ''))) return null;
  if (ids[1] !== undefined && !ID_PATTERN.test(String(ids[1]))) return null;
  return {
    attendanceId: Number(ids[0]),
    breakId: ids[1] === undefined ? null : Number(ids[1]),
  };
}
