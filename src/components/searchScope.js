// The top bar search's scope: what it may find for the signed-in person and where a found person
// opens. Pure; TopBar (server) builds the scope, GlobalSearch (client) links the results.
import { can } from '@/lib/permissions';

/**
 * What the search may find for this person and where a found person opens: their Employee page
 * (team.view), else People (people.manage). An Admin's Employee page is for Admins only (company
 * rule), so for anyone else an Admin opens People, or is left out without people.manage.
 * @param {{ role: string, permissions?: string[] }} user the session user
 * @returns {{ people: 'team' | 'people' | null, admins: 'team' | 'people' | null,
 *   projects: boolean }}
 */
export function searchScope(user) {
  const viaPeople = can(user, 'people.manage') ? 'people' : null;
  const people = can(user, 'team.view') ? 'team' : viaPeople;
  return {
    people,
    admins: user.role === 'admin' ? people : viaPeople,
    projects: can(user, 'project.request') || can(user, 'project.manage'),
  };
}

/**
 * Where a found person opens, or null to leave them out of the results.
 * @param {{ id: number, name: string, role?: string }} person a /api/users row
 * @param {{ people?: string | null, admins?: string | null }} scope `admins` applies to people
 *   with the Admin role (default: as `people`)
 * @returns {string | null}
 */
export function personHref(person, scope) {
  const link = person.role === 'admin' && scope.admins !== undefined ? scope.admins : scope.people;
  if (link === 'team') return `/team/${person.id}`;
  if (link === 'people') return `/people?q=${encodeURIComponent(person.name)}`;
  return null;
}
