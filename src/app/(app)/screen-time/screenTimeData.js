// Loads and shapes the Screen time page: one day for every tracked person (docs/CONTRACT.md
// section 11). Server only (called from page.js); everything returned is plain, serialisable data
// for the client table.
import { can } from '@/lib/permissions';
import { plural } from '@/lib/text';
import {
  addDays,
  clockToMinutes,
  dayjs,
  formatDay,
  formatDuration,
  formatTime,
  formatTimeAmPm,
  now,
  workDate as localDate,
} from '@/lib/time';
import { activity } from '@/modules/activity';
import { settings } from '@/modules/settings';
import { measuredText, minutesText, timelineBlocks, timelineScale } from './screenTimeView';

const LIVE_STATES = new Set(['active', 'idle', 'locked', 'offline']);

/** The ?date= value when it is a real 'YYYY-MM-DD' date, never after today; otherwise today. */
export function resolveDate(asked, today) {
  if (typeof asked !== 'string' || !dayjs(asked, 'YYYY-MM-DD', true).isValid()) return today;
  return asked > today ? today : asked;
}

const minutes = (value) => Math.max(0, Math.round(Number(value) || 0));
const totalOf = (item) =>
  minutes(item.activeMinutes) + minutes(item.idleMinutes) + minutes(item.lockedMinutes);
const hasData = (item) => totalOf(item) > 0 || (item.segments?.length ?? 0) > 0;

/** The "Now" cell: the live state today; on an earlier day whether the person reported at all. */
function stateOf(item, { isToday, date, tz }) {
  const seenThatDay = item.lastSeenAt && localDate(tz, item.lastSeenAt) === date;
  const lastSeen = seenThatDay ? formatTimeAmPm(item.lastSeenAt, tz) : null;
  if (!isToday) return { state: hasData(item) ? 'reported' : 'none', lastSeen, note: null };
  const state = LIVE_STATES.has(item.currentState) ? item.currentState : 'offline';
  if (state === 'offline') {
    return { state, lastSeen, note: lastSeen ? `Last seen ${lastSeen}` : 'Not seen today' };
  }
  // Without Idle Detection the app can only tell whether its own window is in use.
  return { state, lastSeen, note: item.source === 'window' ? 'Window only' : null };
}

function spanText(item, tz) {
  const first = formatTime(item.firstActiveAt, tz);
  const last = formatTime(item.lastActiveAt, tz);
  if (!first) return null;
  return last && last !== first ? `${first} to ${last}` : first;
}

function rowOf(item, ctx) {
  const { user } = item;
  const state = stateOf(item, ctx);
  const values = {
    activeMinutes: minutes(item.activeMinutes),
    idleMinutes: minutes(item.idleMinutes),
    lockedMinutes: minutes(item.lockedMinutes),
  };
  const span = spanText(item, ctx.tz);
  return {
    // The table's "Last seen" column uses table times ("6:45"); sentences keep "6:45 PM".
    seenAt: state.lastSeen ? formatTime(item.lastSeenAt, ctx.tz) : null,
    id: user.id,
    user: {
      id: user.id,
      name: user.name,
      designation: user.designation ?? null,
      initials: user.initials,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl ?? null,
    },
    href: `/team/${user.id}`,
    ...state,
    windowOnly: item.source === 'window',
    ...values,
    active: formatDuration(values.activeMinutes),
    idle: formatDuration(values.idleMinutes),
    locked: formatDuration(values.lockedMinutes),
    span,
    hasData: hasData(item),
    blocks: timelineBlocks(item.segments, ctx),
    label: hasData(item)
      ? `${minutesText(values)}${span ? `, ${span}` : ''}`
      : `No screen time on ${formatDay(ctx.date)}`,
  };
}

function kpis({ rows, isToday, workdayMinutes }) {
  const people = rows.length;
  const reported = rows.filter((row) => row.hasData);
  const pct = (count) => (people > 0 ? (count / people) * 100 : 0);
  const sum = (key) => reported.reduce((total, row) => total + row[key], 0);
  const n = reported.length;
  const avgActive = n ? Math.round(sum('activeMinutes') / n) : null;
  const avgIdle = n ? Math.round(sum('idleMinutes') / n) : null;
  const recorded = sum('activeMinutes') + sum('idleMinutes') + sum('lockedMinutes');
  const idleShare = recorded > 0 ? Math.round((sum('idleMinutes') / recorded) * 100) : 0;
  const ofPeople = `of ${people} ${plural(people, 'person', 'people')}`;
  // On an earlier day nobody is "active now": the first number is who reported that day.
  const first = isToday ? rows.filter((row) => row.state === 'active').length : n;
  return [
    {
      key: 'now',
      label: isToday ? 'Active now' : 'Reported',
      value: String(first),
      sub: ofPeople,
      percent: pct(first),
      color: 'green',
    },
    {
      key: 'active',
      label: 'Average active time',
      value: avgActive === null ? '—' : formatDuration(avgActive),
      // Short, so the number and its sub-line stay on one line like the canvas KPIs.
      sub: n ? 'per person' : 'no data yet',
      percent: avgActive ? Math.min(100, (avgActive / workdayMinutes) * 100) : 0,
      color: 'primary',
    },
    {
      key: 'idle',
      label: 'Average idle time',
      value: avgIdle === null ? '—' : formatDuration(avgIdle),
      sub: n ? `${idleShare}% of their time` : 'no data yet',
      percent: idleShare,
      color: 'marigold',
    },
    {
      key: 'none',
      label: isToday ? 'Not reporting today' : 'Not reporting',
      value: String(people - n),
      sub: ofPeople,
      percent: pct(people - n),
      color: 'red',
    },
  ];
}

function countsOf(rows) {
  const count = (state) => rows.filter((row) => row.state === state).length;
  return {
    all: rows.length,
    active: count('active'),
    idle: count('idle'),
    locked: count('locked'),
    offline: count('offline'),
    reported: count('reported'),
    none: count('none'),
  };
}

/**
 * @param {{ user: object, date?: string }} input  `date` is the raw ?date= value.
 */
export async function loadScreenTime({ user, date: asked }) {
  const current = await settings.getAll();
  const tz = current.timezone;
  const today = localDate(tz);
  const date = resolveDate(asked, today);
  const isToday = date === today;
  const items = (await activity.getTeamDay(date)) ?? [];
  const scale = timelineScale({
    date,
    tz,
    officeStart: current.officeStart,
    officeEnd: current.officeEnd,
    segmentLists: items.map((item) => item.segments),
  });
  const ctx = { date, tz, isToday, scale };
  const rows = items
    .map((item) => rowOf(item, ctx))
    .sort((a, b) => b.activeMinutes - a.activeMinutes || a.user.name.localeCompare(b.user.name));
  const workdayMinutes = Math.max(
    60,
    clockToMinutes(current.officeEnd) - clockToMinutes(current.officeStart),
  );
  const retentionDays = Math.max(1, Number(current.activityRetentionDays) || 365);
  const earliest = addDays(today, -retentionDays);
  return {
    tz,
    date,
    today,
    isToday,
    subtitle: isToday ? `${formatDay(date)}, ${formatTimeAmPm(now(), tz)}` : formatDay(date),
    prevDate: date > earliest ? addDays(date, -1) : null,
    nextDate: date < today ? addDays(date, 1) : null,
    kpis: kpis({ rows, isToday, workdayMinutes }),
    rows,
    counts: countsOf(rows),
    ticks: scale.ticks,
    measured: measuredText(current.activityIdleMinutes),
    trackingOff: current.activityTrackingEnabled === false,
    canManageSettings: can(user, 'settings.manage'),
  };
}
