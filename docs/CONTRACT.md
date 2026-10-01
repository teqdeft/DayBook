# Daybook Phase 1 — build contract

This file is the agreement every part of the codebase is built against. The build guide
(`docs/build-guide.txt`, the text of "Daybook Phase 1 Build Guide.pdf") is the spec; the design
artboards in `docs/design/` are the source of truth for layout, spacing, colour and copy. Where this
contract is more specific than the guide, follow this contract.

## 1. Design references

| File (`docs/design/`)       | Screen                        | Route           | Signed in as            |
| --------------------------- | ----------------------------- | --------------- | ----------------------- |
| 01-today.png                | Today (checked in)            | /today          | Employee (Vishal Saini) |
| 02-daily-report.png         | Daily report                  | /report         | Employee                |
| 03-my-log.png               | My log (first row expanded)   | /log            | Employee                |
| 04-my-projects.png          | My projects                   | /projects       | Employee                |
| 05-team-dashboard.png       | Team dashboard                | /team           | PM                      |
| 06-employee-detail.png      | Employee detailed view        | /team/[userId]  | PM                      |
| 07-projects-new-project.png | Projects + New project drawer | /projects       | PM                      |
| 08-requests.png             | Requests                      | /requests       | PM                      |
| 09-attendance.png           | Attendance                    | /attendance     | HR (Neha Gupta)         |
| 10-people-add-employee.png  | People + Add employee drawer  | /people         | HR                      |
| 11-company-overview.png     | Company overview              | /overview       | Admin (CEO)             |
| 12-settings.png             | Settings                      | /settings       | Admin                   |
| 13-roles.png                | Roles and permissions         | /settings/roles | Admin                   |

- Every artboard is **1440 CSS px wide**. `docs/design/*.png` are 3x (4320 px wide: 3 image px = 1 CSS
  px). `docs/design/1x/*.png` are 1x (1 image px = 1 CSS px) for side-by-side comparison.
- Measure with Python + Pillow, e.g. crop and zoom a region given in CSS px:
  `python -c "from PIL import Image; im=Image.open('docs/design/01-today.png'); im.crop((x0*3,y0*3,x1*3,y1*3)).save('scratch/crop.png')"`
  then look at `scratch/crop.png` with the Read tool. Sample colours with `im.getpixel((x*3, y*3))`.
- Not on the canvas (design them from the same tokens and components, matching the canvas style):
  Today before check-in (the check-in card, also the phone layout), /login (centered card on the
  Paper background), dialogs (check-out with report pending, request a project, request an edit,
  correction request, decline with reason, attendance edit), the notification list, row menus,
  toasts, empty states and skeletons, the dark theme, and the < 1024 px layouts.

### Checking your screen against the design

A shared dev server runs on http://localhost:3000 (do **not** start another `next dev` or run
`next build`; Next.js 16 allows one per project and the orchestrator owns it). It uses the `daybook`
database with demo data from `npm run seed:demo` (people and projects from the artboards).

```bash
node tests/visual/shot.mjs --as vishal@company.com --path /today --out scratch/shots/today.png --full
python tests/visual/compare.py docs/design/1x/01-today.png scratch/shots/today.png scratch/shots/today-cmp.png
```

Then Read the compare image. Demo sign-ins: `vishal@company.com` (employee), `pm@company.com` (PM),
`neha@company.com` (HR), `ceo@company.com` (Admin). Iterate until spacing, sizes, colours, fonts and
copy match. Data-driven numbers may differ from the artboard; layout and styling must not.

> **Company rule (overrides the build guide):** project managers do not check in, check out or
> write daily reports. The `pm` role has no `attendance.self` / `report.self`; PMs are never
> tracked (`roleTracksAttendance()` in `@/lib/permissions`, migration 006). Their nav is Projects,
> Team, Attendance, Requests and they start on `/team`.

## 2. Next.js 16 rules (this is not the Next.js from older training data)

- Read `node_modules/next/dist/docs/` when unsure. Middleware is now `src/proxy.js` (exists).
- `params`, `searchParams`, `cookies()` and `headers()` are **async**: `const { userId } = await params`.
- No `next lint`; lint with `npx eslint <files>`. Turbopack is the default bundler.
- Pages are async Server Components. Interactive pieces are small `'use client'` components that call
  `/api/...` with `api` from `@/lib/apiClient` and then `router.refresh()`.
- Never pass functions (including icon components like `Plus`) from a Server Component to a Client
  Component. Pass elements instead: `icon={<Plus size={18} strokeWidth={1.8} />}`.
- Client Components must not import server modules (`@/lib/db`, `@/lib/session`, `@/modules/*`
  except `@/modules/slack/format`). Shared pure helpers: `@/lib/time`, `@/lib/text`,
  `@/lib/permissions`, `@/lib/apiClient`.

## 3. Code conventions

- Plain JavaScript (ES modules), JSDoc on every service function (what, inputs, returns, error codes).
- Components: `src/components/PascalCase.jsx` + `PascalCase.module.css` (flat folder). Feature-only
  client components live next to their page: `src/app/(app)/<route>/SomethingForm.jsx` +
  `SomethingForm.module.css`. Pages use a `page.module.css` for layout.
- CSS uses the variables in `src/app/globals.css` only — never a raw hex value in a component.
  Headings and every number use `font-family: var(--font-heading-stack)` with
  `font-variant-numeric: tabular-nums` (or the global `.num` class).
- Icons: `lucide-react`, `strokeWidth={1.8}`.
- Copy is sentence case. Dates: "Wednesday, 30 September" in titles (`formatDay`), "Wed, 30 Sep"
  in rows (`formatDayShort`). Times: "9:32" in tables (`formatTime`), "6:30 PM" in sentences
  (`formatTimeAmPm` / `formatClock`). Present time "8h 15m" (`formatDuration`), logged hours "8h" /
  "8.5h" (`formatHours`) — except where the artboard shows otherwise (the Team board "Logged"
  column shows `formatDuration`, e.g. "7h 30m").
- No `new Date()` / `Date.now()` in modules or components: use `now()`, `nowDate()`, `workDate(tz)`
  from `@/lib/time`. The company time zone is `settings.timezone`.
- Prettier: 100 columns, single quotes, semicolons. Functions under ~50 lines, files under ~300.

## 4. Modules, repos, services

Each module in `src/modules/<name>/` has `repo.js` (the only file with Knex queries), `service.js`
(rules, transactions, events), `schemas.js` (zod, one per endpoint body or query) and `index.js`
(`export const <name> = service;` — other code imports only from the index, e.g.
`import { attendance } from '@/modules/attendance'`). Services call their own repo and other
modules' **services**, never other repos. Exception: `modules/dashboard/repo.js` runs read-only
aggregate queries across tables (one query per widget) — dashboards are read models.

Database conventions (`src/lib/db.js`, `knexfile.js`):

- JS uses camelCase; Knex converts to snake_case (`wrapIdentifier`) and back (`postProcessResponse`).
  Write `db('attendance').where({ userId, workDate })`. Raw SQL (`db.raw`) must use snake_case and
  backticks for `before`/`after`/`key`.
- `TINYINT(1)` columns come back as booleans. `DATE` columns come back as `'YYYY-MM-DD'` strings.
  `DATETIME` columns are UTC and come back as JS `Date`; write `Date` objects (from `nowDate()` or
  `dayjs().toDate()`). JSON columns come back as strings: read with `parseJson()`, write with
  `toJson()` (both in `@/lib/db`). `SUM()`/`COUNT()` come back as numbers.
- Repos take an optional `trx = db` last argument. Any write touching more than one table runs in
  `db.transaction(async (trx) => { ... })` and passes `trx` down (including to
  `notifications.notify`, `audit.log`, `slack.enqueue`).
- Local development runs on **MariaDB 10.4**; production is MySQL 8.4. Write SQL that works on
  both: no `SKIP LOCKED` unless `await supportsSkipLocked()`, no `ANY_VALUE()`, no `JSON_TABLE`, no
  `LATERAL`, GROUP BY must list every non-aggregated column. MariaDB error names in `mysql2` can be
  wrong; check `error.errno === 1062` for duplicates.
- Durations are whole minutes (`minutes`, `lateMinutes`, `totalMinutes`). APIs accept hours; the
  service converts at the edge.

Errors: `throw new AppError('CODE', { message?, fields? })` from `@/lib/errors`. Use the codes
already in `ERROR_CODES`; for anything else pass `status` and `message` explicitly rather than editing
`errors.js`. Validation messages are written for people ("Hours must be above 0").

## 5. Shared library (exists — do not edit without the orchestrator)

- `@/lib/env` → `env` (parsed, frozen). `@/lib/db` → `db`, `parseJson`, `toJson`, `supportsSkipLocked`.
- `@/lib/errors` → `AppError`, `validationError(fields, message)`, `ERROR_CODES`.
- `@/lib/logger` → `logger` (pino). Never log tokens, cookies or report text.
- `@/lib/permissions` → `can(user, key)`, `permissionsFor`, `ROLES`, `ROLE_LABELS`,
  `ROLE_DESCRIPTIONS`, `PERMISSIONS`, `PERMISSION_TABLE` (rows for the Roles screen).
- `@/lib/session` (server only) → `getSessionUser()` (cached per request), `requireUser()`,
  `requirePage(permissionKey)` (redirects to /login or /no-access), `setSessionCookie`,
  `clearSessionCookie`, `readSessionToken`.
- `@/lib/route` → `withRoute({ permission, body?, query?, status?, rateLimit? }, handler)` and
  `listResult(rows, { limit, offset, total })`. `permission` is `'public'`, `'signed_in'` or a
  permission key. The handler receives `{ user, body, query, params, ip, request, requestId }` and
  returns plain data (wrapped as `{ data }`), a `listResult(...)`, or a `Response`. Use
  `status: 201` for creates. Example:

  ```js
  export const POST = withRoute(
    { permission: 'attendance.self', body: checkInSchema },
    async ({ user, body, ip }) => attendance.checkIn({ user, ip, ...body }),
  );
  ```

- `@/lib/time` → `now`, `nowDate`, `setNowForTests`, `toLocal`, `workDate(tz, at?)`,
  `normalizeClock`, `clockToMinutes`, `localToUtc(date, clock, tz)`, `isoWeekday`, `isWorkingDay`,
  `addDays`, `eachDay`, `workingDaysBetween`, `weekRange`, `monthRange`, `monthOf`, `addMonths`,
  `lateMinutesFor`, `locksAtFor`, `minutesBetween`, and formatters `formatDay`, `formatDayShort`,
  `formatDayMonth`, `formatDayMonthShort`, `formatWeekday`, `formatMonth`, `formatDateLong`,
  `formatDateDmy`, `formatTime`, `formatTimeAmPm`, `formatClock`, `formatClockShort`,
  `trimNumber`, `minutesToHours`, `formatHours`, `formatDuration`, `formatRelativeDay`, `greeting`.
- `@/lib/text` → `initials(name)`, `avatarTone(user)`, `compactName(value)` (lowercase without
  spaces/dashes, for duplicate checks), `plural`.
- `@/lib/apiClient` (browser) → `api.get/post/put/patch/delete(path, body)` returning `{ data, page }`
  or throwing `ApiError { code, message, fields, status }`.
- `@/lib/events` → `on(name, handler)`, `emit(name, payload)`.
- `@/lib/excel` → `xlsxResponse({ filename, sheets: [{ name, columns: [{ header, key, width?,
numFmt? }], rows }] })` → a download `Response` (return it from a `withRoute` handler).
- Client IP in a Server Component: `clientIp({ headers: await headers() })` (`clientIp` from
  `@/lib/route` only reads `request.headers`).
- `@/config/navigation` → `navigationFor(user, badges)`, `homePathFor(user)`.
- The session user object (from `getSessionUser`/`requirePage`/`withRoute`):
  `{ id, name, email, role, roleLabel, designation, departmentId, departmentName, reportsToId,
avatarUrl, slackUserId, tracksAttendance, shiftStart, shiftEnd, joinedOn, status, initials,
permissions }` (`shiftStart`/`shiftEnd` are `'HH:mm'` or null).

## 6. Module contracts (functions other modules and pages rely on)

Signatures are fixed; add more functions freely. `PublicUser` =
`{ id, name, email, role, roleLabel, designation, departmentId, departmentName, reportsToId,
reportsToName, avatarUrl, slackUserId, tracksAttendance, shiftStart, shiftEnd, joinedOn, status,
initials }`.

### settings (owner: system)

- `getAll()` → `{ companyName, timezone, workingDays, officeStart, officeEnd, lateAfter,
reportReminderAt, reportLock, gapWarningMinutes, stuckTaskDays, allowUnverifiedOffice,
autoMarkMissingCheckout, slackEnabled, slackReportChannelId, slackReportChannelName,
slackPostReports, slackRemind, slackUrgentNotify, slackRequestsNotify }` (clock values
  `'HH:mm'`; cached in-process ~30 s, cleared on save). Defaults come from `db/seeds/03_settings.js`.
- `update({ user, values, ip })` → saves changed keys, audit `settings.update`, returns `getAll()`.
- `listOfficeNetworks()`, `addOfficeNetwork({ user, name, ipAddress, ip })`,
  `removeOfficeNetwork({ user, id, ip })`, `isOfficeIp(ip)` → boolean.

### notifications (owner: system)

- `notify({ userIds, type, title, body?, link? }, trx?)` — in-app rows (the bell). Always created,
  whatever the Slack settings.
- `listForUser(userId, { limit = 20 })` → `[{ id, type, title, body, link, readAt, createdAt }]`,
  `unreadCount(userId)`, `markAllRead(userId)`, `deleteOldRead(before)`.

### audit (owner: system)

- `log({ actorId, action, entityType, entityId, before?, after?, reason?, ip? }, trx?)`.

### slack (owner: system)

- `@/modules/slack/format` → `formatReport({ userName, workDate, entries: [{ projectName,
minutes, tasks: [{ title, status }] }] })` → the exact Slack text. Pure; the report page's Slack
  preview imports it.
- `queueReportPost({ report, userName, userSlackUserId, avatarUrl, entries }, trx?)` — queues a new
  post, or an update when `report.slackTs` is set; no-op when `slackPostReports` is off or no channel.
- `queueDm({ slackUserId, text, settingKey }, trx?)` — no-op when the setting is off; skipped (and
  logged) when `slackUserId` is empty.
- `enqueue({ kind, channel, payload, relatedType?, relatedId? }, trx?)`, `processOutbox()`,
  `deleteOldSent(before)`, `getConnection()` → `{ configured, connected, teamName }`,
  `listChannels()` → `[{ id, name }]`, `lookupUserIdByEmail(email)` → string | null,
  `outboxHealth()` → `{ pending, oldestPendingAt }`.

### users (owner: people-admin)

- `findById(id)` → PublicUser | null; `findByIds(ids)`; `listActive({ tracksAttendance? })` (sorted
  by name); `listByRole(role)` (active); `getReportApproverIds(userId)` → the user's `reportsTo` if
  that user is an active PM, otherwise every active Admin; `listDepartments()` →
  `[{ id, name, activeCount }]`; `syncSlackUserIds()` → `{ updated }` (worker job).

### attendance (owner: attendance)

- `AttendanceRow` = `{ id, userId, workDate, checkInAt, checkOutAt, location, officeVerified,
checkInIp, checkOutIp, note, lateMinutes, isWorkingDay, checkoutStatus, source }`.
- `getForUserOnDate(userId, workDate)` → AttendanceRow | null; `listForUserRange(userId, from, to)`;
  `listForDate(workDate)`; `countPendingCorrections()`; `presentMinutes(row, at?)`;
  `markMissingCheckouts()` → `{ marked }` (worker 00:05; honours `autoMarkMissingCheckout`,
  notifies HR).

### reports (owner: reports)

- `getDayStatus(userId, workDate)` → `{ reportId, status: 'none' | 'draft' | 'submitted', totalMinutes }`.
- `getSubmittedMinutesByDay(userId, from, to)` → `{ 'YYYY-MM-DD': minutes }`.
- `listRecentTasks(userId, from, to)` → latest version of each task (carry-over chains collapsed),
  newest first: `[{ taskId, title, status, projectId, projectName, projectColor, workDate,
firstReportedOn }]`.
- `hasEntriesForProjectRequest(projectRequestId)` → boolean;
  `moveProjectRequestEntries({ projectRequestId, projectId }, trx)` → count moved.
- `listPendingEditRequestsFor(user)` → `[{ id, workDate, reason, createdAt, requester:
{ id, name, designation, role, status } }]` (only requests this user may approve);
  `listHandledEditRequestsFor(user, { limit })` → same plus `status`, `handledAt`,
  `declineReason`; `countPendingEditRequestsFor(user)`.
- `sendReportReminders(workDate)` → `{ reminded }` (worker; honours `slackRemind`).
- `saveSlackMessage({ reportId, channelId, ts })` — called by the Slack outbox after a report post
  succeeds, so later submits update the same message.
- `getMinutesByProject({ from, to, userId? })` → `{ [projectId]: minutes }` from submitted reports
  (Projects cards "Your hours this month", PM table "Hours this week").
- `getLastReportDateByProject(userId)` → `{ [projectId]: 'YYYY-MM-DD' }` ("Your last update").

### projects (owner: projects)

- `Project` = `{ id, name, clientId, clientName, pmId, pmName, status, color, isUrgent, urgentNote,
urgentMarkedAt, urgentMarkedById, urgentMarkedByName, completedAt }`.
- `findById(id)`; `isActive(id)`; `listUrgentForMember(userId)` and `listUrgent()` →
  `[{ id, name, color, urgentNote, urgentMarkedAt, urgentMarkedByName, pmId, pmName,
memberCount }]`; `getPickerFor(userId)` → `{ urgent, mine, others, requests }` where the first
  three are `[{ id, name, color, isUrgent }]` and `requests` is the user's pending project requests
  `[{ requestId, name }]`; `findPendingRequestForUser(requestId, userId)`;
  `countPendingRequestsFor(user)`; `listPendingRequestsFor(user)` →
  `[{ id, name, note, createdAt, requester }]`; `listHandledRequestsFor(user, { limit })`;
  `countActive()` → `{ active, urgent }`.

### dashboard (owner: dashboards)

- `getNavBadges(user)` → `{ requests, corrections }` (requests: pending report edits this user may
  approve + pending project requests; corrections: pending attendance corrections, only for people
  with `attendance.correct`).

Until a module's owner finishes, `src/modules/<name>/` holds a stub with these signatures that
returns empty data, so every page renders. Owners replace the stub completely.

## 7. API ownership

| Owner               | Routes (`src/app/api/...`)                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orchestrator (done) | `auth/slack/start`, `auth/slack/callback`, `auth/logout`, `auth/dev-login`                                                                                                                                                                                                                                                |
| system              | `notifications`, `notifications/read-all`, `settings`, `office-networks`, `office-networks/[id]`, `slack/channels`, `health`                                                                                                                                                                                              |
| people-admin        | `me`, `users`, `users/[id]`, `users/[id]/deactivate`, `users/[id]/reactivate`, `users/[id]/role`, `departments`                                                                                                                                                                                                           |
| attendance          | `attendance/export`, `attendance/me/today`, `attendance/check-in`, `attendance/check-out`, `attendance` (GET, POST), `attendance/summary`, `attendance/[id]` (PATCH), `attendance/[id]/confirm-office`, `attendance-corrections` (GET, POST), `attendance-corrections/[id]/approve`, `attendance-corrections/[id]/reject` |
| reports             | `reports/me`, `reports` (GET), `reports/[id]` (GET, PUT), `reports/[id]/submit`, `reports/[id]/revisions`, `report-edit-requests` (GET, POST), `report-edit-requests/[id]/approve`, `report-edit-requests/[id]/decline`, `me/log`                                                                                         |
| projects            | `projects` (GET, POST), `projects/picker`, `projects/[id]` (PATCH), `projects/[id]/members`, `projects/[id]/urgent` (POST, DELETE), `clients`, `project-requests` (GET, POST), `project-requests/[id]/approve`, `project-requests/[id]/decline`                                                                           |
| dashboards          | `team/today`, `team/[userId]`, `stats/hours-by-project`, `overview`, `exports/hours`                                                                                                                                                                                                                                      |

Downloads ("Download Excel" buttons) — each screen uses an endpoint its viewers are allowed to call:
Team dashboard and Employee detail → `GET /api/exports/hours?from=&to=&userId=` (`export.hours`,
dashboards); My log → `GET /api/me/log?month=YYYY-MM&format=xlsx` (`report.self`, own data only,
reports); Attendance → `GET /api/attendance/export?date=YYYY-MM-DD` (`attendance.view_all`,
attendance). All use `xlsxResponse` from `@/lib/excel`.

Paths, permissions and bodies are in build guide section 9. Lists take `limit` (max 100) and
`offset`. Dates in query strings are `YYYY-MM-DD`.

## 8. Shared components (`src/components/`)

Owners: **ui-kit** builds the primitives, **shell** builds layout, overlays and charts. Import
paths are fixed: `import Button from '@/components/Button'`. Components without hooks have no
`'use client'` so Server Components can use them. Interactive ones are client components with
serialisable props. Every component accepts `className`.

**ui-kit (primitives, server-safe unless marked client)**

- `Button` — `{ variant: 'primary' | 'secondary' | 'dark' | 'text' | 'danger' | 'marigold' = 'primary',
size: 'default' | 'compact' | 'small', icon?: element, iconRight?: element, href?, type = 'button',
loading?, fullWidth?, ...buttonProps }`. 44 px high (40 compact), 10 px radius, 15 px semibold.
  `href` renders a `next/link`. `text` = no box, primary colour (links like "Edit", "Review").
- `IconButton` — `{ label (aria-label, required), icon: element, dot?: boolean, href?, variant:
'secondary' | 'ghost' }` — the 44 px bordered square (bell).
- `Card` (default) and `CardHeader` from `@/components/Card` — Card `{ as?, tone: 'default' | 'urgent'
| 'dark' | 'dashed' | 'muted', padding: 'default' | 'none' | 'compact' }`; CardHeader
  `{ title, subtitle?, actions?, divider?: boolean }` (18 px semibold title).
- `Kpi` — `{ label, value, sub?, footer?, percent?: 0-100, color: 'primary' | 'green' | 'marigold' |
'violet' | 'red' | 'teal' }` (number card with an 8 px bar).
- `StatTile` — `{ value, label }` (the grey boxes in Today's "Your day").
- `StatusCell` from `@/components/StatusCell` — `{ status, label?, size: 'cell' | 'pill' = 'cell',
chevron?: boolean, as?: 'div' | 'button', ...rest }`. Status → fill: green (done, submitted,
  approved, created, active, connected), primary (in_progress, office), red (blocked, missing),
  marigold (urgent, pending, edit_requested, unverified), violet (wfh, edited), line/ink-2 (locked,
  on_hold, declined, not_checked_in, deactivated, completed, draft). Default labels: 'Done',
  'In progress', 'Blocked', 'Submitted', 'Approved', 'Created', 'Active', 'Connected', 'Office',
  'Missing', 'Urgent', 'Pending', 'Edit requested', 'Unverified', 'WFH', 'Edited', 'Locked',
  'On hold', 'Declined', 'Not checked in', 'Deactivated', 'Completed', 'Draft'. `cell` = 34 px high,
  8 px radius, 13 px semibold, fills its column; `pill` = the smaller badge on cards/lists.
  Also exports `STATUS_LABELS`.
- `Tag` — `{ tone: 'primary' | 'marigold' | 'green' | 'red' | 'violet' | 'teal' | 'neutral' | 'ink',
size: 'sm' | 'md', children }` — soft pills ("Today", "WFH", "Late 38m", "Carried over",
  "Report edit", role labels; `ink` = solid navy "Admin").
- `ProjectLabel` — `{ project: { name, color }, size: 'sm' | 'md' | 'lg', as?, chevron?, ...rest }`
  (26 px, 6 px radius, soft background + dark text of the project colour). `ProjectSquare` —
  `{ project, size = 40 }` (the letter square).
- `Avatar` — `{ user: { name, initials?, avatarUrl?, role?, status? }, size = 34, tone? }`; tone
  defaults to `avatarTone(user)`; tones: blue, violet, green, teal, orange, red, pink, navy, ink,
  grey. `AvatarStack` — `{ users, max = 4, size = 30 }`.
- `ProgressBar` — `{ percent, color, height = 8 }` (colour = a tone or a project colour).
- `Legend` — `{ items: [{ label, color, value? }], layout: 'list' | 'inline' }`.
- `Field` — `{ label, htmlFor, help?, error?, children }`; `Input`, `Select` (`{ options: [{ value,
label }] }` or children), `Textarea` — 44 px, 10 px radius, 1 px `--line-strong`; pass `error` for
  the red state. `Toggle` (client) — `{ checked, onChange, label?, help?, disabled?, name? }`.
- `FilterPills` (client when `onChange` is used) — `{ items: [{ value, label, href? }], value,
onChange? }`: 36 px fully rounded; selected = `--ink` with white text. `Segmented` — same props,
  grey track with a white selected thumb (Week/Month). Both render links when items have `href`.
- `SearchBox` (client) — `{ placeholder, value?, onChange?, name?, defaultValue? }`.
- `DateSwitcher` — `{ label, prevHref, nextHref, prevLabel, nextLabel }` ("‹ Today ›").
- `EmptyState` — `{ title, body?, action? }`; `Skeleton` — `{ width, height, radius }`.
- `Breadcrumb` — `{ items: [{ label, href? }] }`.
- `PersonChip` (client) — `{ user, onRemove? }` (avatar + name + ×, in the project drawer).

**shell (layout, overlays, charts)**

- `AppShell` (client) — sidebar + main area; below 1024 px the sidebar becomes a drawer opened by
  the menu button in `TopBar`. Used only by `src/app/(app)/layout.js`.
- `Sidebar` — logo, workspace box, nav items (`navigationFor`), badges, signed-in person with a
  menu (Sign out).
- `TopBar` (async Server Component) — `{ title, subtitle?, breadcrumb?, actions?, bell?: boolean,
avatar?: boolean, search?: { placeholder } }`. Page title 30 px bold (−0.02em), subtitle 15 px
  `--muted`. `bell` renders `NotificationBell` (client: latest 20, "Mark all as read", each item
  links to its screen). `search` renders `GlobalSearch` (people via `/api/users?q=`, projects via
  `/api/projects?q=`).
- `Drawer` (client) — `{ open, onClose, title, footer?, children, width = 460 }`, overlay
  `var(--overlay)`, focus trap, Escape closes, focus returns to the opener.
- `Dialog` (client) — `{ open, onClose, title, description?, footer?, children }`.
- `ToastProvider` + `useToast()` (client) — `toast({ title, body?, tone: 'success' | 'error' })`;
  the provider is mounted in the app shell.
- `Menu` (client) — `{ label (aria), items: [{ label, onSelect, tone?, disabled? }] }` (row "⋯").
- `DataTable` (server-safe, no hooks) — `{ columns: [{ key, header, width?, align?, render?(row) }],
rows, rowKey = 'id', groups?: [{ key, title, tone, count, rows, collapsed?, onToggle?, footer? }],
empty?: node, dense? }`: 40 px header on `--surface-muted`, rows ≥ 54 px with a 1 px `--track`
  divider; below 1024 px rows become stacked cards (use `data-label`).
- `DayBar` — `{ checkInAt, checkOutAt, now, start, end, tz, variant: 'large' | 'compact', color?,
labels? }` (large = Today's 18 px bar with marks; compact = table bar).
- `HBarList` — `{ rows: [{ label, value, display, color }], max?, barHeight = 12 }`.
- `WeekBars` — `{ days: [{ label, value, display?, max?, highlight?, segments?: [{ value, color }],
faded? }], height }` (Today's "This week" and Overview's stacked "Attendance this week").
- `Donut` — `{ segments: [{ label, value, color }], centerValue, centerLabel, size = 190 }`.
- `MonthCalendar` — `{ weeks: [[{ date, day, tone: 'office' | 'wfh' | 'late' | 'missing' |
'future' | 'empty' | 'weekend', isToday }]] }` (Mon–Fri columns) with its legend.

## 9. Pages and ownership

| Owner        | Files                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shell        | `src/app/(app)/layout.js`, `(app)/no-access/page.js`, `(app)/error.js`, `(app)/loading.js`, `src/app/not-found.js`, `src/app/(auth)/login/page.js` (+ its client pieces) |
| people-admin | `(app)/people/**`, `(app)/settings/**` (Settings and Roles)                                                                                                              |
| attendance   | `(app)/today/**`, `(app)/attendance/**`                                                                                                                                  |
| reports      | `(app)/report/**`, `(app)/log/**`                                                                                                                                        |
| projects     | `(app)/projects/**`, `(app)/requests/**`                                                                                                                                 |
| dashboards   | `(app)/team/**`, `(app)/overview/**`                                                                                                                                     |

Every page starts with `const user = await requirePage('<permission>')`, renders `<TopBar ... />`
then its blocks, has a loading skeleton (`loading.js`) and empty states. Page permissions:
/today `attendance.self`, /report and /log `report.self`, /projects `project.request`
(`project.manage` holders see the PM view), /team `team.view`, /requests
`project_request.handle`, /attendance `attendance.view_all`, /people `people.manage`, /overview
`overview.view`, /settings `settings.manage`, /settings/roles `roles.manage`.

## 10. Tests

- Unit and service tests: Vitest, `tests/unit/*.test.js` and `tests/services/<module>.test.js`.
  Service tests call `resetDatabase()` from `tests/helpers/db.js` in `beforeAll` and build their own
  data (`createUser`, `setSettings`). Pin time with `setNowForTests('2026-09-30T04:00:00Z')`.
- Each agent runs tests against **its own** database so parallel runs don't collide:
  `DB_NAME=daybook_test_<n> npx vitest run tests/services/<module>.test.js` (databases
  `daybook_test_1` … `daybook_test_8` exist; your prompt says which number is yours).
- Every business rule in guide section 7 that your module owns gets at least one service test.

## 11. Screen time (added after the build guide, at the company's request)

Records, all day, whether each tracked person is **active**, **idle** (no mouse or keyboard for
`settings.activityIdleMinutes`) or has the **screen locked**, using the browser's Idle Detection API
in the installed Daybook app. Never apps, websites, keystrokes or screenshots. Employees see their
own numbers; PMs and Admin see everyone's (`activity.view_all`). Only tracked people
(`users.tracks_attendance = 1`, so never PMs) are recorded.

- Table `activity_segments` (migration 007): `user_id`, `work_date` (company date of `started_at`),
  `state` active | idle | locked, `source` system (Idle Detection, whole computer) | window (fallback:
  only the Daybook window), `started_at`, `ended_at` (UTC; `ended_at` = last report received).
- Settings: `activityTrackingEnabled` (default true), `activityIdleMinutes` (default 5, min 1),
  `activityRetentionDays` (default 365).
- Permissions: `activity.self` (employee, HR, Admin) and `activity.view_all` (PM, Admin). Nav item
  `screenTime` → `/screen-time` (icon `Monitor`) for PM and Admin.
- Heartbeats: the client sends `POST /api/activity/heartbeat { state, source }` on every state change
  and every 60 s while the app is open (server time decides `started_at`/`ended_at`). Server rule: if
  the person's latest segment has the same state and source, ended within the last 150 s and is on the
  same work date, extend it to now; otherwise start a new segment at now (a gap longer than 150 s is
  "no data", never counted). When two devices disagree within the same minute, `active` wins.
- `activity` module (`@/modules/activity`):
  - `recordHeartbeat({ user, state, source })` → `{ state, segmentId }` (FORBIDDEN unless
    `activity.self` and tracked; no-op `{ state: 'off' }` when `activityTrackingEnabled` is false).
  - `getDay(userId, workDate)` → `{ workDate, activeMinutes, idleMinutes, lockedMinutes,
firstActiveAt, lastSeenAt, source, segments: [{ state, source, startedAt, endedAt }] }`.
  - `getRange(userId, from, to)` → `{ days: [{ workDate, activeMinutes, idleMinutes, lockedMinutes,
firstActiveAt, lastSeenAt }], totals: { activeMinutes, idleMinutes, lockedMinutes, daysWithData } }`.
  - `getTeamDay(workDate)` → for every active tracked person: `{ user: { id, name, designation,
departmentName, role, status, initials }, currentState: 'active' | 'idle' | 'locked' | 'offline',
lastSeenAt, activeMinutes, idleMinutes, lockedMinutes, firstActiveAt, lastActiveAt, source,
segments }` (currentState is offline when the last report is older than 150 s or not today).
  - `deleteOlderThan(workDate)` → rows deleted (cleanup job, `activityRetentionDays`).
- API: `POST /api/activity/heartbeat` (activity.self), `GET /api/activity/me?from=&to=`
  (activity.self), `GET /api/activity/team?date=` (activity.view_all),
  `GET /api/activity/users/[id]?from=&to=` (activity.view_all), `GET /api/activity/export?date=`
  (activity.view_all, xlsx).
- Client: `src/components/ActivityTracker.jsx` (mounted once in `AppFrame` for users with
  `activity.self` who are tracked). One tracker per browser (Web Locks). First run shows a notice
  Dialog ("Daybook records when you're active, idle or have the screen locked while the app is open.
  It never sees which apps or websites you use. Your manager can see it.") whose button calls
  `IdleDetector.requestPermission()`; without Idle Detection it falls back to window activity
  (`source: 'window'`).
- Screens: `/screen-time` (PM/Admin: one day for the whole team), a "Screen time" card on
  `/team/[userId]`, a "Screen time" card on My log, and a one-line "Screen time today" in Today's
  "Your day" card.

## 12. Project report (added after the build guide)

`/projects/[id]` — everything about one project for PMs (all projects) and Admin (`team.view`): who
worked on it, hours per person and over time, every task with its status and dates, a day-by-day log
of entries, and Excel. Counts use submitted reports only (guide 7.10).

- `dashboard` module: `getProjectReport({ projectId, from, to })` → `{ project, range, totals:
{ minutes, people, tasksDone, tasksInProgress, tasksBlocked, firstReportOn, lastReportOn },
byPerson: [{ user, minutes, days, firstOn, lastOn, tasksDone, tasksInProgress, tasksBlocked }],
byPeriod: [{ label, from, to, minutes }], tasks: [{ title, status, user, firstReportedOn,
lastReportedOn, daysReported, minutesOnDays }], entries: [{ workDate, user, minutes, tasks }] }`
  (entries paged with limit/offset); `projectReportWorkbook(...)` for Excel.
- API: `GET /api/projects/[id]/report?from=&to=&limit=&offset=` and
  `GET /api/projects/[id]/report/export?from=&to=` (both `team.view`).
- Entry points: project names in the PM/Admin Projects table, rows of "Hours logged by project" on
  the Team dashboard and Company overview.

## 13. Priority tasks (added after the build guide)

The project's PM (or Admin) lists a project's important tasks and marks each **P1** (highest),
**P2** or **P3**, optionally for one person (`assignee_id`; null = anyone on the project). Members
see their open priority tasks on Today (P1 first) and can link a daily-report task line to one.

- Table `project_tasks` (migration 008): `project_id`, `title` (2–200), `details` (≤1000, optional),
  `priority` p1 | p2 | p3, `assignee_id` (active member of the project, or null), `status` open |
  done, `done_at`, `done_by`, `created_by`, `updated_by`. `report_tasks.project_task_id` (nullable,
  ON DELETE SET NULL) links a report line to the priority task it worked on; carry-over keeps it.
- Who: create, edit (title, details, priority, assignee), mark done / reopen and delete need
  `project.manage` for that project (the project's PM, or Admin) — same rule as editing the project.
  Members of the project (and PM/Admin) can read them. Order everywhere: P1, P2, P3, then oldest first.
- Notifications (type, in the bell and on the desktop): `project_task.added` to the assignee, or to
  every active member when unassigned ("New P1 task on internal-tool: Fix login timeout");
  `project_task.changed` when priority or assignee changes (to the new assignee / members);
  `project.member_added` to people newly added to a project ("You were added to acme-store").
  Audit: `project_task.create`, `project_task.update`, `project_task.done`, `project_task.reopen`,
  `project_task.delete`.
- `projectTasks` module (`@/modules/projectTasks`):
  - `listForProject({ viewer, projectId, status? })` → `[{ id, projectId, title, details, priority,
status, assignee: { id, name, initials, role, status } | null, createdBy, createdAt, doneAt,
doneBy, latestReport: { status, userId, userName, workDate } | null }]`.
  - `listOpenForUser(userId)` → open tasks on the user's projects assigned to them or to anyone,
    with `project: { id, name, color, isUrgent }`, P1 first.
  - `countOpenByProjectForUser(userId)` → `{ [projectId]: { total, p1 } }` (My projects cards).
  - `findOpenForPicker({ userId, projectId })` → open tasks the user can link in a report.
  - `findById(id)`, `create({ user, projectId, input, ip })`, `update({ user, id, input, ip })`,
    `setStatus({ user, id, status, ip })`, `remove({ user, id, ip })`.
  - Also: `findOpenForPickerByProject({ userId, projectIds })` → `{ [projectId]: tasks }` (one query
    for the report page) and `findByIds(ids, { trx?, lock? })` → Map (share-locks the rows inside
    the caller's transaction, used by report saves).
  - `latestReport` is returned in full only to viewers with `team.view`; other members see it only
    when the line is their own (employees see their own data).
- Reports: task lines carry `projectTaskId`, `priority` and `projectTaskTitle`;
  `reports.getPriorityLinks({ projectId, from, to })` feeds the project report's Priority column and
  the Excel Tasks sheet's Priority column. The Slack report text is unchanged.
- API: `GET/POST /api/projects/[id]/tasks`, `PATCH/DELETE /api/project-tasks/[id]`,
  `POST /api/project-tasks/[id]/status { status: 'open' | 'done' }`. Reports' PUT/submit bodies accept
  `projectTaskId` on a task (must be an open task of that entry's project, or the one already linked).
- UI: shared `PriorityTag` component (`@/components/PriorityTag`, `{ priority: 'p1'|'p2'|'p3', size }`:
  P1 red, P2 marigold, P3 neutral, text "P1"). A "Priority tasks" card on `/projects/[id]` (manage),
  a P-count on My projects cards, a "Priority tasks" card on Today, priority suggestions in the daily
  report's task field, and a Priority column for linked tasks in the project report.

## 14. Desktop notifications (added after the build guide)

Every bell notification is also shown on the person's computer (Windows notification centre via the
browser's Web Push), even when the Daybook window is minimised. Each person turns it on per browser
from the bell; Admin can switch it off for everyone (`settings.pushEnabled`, default true).

- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate with
  `npx web-push generate-vapid-keys`); without keys pushes are skipped. Library: `web-push`.
- Table `push_subscriptions` (endpoint, sha256 `endpoint_hash` unique, `p256dh`, `auth`,
  `user_agent`, `last_success_at`, `failure_count`); `notifications.pushed_at` (migration 008 marks old
  rows pushed). Sending is done by the worker, like the Slack outbox: job `push-notifications` every
  10 s claims notifications with `pushed_at IS NULL` (newer than 1 hour; older ones are marked
  without sending), sends to each subscription of that user, sets `pushed_at`; a 404/410 from the push
  service deletes the subscription; other failures count up and are retried on the next tick until the
  notification is an hour old.
- `push` module (`@/modules/push`): `isConfigured()`, `publicKey()`, `subscribe({ user, subscription,
userAgent })`, `unsubscribe({ user, endpoint })`, `deleteForUser(userId, trx?)` (deactivation),
  `sendPending()` (worker).
- API: `POST /api/push/subscriptions` and `DELETE /api/push/subscriptions` (signed_in).
- Client: `public/sw.js` handles `push` (show notification with title, body, icon, `tag` per
  notification, `data.url`) and `notificationclick` (focus a Daybook window and open the link, or open
  a new one); the service worker registers in development too. The bell dropdown gets "Show on this
  computer" (permission + subscribe / unsubscribe); signing out removes this browser's subscription.
