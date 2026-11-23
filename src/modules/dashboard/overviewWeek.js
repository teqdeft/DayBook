// The Company overview's "Attendance this week" (artboard 11): office, WFH, not checked in and
// off per working weekday, from each person's day (CONTRACT 25: holidays and leave are never
// "Not checked in"; a holiday's column is faded with its name). Pure: overview.js does the reads.
import { addDays, isoWeekday, weekRange } from '@/lib/time';
import { holidayOn } from './shared';

const WEEKDAY = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

/**
 * Not checked in and off on one day of the week (CONTRACT 25). Today: presence at now (someone
 * on first-half leave before the split is off, as on Attendance and the Team board). An earlier
 * day: people expected that day (day.expected > 0) without a check-in, and people on full-day
 * leave without one. Someone who checked in counts under Office or WFH only.
 */
function expectedCounts({ people, checkedIn, date, calendar, ctx }) {
  let missing = 0;
  let off = 0;
  for (const person of people) {
    if (checkedIn.has(person.id)) continue;
    if (date === ctx.today) {
      if (person.presence === 'not_checked_in') missing += 1;
      if (person.presence === 'on_leave') off += 1;
      continue;
    }
    const day = calendar.dayFor(person, date);
    if (day.expected > 0) missing += 1;
    else if (day.leave?.part === 'full') off += 1;
  }
  return { missing, off };
}

/**
 * Office, WFH, not checked in and off per working weekday of this week; days to come stay empty.
 * The people are today's tracked people (withPresence rows); their day on each date says
 * whether they were expected (joined, not on leave, not a holiday). A holiday's column is faded
 * with its title ('Holiday: Guru Nanak Jayanti'). hasOff: some day has people off (the legend).
 */
export function attendanceWeek({ checkIns, people, calendar, ctx }) {
  const { from } = weekRange(ctx.today);
  const { workingDays } = ctx.settings;
  const days = [...workingDays].sort((a, b) => a - b).map((w) => addDays(from, w - 1));
  const onDay = (date) => checkIns.filter((row) => row.workDate === date);
  let hasOff = false;
  const columns = days.map((date) => {
    const label = WEEKDAY[isoWeekday(date)];
    const holiday = holidayOn(calendar, date, workingDays);
    const marks = holiday ? { faded: true, title: `Holiday: ${holiday.name}` } : {};
    if (date > ctx.today) return { date, label, highlight: false, ...marks, segments: [] };
    const rows = onDay(date);
    const wfh = rows.filter((row) => row.location === 'wfh').length;
    const checkedIn = new Set(rows.map((row) => row.userId));
    const { missing, off } = expectedCounts({ people, checkedIn, date, calendar, ctx });
    hasOff ||= off > 0;
    return {
      date,
      label,
      highlight: date === ctx.today,
      ...marks,
      segments: [
        { key: 'office', label: 'Office', value: rows.length - wfh, color: 'primary' },
        { key: 'wfh', label: 'Working from home', value: wfh, color: 'violet' },
        { key: 'missing', label: 'Not checked in', value: missing, color: 'red' },
        { key: 'off', label: 'Off', value: off, color: 'teal' },
      ],
    };
  });
  return { max: people.length, hasOff, days: columns };
}
