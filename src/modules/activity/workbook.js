// The team's screen time on one day as an Excel workbook (GET /api/activity/export).
import { toLocal } from '@/lib/time';
import { settings } from '@/modules/settings';
import { minutesFromSeconds, segmentSeconds } from './segments';
import { getTeamDay } from './service';

const STATE_WORDS = { active: 'Active', idle: 'Idle', locked: 'Screen locked' };
const SOURCE_WORDS = { system: 'Idle detection', window: 'Daybook window only' };
const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;

/**
 * The workbook spec for xlsxResponse: one row per tracked person, then every segment.
 * @param {string} date 'YYYY-MM-DD'
 * @returns {Promise<{ filename: string, sheets: Array<{ name: string, columns: object[],
 *   rows: object[] }> }>}
 */
export async function exportDay(date) {
  const [people, current] = await Promise.all([getTeamDay(date), settings.getAll()]);
  // 24-hour clocks: "6:34" alone can't be told from 6:34 AM in a spreadsheet.
  const clock = (at) => (at ? toLocal(at, current.timezone).format('HH:mm') : '');
  const summary = people.map((item) => ({
    name: item.user.name,
    email: item.user.email ?? '',
    designation: item.user.designation,
    department: item.user.departmentName ?? '',
    firstActive: clock(item.firstActiveAt),
    lastActive: clock(item.lastActiveAt),
    lastSeen: clock(item.lastSeenAt),
    active: hours(item.activeMinutes),
    idle: hours(item.idleMinutes),
    locked: hours(item.lockedMinutes),
    source: SOURCE_WORDS[item.source] ?? '',
  }));
  const segments = people.flatMap((item) =>
    item.segments.map((segment) => ({
      name: item.user.name,
      state: STATE_WORDS[segment.state],
      source: SOURCE_WORDS[segment.source],
      start: clock(segment.startedAt),
      end: clock(segment.endedAt),
      minutes: minutesFromSeconds(segmentSeconds(segment)),
    })),
  );
  return {
    filename: `screen-time-${date}.xlsx`,
    sheets: [
      {
        name: 'Screen time',
        columns: [
          { header: 'Name', key: 'name', width: 24 },
          { header: 'Email', key: 'email', width: 28 },
          { header: 'Designation', key: 'designation', width: 24 },
          { header: 'Department', key: 'department', width: 16 },
          { header: 'First active', key: 'firstActive', width: 12 },
          { header: 'Last active', key: 'lastActive', width: 12 },
          { header: 'Last seen', key: 'lastSeen', width: 12 },
          { header: 'Active (hours)', key: 'active', width: 14, numFmt: '0.00' },
          { header: 'Idle (hours)', key: 'idle', width: 12, numFmt: '0.00' },
          { header: 'Screen locked (hours)', key: 'locked', width: 20, numFmt: '0.00' },
          { header: 'Recorded by', key: 'source', width: 20 },
        ],
        rows: summary,
      },
      {
        name: 'Segments',
        columns: [
          { header: 'Name', key: 'name', width: 24 },
          { header: 'State', key: 'state', width: 14 },
          { header: 'Recorded by', key: 'source', width: 20 },
          { header: 'Start', key: 'start', width: 10 },
          { header: 'End', key: 'end', width: 10 },
          { header: 'Minutes', key: 'minutes', width: 10 },
        ],
        rows: segments,
      },
    ],
  };
}
