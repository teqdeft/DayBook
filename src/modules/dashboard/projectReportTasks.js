// Project report: tasks with carry-over chains collapsed (one row per piece of work), and the
// done / in progress / blocked counts per person. Pure functions over repo rows.

const STATUS_ORDER = { blocked: 0, in_progress: 1, done: 2 };

/** A tiny union-find over task ids. */
function disjointSet(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let node = id;
    while (parent.get(node) !== root) {
      const next = parent.get(node);
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(Math.max(rootA, rootB), Math.min(rootA, rootB));
  };
  return { find, union };
}

const titleKey = (title) =>
  String(title ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * Groups task versions into chains. A carried task points at the version it continues
 * (carried_from_task_id). When that link is gone (the earlier version was edited away or lies
 * outside the range) the version still keeps the original first_reported_on, so versions by the
 * same person with the same first day and the same title are one chain too.
 * @param {{ id: number, title: string, firstReportedOn: string, carriedFromTaskId: number|null,
 *   userId: number }[]} rows
 * @returns {object[][]} chains, each oldest version first
 */
export function taskChains(rows) {
  const ids = rows.map((row) => row.id);
  const known = new Set(ids);
  const set = disjointSet(ids);
  const firstByKey = new Map();
  for (const row of rows) {
    if (row.carriedFromTaskId && known.has(row.carriedFromTaskId)) {
      set.union(row.id, row.carriedFromTaskId);
    }
    const key = `${row.userId}|${row.firstReportedOn}|${titleKey(row.title)}`;
    if (firstByKey.has(key)) set.union(row.id, firstByKey.get(key));
    else firstByKey.set(key, row.id);
  }
  const chains = new Map();
  for (const row of rows) {
    const root = set.find(row.id);
    if (!chains.has(root)) chains.set(root, []);
    chains.get(root).push(row);
  }
  return [...chains.values()].map((versions) =>
    versions.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.id - b.id),
  );
}

/**
 * One row per chain: the latest version's title, status and priority task link (`priority`
 * 'p1' | 'p2' | 'p3' or null), the first day it was reported (carried versions keep the original
 * day), the last day, how many days it was reported and the project minutes of the entries it
 * was on.
 * @param {object[]} taskRows listProjectTasks rows, with projectTaskId / priority /
 *   projectTaskTitle when linked
 * @param {Map<number, number>} minutesByEntry entry id -> minutes
 * @param {(userId: number) => object} personOf
 */
export function collapseTasks(taskRows, minutesByEntry, personOf) {
  return taskChains(taskRows)
    .map((versions) => {
      const latest = versions[versions.length - 1];
      const days = new Set(versions.map((version) => version.workDate));
      const entries = new Set(versions.map((version) => version.entryId));
      const firstReportedOn = versions.reduce(
        (first, version) =>
          version.firstReportedOn && version.firstReportedOn < first
            ? version.firstReportedOn
            : first,
        versions[0].workDate,
      );
      return {
        id: latest.id,
        title: latest.title,
        status: latest.status,
        projectTaskId: latest.projectTaskId ?? null,
        priority: latest.priority ?? null,
        projectTaskTitle: latest.projectTaskTitle ?? null,
        user: personOf(latest.userId),
        firstReportedOn,
        lastReportedOn: latest.workDate,
        daysReported: days.size,
        minutesOnDays: [...entries].reduce((sum, id) => sum + (minutesByEntry.get(id) ?? 0), 0),
        carried: versions.length > 1 || firstReportedOn < versions[0].workDate,
      };
    })
    .sort(
      (a, b) =>
        b.lastReportedOn.localeCompare(a.lastReportedOn) ||
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.firstReportedOn.localeCompare(a.firstReportedOn) ||
        b.id - a.id,
    );
}

/** { done, inProgress, blocked } of a list of collapsed tasks. */
export function countTasks(tasks) {
  const counts = { done: 0, inProgress: 0, blocked: 0 };
  for (const task of tasks) {
    if (task.status === 'done') counts.done += 1;
    else if (task.status === 'blocked') counts.blocked += 1;
    else counts.inProgress += 1;
  }
  return counts;
}
