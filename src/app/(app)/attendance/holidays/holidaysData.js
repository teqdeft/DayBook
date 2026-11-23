// Loads and shapes the Holidays page (CONTRACT 25, item 6). Server only (called from page.js):
// one year's holidays with their status tags, the card's subtitle and the year switcher's links
// (last year to next year).
import { can } from '@/lib/permissions';
import { plural } from '@/lib/text';
import { attendance } from '@/modules/attendance';

/** "Today" (primary), "Past" and "Not a working day" (neutral); nothing for days to come. */
function statusesOf(item) {
  const tags = [];
  if (item.today) tags.push({ label: 'Today', tone: 'primary' });
  else if (item.past) tags.push({ label: 'Past', tone: 'neutral' });
  if (!item.weekday) tags.push({ label: 'Not a working day', tone: 'neutral' });
  return tags;
}

/** "3 holidays, 1 still to come", "1 holiday", "No holidays". */
function subtitleOf(items, upcoming) {
  if (items.length === 0) return 'No holidays';
  const count = `${items.length} ${plural(items.length, 'holiday')}`;
  return upcoming > 0 ? `${count}, ${upcoming} still to come` : count;
}

const hrefFor = (year) => `/attendance/holidays?year=${year}`;

/**
 * @param {{ user: object, year?: string }} input year from the URL (anything else: this year)
 * @returns {Promise<{ year: number, today: string, available: boolean, canCorrect: boolean,
 *   subtitle: string, rows: Array<{ id: number, date: string, name: string, dayLabel: string,
 *   past: boolean, today: boolean, statuses: Array<{ label: string, tone: string }> }>,
 *   prev: { href: string | undefined, label: string },
 *   next: { href: string | undefined, label: string } }>}
 */
export async function loadHolidays({ user, year }) {
  const asked = /^\d{4}$/.test(String(year ?? '')) ? Number(year) : undefined;
  const data = await attendance.listHolidays({ year: asked });
  const shown = data.year;
  return {
    year: shown,
    today: data.today,
    firstYear: data.firstYear,
    lastYear: data.lastYear,
    available: data.available,
    canCorrect: can(user, 'attendance.correct'),
    subtitle: subtitleOf(data.items, data.upcoming),
    rows: data.items.map((item) => ({
      id: item.id,
      date: item.date,
      name: item.name,
      dayLabel: item.dayLabel,
      past: item.past,
      today: item.today,
      statuses: statusesOf(item),
    })),
    prev:
      shown > data.firstYear
        ? { href: hrefFor(shown - 1), label: String(shown - 1) }
        : { href: undefined, label: 'No earlier years' },
    next:
      shown < data.lastYear
        ? { href: hrefFor(shown + 1), label: String(shown + 1) }
        : { href: undefined, label: 'No later years' },
  };
}
