// The Board tab (CONTRACT 27 and 28, Board tab), a server component: the band, then the project's
// tasks as the Board or the Table. It loads the tasks the viewer may read (a member gets only
// theirs and Anyone tasks) and, per task and per viewer: the files the viewer may see (count and
// the first two chips; nothing about files for a viewer with no file rights, another PM who isn't
// on the project), the minutes from timers (everyone's for a `team.view` holder, else only the
// viewer's own), the report lines and the newest one (the status chip; a viewer without
// `team.view` counts and sees only their own) and, for the project's PM and Admins, the links to
// "Only PM and Admins" files. Each of those reads falls back to nothing when it fails, so the board
// still shows (before migration 020 links read as none). A member's band counts every task of the
// project per phase, without their names. The view (Board or Table) and the Done phases rail
// (open or closed) come from the viewer's cookies, so the first paint is already right; `?view=`
// wins over the cookie.
import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';
import { projectFiles } from '@/modules/projectFiles';
import { projectTasks } from '@/modules/projectTasks';
import { timers } from '@/modules/timers';
import Board from './_board/Board';
import { countByPhase } from './_board/bandView';
import { RAIL_COOKIE, VIEW_COOKIE, firstView } from './_board/viewPrefs';
import { toBoardTask } from './phasesView';

const first = (value) => (Array.isArray(value) ? value[0] : value);

/** A read that answers `fallback` (and logs) when it fails: the board shows without it. */
async function safe(read, fallback, what) {
  try {
    return (await read()) ?? fallback;
  } catch (error) {
    logger.warn({ err: error }, `Board: ${what} failed; the cards show none`);
    return fallback;
  }
}

/**
 * What the cards show per task, for this viewer.
 * @returns {Promise<{ chips: object, minutes: object, updates: object, lines: object,
 *   privateLinks: object }>} each keyed by task id
 */
async function extrasFor({ viewer, rows, access, filesAccess }) {
  if (rows.length === 0)
    return { chips: {}, minutes: {}, updates: {}, lines: {}, privateLinks: {} };
  const taskIds = rows.map((task) => task.id);
  const ownOnly = !can(viewer, 'team.view');
  const [chips, minutes, updates, lines, privateLinks] = await Promise.all([
    filesAccess === 'none'
      ? {}
      : safe(() => projectFiles.chipsForTasks({ viewer, tasks: rows }), {}, 'file chips'),
    safe(
      () => timers.minutesByTask({ taskIds, userId: ownOnly ? viewer.id : null }),
      {},
      'minutes',
    ),
    safe(() => projectTasks.updateCountsFor({ viewer, taskIds }), {}, 'update counts'),
    safe(() => projectTasks.latestLinesFor({ viewer, taskIds }), {}, 'report lines'),
    access === 'manage'
      ? safe(() => projectFiles.privateLinkCounts(taskIds), {}, 'private links')
      : {},
  ]);
  return { chips, minutes, updates, lines, privateLinks };
}

/** The view and rail cookies; none when they can't be read. */
async function remembered() {
  try {
    const store = await cookies();
    return { view: store.get(VIEW_COOKIE)?.value, rail: store.get(RAIL_COOKIE)?.value };
  } catch {
    return {};
  }
}

/**
 * @param {{ head: object, query?: Record<string, string | string[] | undefined> }} props head:
 *   loadProjectHead (`project`, `plan`, `today`, `forecast` (not for a member), `access`
 *   ('manage' | 'team' | 'member'), `filesAccess`, `hoursThisMonth`, `viewerId`, `viewerName`);
 *   query: the page's search params (`?view=`, `?show=`)
 */
export default async function BoardTab({ head, query = {} }) {
  const { project, plan, today, access, filesAccess } = head;
  const viewer = await getSessionUser();
  const member = access === 'member';
  const [rows, phaseCounts, saved] = await Promise.all([
    projectTasks.listForProject({ viewer, projectId: project.id }),
    member ? projectTasks.countsByPhase(project.id) : null,
    remembered(),
  ]);
  const extras = await extrasFor({ viewer, rows, access, filesAccess });
  const viewerId = head.viewerId ?? viewer?.id ?? null;
  const tasks = rows.map((task) =>
    toBoardTask(task, today, {
      viewerId,
      files: extras.chips[task.id],
      line: extras.lines[task.id],
      minutes: extras.minutes[task.id],
      updateCount: extras.updates[task.id],
      privateLinkCount: extras.privateLinks[task.id],
    }),
  );
  return (
    <Board
      projectId={project.id}
      projectName={project.name}
      access={access}
      filesAccess={filesAccess}
      tasks={tasks}
      counts={phaseCounts ?? countByPhase(tasks)}
      plan={plan}
      today={today}
      status={project.status}
      pmId={project.pmId ?? null}
      pmName={project.pmName ?? null}
      viewerId={viewerId}
      viewerName={head.viewerName ?? viewer?.name ?? null}
      hoursThisMonth={member ? (head.hoursThisMonth ?? null) : null}
      forecast={member ? null : (head.forecast ?? null)}
      show={first(query?.show) ?? null}
      view={firstView(query?.view, saved.view)}
      railOpen={saved.rail === 'open'}
    />
  );
}
