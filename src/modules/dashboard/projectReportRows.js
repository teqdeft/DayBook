// Project report: the people rows and the daily log rows, from the range's submitted entries and
// the collapsed tasks. Pure functions over repo rows.
import { initials } from '@/lib/text';
import { formatDayShort, formatHours } from '@/lib/time';
import { countTasks } from './projectReportTasks';
import { percent } from './shared';

/** A person as the report shows them (avatar, name, designation, link to their detail page). */
export function personOf(row) {
  const id = row.userId ?? row.id;
  return {
    id,
    name: row.name,
    initials: initials(row.name),
    designation: row.designation ?? null,
    role: row.role ?? null,
    status: row.status ?? null,
    avatarUrl: row.avatarUrl ?? null,
    href: `/team/${id}`,
  };
}

/**
 * Everyone on the report: people with hours in the range, then members without any.
 * `members` are the members listed even without hours; `memberIds` (default: their ids) decides
 * `isMember` for everyone, so a deactivated member with hours is still marked as one.
 */
export function byPersonRows({ entryRows, tasks, members, memberIds, people, totalMinutes }) {
  const rows = new Map();
  const rowFor = (user) => {
    if (!rows.has(user.id)) {
      rows.set(user.id, { user, minutes: 0, dates: new Set(), tasks: [] });
    }
    return rows.get(user.id);
  };
  for (const entry of entryRows) {
    const row = rowFor(people.get(entry.userId));
    row.minutes += Number(entry.minutes);
    row.dates.add(entry.workDate);
  }
  for (const task of tasks) rowFor(task.user).tasks.push(task);
  for (const member of members) rowFor(people.get(member.id));
  const isMember = memberIds ?? new Set(members.map((member) => member.id));
  return [...rows.values()]
    .map(({ user, minutes, dates, tasks: own }) => {
      const sorted = [...dates].sort();
      const counts = countTasks(own);
      return {
        user,
        isMember: isMember.has(user.id),
        noHours: minutes === 0,
        minutes,
        hours: formatHours(minutes),
        share: percent(minutes, totalMinutes),
        days: sorted.length,
        firstOn: sorted[0] ?? null,
        lastOn: sorted[sorted.length - 1] ?? null,
        tasksDone: counts.done,
        tasksInProgress: counts.inProgress,
        tasksBlocked: counts.blocked,
      };
    })
    .sort((a, b) => b.minutes - a.minutes || a.user.name.localeCompare(b.user.name));
}

/** One daily log row per person per day (their report's entries on this project). */
export function dailyLog(entryRows, taskRows, people) {
  const tasksByEntry = new Map();
  for (const task of taskRows) {
    if (!tasksByEntry.has(task.entryId)) tasksByEntry.set(task.entryId, []);
    tasksByEntry.get(task.entryId).push({ id: task.id, title: task.title, status: task.status });
  }
  const rows = new Map();
  for (const entry of entryRows) {
    if (!rows.has(entry.reportId)) {
      rows.set(entry.reportId, {
        id: entry.reportId,
        workDate: entry.workDate,
        dateLabel: formatDayShort(entry.workDate),
        user: people.get(entry.userId),
        minutes: 0,
        tasks: [],
      });
    }
    const row = rows.get(entry.reportId);
    row.minutes += Number(entry.minutes);
    row.tasks.push(...(tasksByEntry.get(entry.entryId) ?? []));
  }
  return [...rows.values()].map((row) => ({ ...row, hours: formatHours(row.minutes) }));
}
