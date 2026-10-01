// Sidebar items per role, in the order the design canvas shows them. Items are also filtered by
// permission, so a role never sees a link it can't open. Later phases add items here.
import { can } from '@/lib/permissions';

/**
 * Icons are lucide-react component names. `matches` lists other paths that light the item up: the
 * Daily report is opened from Today, so Today stays active there (artboard 02).
 */
export const NAV_ITEMS = {
  overview: {
    label: 'Overview',
    href: '/overview',
    icon: 'LayoutDashboard',
    permission: 'overview.view',
  },
  today: {
    label: 'Today',
    href: '/today',
    icon: 'House',
    permission: 'attendance.self',
    tracksAttendance: true,
    matches: ['/report'],
  },
  log: {
    label: 'My log',
    href: '/log',
    icon: 'FileText',
    permission: 'report.self',
    tracksAttendance: true,
  },
  projects: { label: 'Projects', href: '/projects', icon: 'Folder', permission: 'project.request' },
  team: { label: 'Team', href: '/team', icon: 'Users', permission: 'team.view' },
  screenTime: {
    label: 'Screen time',
    href: '/screen-time',
    icon: 'Monitor',
    permission: 'activity.view_all',
  },
  attendance: {
    label: 'Attendance',
    href: '/attendance',
    icon: 'CalendarDays',
    permission: 'attendance.view_all',
    badge: 'corrections', // pending correction requests
    badgeRoles: ['hr'], // guide section 8: correction counts are shown to HR
  },
  requests: {
    label: 'Requests',
    href: '/requests',
    icon: 'Inbox',
    permission: 'project_request.handle',
    badge: 'requests', // pending report edit and project requests for this approver
    badgeRoles: ['pm'], // guide section 8: request counts are shown to PMs
  },
  people: { label: 'People', href: '/people', icon: 'SquareUser', permission: 'people.manage' },
  roles: { label: 'Roles', href: '/settings/roles', icon: 'Shield', permission: 'roles.manage' },
  settings: {
    label: 'Settings',
    href: '/settings',
    icon: 'SlidersHorizontal',
    permission: 'settings.manage',
  },
};

export const NAVIGATION = {
  employee: ['today', 'log', 'projects'],
  // PMs don't check in or write reports, so no Today or My log.
  pm: ['projects', 'team', 'screenTime', 'attendance', 'requests'],
  hr: ['today', 'log', 'attendance', 'people'],
  // Today and My log appear for an Admin only when they track attendance (the CEO doesn't).
  admin: [
    'overview',
    'today',
    'log',
    'team',
    'screenTime',
    'projects',
    'attendance',
    'people',
    'roles',
    'settings',
  ],
};

/**
 * The sidebar items for a user.
 * @param {{ role: string, tracksAttendance: boolean }} user
 * @param {{ corrections?: number, requests?: number }} [badges]
 */
export function navigationFor(user, badges = {}) {
  return (NAVIGATION[user.role] ?? [])
    .map((key) => ({ key, ...NAV_ITEMS[key] }))
    .filter((item) => can(user, item.permission))
    .filter((item) => !(item.tracksAttendance && user.role === 'admin' && !user.tracksAttendance))
    .map((item) => ({
      key: item.key,
      label: item.label,
      href: item.href,
      icon: item.icon,
      matches: item.matches ?? [],
      badge: item.badge && item.badgeRoles.includes(user.role) ? badges[item.badge] || 0 : 0,
    }));
}

/**
 * The href of the item to highlight for a path: the longest item path (or `matches` path) that
 * is the path itself or a parent of it, so /settings/roles picks Roles, not Settings.
 * @param {{ href: string, matches?: string[] }[]} items
 * @param {string} pathname
 * @returns {string | null}
 */
export function activeNavHref(items, pathname) {
  let best = null;
  let bestLength = 0;
  for (const item of items) {
    for (const path of [item.href, ...(item.matches ?? [])]) {
      const hit = pathname === path || pathname.startsWith(`${path}/`);
      if (hit && path.length > bestLength) {
        best = item.href;
        bestLength = path.length;
      }
    }
  }
  return best;
}

/** Where "/" sends each role. */
export function homePathFor(user) {
  if (user.role === 'admin') return '/overview';
  if (user.role === 'pm') return '/team';
  return '/today';
}
