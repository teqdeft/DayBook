// Role to permission map. can() is the single place that answers "is this allowed".
// Later phases add keys here; nothing else about roles changes.

export const ROLES = ['employee', 'pm', 'hr', 'admin'];

export const ROLE_LABELS = {
  employee: 'Employee',
  pm: 'Project manager',
  hr: 'HR',
  admin: 'Admin',
};

export const ROLE_DESCRIPTIONS = {
  admin: 'Everything, including settings and roles.',
  pm: 'Projects, team views and report edits.',
  hr: 'People and attendance.',
  employee: 'Check-in, daily report and own log.',
};

export const PERMISSIONS = {
  'attendance.self': 'Check in, check out, request a correction',
  'report.self': 'Write, submit and view own reports, request edits',
  'project.request': 'Ask for a missing project',
  'project.manage': 'Create and edit projects, members, urgent flag',
  'team.view': 'Team dashboard and employee detail',
  'report.approve_edit': 'Approve or decline report edit requests',
  'project_request.handle': 'Approve or decline project requests',
  'attendance.view_all': 'Attendance screen for everyone',
  'attendance.correct': 'Edit attendance, handle correction requests',
  'people.manage': 'Add, edit and deactivate employees',
  'export.hours': 'Download hours as Excel',
  'overview.view': 'Company overview',
  'roles.manage': "Change anyone's role",
  'settings.manage': 'Company settings, office networks, Slack',
  // Screen time (company request after the build guide)
  'activity.self': 'Report and see own screen time (active, idle, locked)',
  'activity.view_all': "See everyone's screen time",
};

const SELF = ['attendance.self', 'report.self', 'project.request', 'activity.self'];

export const ROLE_PERMISSIONS = {
  employee: [...SELF],
  // Company decision (overrides the build guide, where PMs checked in like everyone else):
  // PMs don't check in, check out or write daily reports, so they have no attendance.self or
  // report.self and are never tracked (see roleTracksAttendance).
  pm: [
    'project.request',
    'project.manage', // own projects only (pm_id), checked in the projects service
    'team.view',
    'report.approve_edit', // their reports only, checked in the reports service
    'project_request.handle',
    'attendance.view_all',
    'export.hours',
    'activity.view_all',
  ],
  hr: [...SELF, 'attendance.view_all', 'attendance.correct', 'people.manage'],
  // Check-in is optional for Admin: it is allowed, and shown only when tracks_attendance = 1.
  admin: Object.keys(PERMISSIONS),
};

/**
 * @param {{ role: string, status?: string } | null | undefined} user
 * @param {keyof typeof PERMISSIONS} key
 */
export function can(user, key) {
  if (!user || (user.status && user.status !== 'active')) return false;
  return ROLE_PERMISSIONS[user.role]?.includes(key) ?? false;
}

/** Every permission key the user has. */
export function permissionsFor(user) {
  return Object.keys(PERMISSIONS).filter((key) => can(user, key));
}

/** Roles that never check in or write reports, so users.tracks_attendance is always 0 for them. */
export const NON_TRACKING_ROLES = ['pm'];

/**
 * Whether someone with this role is tracked (checks in, writes reports, counts on dashboards).
 * `requested` is the stored or chosen value for roles where tracking is a per-person choice.
 * @param {string} role
 * @param {boolean} [requested]
 */
export function roleTracksAttendance(role, requested = true) {
  return NON_TRACKING_ROLES.includes(role) ? false : Boolean(requested);
}

/**
 * Rows of the read-only "What each role can do" table on the Roles screen.
 * Each row is allowed for a role when the role has every key in the row.
 */
export const PERMISSION_TABLE = [
  {
    label: 'Check in, check out, daily report',
    keys: ['attendance.self', 'report.self'],
    adminOptional: true,
  },
  { label: 'Create and edit projects, mark urgent', keys: ['project.manage'] },
  { label: 'Team dashboard and detailed views', keys: ['team.view'] },
  { label: 'Approve report edits', keys: ['report.approve_edit'] },
  { label: "View everyone's attendance", keys: ['attendance.view_all'] },
  { label: 'Correct attendance', keys: ['attendance.correct'] },
  { label: 'Add and deactivate employees', keys: ['people.manage'] },
  { label: "See everyone's screen time", keys: ['activity.view_all'] },
  { label: 'Change roles and settings', keys: ['roles.manage', 'settings.manage'] },
].map((row) => ({
  ...row,
  roles: Object.fromEntries(
    ROLES.map((role) => {
      const allowed = row.keys.every((key) => ROLE_PERMISSIONS[role].includes(key));
      return [role, role === 'admin' && row.adminOptional ? 'optional' : allowed];
    }),
  ),
}));
