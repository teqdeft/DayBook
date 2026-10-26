// Who and what a viewer may see in Ask Daybook (CONTRACT 20), the same as their screens:
// - Admin: every project, everyone's hours and tasks, everyone's attendance (Admins' too);
// - a PM (team.view): only the projects they manage and the people on them (members, and anyone
//   who logged hours there), and those people's attendance;
// - HR (attendance.view_all only): attendance, no projects, hours or tasks.
// Nobody but an Admin sees an Admin's attendance (CONTRACT 16). Names are resolved only inside
// what the viewer may see, so an unknown name and a hidden one answer the same.
import { can, ROLE_LABELS } from '@/lib/permissions';
import { compactName } from '@/lib/text';
import * as repo from './repo';

/**
 * Loads the viewer's scope once per question.
 * @param {{ id: number, role: string, status?: string }} viewer the session user
 * @returns {Promise<{ kind: 'admin' | 'pm' | 'hr', work: boolean, attendance: boolean,
 *   projects: object[], projectIds: number[] | null, workPeople: object[],
 *   workPeopleIds: number[] | null, attendancePeople: object[], people: object[] }>}
 *   projectIds / workPeopleIds null = no limit (Admin); attendancePeople = tracked, active
 *   people whose attendance the viewer sees; people = everyone the viewer may name
 */
export async function loadScope(viewer) {
  const isAdmin = viewer.role === 'admin';
  const work = can(viewer, 'team.view');
  const attendance = can(viewer, 'attendance.view_all');
  const [everyone, allProjects] = await Promise.all([
    repo.listPeople(),
    work ? repo.listProjects() : [],
  ]);
  const projects = isAdmin ? allProjects : allProjects.filter((p) => p.pmId === viewer.id);
  const projectIds = isAdmin ? null : projects.map((project) => project.id);

  let workPeople = [];
  let workPeopleIds = [];
  if (work && isAdmin) {
    workPeople = everyone;
    workPeopleIds = null;
  } else if (work) {
    const ids = new Set(await repo.listProjectPeopleIds(projectIds));
    workPeople = everyone.filter((person) => ids.has(person.id));
    workPeopleIds = workPeople.map((person) => person.id);
  }

  let attendancePeople = [];
  if (attendance) {
    const pool = work && !isAdmin ? workPeople : everyone;
    attendancePeople = pool.filter(
      (person) =>
        person.status === 'active' &&
        person.tracksAttendance &&
        (isAdmin || person.role !== 'admin'),
    );
  }

  const people = isAdmin ? everyone : unionById(workPeople, attendancePeople);
  return {
    kind: isAdmin ? 'admin' : work ? 'pm' : 'hr',
    work,
    attendance,
    projects,
    projectIds,
    workPeople,
    workPeopleIds,
    attendancePeople,
    people,
  };
}

function unionById(...lists) {
  const byId = new Map();
  for (const list of lists) for (const item of list) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const normal = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** "Raj Kumar (Developer)" when two people share a name, else just the name. */
function labelOf(item, all) {
  const twins = all.filter((other) => normal(other.name) === normal(item.name)).length > 1;
  const detail = item.designation || ROLE_LABELS[item.role] || item.clientName;
  return twins && detail ? `${item.name} (${detail})` : item.name;
}

/** Candidates for a name: exact, then the same without spaces or dashes, then by word start. */
function candidatesFor(items, name) {
  const wanted = normal(name);
  const exact = items.filter((item) => normal(item.name) === wanted);
  if (exact.length > 0) return exact;
  const compact = items.filter((item) => compactName(item.name) === compactName(name));
  if (compact.length > 0) return compact;
  return items.filter((item) => {
    const words = normal(item.name).split(/[\s_-]+/);
    const full = normal(item.name);
    return full.startsWith(wanted) || words.some((word) => word.startsWith(wanted));
  });
}

/**
 * Finds one project or person by name among what the viewer may see.
 * @param {Array<{ id: number, name: string }>} items the visible projects or people
 * @param {string} name what the question called it
 * @param {'project' | 'person'} kind
 * @returns {{ item: object } | { error: string }} error = words for Gemini (unknown or
 *   ambiguous; never names anything outside `items`)
 */
export function resolveName(items, name, kind) {
  const wanted = normal(name);
  if (!wanted) return { error: `Give the ${kind}'s name.` };
  const found = candidatesFor(items, wanted);
  if (found.length === 1) return { item: found[0] };
  if (found.length === 0) {
    return { error: `There is no ${kind} called "${String(name).trim()}" that you can see.` };
  }
  const names = found.slice(0, 6).map((item) => labelOf(item, items));
  const more = found.length > names.length ? ` and ${found.length - names.length} more` : '';
  return {
    error: `More than one ${kind} matches "${String(name).trim()}": ${names.join(', ')}${more}. Ask which one they mean.`,
  };
}
