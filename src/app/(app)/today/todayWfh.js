// Server only (called from todayData.js): Today's work-from-home parts (CONTRACT 17) — the
// check-in card's WFH state and, for people who need HR's approval, the "Ask HR" line with their
// requests.
import { attendance } from '@/modules/attendance';
import { nextWorkingDay, wfhLines, wfhToday } from './wfhOptions';

// Pending requests come first, then the most recently handled: enough to find every approved
// request that isn't over yet.
const REQUESTS_READ = 50;

/**
 * @param {{ user: object, mine: object, today: string, current: object }} input the session
 *   user, attendance.getMyToday(), today's company date and settings.getAll()
 * @returns {Promise<{ wfh: ReturnType<typeof wfhToday>, wfhLinks: { nextDay: string,
 *   lines: ReturnType<typeof wfhLines> } | null }>} wfhLinks null: no Ask HR line (the setting
 *   is off, the person approves requests themselves or doesn't check in)
 */
export async function loadWfh({ user, mine, today, current }) {
  const wfh = wfhToday(mine);
  if (!wfh.needsApproval || !user.tracksAttendance) return { wfh, wfhLinks: null };
  let requests = [];
  try {
    const { items } = await attendance.listWfhRequests({
      viewer: user,
      userId: user.id,
      limit: REQUESTS_READ,
    });
    requests = items ?? [];
  } catch {
    // The lines are extra: Today still works without them.
  }
  return {
    wfh,
    wfhLinks: {
      nextDay: nextWorkingDay(today, current.workingDays),
      lines: wfhLines(requests, today),
    },
  };
}
