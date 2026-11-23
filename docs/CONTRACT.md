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
  "8h 30m" (`formatHours`, the same text as `formatDuration` since CONTRACT 16).
- No `new Date()` / `Date.now()` in modules or components: use `now()`, `nowDate()`, `workDate(tz)`
  from `@/lib/time`. The company time zone is `settings.timezone`.
- Prettier: 100 columns, single quotes, semicolons. Functions under ~50 lines, files under ~300.

## 4. Modules, repos, services

Each module in `src/modules/<name>/` has `repo.js` (the only file with Knex queries), `service.js`
(rules, transactions, events), `schemas.js` (zod, one per endpoint body or query) and `index.js`
(`export const <name> = service;` — other code imports only from the index, e.g.
`import { attendance } from '@/modules/attendance'`). Services call their own repo and other
modules' **services**, never other repos. Exception: `modules/dashboard/repo.js` runs read-only
aggregate queries across tables (one query per widget) — dashboards are read models. The same goes
for `modules/aiSummaries/repo.js` and `modules/aiAsk/repo.js` (read-only queries that feed Gemini,
CONTRACT 20).

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
slackPostReports, slackRemind, slackUrgentNotify, slackRequestsNotify, activityTrackingEnabled,
activityIdleMinutes, activityRetentionDays, pushEnabled, timersMode, timerAwayMinutes,
timerReminderMinutes, breakAllowanceMinutes }` (sections 11, 14, 15 and 19 to 25 describe the later
  keys; §25 adds halfDayUnderMinutes, shortDayUnderMinutes, leftEarlyGraceMinutes,
  payrollMonthStartDay, hrMorningSummary, hrSummaryAt, hrEveningSummary, checkinReminderMinutes,
  lateAlertDays, slackAttendanceRemind, slackHrSummary; clock values
  `'HH:mm'`; cached in-process ~30 s, cleared on save). Defaults come from `db/seeds/03_settings.js`.
- `update({ user, values, ip })` → saves changed keys, audit `settings.update`, returns `getAll()`.
- `listOfficeNetworks()`, `addOfficeNetwork({ user, name, ipAddress, ip })`,
  `removeOfficeNetwork({ user, id, ip })`, `isOfficeIp(ip)` → boolean.

### notifications (owner: system)

- `notify({ userIds, type, title, body?, link? }, trx?)` — in-app rows (the bell). Always created,
  whatever the Slack settings.
- `listForUser(userId, { limit = 20 })` → `[{ id, type, title, body, link, readAt, createdAt }]`,
  `unreadCount(userId)`, `markAllRead(userId, { ids? })` (only those ids when given, CONTRACT 26),
  `deleteOldRead(before)`; `listAfter(userId, { after, limit = 20 })` → `{ items, more }` and
  `latestId(userId)` for the live check (CONTRACT 26). `notify` needs a type listed in
  `ALERT_TYPES` (`@/modules/notifications/alerts`): unlisted types throw in tests and log a warning
  in production.

### audit (owner: system)

- `log({ actorId, action, entityType, entityId, before?, after?, reason?, ip? }, trx?)`.
- `listForEntities({ entityType, entityIds, actions?, limit? })` and `listForType({ entityType,
since, actions? })` (CONTRACT 25).

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
- `listTrackedForRange({ from, to })` → PublicUser[] with `deactivatedAt` (CONTRACT 25).

### attendance (owner: attendance)

- `AttendanceRow` = `{ id, userId, workDate, checkInAt, checkOutAt, location, officeVerified,
checkInIp, checkOutIp, note, lateMinutes, isWorkingDay, checkoutStatus, source }`.
- `getForUserOnDate(userId, workDate)` → AttendanceRow | null; `listForUserRange(userId, from, to)`;
  `listForDate(workDate)`; `countPendingCorrections()`; `presentMinutes(row, at?)`;
  `markMissingCheckouts()` → `{ marked }` (worker 00:05; honours `autoMarkMissingCheckout`,
  notifies HR).
- Daybook 1.10 (CONTRACT 25): the person's day (`personDay`, `presenceOf`, `dayCounts`,
  `effectiveLateMinutes`, `loadCalendar({ leaveDetail })`, `getDay`, `companyDay`,
  `clearCompanyDayCache`, `lastWorkingDayBefore`, `applyDayRules(scope, trx, write)`,
  `recheckDayRules`), the calendar reads (`listHolidaysBetween`, `nextHoliday`, `listOnLeave`,
  `listUpcomingLeave`, `getMyLeave`), breaks (`saveAwayBreak`, `breakTotalsIn`,
  `noticeOverAllowance`, `lockAwayBreak`, `deleteAwayBreak`, `checkOutAtLeft`, `listAwayBreaks`,
  `listBreakDetails`, `listBreaksForRow`, `changeBreakEnd`, `deleteBreak`), check-outs
  (`listMyMissingCheckouts`, `fixMyMissingCheckout`, `hideMissingCheckoutPrompt`,
  `listMissingCheckouts`, `missingCheckoutsFor`, `fixMissingCheckouts`, `suggestCheckoutTimes`,
  `checkoutEnteredFor`), reminders (`remind`, `listReminders`, `remindKindFor`,
  `sendCheckinReminders`), summaries (`sendHrMorningSummary`, `sendHrEveningSummary`), the month
  (`summarizeRange`, `getMonth`, `exportMonth`, `getPersonMonth`, `getNeedsLook`,
  `clearNeedsLookCache`, `lateCountsFor`, `sendLateAlerts`), holidays and leave writes;
  `requestCorrection(input, trx?)`. AttendanceRow is unchanged: the new attendance columns are
  never in ROW_COLUMNS.

### reports (owner: reports)

- `getDayStatus(userId, workDate)` → `{ reportId, status: 'none' | 'draft' | 'submitted', totalMinutes }`.
- `getSubmittedMinutesByDay(userId, from, to)` → `{ 'YYYY-MM-DD': minutes }`.
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
  (Projects cards "Your hours this month", PM table hours column).
- `getLastReportDateByProject(userId)` → `{ [projectId]: 'YYYY-MM-DD' }` ("Your last update").
- `listSubmittedUserIds(userIds, workDate)`, `listSubmittedDays({ userIds, from, to })` →
  `{ [userId]: string[] }` (CONTRACT 25).

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
- `buildCalendar({ month, attendance, profile, ctx, range?, toneOf? })` (CONTRACT 25).

### timers (owner: timers)

- Section 15 "Module APIs" has the module. CONTRACT 25 adds `lastRanByUser({ workDate, userIds })`
  → `Map<userId, Date | null>` (the last finished entry of that date per person, one query),
  `listEntriesFor(userId, workDate)`, `putBackAway({ user, breakId })`, and the `getState` (`away`
  for every one of today's timer entries, `removed`) and `resolveAway` (`decision: 'left'`,
  `answer`) additions.

### activity (owner: activity)

- Section 11 has the module. CONTRACT 25 adds `anyoneSeenBetween({ workDate, from, to,
exceptUserId })` → boolean.

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

Later sections add: activity → `activity/*` (11), dashboards → `projects/[id]/report*` (12),
projects → `projects/[id]/tasks`, `project-tasks/*` (13), system → `push/subscriptions` (14),
timers → `timers/*` and attendance → `attendance/break/start`, `attendance/break/end` (15),
projects → `projects/[id]/phase`, `deadline`, `phases/[phase]/dates`, `documents`,
`project-documents/*` and ai → `ai/projects/[id]/summary*` (22), reports → `me/todo/**`,
`me/carry-suggestions/**` (24), timers → `timers/away/[breakId]/put-back` and attendance →
`attendance/[id]/breaks/**`, `attendance/me/missing-checkouts/**`,
`attendance/missing-checkouts/fix`, `attendance/reminders`, `attendance/month/**`,
`attendance/people/**`, `attendance/needs-look`, `holidays/**`, `leave/**` (25).

Downloads ("Download Excel" buttons) — each screen uses an endpoint its viewers are allowed to call:
Team dashboard and Employee detail → `GET /api/exports/hours?from=&to=&userId=` (`export.hours`,
dashboards); My log → `GET /api/me/log?month=YYYY-MM&format=xlsx` (`report.self`, own data only,
reports); Attendance → `GET /api/attendance/export?date=YYYY-MM-DD` (`attendance.view_all`,
attendance); Attendance month → `GET /api/attendance/month/export?month=YYYY-MM&userId=`
(`attendance.correct`, attendance). All use `xlsxResponse` from `@/lib/excel`.

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
'violet' | 'red' | 'teal', trailing?: element, as?, href? }` (number card with an 8 px bar).
  `trailing` sits at the top right, level with the label (the label gets right padding); `as` and
  `href` pass through, so `<Kpi as={Link} href="/requests" ...>` makes the whole card the link
  (CONTRACT 23). An empty spacer before the footer grows (`flex: 1 0 0`), so in a grid row every
  bar sits at the card's bottom (CONTRACT 25; a spacer, not a wrapper, so the pages' `.kpi > p`
  child rules keep working).
- `StatTile` — `{ value, label }` (the grey boxes in Today's "Your day").
- `StatusCell` from `@/components/StatusCell` — `{ status, label?, size: 'cell' | 'pill' = 'cell',
chevron?: boolean, as?: 'div' | 'button', ...rest }`. Status → fill: green (done, submitted,
  approved, created, active, connected), primary (in_progress, office), red (blocked, missing),
  marigold (urgent, pending, edit_requested, unverified), violet (wfh, edited), line/ink-2 (locked,
  on_hold, declined, not_checked_in, deactivated, completed, draft), teal (on_leave), green
  (holiday), neutral (day_off) (CONTRACT 25). Default labels: 'Done',
  'In progress', 'Blocked', 'Submitted', 'Approved', 'Created', 'Active', 'Connected', 'Office',
  'Missing', 'Urgent', 'Pending', 'Edit requested', 'Unverified', 'WFH', 'Edited', 'Locked',
  'On hold', 'Declined', 'Not checked in', 'Deactivated', 'Completed', 'Draft', 'On leave',
  'Holiday', 'Day off'. `cell` = 34 px high,
  8 px radius, 13 px semibold, fills its column; `pill` = the smaller badge on cards/lists.
  Also exports `STATUS_LABELS`.
- `Tag` — `{ tone: 'primary' | 'marigold' | 'green' | 'red' | 'violet' | 'teal' | 'neutral' | 'ink',
size: 'sm' | 'md', children }` — soft pills ("Today", "WFH", "Late 38m", "Carried over",
  "Report edit", role labels; `ink` = solid navy "Admin").
- `ProjectLabel` — `{ project: { name, color }, size: 'sm' | 'md' | 'lg', as?, chevron?, ...rest }`
  (26 px, 6 px radius, soft background + dark text of the project colour; its own colour style is
  merged with the caller's `style`). `ProjectSquare` — `{ project, size = 40 }` (the letter square).
  A project `color` is a preset (`blue`, `green`, `violet`, `orange`, `teal`, `pink`, `yellow`) or a
  custom lowercase `#rrggbb`, shown through `--project` (`projectColorStyle` in
  `@/lib/projectColors`); anything else shows blue (CONTRACT 23).
- `Avatar` — `{ user: { name, initials?, avatarUrl?, role?, status? }, size = 34, tone? }`; tone
  defaults to `avatarTone(user)`; tones: blue, violet, green, teal, orange, red, pink, navy, ink,
  grey. `AvatarStack` — `{ users, max = 4, size = 30 }`.
- `ProgressBar` — `{ percent, color, height = 8 }` (colour = a tone or a project colour, a custom
  `#rrggbb` included).
- `Legend` — `{ items: [{ label, color, value? }], layout: 'list' | 'inline' }`. Its colours, and
  those of `DayBar`, `HBarList`, `WeekBars` and `Donut`, go through `resolveColor`
  (`chartColors.js`): a tone, a project preset, a `var(--token)` or a custom `#rrggbb`; anything
  else gets the fallback.
- `Field` — `{ label, htmlFor, help?, error?, children }`; `Input`, `Select` (`{ options: [{ value,
label }] }` or children), `Textarea` — 44 px, 10 px radius, 1 px `--line-strong`; pass `error` for
  the red state. `Toggle` (client) — `{ checked, onChange, label?, help?, disabled?, name? }`.
- `FilterPills` (client when `onChange` is used) — `{ items: [{ value, label, href? }], value,
onChange? }`: 36 px fully rounded; selected = `--ink` with white text. `Segmented` — same props,
  grey track with a white selected thumb (Week/Month). Both render links when items have `href`.
  An item may set `disabled` (CONTRACT 25): the button is disabled, a link item renders as a span
  with aria-disabled.
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
  links to its screen; it follows the live check through `useLiveNotifications()`, CONTRACT 26).
  `search` renders `GlobalSearch` (people via `/api/users?q=`, projects via `/api/projects?q=`).
- `Drawer` (client) — `{ open, onClose, title, footer?, children, width = 460 }`, overlay
  `var(--overlay)`, focus trap, Escape closes, focus returns to the opener.
- `Dialog` (client) — `{ open, onClose, title, description?, footer?, children }`.
- `ToastProvider` + `useToast()` (client) — `toast({ title, body?, tone: 'success' | 'error' })`;
  the provider is mounted in the app shell. `useToastSlot()` returns the element under the app
  toasts where a component portals its own toast (the bell's Undo, CONTRACT 20), so they stack
  instead of covering each other.
- `LiveNotifications` (client, mounted once in AppFrame around AppShell) — `{ userId, latestId, tz,
push, children }`: the live check, the preview cards ("New notifications" region, at most 3, 2 on
  a phone, z-index 65) and the chime (CONTRACT 26); `useLiveNotifications()` returns its store, or
  null outside it.
- `NotificationUndo` (client, used by `NotificationBell`) — `{ pending, onUndo, onDismiss, onHold,
onLeave }`: "Notification deleted" with Undo for 5 s; the time stops while the pointer or focus
  is on it (`onHold`) and resumes after, at least 2 s; Tab, Shift+Tab or Escape call `onLeave`.
- `Menu` (client) — `{ label (aria), items: [{ label, onSelect, tone?, disabled? }] }` (row "⋯").
- `DataTable` (server-safe, no hooks) — `{ columns: [{ key, header, width?, align?, render?(row) }],
rows, rowKey = 'id', groups?: [{ key, title, tone, count, rows, collapsed?, onToggle?, footer? }],
empty?: node, dense?, stackBelow?: 1024 | 1280 }`: 40 px header on `--surface-muted`, rows ≥ 54 px
  with a 1 px `--track` divider; below 1024 px rows become stacked cards (use `data-label`).
  `stackBelow={1280}` (CONTRACT 25, a table without groups) also makes each row a card from 1024
  to 1279 px: the first cell across the top, the others in four columns, label above value.
- `DayBar` — `{ checkInAt, checkOutAt, now, start, end, tz, variant: 'large' | 'compact', color?,
labels? }` (large = Today's 18 px bar with marks; compact = table bar).
- `HBarList` — `{ rows: [{ label, value, display, color }], max?, barHeight = 12 }`.
- `WeekBars` — `{ days: [{ label, value, display?, max?, highlight?, segments?: [{ value, color }],
faded?, title? }], height }` (Today's "This week" and Overview's stacked "Attendance this week"; a
  day's `title` is its hover text, read out with the label, and `faded` also fades a stacked column,
  CONTRACT 25).
- `Donut` — `{ segments: [{ label, value, color }], centerValue, centerLabel, size = 190 }`.
- `MonthCalendar` — `{ weeks: [[{ date, day, tone: 'office' | 'wfh' | 'late' | 'missing' |
'future' | 'empty' | 'weekend' | 'leave' | 'holiday', isToday }]], legendItems? }` (Mon–Fri
  columns) with its legend; the `leave` (teal) and `holiday` (green) tones and the optional
  `legendItems` (default `CALENDAR_LEGEND`) are CONTRACT 25.

## 9. Pages and ownership

| Owner                                                    | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell                                                    | `src/app/(app)/layout.js`, `(app)/no-access/page.js`, `(app)/error.js`, `(app)/loading.js`, `src/app/not-found.js`, `src/app/(auth)/login/page.js` (+ its client pieces)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| people-admin                                             | `(app)/people/**`, `(app)/settings/**` (Settings and Roles)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| attendance                                               | `(app)/today/**`, `(app)/attendance/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| reports                                                  | `(app)/report/**`, `(app)/log/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| projects                                                 | `(app)/projects/**`, `(app)/requests/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| dashboards                                               | `(app)/team/**`, `(app)/overview/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ai                                                       | `(app)/summaries/**`, `(app)/ask/**`, `api/ai/**` (CONTRACT 20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| preferences                                              | `(app)/my-settings/**`, `api/me/preferences/**`, `src/modules/preferences/**` (CONTRACT 21)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| projects                                                 | `src/modules/projectPlan/**`, `src/modules/projectSummaries/**`, `db/migrations/015_project_plan.js`, `(app)/projects/[id]/**` (CONTRACT 22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| orchestrator                                             | `db/migrations/016_project_color.js`, `src/lib/projectColors.js`, `src/app/globals.css` (yellow tokens), `src/config/version.js` (CONTRACT 23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| dashboards                                               | `src/modules/dashboard/overview.js`, `src/modules/dashboard/requestsCard.js`, `(app)/overview/**`, `(app)/team/UrgentList.jsx` (+ css) (CONTRACT 23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| projects                                                 | `src/modules/projects/{schemas,repo}.js`, `(app)/projects/ColorSwatches.jsx` (+ css) and `ProjectDrawer.jsx`, `(app)/requests/AttendanceFixes.jsx` (CONTRACT 23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| reports                                                  | `(app)/report/ProjectCard.jsx` (`colorVars`), `(app)/report/ProjectPicker.jsx` (+ css) (CONTRACT 23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ui-kit                                                   | `src/components/{Kpi,ProjectSquare,ProjectLabel,ProgressBar,chartColors,GlobalSearch}` (+ css) (CONTRACT 23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| orchestrator                                             | `db/migrations/017_todo.js`, `db/seeds/03_settings.js`, `src/config/version.js`, `db/demo/todo.js`, `tests/e2e/todo.spec.js` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| reports                                                  | `src/modules/reports/{todo,todoRead,todoAdd,todoEdit,todoTimer,todoSlack,todoWrite,todoView,todoRepo}.js`, `api/me/todo/**`, `api/me/carry-suggestions/**` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| reports                                                  | `src/modules/reports/{suggestions,carry,carryRepo,planned,todoText}.js` (+ `schemas`, `drafts`, `save`, `submit`, `timerCheck`, `repo`) (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| reports                                                  | `src/modules/reports/{writeTx,todoSchemas}.js` (the line-writing transaction, the to-do schemas) (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| reports                                                  | `(app)/report/{CarrySuggestions,SuggestionRows,StillOpenDialog,CardCarry,StillOpenReminder}.jsx` (+ css), `useSuggestionClose.jsx` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| reports                                                  | `(app)/report/{useCarrySuggestions,reportCarry,reportPlanned}.js`, `ProjectCard.jsx`, `ProjectPicker.jsx` (+ css), `ReportEditor.jsx` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| attendance                                               | `(app)/today/{TodoProvider,TodoCard,TodoHeader,TodoGroup,TodoLine,TodoAddInput,TodoPasteDialog,TimerNoteField,TimerNow}.jsx` (+ css) (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| attendance                                               | `(app)/today/{useTodoState,todoModel,todoPaste,todayTodo,todayData}.js`, `page.js`, `TodayCards.jsx`, `PriorityCard.jsx`, `TimerStartForm.jsx` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| attendance                                               | `(app)/today/{todoSync,todoActions,useTodoSync,useSendBeforeLeave}.js` (the to-do's state, its writes, leaving with a delete waiting) (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| dashboards                                               | `src/modules/dashboard/{todo,todoRepo,todoColumns}.js` (+ `team`, `employee`, `repo`), `(app)/team/{TodoPopover,TodoList}.jsx` (+ css) (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| system                                                   | `src/modules/slack/{todo,todoDelivery,enqueue}.js` (+ `format`, `service`, `outbox`, `schemas`, `repo`), `src/modules/settings/schemas.js` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| people-admin                                             | `(app)/settings/SlackSection.jsx` ("Post to-dos to"), `settingsValues.js` (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| preferences                                              | `(app)/my-settings/MySettingsSections.jsx`, `src/modules/preferences/schemas.js` (the `carryOver` label) (CONTRACT 24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| orchestrator                                             | `db/migrations/018_hr_tools.js` and `db/lib/removedSpans018.js` (the proposals in `scratch/design-1.10`), `db/seeds/03_settings.js` (11 keys, `settings-additions.js`), `src/config/version.js` ('1.10'), `src/lib/time.js` (`holidays` argument) and `tests/unit/time.test.js`, `src/lib/permissions.js` (`attendance.correct` text "Edit attendance, handle correction requests, mark leave and holidays"), `timers.lastRanByUser` (in `src/modules/timers/worker.js` and the `service.js` re-export; B owns both files afterwards), `tests/unit/migration018Away.test.js`, `docs/design/hr-tools-prototype.html`, `.github/workflows/migration-check.yml` (new: a `mysql:8.4` service container runs migrate up, down for 018, up, and `tests/services/migration018.test.js`; never touches the deploy branch, no npm dependency) (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| orchestrator                                             | `src/worker/cron.js` and `src/worker/index.js` (register `checkin-reminders`, `hr-summary`, `hr-evening-summary`, `late-alerts` in `MINUTE_JOBS` before `cleanupJob`, none in `SLOW_JOBS`; `closeOpenTimersJob` before `markMissingCheckoutsJob`), `README.md` ("Deployment notes" bullet and the 1.10 "Updating" steps below), `scripts/doctor.js` (a "Database" line from `db.migrate.list()`: "✓ Database is up to date" or "✗ 1 database update not run: 018_hr_tools.js. Run the migrate line in README Updating."), `db/demo/*` (a holiday, leave, an away break, a missing check-out with a reminder, a self-entered check-out past last seen, a person at 4 late days and a short day), `tests/e2e/{breaks,missing-checkout,attendance-month,holidays-leave}.spec.js`, `tests/services/migration018.test.js` (+ `migration018Kit.js`, `migration018World.js`), `docs/CONTRACT.md` (this section and the edits listed after Tests) (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| attendance                                               | `src/modules/attendance/{migration018,calendar,calendarReads,calendarRepo,dayRules,marks,payroll,dayExport,checkoutEntered,myToday,tellPerson,leaveReads}.js` (new), `day.js`, `rules.js`, `schemas.js` (`FILTERS`), `index.js` (+ the five barrel stubs), `service.js` (`checkIn`, `getMyToday` through `myToday.js`, `notifyMissing` body and link), `hr.js` (`getDay`, entered-by rule, `tellPerson` moved out), `decisions.js` (`getDay`, `clearCheckoutEntered`); `src/worker/clock.js` (`companyDay`); `api/attendance/route.js` (`lateCount`); `(app)/attendance/DayCells.jsx` (new), `{dayRows,rowActions}.js` (new), `AttendanceCards.jsx`, `attendanceData.js`, `page.js`, `page.module.css`, `loading.js` (+ css); `(app)/today/page.js` (`searchParams`, placing B, C and F's pieces), `todayData.js`, `page.module.css` (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| attendance, timers, activity, shell                      | `src/modules/attendance/{awayBreaks,breakFixes,breakView,breakRepo,breakSchemas,leftAt,breakExports}.js`, `breaks.js` (`breakTotalsIn`, `noticeOverAllowance`); `api/attendance/[id]/breaks/route.js`, `api/attendance/[id]/breaks/[breakId]/route.js`; `(app)/attendance/{BreaksButton,BreakListDialog,BreakListHost,BreakFixForm}.jsx` + `BreakListDialog.module.css`; `(app)/today/TimerRemovedRow.jsx` (new), `TimerEntries.jsx` (+ css), `TimerCard.jsx`, `timerData.js`, `useTimerActions.js`; `src/modules/timers/{awayRules,awayAnswer,awayPutBack}.js` (new), `away.js`, `rules.js` (re-exports), `state.js`, `shared.js`, `entries.js`, `schemas.js`, `service.js`, `worker.js` (`sendReminders` gate), `repo.js`; `api/timers/away/route.js`, `api/timers/away/[breakId]/put-back/route.js`; `src/modules/activity/{service,repo}.js` (`anyoneSeenBetween` only); `src/components/TimerAwayDialog.jsx` (+ css), `TimerChip.jsx`, `TimerChip.clock.js` (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| attendance                                               | `src/modules/attendance/{missingSelf,missingHr,missingRepo,missingRules,missingSchemas,checkoutSuggest,checkoutExports}.js`, `corrections.js` (optional `trx`); `api/attendance/me/missing-checkouts/[id]/fix/route.js`, `api/attendance/me/missing-checkouts/hide/route.js`, `api/attendance/missing-checkouts/fix/route.js`; `(app)/attendance/MissingCard.jsx` (+ css), `RowAction.jsx` (suggested prefill), `(app)/attendance/missing/{page,loading,missingData}.js`, `(app)/attendance/missing/{MissingTable,MissingFixDialog,missingCells}.jsx` (+ css); `(app)/today/{MissingCheckoutPrompt,MissingCheckoutDialog}.jsx` (+ css), `todayMissing.js` (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| attendance, system                                       | `src/modules/attendance/{reminders,reminderRepo,remindRules,reminderMessages,checkinReminders,hrSummary,hrSummaryData,hrSummaryText,hrSummaryRepo,reminderExports}.js`; `api/attendance/reminders/route.js`; `(app)/attendance/{ReminderNote,RemindAllButton,RemindSelectedButton}.jsx` (+ css), `{useRemind,remindItem,remindData}.js`; `src/worker/jobs/{checkinReminders,hrSummary,hrEveningSummary}.js` (new), `cleanup.js` (`oldReminders`) (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| attendance, system                                       | `src/modules/attendance/{monthRules,monthRepo,month,monthExport,personMonth,personChanges,needsLook,lateAlerts,monthSchemas,monthExports}.js`; `api/attendance/month/route.js`, `api/attendance/month/export/route.js`, `api/attendance/people/[userId]/month/route.js`, `api/attendance/needs-look/route.js`; `(app)/attendance/month/**`, `(app)/attendance/people/[userId]/**`, `(app)/attendance/NeedsLookCard.jsx` (+ css); `src/worker/jobs/lateAlerts.js` (new) (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| attendance                                               | `src/modules/attendance/{holidays,leave,leaveRules,calendarSchemas,calendarWriteRepo,calendarExports}.js` and `{holidayRules,holidayNotices,calendarEffects,leaveList,leavePreview}.js` (split out to stay under 300 lines); `api/holidays/route.js`, `api/holidays/[id]/route.js`, `api/leave/route.js`, `api/leave/[id]/route.js`, `api/leave/preview/route.js`, `api/leave/people/route.js`, `api/holidays/calendarRoute.js` (the shared rate limits and `:id`, not a route); `(app)/attendance/holidays/{page,loading,holidaysData}.js`, `(app)/attendance/holidays/{HolidayTable,HolidayDialog,HolidayDeleteDialog}.jsx` (+ css); `(app)/attendance/leave/{page,loading,leaveData}.js`, `(app)/attendance/leave/{LeaveTable,LeaveFilter}.jsx` (+ css); `(app)/attendance/{LeaveDialog,LeaveFields,LeaveDeleteDialog,LeaveCard,DayNotice,RowMenu}.jsx` (+ css), `{leaveForm,useLeavePreview}.js`; `(app)/today/TodayDayNotice.jsx` (new), `todayDay.js` (new: notices, week labels, "coming up" lines), `CheckInCard.jsx` (subtitle), `todayWfh.js`, `wfhOptions.js` (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| system, people-admin, reports, ui-kit, shell, dashboards | `src/modules/settings/{schemas,service}.js` (+ `crossChecks.js`, `officeNetworks.js`, `parse.js`, split out to stay under 300 lines; 11 keys, `checkHrSummary`, `checkDayMarks`, `CLOCK_KEYS`, `BOUNDED_KEYS`, `getAll` JSDoc); `src/modules/audit/{service,repo}.js` (`listForEntities`); `src/modules/users/{service,repo}.js` (`listTrackedForRange`); `src/modules/reports/{service,repo}.js` (export `listSubmittedUserIds`, new `listSubmittedDays`); `(app)/settings/{AttendanceMarksSection,HrUpdatesSection}.jsx` (new, + `HrUpdatesSection.module.css`), `(app)/settings/{SettingsForm,SettingsNav,SlackSection,TimersSection}.jsx` (two Slack switches, the timers help), `(app)/settings/{settingsValues,numberFields,page}.js` (`KEYS`, `HR_CLOCKS.hrSummaryAt` (not `CLOCKS`, whose keys `autoCheckoutSettings.test.js` pins), `SHOWN_WITH`, `NUMBERS`), `loading.js` (two more nav skeleton widths); `src/components/StatusCell.jsx` (+ css: `on_leave` "On leave" teal, `holiday` "Holiday" green, `day_off` "Day off" neutral), `Segmented.jsx` (+ css: an optional `disabled` per item; a button gets `disabled`, a link item renders as a span with `aria-disabled`, text `--muted` at 50%, no hover), `Kpi.jsx` (+ css: an empty spacer `span` with `flex: 1 0 0` before the footer, so in a grid row every bar sits at the card's bottom 8 px under the tallest content; a wrapper `div` would break the `.kpi > p:nth-child(2)` rules of `team/page.module.css` and `projects/[id]/HoursTab.module.css`; cards of equal height look as today), `MonthCalendar.jsx` (+ css: tones `leave` teal and `holiday` green, dots for both, optional `legendItems` prop, default `CALENDAR_LEGEND`); `src/modules/dashboard/{calendar,index}.js` (`buildCalendar` gains `range` and `toneOf`, `dayTone` takes `day` and answers `holiday` and `leave`, `dashboard.buildCalendar` exported) (CONTRACT 25) |
| dashboards, reports, ai, activity                        | `src/modules/dashboard/{team,shared,overview,history,employee,service}.js` and new `{teamBoard,overviewWeek,employeeTasks}.js` (split out to stay under 300 lines), `repo.js` (`listCheckInsBetween(from, to)` replaces `countAttendanceByDay`; `listTrackedPeopleDay` adds the shift); `src/components/WeekBars.jsx` (+ css: a day's `title`, `faded` on a stacked column), `(app)/overview/page.js` (the Off legend item when `attendanceWeek.hasOff`), `src/modules/reports/logExport.js` (Day type and Leave columns); `(app)/team/**` except `[userId]/screenTime.js` (Off today group and tags, history Where and Report cells); `src/modules/reports/{monthLog,queries}.js` (My log, stuck tasks skip holidays); `(app)/log/**` except `screenTime.js` (status cells, KPI words, Day type and Leave columns); `src/modules/aiSummaries/{hrNotes,calendar}.js`, `src/modules/aiAsk/{attendance,prompt}.js`, `src/worker/jobs/aiHrNotes.js` (runs on or after the week's last working day, holidays skipped, within that ISO week); `(app)/screen-time/screenTimeView.js`, `(app)/log/screenTime.js`, `(app)/team/[userId]/screenTime.js` (no bar for a holiday without data) (CONTRACT 25)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| orchestrator                                             | `docs/design/bell-preview-prototype.html` (first), `src/config/version.js` ('1.11'), `README.md` (the 1.11 "Deployment notes" and "Updating" lines), `docs/CONTRACT.md` (section 26 and its "Other section edits") (CONTRACT 26)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| system, preferences, shell                               | `src/modules/notifications/alerts.js` (new), `src/modules/notifications/{repo,service,schemas,index}.js`; `src/app/api/notifications/route.js`, `src/app/api/notifications/read-all/route.js`; `src/modules/push/{payload,service}.js`; `public/sw.js`; `src/modules/preferences/{schemas,service}.js`; `src/components/UserPrefs.jsx`; `tests/unit/{notificationAlerts,serviceWorker}.test.js` (new), `tests/unit/push.test.js`; `tests/services/notificationsLive.test.js` (new), `tests/services/{notifications,notificationsCenter,push,preferences,preferencesRoute}.test.js` (CONTRACT 26)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| shell                                                    | `src/components/live/{LiveNotifications,LiveCards,PreviewStack,PreviewCard}.jsx` and `PreviewStack.module.css` (new), `src/components/live/{liveStore,liveRules,liveCheck,liveBatch,liveLeader,liveLoop,livePresence,liveTab,liveSound,liveChannel,swAnswer,pushActive,chime,chimeGate,previewWait,useLiveEngine,useStack,usePreviewActions}.js` (new); `src/components/AppFrame.jsx`; `src/components/NotificationBell.jsx` (also exports `BellIcon`), `NotificationBell.actions.js`, `NotificationBell.list.js` (`itemTime`), `NotificationBell.live.js` (new), `NotificationItem.jsx` (uses `itemTime`); `tests/unit/{liveRules,liveBatch,liveLeader,liveChime,liveRecovery,liveStack,livePlacement,appFrameLive}.test.js` (new), `tests/helpers/liveFakes.js` (new), `tests/unit/notificationCenter.test.js` (merge of new items) (CONTRACT 26)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| preferences, orchestrator                                | `src/app/(app)/my-settings/{MySettingsSections.jsx,sections.js,page.module.css,PreferencesProvider.jsx,loading.js,loading.module.css}`, `PlaySoundButton.jsx` (new); `tests/unit/mySettings.test.js`; `tests/e2e/live-notifications.spec.js` (new), `tests/e2e/my-settings.spec.js`, `tests/e2e/support/live.js` (new), `tests/e2e/support/demoData.js` (`addNotification`) (CONTRACT 26)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Every page starts with `const user = await requirePage('<permission>')`, renders `<TopBar ... />`
then its blocks, has a loading skeleton (`loading.js`) and empty states. Page permissions:
/today `attendance.self`, /report and /log `report.self`, /projects `project.request`
(`project.manage` holders see the PM view), /team `team.view`, /requests
`project_request.handle`, /attendance `attendance.view_all`, /attendance/missing and
/attendance/holidays `attendance.view_all`, /attendance/month, /attendance/people/[userId] and
/attendance/leave `attendance.correct` (CONTRACT 25), /people `people.manage`, /overview
`overview.view`, /settings `settings.manage`, /settings/roles `roles.manage`, /my-settings any
signed-in person (`requireUser()`).

## 10. Tests

- Unit and service tests: Vitest, `tests/unit/*.test.js` and `tests/services/<module>.test.js`.
  Service tests call `resetDatabase()` from `tests/helpers/db.js` in `beforeAll` and build their own
  data (`createUser`, `setSettings`). Pin time with `setNowForTests('2026-09-30T04:00:00Z')`.
- Each agent runs tests against **its own** database so parallel runs don't collide:
  `DB_NAME=daybook_test_<n> npx vitest run tests/services/<module>.test.js` (databases
  `daybook_test_1` … `daybook_test_8` exist; your prompt says which number is yours).
- Migration checks that need MySQL 8.4 run in `.github/workflows/migration-check.yml` (a mysql:8.4
  service container; CONTRACT 25).
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
- The away question (CONTRACT 25 A) also reads no-data gaps: more than 150 s between two `system`
  segments, asked about only when someone else's screen time was recorded during it (more than
  150 s from its ends, so a Daybook outage is never asked about). HR never sees
  segments, only one suggested check-out time (CONTRACT 25 Words).

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
browser's Web Push), even when the Daybook window is minimised, except while a Daybook window is in
front and shows its own preview card (never on Safari; CONTRACT 26). Each person turns it on per
browser from the bell; Admin can switch it off for everyone (`settings.pushEnabled`, default true).

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
- Client: `public/sw.js` handles `push`: it asks every Daybook window first (at most 1 s); when a
  window in front answers that it shows the notification, no system notification is shown (not for
  Apple endpoints, `mustShow`); otherwise it shows it (title, body, icon, `tag` per notification,
  `data.url`), `silent` when this browser already alerted the person or a window in front has Sound
  Off, never for Apple endpoints (CONTRACT 26). Payload `{ id, userId, title, body, url,
mustShow? }`. It also handles `notificationclick` (focus a Daybook window and open the link, or
  open a new one); the service worker registers in development too. The bell dropdown gets "Show on
  this computer" (permission + subscribe / unsubscribe); signing out removes this browser's
  subscription.

## 15. Project timers and breaks (added after the build guide)

Instead of typing hours, a person can run a **timer** per project: pick a project (optionally a
priority task and a short note) and press Start. One timer runs at a time; starting another stops
the first. At report time the daily report is **filled from the timers** (hours per project rounded
to the nearest 15 minutes, task lines from the notes); the person reviews and submits as before.
**Breaks**: Start break / End break on Today. A break pauses the running timer, and **worked time**
= present time minus breaks; the gap warning compares worked time with logged hours. Settings:
`timersMode` off | optional | required (default optional), `timerAwayMinutes` (25),
`timerReminderMinutes` (25, 0 = never), `breakAllowanceMinutes` (60, 0 = no allowance).

**Who.** Timers and breaks are for people who check in and write reports: active, tracked
(`tracksAttendance`), with `attendance.self` and `report.self` (employee, HR, tracked Admin; never
PMs). Everything is about the person's **own** data; PMs and Admin see live status on the Team
board, HR sees breaks on Attendance.

### Data (migration 009)

- `time_entries`: `user_id`, `work_date` (company date of `started_at`), `project_id` (active
  project when started; real projects only, never project requests), `project_task_id` (nullable,
  SET NULL), `note` (≤200, nullable), `started_at`, `ended_at` (NULL = running), `source` timer |
  manual, `stop_reason` stopped | switched | break | checkout | midnight | away (NULL while
  running), `away_checked_until` (away prompts already answered up to here), timestamps.
  Generated `running_user_id` (= user_id while `ended_at` IS NULL) is UNIQUE: at most one running
  timer per person — an insert that breaks it fails with errno 1062.
- `attendance_breaks`: `user_id`, `attendance_id` (CASCADE), `work_date`, `started_at`, `ended_at`
  (NULL = on break), `end_reason` self | checkout | timer | midnight | away | hr, `source` self |
  away, `away_entry_id` (SET NULL), `changed_by_id`, `changed_at` (CONTRACT 25; never in
  BREAK_COLUMNS), `paused_entry_id` (the timer
  the break stopped, SET NULL), timestamps. Generated `open_user_id` UNIQUE: one open break per
  person.
- Never insert or update the generated columns. Entries are unbroken stretches: pausing, switching
  and "remove away time" end a row and start a new one; since CONTRACT 25 a Remove also saves the
  removed time as an away break.

### Rules

- **Minutes** of an entry = `minutesBetween(startedAt, endedAt ?? now())`. Report minutes per
  project = the exact whole-minute sum (`roundedMinutes` keeps its name; no 15-minute rounding
  since CONTRACT 18).
- **Start** (`timers.start`): timers not `off` (else `TIMERS_OFF`); today's attendance row open
  (`NOT_CHECKED_IN` / `ALREADY_CHECKED_OUT` otherwise); project active (`PROJECT_NOT_ACTIVE`,
  message "Only active projects can be timed."); `projectTaskId` must be an open task of that
  project that `projectTasks.findOpenForPicker({ userId, projectId })` returns (else
  `VALIDATION_FAILED` on `projectTaskId`); note trimmed, '' → null. One transaction: lock the
  running entry; if on a break, end it (`end_reason 'timer'`, no resume); if a timer runs with the
  same project, task and note, return the state unchanged (double click); otherwise stop it
  (`switched`) at the same moment and insert the new entry. errno 1062 → `CONFLICT` ("Another
  timer just started. Refresh to see it.").
- **Stop**: ends the running entry (`stopped`); with nothing running it just returns the state.
- **Break start** (`attendance.startBreak`): today's row open, not already on a break
  (`ALREADY_ON_BREAK`, also for errno 1062). One transaction: lock the attendance row, stop a
  running timer (`timers.stopRunning({ userId, at, reason: 'break' }, trx)`), insert the break
  with `pausedEntryId`.
- **Break end** (`attendance.endBreak`): `NOT_ON_BREAK` without an open break. Ends it (`self`);
  if it paused a timer and no timer runs now, `timers.resumeAfterBreak({ userId, entryId, at },
trx)` starts a new entry with the same project, task and note (skipped when that project is no
  longer active). Inside the transaction it works out whether this break took today's total over
  the allowance (`breakTotalsIn`, CONTRACT 25); after commit, if it did and
  `breakAllowanceMinutes > 0`, notify the person once, as a Remove does
  (`attendance.break_over_allowance`, "Your breaks today are over the 1h allowance" (hours and
  minutes, see 16), body "You've had 1h 15m of breaks today.", link `/today`).
- **Check-out** (`attendance.checkOut`) becomes one transaction: close the row, end an open break
  (`checkout`, at the check-out time) and stop a running timer (`checkout`). The response adds
  `breakMinutes` and `workedMinutes`; `gapMinutes = |workedMinutes − loggedMinutes|`.
- **Worked minutes** (pure, `attendance/rules.js`): `breakMinutesWithin(breaks, row, at, tz)` =
  total overlap of each break `[startedAt, endedAt ?? at]` with the present window `[checkInAt,
checkOutAt ?? at]` (capped like `presentMinutes`); `workedMinutes(row, breaks, at, tz) =
max(0, presentMinutes − breakMinutesWithin)`. A missing check-out counts 0. HR's
  check-in and check-out edits and corrections never touch breaks (the overlap clips them). HR and
  Admins may change a break's end or delete it, with a reason (CONTRACT 25 item 2).
- **Away time**: see CONTRACT 25 A: every one of today's timer entries is asked about, no-data
  gaps count for Idle Detection, Remove saves an away break, an away span after the day end offers
  "I had left", and Today has Put back.
- **Changing entries**: only the person's own entries of **today** (company date), else
  `BAD_REQUEST` "Only today's timers can be changed." Times are `'HH:mm'` clocks on the work date
  (`localToUtc`); start < end, end ≤ now, no overlap (to the minute) with the person's other entries or breaks
  (`VALIDATION_FAILED` on `startClock` / `endClock`), ≥ 1 minute. A running entry can change its
  project, task, note and start, not its end. Manual adds have `source 'manual'`. Audit
  `time_entry.create` / `time_entry.update` / `time_entry.delete` (manual changes only; start and
  stop are not audited).
- **Locks and races**: every write that touches attendance, breaks or timers locks in one order:
  the attendance row by primary key (`attendance.lockDay`), then the open break, then the running
  timer; these transactions run at READ COMMITTED and retry a deadlock up to 3 times, then
  `CONFLICT` ("Something else changed at the same moment. Try again."). A timer still running from
  an earlier day is first closed by the midnight rule (on start, stop, break or check-out;
  `stopRunning` then returns null). `onBreak` counts only today's break. `resumeAfterBreak` does
  nothing when timers are off, the person can no longer use timers or today's row is closed. Stop
  works even when timers are off. Removing away time that starts in the timer's first minute moves
  its start instead. Today's entries stay editable after check-out. Remove locks the attendance
  row of the timer's own date, then the entry by id; a break fix locks the attendance row by
  primary key, then the break; holiday and leave day rules lock the changed rows in work_date,
  user_id order (CONTRACT 25).
- **Midnight** (worker `close-open-timers`, once per date after 00:05): entries still running from
  an earlier date end at the check-out time if the row has one, else at the person's last
  screen-time `lastActiveAt` that day if it is after the start, else at the start; never after the
  end of the work date; `midnight`. The person is notified (`timer.stopped_midnight`, "Your timer
  on acme-app was still running", body "We stopped it at 6:42 PM, the last time Daybook saw you
  active. Check your report before it locks.", link `/report?date=YYYY-MM-DD`). Breaks still open
  from an earlier date end at the row's check-out if it has one, else at their own start
  (`midnight`).
- **Reminder** (worker `timer-reminders`, every minute, whenever timers are not off (CONTRACT 19), a reminder time above
  zero, working day, between `officeStart` and `officeEnd`): a tracked person with an open row, not
  on a break, no running timer, whose last entry ended (or who checked in) at least
  `timerReminderMinutes` ago and who had no `timer.reminder` in the last 60 minutes gets one ("No
  timer is running", body "Start a timer for what you're working on.", link `/today`).
- **Required mode** (report submit, `reports` module): applies when the day has at least one time
  entry or the report's day is today or later. Every project entry's minutes must match the
  timer minutes of that project within 2 minutes (`entries.N.hours`: "Hours come from your timers
  (4h 15m)." or
  "No timer time on this project today. Remove it or add time on Today."), and every project with
  more than 2 timer minutes must be in the report (`total`: "acme-app has 1h 30m on your timers.
  Fill the report from timers."). Entries for pending project requests are exempt, and so is anyone who can't use timers (`timers.canUse`). In optional
  mode the report is never checked against timers.

### Module APIs

- `timers` (`@/modules/timers`, owner: timers; `export const timers = service`, no spread):
  - `EntryView` = `{ id, projectId, projectName, projectColor, isUrgent, projectTaskId, priority,
projectTaskTitle, note, startedAt, endedAt, minutes, source, stopReason, startClock, endClock }`
    (ISO strings; clocks `'HH:mm'` in company time, `endClock` null while running).
  - `getState({ user })` → `{ mode, canUse, blocked: null | 'off' | 'not_checked_in' |
'checked_out' | 'not_allowed', running: EntryView | null, onBreak, breakStartedAt, entries:
EntryView[] (today, oldest first), totalMinutes, byProject: [{ projectId, projectName,
projectColor, minutes }], away: { entryId, from, to, minutes, fromClock, toClock, projectName }
| null, serverNow }` — never throws for a signed-in person.
  - `start({ user, projectId, projectTaskId?, note? })`, `stop({ user })`,
    `addEntry({ user, input })`, `updateEntry({ user, id, input })`, `removeEntry({ user, id })`,
    `resolveAway({ user, entryId, from, to, decision })` → all return `getState`.
  - `canUse(user)` → boolean (who may use timers at all).
  - `stopRunning({ userId, at, reason }, trx)` → stopped EntryView | null;
    `resumeAfterBreak({ userId, entryId, at }, trx)` → new EntryView | null.
  - `getDaySummary(userId, workDate)` → `{ totalMinutes, projects: [{ projectId, projectName,
projectColor, isUrgent, minutes, roundedMinutes, tasks: [{ note, projectTaskId, priority,
projectTaskTitle }] }] }` (biggest first; tasks de-duplicated by priority task, else by
    case-insensitive note; an entry with only a priority task gives a line titled with the task; a priority task that is no
    longer open keeps its text but loses the link).
  - Worker: `closeForgotten(today)` → `{ closed }`, `sendReminders(today)` → `{ reminded }`.
  - `stopAllRunning({ at, reason })` → `{ stopped }` (`settings.update` calls it after timersMode
    changes to off; a failure only logs a warning).
- `attendance` additions (owner: attendance, file `attendance/breaks.js`):
  - `BreakRow` = `{ id, userId, attendanceId, workDate, startedAt, endedAt, endReason,
pausedEntryId }`.
  - `startBreak({ user })` → `{ break: BreakRow, pausedEntryId }`; `endBreak({ user })` →
    `{ break, breakMinutesToday, overAllowanceMinutes }`.
  - `lockDay({ userId, workDate }, trx)` → AttendanceRow | null (locks the row, see Locks);
    `getOpenBreak(userId, trx?)` → BreakRow | null; `endOpenBreak({ userId, at, reason }, trx)` →
    BreakRow | null (no resume; used by timers.start); `listBreaks(userId, workDate)`;
    `listBreaksForDate(workDate)` → BreakRow[]; `closeForgottenBreaks(today)` → `{ closed }`.
  - `getMyToday` adds `breaks`, `openBreak`, `breakMinutes`, `workedMinutes`; `listDay` rows add
    `breakMinutes`, `workedMinutes`, `overAllowanceMinutes`; `exportDay` adds "Breaks (minutes)"
    and "Worked (hours)" after "Present (hours)"; `workedMinutes` and `breakMinutesWithin` are
    exported too.
- `dashboard.getTeamToday` rows add `onBreak`, `breakSince` (ISO | null) and `workingOn: { name,
color, note } | null` (read with one extra query each over `attendance_breaks` / `time_entries`).

### API

| Route                              | Permission      | Body / returns                                                             |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `GET /api/timers/current`          | report.self     | `getState`                                                                 |
| `POST /api/timers/start`           | report.self     | `{ projectId, projectTaskId?, note? }` → state                             |
| `POST /api/timers/stop`            | report.self     | → state                                                                    |
| `POST /api/timers/entries`         | report.self     | `{ projectId, projectTaskId?, note?, startClock, endClock }` → state (201) |
| `PATCH /api/timers/entries/[id]`   | report.self     | `{ projectId?, projectTaskId?, note?, startClock?, endClock? }` → state    |
| `DELETE /api/timers/entries/[id]`  | report.self     | → state                                                                    |
| `POST /api/timers/away`            | report.self     | `{ entryId, from, to, decision: 'keep' or 'remove' }` → state              |
| `POST /api/attendance/break/start` | attendance.self | → `{ break, pausedEntryId }`                                               |
| `POST /api/attendance/break/end`   | attendance.self | → `{ break, breakMinutesToday, overAllowanceMinutes }`                     |
| `GET /api/reports/[id]/timers`     | report.self     | own report only → `{ mode, required, summary }` or null (fresh summary)    |

### Screens

- **Today** (attendance owner): next to Check out, **Start break** (secondary; shown whatever the
  timers mode, since breaks don't depend on timers); on a break the pill
  is marigold "On break since 1:10" and the button is **End break** (primary). The "Your day"
  second tile shows worked time; with breaks its label is "Worked so far · 45m break" ("Worked
  today · …" after check-out), without breaks it stays "Present so far" / "Present today". A
  **Working on** card (`TimerCard`, after the "Your day" row) when timers aren't off and the person
  has checked in today: running → project label, task or note, a ticking `1:24:10`, **Stop** and
  **Switch project**; idle → project picker (the report's `ProjectPicker` with
  `allowRequests={false}`), optional priority task, note ("What are you working on?"), **Start**;
  on a break → "Timer paused for your break"; then today's entries (time range, project, note,
  duration, Edit / Delete) with **Add time**, and "Tracked today 5h 45m". After any change it
  dispatches `window` event `daybook:timers-changed` and `router.refresh()`.
- **Everywhere** (shell): `TimerChip` in the sidebar above the signed-in person, only while a
  timer runs or the person is on a break ("● acme-app 1:24:10 ■"; the name links to `/today`, ■
  stops). It loads `GET /api/timers/current` on mount (only while a timer runs or a break is on), every
  60 s while visible, on `visibilitychange` and on `daybook:timers-changed`; when the state has `away` and the page is
  visible it opens the away Dialog (only the chip shows it). Mounted by `AppFrame` for timer users
  when timers aren't off, or while a timer still runs after Admin turned them off (so it can be
  stopped); `timerStateFor(user)` (React `cache`) shares one `getState` per request with Today.
- **Daily report** (reports owner): when timers aren't off and the report is editable, a "From your
  timers" card lists projects with rounded hours and **Fill report from timers**: merge by project
  (hours become the rounded timer hours; projects with 0 rounded minutes are skipped; missing task
  lines are added with status In progress — matched by priority task, else case-insensitive title,
  else the timer note a line was filled from (`timerNote`, CONTRACT 21 "Timer lines remember their
  note"; a line that says a note by title but has none takes the note first); the lone empty task line of a card is replaced; nothing is removed). Required mode applies exactly where the server checks it (`data.timers.required`, from
  `reports.timersForReport({ user, report })`): project hours are read-only ("From timers"); on a
  draft the hours merge runs on load when they differ and follows fresh summaries
  (`reports.getTimersForReport({ user, reportId })` via `GET /api/reports/[id]/timers`, re-read
  before Fill, before a required-mode submit, when the page comes back into view and every 60 s on
  today's open report); a submitted report is never changed automatically — it shows "Your timers
  changed after you submitted this report" with Fill instead; a card that is added or moved to
  another project takes that project's timer hours. A project that is no longer active may still be
  picked in a report when the person timed it that day. The gap notice uses worked minutes.
- **Team board** (dashboards): marigold "On break" tag under the check-in time; "Projects today"
  starts with a "Now" tag and the running project.
- **Attendance** (HR): Present shows worked time with a "Breaks 45m" sub-line, plus a red "Over
  15m" tag past the allowance; Excel gets the two new columns.
- **Settings** (people-admin): section "Timers and breaks" (`id="timers"`): Project timers (Off /
  Optional — people can still type hours / Required — report hours come from timers), Ask about
  away time after (min), Remind when no timer runs after (min, only when required, 0 = never),
  Daily break allowance (min, 0 = no allowance).
- Turning timers off (Settings) stops every running timer (`stopped`); with timers off the Team
  board shows no "Now" and `getState` reads only a still-running entry.
- Notification types: `attendance.break_over_allowance`, `timer.reminder`,
  `timer.stopped_midnight`.

## 16. Company requests, October 2026 (added after the build guide)

- **Durations read as hours and minutes everywhere** ("Late 1h 37m", "1h 45m", "over the 1h
  allowance"): `formatHours(minutes)` now returns the same text as `formatDuration` (its decimals
  argument is gone). Under an hour a few sentences keep "N min". Report hour inputs are "2h 15m"
  boxes (CONTRACT 18); the Slack report text says "Hours: 8h 30m" (`formatSlackHours`, also used by
  the report page's Slack preview).
- **Late grace.** Settings "Late after" (e.g. 9:35 with office start 9:30) is the late mark;
  someone with their own shift start gets the same grace (`attendance.lateMarkFor({ shiftStart,
settings })`: shift start + (late after − office start)). Late minutes are stored at check-in,
  so earlier rows keep their value. Since CONTRACT 25 the mark follows the person's day (none on a
  holiday or with full-day leave; on first-half leave the split plus the grace). A holiday or
  leave change rewrites the stored late minutes of only the days it changes (`applyDayRules`,
  `recheckDayRules`, audited).
- **Report due vs missing (Team board, Employee detail history, Overview "Needs attention").**
  Before today's `reportReminderAt` someone checked in without a submitted report is `due` ("Due
  6:30 PM", neutral) or `draft`; from that time on anything not submitted is `missing`. The
  "Report missing" filter, count and KPI count `missing` only. `getTeamToday` rows carry
  `reportLabel`, the result `reportDue`.
- **An Admin's attendance is for Admins only.** For a viewer whose role isn't `admin`, people with
  role `admin` are left out of every attendance/presence read and count: Team board, Employee
  detail (NOT_FOUND), screen time (team, user range, export), Attendance day list, summary, missing
  check-outs, export, corrections list and badge, and hours-export "Missing" rows. An Admin's
  attendance row or correction request looked up by id answers NOT_FOUND to HR and PMs (the same as
  a row that doesn't exist); `createForUser` for an Admin answers FORBIDDEN. Notifications about an
  Admin's attendance (unverified office, missing check-out, correction request and its Slack DM) go
  to the other active Admins — never HR; nobody when there is no other Admin. Report hours stay
  visible (project report rows show the Admin's name without a link to non-Admins; global search
  leaves Admins out for PMs). Reads with no viewer (worker, a person's own pages) see everyone.
  Functions take `viewer`: `dashboard.getTeamToday({ filter, viewer })`, `getEmployeeDetail`,
  `getProjectReport` / `getProjectReportEntries`, `activity.getTeamDay` / `getUserRange` /
  `exportDay`, `attendance.listDay(date, { viewer })`, `listForDay`, `getDaySummary(date, { items,
viewer })`, `listMissingCheckouts`, `exportDay`, `listCorrections`, `countPendingCorrections`.
- **Submit and check out** (daily report): offered for today's draft when the person's attendance
  row is open and they have `attendance.self`; one confirmation dialog ("Submit your report and
  check out?"), then the normal submit and, only if it succeeded, the normal check-out; a failed
  check-out after a successful submit says so and sends the person to Today.
- **Projects**: the employee view has a search box (project or client name). The PM and Admin table
  has the project report's range next to the status tabs: This week (the default), This month, All
  time, Custom (`?range=&from=&to=`, `projectsRange.js`; the tabs, the search and the pager keep
  it). The hours column follows the range ("Hours this week", "Hours this month", "Total hours",
  "Hours in range") and shows a muted all-time total under it when it differs. Every project stays
  listed: the range changes the hours, not the rows.
- **Today**: Start break only for people who track attendance.
- **Not found inside the app**: `src/app/(app)/not-found.js` (shell) renders inside the app frame.

## 17. Office check-in from anywhere and HR-approved work from home (added after the build guide)

Company request: for now everyone checks in as **Office** from wherever they are, and **working from
home needs HR's approval**. Two settings (Settings → Check-in), both booleans:

- `officeCheckinAnywhere` (default false): Office check-in works from any network. The check-in is
  saved as `location 'office'`, `office_verified = 1` (verification is switched off, so it is not
  "unverified" and HR is not notified); the IP is still stored. With it off, the guide's rules stay
  (Office only on an office network, else "Office, unverified" when allowed).
- `wfhRequiresApproval` (default true): a WFH check-in needs an **approved WFH request covering
  today**, unless the person has `attendance.correct` (HR, Admin — the approvers). Otherwise
  `checkIn` refuses with `WFH_NOT_APPROVED` (409, "Working from home needs HR's approval for today.
  Ask HR first."). The existing rule stays: on the office network the only option is Office.

### WFH requests

- Table `wfh_requests` (migration 010): `user_id`, `from_date`, `to_date` (company dates, both
  included), `reason` (≤500), `status` pending | approved | declined | cancelled, `handled_by`,
  `handled_at`, `decline_reason` (≤300), timestamps.
- **Ask** (`attendance.requestWfh({ user, fromDate, toDate, reason, ip })`, `attendance.self`,
  tracked people): `fromDate` today or later, `toDate ≥ fromDate`, at most 14 days in the range,
  reason 5–500 characters (trimmed), no overlap with the person's own pending or approved request
  (`REQUEST_ALREADY_PENDING` with fields). Notifies the approvers — HR (`hrRecipients`, or the
  Admins when there is no other HR; an HR person's own request goes to the Admins; an Admin's to the
  other Admins, CONTRACT 16) — type `wfh_request.created` ("Vishal Saini asked to work from home on
  Tue, 14 Oct", body = reason, link `/attendance#wfh`), plus a Slack DM to them with setting key
  `slackRequestsNotify`. Audit `wfh_request.create`.
- **Approve / decline** (`approveWfh({ actor, id, ip })`, `declineWfh({ actor, id, reason, ip })`,
  `attendance.correct`): not your own request (`FORBIDDEN`), only pending ones
  (`REQUEST_ALREADY_HANDLED`); decline needs a reason (2–300). An Admin's request is NOT_FOUND for
  non-Admins (CONTRACT 16). Notifies the person (`wfh_request.approved` "Working from home approved
  for Tue, 14 Oct" / `wfh_request.declined` "Working from home declined for Tue, 14 Oct", body = the
  decline reason, link `/today`) and sends a Slack DM. Audit `wfh_request.approve` /
  `wfh_request.decline`.
- **Cancel** (`cancelWfh({ user, id, ip })`): your own request while it is pending, or approved and
  `fromDate` after today. Audit `wfh_request.cancel`.
- **Reads**: `listWfhRequests({ viewer, status?, userId?, limit, offset })` (approvers: everyone's,
  Admins hidden for non-Admins; others: their own), `countPendingWfh({ viewer })` (added to the
  Attendance nav badge, the same badge as corrections), `getWfhForDay(userId, workDate)` →
  `{ required, approved: request | null, pending: request[] }`. Dates in rows are 'YYYY-MM-DD';
  rows carry `{ id, user: { id, name, initials, designation, role, status }, fromDate, toDate,
reason, status, handledBy: { id, name } | null, handledAt, declineReason, createdAt }`.
- `getMyToday` adds `officeAnywhere` (setting), `wfh` (`getWfhForDay` for today) and
  `wfhNeedsApproval` (setting on and the person lacks `attendance.correct`).
- API: `POST /api/wfh-requests` (attendance.self, 201), `GET /api/wfh-requests?status=&limit=&offset=`
  (signed_in; scoped as above), `POST /api/wfh-requests/[id]/approve` and `/decline { reason }`
  (attendance.correct), `POST /api/wfh-requests/[id]/cancel` (attendance.self).
- The request dialog's next working day skips company holidays. On Attendance, the "WFH approved"
  line and `day.wfhApproved` are only for `attendance.correct` viewers (CONTRACT 25).

### Screens

- **Today, Check in card**: with `officeCheckinAnywhere` the Office option is always available and
  selected first ("Office" / hint "Check in from anywhere for now"); the network tag isn't shown.
  The WFH option: approved today → enabled, hint "Approved by Neha"; when approval is needed and
  missing → disabled, hint "Needs HR's approval" with a text button **Ask HR** (pending: "Waiting
  for HR"). Under the card's links: "Working from home another day? **Ask HR**". The request dialog:
  From / To dates (To defaults to From), Reason, **Send request**; toast "Request sent to HR".
- **Attendance (HR, Admin)**: a "Work from home requests" card (`id="wfh"`) above the day table
  when there are pending requests or ones handled in the last 7 days: person, dates ("Tue, 14 Oct"
  or "Tue, 14 – Thu, 16 Oct"), reason, **Approve** / **Decline** (dialog with a reason); handled ones
  show their status. The nav badge counts pending corrections + pending WFH requests.
- **Settings → Check-in**: toggles "Office check-in from any network" (help "Turn on while the
  office network isn't set up. Everyone can check in as Office from anywhere.") and "Working from
  home needs HR approval" (help "People ask HR first. HR and Admins don't need approval.").

## 18. Exact minutes in the daily report (added after the build guide)

Company request: "show 8h 30m, proper correct time" and "the timer shows 2h 5m but Fill from timers
shows only 2h". The daily report now counts **exact minutes**; the 0.25-hour steps are gone.

- **Hours box** (report page, `HoursField`): shows "2h 15m" (`formatDuration`, "0h" when empty) and
  accepts "2h 15m", "2h15m", "2 h 15 m", "2h", "15m", "15 min", "2:15" and decimal hours in
  quarter steps only ("6.5", "2.25", "7.50"); any other decimal such as "8.30" is refused ("Enter
  time like 2h 15m") so it is never read as 8h 18m. Normalised on blur; over 24h → "Hours must be
  24 or less." The accessible name stays "Hours for <project>". Shared parser:
  `parseDuration(text, { max })` in `@/lib/time`.
- **API**: report entries take `minutes` (whole number 0–1440, wins when both are sent) or `hours`
  (a number of any precision, or text in the forms above). Submit still needs each project above 0
  and a day total of 16h or less; there is no step rule.
- **Timers**: `getDaySummary` gives exact whole minutes, so Fill gives "2h 5m". Fill doesn't add a
  new card for a project timed 2 minutes or less. Required mode accepts a 2-minute difference
  (a running timer keeps counting); its follow-the-timer updates save at most every 15 minutes
  (`ReportProvider` `change(updater, clear, { quiet: true })` updates the page without autosave).
- The Slack text and preview say "Hours: 2h 15m" (`formatSlackHours`).
- `dashboard.getNavBadges` corrections count includes pending WFH requests (CONTRACT 17).

## 19. Auto check-out when inactive, and "no timer yet" reminders in every mode (added after the build guide)

Company requests: people who forget to check out disrupt the reports, but someone genuinely
working late must never be checked out; and people who check in but don't start a project timer
within about 25 minutes should be reminded.

### Auto check-out when inactive

Settings (Settings → Check-in): `autoCheckoutEnabled` (default true) and `autoCheckoutAt` ('HH:mm',
default '20:00', must be later than `officeEnd`). The check window is `[officeEnd, autoCheckoutAt]`
in company time (6:30 PM – 8:00 PM by default).

- **Reminder at `officeEnd`** (worker `checkout-reminder`, once per date via `runOnce` key
  `checkout_reminder:<date>`): everyone with an open row today (checked in, not checked out) gets
  `attendance.checkout_reminder` — "You're still checked in", body "Check out if you're done for
  the day. If you're still working, carry on.", link `/today`. Skipped when `autoCheckoutEnabled`
  is off.
- **Check at `autoCheckoutAt`** (worker `auto-checkout`, once per date, key
  `auto_checkout:<date>`; does nothing while `autoCheckoutEnabled` or `activityTrackingEnabled` is
  off): for each open row of today checked in before `officeEnd` (people whose own shift ends
  after `officeEnd` are skipped), the person is **working late** — and left alone — when there is
  a sign of work after `officeEnd` and within the 60 minutes before the check. Signs of work:
  active screen time (any source), window-mode idle (no Idle Detection), a timer (now while it
  runs) and break starts and ends. The same `lastSeenWorking` gives the suggested check-out time of
  CONTRACT 25 (for a past date, the timer sign is the last finished entry,
  `timers.lastRanByUser`). Otherwise they are checked out automatically:
  - check-out time = their latest sign of work if it is after check-in, else `officeEnd`;
  - `checkout_status = 'auto'` (migration 011), `check_out_ip` null; an open break ends there
    (`end_reason 'checkout'`) and a running timer stops there (`stop_reason 'checkout'`), in the
    same transaction and lock order as `checkOut` (CONTRACT 15); the check time is read after the
    row is locked, so a heartbeat or timer start during the run counts;
  - the person is notified (`attendance.auto_checkout`): "You were checked out at 6:12 PM", body
    "There was no activity on your computer after 6:30 PM. If you were working, request a
    correction." (the later of office end and the check-out time), link `/today`; audit
    `attendance.auto_checkout` (actor null);
  - rows checked in after `officeEnd` are left for the midnight rule.
- APIs: `attendance.sendCheckoutReminders(today)` → `{ reminded }`,
  `attendance.autoCheckOut(today)` → `{ checkedOut, kept }`, `timers.lastRanAt({ userId,
workDate, at }, trx)` → Date | null; Employee detail history rows carry `checkoutStatus`.
- `'auto'` behaves like `'checked_out'` everywhere (present/worked time, reports, Team board), but
  is shown as "Auto check-out" next to the Out time on Attendance, Employee detail history and
  the person's Today ("Checked out automatically at 6:12"). A check-out correction or HR edit of
  an auto row sets `'corrected'`, as for any row. The midnight `markMissingCheckouts` never
  touches `'auto'` rows. HR's Attendance filters gain nothing new; the Excel "Check-out status"
  column says "Auto".
- The person's own Today, when open after `officeEnd`, shows a gentle line "Still working? You'll
  stay checked in as long as you're active." under the top bar (only while the row is open,
  after `officeEnd` and `autoCheckoutEnabled` is on).
- CONTRACT 16 applies: notifications go to the person only.
- The 00:05 missing check-out notification to the person reads "Add the time you left on Today."
  and links `/today?checkout=missing`. The cron runs close-open-timers before
  mark-missing-checkouts (CONTRACT 25).

### Timer reminder in optional and required mode

`timerReminderMinutes` (default now 25 — migration 011 moves a database still on the old 20 to 25; 0 = never) applies whenever timers aren't **off** (it was
required mode only). The rule is otherwise unchanged (CONTRACT 15 "Reminder"): a tracked person
with an open row, not on a break, no running timer, whose check-in (or last entry's end, or last
break's end) was at least that many minutes ago, during office hours on a working day, at most
once an hour. The first reminder after check-in says "You haven't started a timer yet", body
"You checked in at 9:32. Start a timer for what you're working on.", later ones keep "No timer
is running". Settings help text becomes "Reminds people who are checked in without a running
timer. 0 turns it off."

## 20. AI with Gemini, version label, notification center (added after the build guide)

Company requests (phase 1): Polish my tasks, auto-write the report from timers, a daily report
summary for PMs, weekly HR notes, Ask Daybook; a version number in the UI; a better notification
center (click marks read, mark unread, delete, swipe to delete, a gently ringing bell).

### AI core (`@/modules/ai`, owner: ai)

- Env (server only): `GEMINI_API_KEY` (empty = every AI feature off), `GEMINI_MODEL` (default
  `gemini-3.5-flash-lite`, everyday), `GEMINI_SMART_MODEL` (default `gemini-3.5-flash`, Ask).
  REST `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`,
  header `x-goog-api-key` (read the official docs for request/response, JSON output and function
  calling before coding). `fetch` with a 30 s timeout; no SDK needed.
- Settings (Settings → AI, Admin): `aiEnabled` (default false), `aiDailyLimit` (200, 0–2000, whole
  company, counted in company-time days), `aiPolishEnabled`, `aiPmSummaryEnabled`,
  `aiPmSummaryAt` ('19:00'), `aiSummarySlack` (true), `aiHrNotesEnabled`, `aiHrNotesAt`
  ('19:00'), `aiAskEnabled`.
- `ai.isAvailable(feature)` → boolean: key set, `aiEnabled` and that feature's switch on
  (features: `polish`, `pm_summary`, `hr_notes`, `ask`).
- `ai.generate({ feature, userId?, model: 'fast' | 'smart', system, prompt, json?, tools?,
onToolCall? })` → `{ text, data }`: checks availability (`AI_OFF`), the company daily limit and
  the per-person daily caps (polish 40 since CONTRACT 21, ask 30) (`AI_LIMIT`), calls Gemini, writes one `ai_usage`
  row per request (feature, user, model, ok, error code, token counts — never the prompt or the
  answer), maps HTTP 429 → `AI_BUSY` and other failures → `AI_ERROR` (503 and timeouts: see "Busy Gemini" below). With `json` (a JSON schema)
  it asks for JSON output and returns the parsed object in `data`. With `tools` it runs Gemini
  function calling for at most 5 rounds, calling `onToolCall(name, args)` for each call.
- Error codes (add to `src/lib/errors.js`): `AI_OFF` 409 "AI is turned off.", `AI_LIMIT` 429
  "Daybook's AI has reached today's limit. Try again tomorrow.", `AI_BUSY` 503 "Gemini is busy.
  Try again in a minute.", `AI_ERROR` 502 "AI couldn't answer right now. Try again later."
- **Privacy**: never send emails, phone numbers, IPs or Slack ids. The PM summary and HR notes
  send people as tokens ("Person 1", "Person 2", …; not `P1`, which is a priority label) and put
  the names back into the returned text
  (`pseudonymize` / `restoreNames` helpers in the module); project names, task text and numbers
  are sent as they are. Ask Daybook sends the names its tools return (the page says so). Logs
  never contain prompts or answers.
- Table `ai_usage` (migration 012): `user_id` (nullable), `feature`, `model`, `ok`, `error_code`,
  `input_tokens`, `output_tokens`, `created_at`. `ai.usageToday()` → `{ used, limit }` for Settings.

### Polish my tasks and auto-write from timers (report page)

- `POST /api/ai/polish { lines: [{ key, title, projectName }] }` (report.self; 1–60 lines, titles ≤ 500) → `{ lines: [{ key, title }] }`: the fast model rewrites each task line as a clear, short
  line (≤ 120 characters) in the same language, same meaning, no new facts, keeping product and
  project names; lines it can't improve come back unchanged. Same keys back; anything else is
  dropped.
- Report page (when `ai.isAvailable('polish')` and the report is editable): a secondary
  **Polish with AI** button (sparkle icon) near the submit actions. It opens a dialog "Suggested
  wording" listing each changed line as before → after with a checkbox (all ticked), **Use
  selected** applies them through `change()` (priority links stay), Cancel keeps everything.
  Unchanged lines aren't listed; nothing changed → toast "Your tasks already read well".
- **Auto-write**: after **Fill report from timers** adds lines, the same dialog opens for just
  those lines (only when polish is available).

### Daily report summary for PMs (worker `ai-pm-summary`)

- Once per date (`runOnce` key `ai_pm_summary:<date>`) at or after `aiPmSummaryAt` on working days:
  for each active PM whose active projects had at least one **submitted** report today, one Gemini
  request (fast model, JSON `{ title, body }`) about their projects: per project the people
  (tokens) with minutes and task lines (title, status, priority), blocked tasks, priority tasks
  done today; projects with no report today are listed by the code itself ("No reports yet:
  acme-seo"). The body is plain text with short "- " lists (Done, In progress, Blocked, Hours),
  ≤ 1500 characters, hours as "2h 15m", names restored.
- Saved in `ai_summaries` (`kind 'pm_daily'`, period = today); bell `ai.pm_summary` "Today on your
  projects", body = the first 300 characters, link `/summaries/<id>`; with `aiSummarySlack` also a
  Slack DM with the full text (`slack.queueDm` setting key `aiSummarySlack`).

### Weekly HR notes (worker `ai-hr-notes`)

- Once per ISO week (`runOnce` key `ai_hr_notes:<year>-W<week>`) on the week's last working day
  (company holidays skipped, CONTRACT 25) at or after `aiHrNotesAt`: numbers per tracked, active,
  non-Admin person for Monday–today (days present, WFH days, late days and total late minutes,
  holidays and leave days, missing check-outs and auto check-outs (by the month rules of CONTRACT
  25), correction requests, days with breaks over the allowance, missing reports), sent as tokens; the
  fast model writes neutral, factual notes (patterns, people HR may want to check in with,
  improvements) — never judgments or disciplinary language. Saved per recipient (`hr_weekly`),
  bell `ai.hr_notes` "This week's attendance notes", link `/summaries/<id>`. Recipients: active HR
  people, or the Admins when there is no HR. The leave type, pay and note are never sent.

### Summaries pages

- `/summaries` (signed in): the person's own AI summaries, newest first (title, date, a short
  excerpt). `/summaries/[id]`: one summary; someone else's is NOT_FOUND. Each page says "Written
  by AI from Daybook's data. Check anything important."

### Ask Daybook

- Who: viewers with `team.view` or `attendance.view_all` (Admin, PM, HR), when
  `ai.isAvailable('ask')`. Nav item "Ask Daybook" (icon `Sparkles`) for them; page `/ask`.
- `POST /api/ai/ask { question (2–500), history?: [{ question, answer }] (≤ 4) }` →
  `{ answer }`. The smart model with function calling over read-only tools that enforce the
  viewer's scope exactly like the screens (PMs: their own projects and the people on them; HR:
  attendance; Admin: everything; CONTRACT 16 hides Admins' attendance from non-Admins):
  `list_projects`, `list_people`, `hours_by_project { from, to, projectName? }`,
  `hours_by_person { from, to, personName?, projectName? }`,
  `report_tasks { from, to, projectName?, personName?, status? }`,
  `attendance_summary { from, to, personName? }`, `priority_tasks { projectName?, status? }`.
  Dates 'YYYY-MM-DD', at most 366 days, results capped at 200 rows; a tool the viewer can't use
  returns `{ error: 'not allowed' }`. The answer uses only tool results ("I don't have that"
  otherwise), hours as "2h 15m", short.
- Page: a question box, example questions, the answers of this visit (not stored), and the note
  "Your question and the data needed to answer it are sent to Google Gemini."
- Attendance wording (CONTRACT 25): `OUT_STATUS.corrected` reads 'Corrected'; a check-out the
  person entered reads 'Entered by the person'.

### Version label

- `APP_VERSION` in `src/config/version.js` (now '1.11'; raised with each release). Shown as small
  muted "Daybook v1.05" at the bottom of the sidebar and under the sign-in card.

### Notification center

- `notifications.markRead({ userId, id, read })` → row, `notifications.remove({ userId, id })`;
  `PATCH /api/notifications/[id] { read: boolean }` and `DELETE /api/notifications/[id]` (signed
  in; someone else's or missing → NOT_FOUND).
- Bell dropdown: clicking an item marks it read (the blue dot goes at once) and opens its link;
  each item has Mark as unread / Mark as read and Delete (visible on hover and focus, always on
  touch); on touch screens swiping an item left past a threshold deletes it, with a toast
  "Notification deleted" and **Undo** for 5 s (the DELETE is sent when the toast ends).
- While there are unread notifications the bell rings gently: a short damped swing about every 6 s
  (and once at once when a new one arrives), with the red dot; no movement under
  `prefers-reduced-motion`.
- Live (CONTRACT 26): while Daybook is open the bell learns about new notifications by itself
  (`GET /api/notifications?after=`), a preview card shows each new one (a summary for 3 or more),
  and a short chime plays for important ones by default (My settings → Sound).

### Decisions made while building (phase 1)

- **Contact scrubbing**: besides the person tokens, emails (any script), phone numbers (with or
  without "+"), IPs and Slack ids in the system text, prompt and tool results become numbered
  placeholders ("[email 1]") and are put back in the answer and in tool arguments.
- **Limits count Gemini requests**, tool rounds included (one Ask question takes about 2–6 of the
  30). Each request first saves its `ai_usage` row as pending (`error_code 'PENDING'`); the limit
  check and that save run under `GET_LOCK('daybook_ai_limits', 5)`, so parallel requests count
  each other (lock not free in 5 s → `AI_BUSY`). Rounds of an answer already under way may finish.
  Per-person rate limits: polish 20 a minute (CONTRACT 21; was 10), ask 12 a minute.
- **Busy Gemini** (found testing on the free tier, where `gemini-3.8-flash` answered "high demand"
  503s or took over 2 minutes): HTTP 429 and 503 and no answer within 30 s are `AI_BUSY`. The
  smart model is sent `thinkingConfig.thinkingLevel: 'low'` (Gemini 3 and later only; at its
  default a Flash model thinks 15 s for a one-word answer). When the smart model is busy on the
  first request, generate() asks the fast model once instead (a new request, counted like any
  other); a busy later tool round is not retried.
- **AI module extras**: `ai.saveSummary`, `listSummaries`, `countSummaries`, `getSummary`
  (`ai_summaries` storage; the same kind, person and period again replaces the text);
  `PEOPLE_TOKEN_NOTE`, `AI_FEATURES`, `PERSON_DAILY_CAPS`, `MAX_TOOL_ROUNDS`; test hooks
  `setTransportForTests`, `fakeGeminiResponse`, `setApiKeyForTests`, `setTimeoutForTests`. JSON
  answers use `responseMimeType: 'application/json'` with `responseJsonSchema`.
- **Polish**: lines go to Gemini as `L1…Ln` (never the browser's keys) and come back as JSON with
  those ids. A line keeps its own title when the answer is empty, over 120 characters (unless the
  original was longer), holds a leftover placeholder or an email the line didn't have. "Polish
  with AI" comes first among the report's top-bar buttons (icon only at 1024–1199 px when all
  three show). Auto-write polish stays silent on errors and when nothing changed, and is dropped
  if the report's status changed while Gemini was writing.
- **Settings → AI** (`id="ai"`): "Use AI (Gemini)" is disabled until the key is set (it can always
  be switched off); the limit and the times are hidden while AI or their feature is off.
- **Summaries module `@/modules/aiSummaries`** (owner: ai): `sendPmSummaries(date)`,
  `sendHrNotes(date)`, `listMine({ user, page })`, `getMine({ user, id })`, `countMine`,
  `readableKinds`, `isoWeekKey`, `lastWorkingDayOfWeek`.
  - PM summaries go to active users with role `pm` only (Admins who run projects get none).
  - HR notes count correction requests by the day they were sent; missing reports are days
    checked in without a submitted report (today only from `reportReminderAt`); no Slack DM.
  - Both jobs: up to 3 runs 10 minutes apart (run keys `<key>`, `<key>#2`, `<key>#3`), skipping
    people already written; a failure for one PM is logged (code only) and the next goes on;
    `AI_LIMIT` or `AI_OFF` ends the run quietly. In `cron.js` they start only in the first 15 s
    of a run, and the sending loop ends 50 s after the run started.
  - Summaries are filtered by the current role: `pm_daily` needs `team.view`, `hr_weekly` needs
    `attendance.view_all` (otherwise not listed and NOT_FOUND). Excerpts are built like the bell's
    ("Done: Fixed … · …").
- **Navigation**: `navigationFor(user, badges, { ask, summaries })`: "Ask Daybook" (`Sparkles`)
  when `aiAsk.isAvailableFor(user)`, "Summaries" (`Newspaper`) for PM, HR and Admin once they have
  a summary their role can read.
- **Ask Daybook scope**: a PM's attendance answers cover only the people on their projects
  (stricter than the Attendance screen). Names are matched only among what the viewer may see, so
  a hidden name and an unknown one get the same answer. A failing tool gives Gemini "Daybook
  couldn't read this data just now." and the log gets the tool name only. Examples and Try again
  keep the draft; Try again is hidden for `AI_LIMIT` and `AI_OFF`.

## 21. My settings and polish on each task line (added after the build guide)

Company request (phase 1.06): keep **Polish with AI** in the report's top bar and add a sparkle to
each task line; give every person a **My settings** page (in the sidebar under Projects) to turn
these on or off, choose which submit buttons the report shows, and change a few other things for
themselves only. Company rules stay in Settings (Admin).

### Preferences (`@/modules/preferences`, owner: preferences)

- Table `user_preferences` (migration 013): `user_id` (PK, FK users, ON DELETE CASCADE), `prefs`
  (JSON: only keys that differ from the defaults are needed), `updated_at`. One row per person,
  created on the first change.
- Keys, values and defaults (`PREFERENCE_DEFAULTS`, frozen):

  | Key                 | Values                              | Default         | Used by                            |
  | ------------------- | ----------------------------------- | --------------- | ---------------------------------- |
  | `submitButtons`     | `'both'` `'checkout'` `'submit'`    | `'both'`        | report top bar                     |
  | `newTaskStatus`     | `'in_progress'` `'done'`            | `'in_progress'` | report editor                      |
  | `carryOver`         | boolean                             | `true`          | suggestions (CONTRACT 24)          |
  | `slackPreview`      | boolean                             | `true`          | report page                        |
  | `polishButton`      | boolean                             | `true`          | report top bar                     |
  | `polishLines`       | boolean                             | `true`          | report task lines                  |
  | `polishAfterTimers` | boolean                             | `true`          | Fill report from timers            |
  | `bellRing`          | boolean                             | `true`          | notification bell                  |
  | `bellSound`         | `'important'` `'all'` `'off'`       | `'important'`   | when the sound plays (CONTRACT 26) |
  | `bellTone`          | `'chime'` `'bell'` `'ding'` `'pop'` | `'chime'`       | which sound (CONTRACT 26)          |
  | `bellPreview`       | boolean                             | `true`          | preview cards (CONTRACT 26)        |
  | `theme`             | `'system'` `'light'` `'dark'`       | `'system'`      | whole app                          |

- `preferences.getFor(userId)` → every key (stored values over the defaults; an unknown key or a
  stored value that is no longer valid is ignored). A missing table (MySQL errno 1146, a deploy
  before `npm run migrate`) gives the defaults and one warning in the log; other errors throw.
- `preferences.update({ user, values })` → validates `values` (zod, strict: a wrong value is
  `VALIDATION_FAILED` with the field named; of unknown keys only the first is named, so
  `error.fields` stays one entry; an empty body is `fields._` "Choose a setting to change."), saves
  in one statement (`INSERT … ON DUPLICATE KEY UPDATE prefs = JSON_MERGE_PATCH(prefs, ?)`, so
  changes saved at the same moment all stay; a value set back to its default is removed from the
  row), returns `getFor(user.id)`. A missing table → `PREFERENCES_UNAVAILABLE` (503). A person only
  ever changes their own row; no audit entry.
- `preferencesFor(user)`: the same object, cached per request (React `cache()`), so the layout and
  a page share one query.
- `GET /api/me/preferences` (signed_in) → the object. `PATCH /api/me/preferences` (signed_in,
  body: one or more keys) → the object. Rate limit 60 a minute per person, GET and PATCH sharing
  one count. PATCH reads the body itself: the rate limit is counted first (refused bodies count
  too), then a body over 2,048 characters is 413 `PAYLOAD_TOO_LARGE`, then it is parsed and handed
  to `update`.
- Every key may be saved by anyone; a key that doesn't apply to someone's role (a PM has no
  report) just has no effect.

### My settings page (`/my-settings`)

- Any signed-in person (`requireUser()`). Nav item `mySettings`: "My settings", icon `UserCog`,
  the last item for every role (an employee sees Today, My log, Projects, My settings); also
  "My settings" (same icon) above "Sign out" in the account menu (sidebar and top-bar avatar).
- Built like Settings (artboard 12): TopBar "My settings", subtitle "How Daybook looks and works
  for you", a section list card on the left (anchors) and one card per section on the right, rows
  with a label, a muted help line and the control on the right (Toggle) or below (Segmented).
  **Every change saves at once** (PATCH with that one key; no Save button): a quiet "Saved" /
  "Saving…" status at the top right, placed over the TopBar so it never takes a row of its own on
  narrow screens; a failed save puts the control back and shows a toast.
- Sections, in this order (a section that doesn't apply is left out, and so is its anchor). "Writes
  reports" (`writesReports(user)` in `my-settings/sections.js`) is `report.self`, except an Admin
  who doesn't track attendance (the same rule that hides Today and My log in the sidebar):
  1. **Daily report** (people who write reports):
     - "Submit buttons" (Segmented: Both · Submit and check out · Submit report). Help: "Submit and
       check out shows while you're checked in today. Update report always shows once the report
       is submitted."
     - "New tasks start as" (Segmented: In progress · Done). Help: "For tasks you add yourself.
       Tasks from your timers start as In progress."
     - "Suggest my unfinished tasks" (Toggle; CONTRACT 24). Help: "When you pick a project, its
       unfinished tasks from past reports show up."
     - "Show the Slack preview" (Toggle). Help: "Beside your report, what will post to Slack."
  2. **AI** (people who write reports, while `ai.isAvailable('polish')`):
     - "Polish with AI button" (Toggle). Help: "At the top of your report, for every task at once."
     - "Polish on each task line" (Toggle). Help: "A sparkle at the end of each task line, for one
       task at a time."
     - "Suggest wording after Fill report from timers" (Toggle).
     - Under them, muted: "When you use these, your task lines are sent to Google Gemini."
  3. **Notifications** (everyone): "Ring the bell for unread notifications" (Toggle). Help: "A
     small swing every few seconds while you have unread ones." "Sound" (Segmented: Important only
     · All · Off). "Choose a sound" (Segmented: Chime · Soft bell · Ding · Pop; picking one plays
     it) with "Play sound" (CONTRACT 26). "Show a preview" (Toggle). Then the existing desktop
     switch (`PushSwitch` "Show on this computer"), only while desktop notifications are on for the
     company, with the note "When this is on and Daybook is in the background, Daybook doesn't
     chime. Your computer's settings decide if the desktop notification makes a sound, whatever you
     chose for Sound."
     Reminders from HR and from Daybook, and for HR the morning summary and the evening wrap-up
     (CONTRACT 25), come to the bell and, where Show on this computer is on, as desktop
     notifications. There is no per-type mute; the Sound choice is the only difference by type
     (CONTRACT 26). Slack DMs follow the company's switches in Settings → Slack.
  4. **Appearance** (everyone): "Theme" (Segmented: Match my computer · Light · Dark).
- Loading skeleton (`loading.js`) like Settings'. Desktop, < 1024 px and 375 px layouts, dark theme.

### What the preferences change

- **Submit buttons** (report top bar). "Update report" and "Request an edit" never hide.
  `'submit'` hides "Submit and check out". `'checkout'` hides "Submit report" only while
  "Submit and check out" is shown (today's draft, still checked in); otherwise "Submit report"
  shows as before, so a report can always be sent. When "Submit and check out" is the only submit
  button it is the primary (blue) one (`submitButtonsShown(...).checkOutPrimary`).
- **New tasks start as**: lines added by hand (Add task, Enter at the end of a line, the empty line
  of a newly added project) get this status; lines written by Fill report from timers and carried
  lines keep theirs.
- **Carry-over off** (since Daybook 1.09, CONTRACT 24: carry forward suggests, it no longer
  copies): no new draft starts with carried lines whatever the setting. While it is on, picking a
  project on Today or in the report suggests its tasks still open from past reports; off, there
  are no suggestions, no reminder line and no "still open" hints. Existing drafts are not changed.
- **Slack preview off**: the side panel isn't rendered and the cards take the full width.
- **Polish**: `polishButton` off hides the top-bar button; `polishLines` off hides the line
  sparkles; `polishAfterTimers` off skips the "Suggested wording" offer after Fill report from
  timers. All three still need the company's AI (`data.aiPolish`) and an editable report.
- **Bell**: `bellRing` off stops the swing; the red dot and the count stay.
- **Sound**: Important only chimes for the types marked important in `ALERT_TYPES`, All for every
  new notification, Off never (CONTRACT 26).
- **Choose a sound**: which of the four sounds plays (CONTRACT 26).
- **Show a preview** off: no preview cards and no announcement; the bell's dot and count still
  change.
- **Theme**: `data-theme="light" | "dark"` on `<html>` overrides the device setting.
  `globals.css` writes each colour that changes as `light-dark(light, dark)` (one list for both
  themes), and three rules pick `color-scheme`: `:root` light, `:root[data-theme='dark']` dark,
  and under `prefers-color-scheme: dark` `:root:not([data-theme='light'])` dark. Any other rule
  that differs in the dark theme uses `light-dark()` too, never its own `prefers-color-scheme`
  query. Browsers without `light-dark()` (before Chrome/Edge 123, Firefox 120, Safari 17.5) get the
  light theme from an `@supports not` block (`tests/unit/themeFallback.test.js` keeps it equal to
  the light side). `'system'` removes the attribute. AppFrame renders `ThemeSync`, which puts the
  theme script in `<head>` before the first paint and keeps a copy in
  `localStorage['daybook-theme']`; the launch script (root layout) applies that copy first on every
  page, the sign-in page included (only `'light'` or `'dark'` are ever applied), so pages don't
  flash. My settings applies a
  change at once, without a reload. Sign out resets the theme to `'system'` (attribute and stored
  copy), so the sign-in page on a shared computer doesn't keep the last person's theme.

### Polish on each task line

- Shown on an editable report's task line when `data.aiPolish`, `polishLines` is on and the line
  has text (1–500 characters trimmed). A small icon button (lucide `Sparkles` 16 px) inside the
  task field's cell, at its right end before the remove ×; visible while the row is hovered (only
  on devices that can hover, so a tap never leaves a sticky hover) or has focus, and while it is
  busy or showing a suggestion. On touch screens wider than 640 px it always shows. On touch phones
  (640 px and narrower) it shows only while the line is focused, busy or suggesting, so the title
  keeps its width; while hidden, taps go through to the field. Name "Polish task 2 for Daybook
  with AI", tooltip "Polish with AI".
- Press → `POST /api/ai/polish` with that one line. While waiting the icon is a spinner
  (`aria-busy`, presses ignored) and the line stays editable. Lines are independent: several may
  be waiting at once, and the top-bar button works meanwhile.
- A changed answer → a suggestion strip under the line (inside the row, full width; violet tokens
  `--violet-soft` / `--violet-text`): an arrow, the suggested text ("Suggested:" for screen
  readers), and two small buttons **Keep mine** and **Use**. Focus moves to **Use**; Escape in the
  strip is Keep mine. **Use** changes only the title (status and priority link stay), through the
  same `change()` path and only while the line still says what was sent; focus returns to the
  task field. Keep mine closes it; focus returns to the sparkle. Typing in the line, removing it,
  or the report becoming read-only drops the strip. While the report is submitting, Keep mine and
  Use are disabled (Escape does nothing). The arrow and the buttons line up with the first line of
  a long suggestion.
- An unchanged answer → toast "This task already reads well". An error → toast "Couldn't polish
  this task" with the error's message.
- Limits: each press is one Gemini request. The per-person polish cap is now **40 a day** (was 20) and the polish rate limit **20 a minute** (was 10); the company's daily limit is unchanged.

### Timer lines remember their note (fix found testing 1.06)

Bug: a line written by **Fill report from timers** and then reworded (Polish → Use, the top-bar
dialog, or a hand edit such as fixing a typo) no longer matched its timer's note, so the next Fill
added the original note again as a new line. Fill twice with a polish in between and the card shows
"Deploying new features", "Deploying new features", "Deploting new features".

- Migration 014: `report_tasks.timer_note` VARCHAR(200) NULL (the timer note's length), no index,
  no default. Additive; existing rows stay NULL.
- A task line's `timerNote` (string or null): the trimmed timer note the line stands for, which is
  the timer summary task's `note`. For a priority task timed without a note that is the task's
  title (`timers/rules.js` taskLine), so such a line stores the title (it then still matches after
  the task is marked done and the timer line becomes a plain note). Set only by Fill, never by
  typing:
  - on the lines Fill writes (`lineFromTimer`, including the lone empty line it replaces);
  - before the merge, on a line of the card Fill fills that already says a timer note by title
    (case-insensitive, trimmed) but has no note (`rememberTimerNotes`): lines saved before 014,
    lines carried from such a report, and lines typed by hand. Not when another line already
    matches that timer task by priority task or by note; the first such line without a note gets
    it.

  Otherwise null. It never shows on the page and never changes when the title changes, by hand or by
  polish.

- Fill's match (`lineFor` in `reportTimers.js`): same priority task, else the title equals the note
  (case-insensitive, trimmed), else the line's `timerNote` equals the note (the same comparison). So
  a reworded line still stands for its timer note and isn't added again. A line the person removed
  is still added again by the next Fill (as before: "nothing is removed", and Fill brings back what
  is missing). A line emptied by hand no longer stands for its note: the lone empty line is refilled,
  otherwise the note is added as a new line.
- A Fill that only gives lines their notes says "Your report already matches your timers" and
  offers nothing to polish. A draft autosaves the notes; on a submitted report the change is quiet
  (no "Unsaved changes", no backup) and goes out with the next Update report.
- It travels with the line everywhere the line goes: `serialize` sends it (`timerNote`, omitted when
  null), `taskInputSchema` takes it (optional, trimmed, '' → null, max 200), `writeEntries` saves it
  on insert and update (part of the fields `sameFields` compares), the report view returns it on
  every task, `entriesFromView` reads it, and the browser backup of a submitted report keeps it.
  Carry-over copies it to the carried line (so a carried, reworded line isn't added again by today's
  Fill of the same note). Since CONTRACT 24 (1.09) a set note is part of the report's version
  (`taskVersion`; a line without one hashes as before), because Play on Today writes it from
  outside the report page: a tab opened before Play gets the "changed somewhere else" CONFLICT
  instead of saving the line without it. A page opened before the 1.09 deploy whose lines have
  notes gets that CONFLICT once and reloads.
- Moving a card to another project (`unlinkTasks`, used by `pickProject` and by the request-a-project
  move) clears `timerNote` on its lines: the note belonged to the old project's timer.
- Nothing else reads it: Slack text, the PM views, exports, revisions and AI prompts are unchanged.
- Lines saved before migration 014 have no note. A line that still says its timer note gets it on
  the next Fill. A line already reworded before 014 no longer matches, so the next Fill adds the
  note once more as a new line that remembers it. Keep that new line (reword or polish it) and
  remove the old reworded one; removing the new line instead brings it back on every Fill.
- A deploy before `npm run migrate` (no `report_tasks.timer_note` yet; `reports/repo.hasTimerNote`):
  task lines are read and written without `timerNote`, so Fill matches by priority task and title
  only, as before. One warning is logged, and reports open, save, submit and carry over as usual.
  Once the migration has run, notes are kept again without a restart.

### Version

- `APP_VERSION` '1.06'.

### Tests

- `tests/e2e/my-settings.spec.js` signs in as Ankit Rana (ankit@company.com): the evening demo
  leaves Vishal checked out with a submitted report, so only Ankit shows "Submit and check out".

## 22. Project management: phases, plan, tasks and AI summary (company request, Daybook 1.07)

**Design:** `docs/design/project-management-prototype.dc.html`, the clickable prototype the owner approved. Its look, layout and copy bind every screen below (its numbers are sample data, and its "speed is 4" is a demo shortcut). Open it in a text editor: the markup and the `renderVals()` logic are readable. Where real data needs a state the prototype doesn't draw, this section says what to show. Build with Daybook's real components and tokens (`Card`, `TopBar`, `Button`, `Dialog`, `Segmented`, `FilterPills`, `DataTable`, `PriorityTag`, `Toast`), never raw hex in CSS modules. **The UI says "AI", never "Gemini"** (Settings → AI excepted). No consent checkbox, no phase history screen, no note on a phase move.

### Words

- **Project phase** (fixed list, in order): `requirement_gathering` "Requirement gathering", `design` "Design", `development` "Development", `testing` "Testing", `launch` "Launch", `support` "Support". No phase yet = `null` = "Not set". Phase is separate from status (Active, On hold, Completed): it blocks nothing, and neither changes the other.
- **Task** = the existing priority task (CONTRACT 13), now with an optional phase and due date. There is one task list. **Critical** = an open P1.
- **Health** = the worked-out state of a project, see Forecast.

### Data (migration `015_project_plan.js`, portable to MySQL 8.4; every length is also checked in zod)

- `project_plans`: `project_id` PK FK CASCADE, `current_phase` VARCHAR(24) NULL, `deadline` DATE NULL, `updated_by` FK users NULL, timestamps. No row = Not set and no deadline.
- `project_phase_plans`: PK (`project_id`, `phase`), FK CASCADE, `phase` VARCHAR(24), `planned_start`, `planned_end`, `actual_start`, `actual_end` DATE NULL, `updated_by`, timestamps. No row = no dates.
- `project_tasks` gets `phase` VARCHAR(24) NULL and `due_date` DATE NULL, and INDEX(`project_id`, `status`, `done_at`). Existing tasks stay `NULL`.
- `project_documents`: `id`, `project_id` FK CASCADE, `phase` VARCHAR(24) NOT NULL, `kind` ENUM('file','note'), `title` VARCHAR(200), `body` MEDIUMTEXT (a file's pages are separated by `\f`), `pages` INT NULL, `pages_total` INT NULL, `char_count` INT, `created_by`, `updated_by`, timestamps, INDEX(`project_id`, `phase`). **The text is stored; the file never is.**
- `project_summaries`: `project_id` PK FK CASCADE, `body` JSON (no column default), `source_key` CHAR(64), `truncated` BOOLEAN, `dropped_count` INT, `model` VARCHAR(60) NULL, `created_by`, `updated_by`, timestamps.
- Settings key `aiProjectSummaryEnabled` (boolean, default false) in `db/seeds/03_settings.js`, the settings schema and `settingsValues.js`.

**Deploy before migrate:** Today, the daily report and every other existing screen keep working without the migration, because their queries don't read the new columns (`TASK_COLUMNS` readers that need them go through new functions or a separate select). `/projects` and `/projects/[id]` catch errno 1146 and 1054 in the plan reads, log one warning, and show every project as Not set with "No plan yet"; writes to the new tables answer a clear error.

### Modules

- `@/modules/projectPlan` (`repo`, `service`, `schemas`, `index`, tables `project_plans`, `project_phase_plans`), plus pure browser-safe files other code may import directly:
  - `src/modules/projectPlan/phases.js`: `PROJECT_PHASES` `[{ key, label }]`, `phaseLabel(key)`, `phaseIndex(key)`, `nextPhase(key)` (from `null` it is the first; after `support` it is `null`).
  - `src/modules/projectPlan/forecast.js`: `forecastProject(input)`, see Forecast. No I/O.
  - `getPlan(projectId)` → `{ currentPhase, deadline, phases: [{ key, label, plannedStart, plannedEnd, actualStart, actualEnd }] }` (always 6 phases, in order).
  - `listPlans(projectIds)` → `{ [projectId]: { currentPhase, deadline } }`, one query.
  - `movePhase({ user, projectId, phase, from?, ip })`, `setDeadline({ user, projectId, deadline, ip })`, `setPhaseDates({ user, projectId, phase, plannedStart, plannedEnd, ip })`: `assertCanManage`, a transaction that locks the plan row, `audit.log` in it (`project.phase`, `project.deadline`, `project.phase_dates`: ids and values only). End before start: "The end date can't be before the start date." `from` is the phase the page showed (null for Not set): when the locked row's phase differs and isn't already `phase`, the move is refused with CONFLICT (409) "The phase changed. Reload the page.", so a page left open can't turn a move forward into a move back. Without `from` nothing is checked.
  - **Actual dates** (company time zone), as in the prototype's `confirmMove`. Forward: the old phase's `actual_end` = today, the new phase's `actual_start` = today and `actual_end` = null; phases jumped over stay empty (shown as "Skipped"). Back: later phases lose both actual dates, the target's `actual_end` = null, and its `actual_start` = today only when empty. Moving to the current phase is a no-op.
- `@/modules/projectTasks` (extended): create and update take `phase` (one of the list, or null) and `dueDate` (`YYYY-MM-DD` or null); `listForProject` returns them. The project's PM may now be an assignee, next to active members. `progressByProject(projectIds, { weeks })` → `{ [projectId]: { total, done, doneByWeek: [n, n, n] } }` in one query (`weeks` = `{ from, to }` UTC bounds of the last 3 full Monday to Sunday weeks in the company time zone, newest first). `doneByWeek` counts by `done_at`, so reopening a task takes it out. Existing notification and audit behaviour stays.
- `@/modules/projectSummaries` (`repo`, `service`, `schemas`, `prompt.js`, `checks.js`, `index`, tables `project_documents`, `project_summaries`). **Everything here is only for people who can manage the project**: reads return NOT_FOUND to anyone else, on the server, so nothing reaches another PM's browser.
  - `listDocuments({ user, projectId })` (no `body`), `getDocument({ user, id })` (with `body`), `addDocument`, `updateDocument` (notes only: title and text), `removeDocument`. Limits: title 1 to 200, text 1 to 200,000 characters, 40 documents per project ("This project has too many files and notes. Delete some first.").
  - `getSummary({ user, projectId })` → `{ body, stale, truncated, updatedAt, updatedByName, sources: { files, notes } }` or null. `stale` = `source_key` differs from the sha256 of the current documents' ids and `updated_at`.
  - `writeSummary({ user, projectId })`, `addActionAsTask({ user, projectId, actionKey })`.
- `@/modules/ai`: feature `project_summary` (`aiProjectSummaryEnabled`), `PERSON_DAILY_CAPS.project_summary` 15, and `generate()` takes an optional `timeoutMs` (55,000 for this feature; everyone else keeps 30 s). The company's existing daily limit applies. Nothing new in Settings except the one row: "Project summaries", help "PMs can write a short summary from a project's files and notes with Gemini.", shown like the other feature rows in `AiSection.jsx`.

### API

| Route                                                                             | Permission                    | Notes                                                                |
| --------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `PUT /api/projects/[id]/phase` `{ phase, from? }`                                 | `project.manage`, own project | returns the plan; 409 when `from` is out of date                     |
| `PUT /api/projects/[id]/deadline` `{ deadline }`                                  | same                          | `null` clears it                                                     |
| `PUT /api/projects/[id]/phases/[phase]/dates` `{ plannedStart, plannedEnd }`      | same                          | both nullable                                                        |
| `POST /api/projects/[id]/documents`, `PATCH`/`DELETE /api/project-documents/[id]` | same                          | body `{ phase, kind, title, text, pages?, pagesTotal? }`             |
| `GET /api/project-documents/[id]`                                                 | `signed_in`                   | the service answers NOT_FOUND to anyone who can't manage the project |
| `POST /api/ai/projects/[id]/summary`                                              | `project.manage`, own project | 4 a minute per person; writes or updates the summary                 |
| `POST /api/ai/projects/[id]/summary/tasks` `{ actionKey }`                        | `project.manage`, own project | adds a P2 task to the current phase, once                            |
| existing `projects/[id]/tasks`, `project-tasks/*`                                 | unchanged                     | now take `phase`, `dueDate`                                          |

Non-managers get FORBIDDEN on writes. Document and AI routes refuse a raw body over 1 MB with 413 before parsing, like `src/app/api/me/preferences/route.js`.

### Forecast (pure, `forecastProject`)

Input: `{ status, total, done, doneByWeek, deadline, today, createdOn }`. Output: `{ kind, pill, title, body, pct, done, total, left, finishOn, daysLate, daysLeft, speed, needed }`. First match wins:

| `kind`       | When                      | `pill`          | `title`                                                             | `body`                                                                                                                       |
| ------------ | ------------------------- | --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `completed`  | status completed          | Completed       | Completed                                                           | This project is completed.                                                                                                   |
| `hold`       | status on hold            | On hold         | On hold                                                             | This project is on hold.                                                                                                     |
| `noplan`     | no tasks                  | No plan yet     | No plan yet                                                         | Add tasks to the phases to see if the project is on track.                                                                   |
| `nodeadline` | no deadline               | No deadline     | No deadline yet                                                     | Add a deadline to see if the project is on track.                                                                            |
| `on`         | no tasks left             | On track        | On track: all tasks are done                                        | All 50 tasks are done. The deadline is 15 Dec.                                                                               |
| `off`        | deadline before today     | Off track       | Off track: the deadline passed 5 days ago                           | 12 tasks are still open.                                                                                                     |
| `nodata`     | speed is 0                | Not enough data | Not enough data yet                                                 | Daybook works out the speed from tasks marked done in the last 3 full weeks.                                                 |
| `off`        | more than 7 days late     | Off track       | Off track: will miss the deadline by about 14 days                  | At the current speed (4 tasks a week) the work ends around 29 Dec. To finish by 15 Dec, the team needs about 5 tasks a week. |
| `risk`       | 1 to 7 days late          | At risk         | At risk: may miss the deadline by about 3 days                      | same sentence                                                                                                                |
| `on`         | on or before the deadline | On track        | On track: will finish about 5 days early (or "will finish on time") | At the current speed (4 tasks a week) the work ends around 10 Dec. The deadline is 15 Dec.                                   |

- **Speed**: `weeksCounted` = whole weeks between `createdOn` and this Monday, at most 3. Speed = the newest `weeksCounted` of `doneByWeek` ÷ `weeksCounted`; `weeksCounted` 0 means speed 0. Today never counts, so ticking a task doesn't change the speed. Whole numbers read "4 tasks a week" and "1 task a week", others "about 3.5 tasks a week".
- `finishOn` = today + `ceil(left ÷ speed × 7)` days. `daysLate` = `finishOn` − deadline. `daysLeft` = deadline − today, `needed` = `max(round(left ÷ (daysLeft ÷ 7)), floor(speed) + 1)` ("about 5 tasks a week"; when `daysLeft` is 0 the second sentence is left out).
- `pct` = `round(done ÷ total × 100)`, 0 with no tasks.
- Pills use Daybook's soft tags: Off track red, At risk marigold, On track green, the rest neutral. The list sorts by: off, risk, on, nodata, nodeadline, noplan, hold, completed; then nearest deadline; then name.

### Projects list (`ManageProjectsView`; PM and Admin only)

As the prototype: subtitle "5 active projects: 1 off track, 1 at risk" (the counts only on the Active tab, without a search), search, New project, status pills, the hours range, then the columns Project (square, name, client under it), Health, Phase, Progress (thin bar + %, or "No tasks yet"), Deadline ("15 Dec 2026", or muted "No deadline"), Manager, Hours (as today, following the range), and the existing row menu at the end. Team and Status columns go. An urgent project gets a small marigold "Urgent" tag beside its name, with the note as its `title`. The range keeps working (CONTRACT 16). The row menu's "Priority tasks" becomes "Phases and tasks", linking to `?tab=phases`. No N+1: one `listPlans`, one `progressByProject`. A failure of either still renders the table, as "No plan yet".

### Project page (`/projects/[id]`, `team.view`)

Breadcrumb, square, name and health pill, subtitle "Acme Clinics · PM: Riya Kapoor · Active" (with the urgent note as today). Tabs are links with `?tab=overview|phases|timeline|hours`, `aria-current`, default `overview`; a URL with `range`, `from` or `to` and no tab opens Hours, so old links keep working. Only the chosen tab loads its data.

- **Overview**: health box, then Progress (donut), Deadline (with "Change deadline" or "Add deadline" and its one-field dialog) and Phase (stepper, AI line, button named after the next phase: "Move to Design"; from Not set "Start Requirement gathering"; no button after Support), then Critical tasks (open P1s by due date, tasks without a date last, max 5, checkbox, "See all tasks") and AI summary.
- **Phases**: as the prototype, one accordion section per phase, the current one open (with Not set, the first). A section "No phase yet" comes last, only when tasks without a phase exist; it has no dates, files, Move or Edit dates. Task rows keep what the card shows today: `details` as a muted line, the away label, and the latest reported status ("Neha, yesterday: In progress"), which helps the PM decide to tick a task. Only the PM and Admin tick; reports never close a task. The add and edit row sets title, owner, due date and priority; `details` is left alone on edit.
- **Timeline**: as the prototype, from a pure `timelineLayout.js`. The chart runs from the Monday before the earliest date (planned, actual or today) to the Sunday after the latest (planned, actual, deadline, expected finish or today), at least 8 weeks. Empty state when no phase has planned dates: "No planned dates yet. Add dates to each phase in the Phases tab." with a button going there. Summary line copy as in the prototype, built from real late phases, left out when nothing is late. The actual bar turns red only after a planned end (a planned start alone makes nothing late), a month name near the right edge stays inside the chart, and a range on one day reads "11 Nov" here as on Phases (`planFormat.dateRange`).
- **Hours**: today's report exactly (range, Download Excel, KPIs, charts, people, tasks, daily log), with the Priority tasks card gone and `tab=hours` kept on its range links and form (`keep`).
- **Another PM** (`team.view`, can't manage): sees health, progress, deadline, stepper, critical tasks, phases with tasks and dates, the timeline and hours, with no ticks, Add, Edit, Move, Change deadline or AI line. In place of the AI summary: nothing, and Critical tasks takes the width. In Phases: the muted "Only Riya Kapoor and Admins can edit phases." on top, and "Files and notes are only for Riya Kapoor and Admins." in each open section.
- **Undo**: Delete hides the row at once with a toast and Undo for 6 s (`useToastSlot`, as the bell's Undo). The `DELETE` is sent when the toast ends, on unmount, or on `pagehide` with `keepalive`. Undo cancels it. A failed delete brings the row back with an error toast. Every sent delete refreshes the page once it is done, also after the board unmounted (the tab shown next was loaded before the delete went out). Ticking a task: the prototype's "Marked done." with Undo, which reopens it.
- Notification links to `#priority` become `?tab=phases`; `HoursCard` links gain `tab=hours`.
- **Shared client parts** (in `src/app/(app)/projects/[id]/`): `MovePhaseButton` `{ projectId, currentPhase, targetPhase, plan, today, children | label, variant, size, className }` (sends `{ phase: targetPhase, from: currentPhase }`); `BusyButton` `{ busy, onClick, …Button props }`, a button that keeps keyboard focus while it works (`aria-disabled`, never `disabled`), for the AI card's buttons; `TaskCheck` `{ taskId, title, done, className }`, whose Undo toast lives in `TaskUndoProvider` (mounted by `ProjectView` around every tab, so the toast outlives a row that leaves the list); `DueTag` `{ dueDate, today, done, className }`; `UndoToast` `{ pending, onUndo, onEnd, onLeave?, duration? }` with `UNDO_MS` 6000; `planFormat.js` for dates and phase copy.

### Files and notes

- **+ Add file**: a real file picker, PDF, Word `.docx`, `.txt` or `.md` (`accept` lists the extensions and their MIME types). Every file is read **in the browser**; the server never opens a file, because of the host's memory limits, and only the text is sent. Limits for every type: 20 MB, 200,000 characters. Wrong type: "Pick a PDF, Word (.docx), .txt or .md file."
- **PDF**: `pdfjs-dist` (dynamic import, loaded only on click, legacy build, `isEvalSupported: false`, `getDocument` and `getTextContent` only, never the viewer, annotation layer or scripting). Pages join with `\f`. Also the first 100 pages; when cut, the toast says "Read the first 100 of 140 pages." Errors in a toast: no text "No readable text. Is it a scan? Paste the key parts as a note."; password "Remove the password or paste the text as a note."; broken "This file isn't a PDF Daybook can read." While reading: "Reading page 12 of 14…" on the button. `pdfjs-dist` is a **devDependency** pinned to **5.5.207** (it is bundled by the build in GitHub Actions; the server installs nothing new): 5.6.83 up to 6.2.107 carry advisory GHSA-hq66-cqwq-w95j, and the fixed versions need Node 22.13, which CI and the host don't run.
- **Word `.docx`** (owner's request, 11 Nov): no new dependency. A `.docx` is a zip: Daybook reads its central directory, inflates `word/document.xml` with the browser's own `DecompressionStream('deflate-raw')` (stored entries too), and takes the text in document order: each paragraph a line, `w:tab` a tab, `w:br` and `w:cr` a line break, table cells joined by a tab and each row a line, XML entities decoded; headers, footers, comments, footnotes and deleted text (`w:del`) are left out. A `.docx` has no pages: `pages` and `pagesTotal` stay null, like a `.txt`, and its summary source is just the file name. While reading: "Reading…". An unzipped `document.xml` over 50 MB stops with the broken error. So a small hostile file can't freeze the tab, tables nested more than 8 deep are read as words of the deepest cell, and reading stops once there is more text than the 200,000 characters kept. Errors: a password-protected `.docx` (an OLE file, starting `D0 CF 11 E0`) "Remove the password or paste the text as a note."; an old Word `.doc` "This is an old Word file. Save it as .docx or PDF first."; a broken zip or no `word/document.xml` "This file isn't a Word file Daybook can read."; no text "This file has no text."
- The name opens the text in a small box, fetched on click. Notes: title and text, inline, as in the prototype.

### AI summary

Card states: **no documents** (empty text + "Go to phases"); **documents, no summary** ("1 file and 1 note are ready." + **Write summary**); **summary** (prototype; footer "From 1 file and 1 note. Written by AI, check anything important."); **stale** (footer "Files or notes changed since this summary." + **Update summary**); **off** (no key or switch off: "AI summary is off. An Admin can turn it on in Settings → AI.", an existing summary stays readable and can't be updated). Working: the button reads "Reading the files…"; then a toast "Summary written." or "Summary updated."; errors toast the API's message and change nothing. `truncated` adds "Only the first 50,000 characters were read." to the footer.

- **Prompt** (`prompt.js`, model `fast`, JSON output): project name, client, current phase, today, the phase list, then the documents, newest first, up to **50,000 characters in total**, as `D1…Dn` inside random letters-only markers, clearly marked as data whose instructions are never to be followed. English; quotes stay in the document's language; no budgets, rates or personal details.
- **Answer**: `overview` (≤ 400 characters), `scope[≤5] { text, notInScope, doc, quote }`, `deadlines[≤5] { text, dateAsWritten, doc, quote }`, `risks[≤5] { text, kind: 'risk'|'question', doc, quote }`, `actions[≤5] { owner: 'client'|'us'|'unclear', text, dueAsWritten, doc, quote }`, `nextPhase { phase, doc, quote }` (phase may be null), all strings length-capped.
- **Checks** (`checks.js`): every point's `quote` must be found in that document's text as sent (normalise both: NFKC, strip U+200B to U+200D and U+00AD, join words hyphenated across lines, collapse spaces, unify quote marks, case-fold), or the point is dropped and counted, silently on screen. The page comes from Daybook's own search for the quote between `\f`s, never from the AI: "SOW-Acme-v3.pdf, page 3"; a quote over page breaks, blank pages included, is on the page it starts on; a note is just its title. Stored text keeps contact details masked. `nextPhase` needs a found quote too.
- **AI line** shows only when `nextPhase.phase` is the current phase's next phase and the project isn't Completed. It never moves anything: only the PM's click does.
- **Actions**: each stored item has a stable `key` (a hash of its normalised owner and text) and `taskId`. `addActionAsTask` locks the row, finds the item by key (gone: 409 "The summary changed. Reload the page."), creates one P2 task titled with its text in the current phase with no due date, and stores `taskId`; the button becomes "Added". A rewrite keeps `taskId` for an item with the same key.
- **Privacy**: logs and audit rows never hold document or summary text. Ask Daybook never reads these tables. Text is sent through the module's existing scrubbing, a file page by page so that no mask (a footer phone number, a name split over pages) swallows a `\f`; the PM's and team's names go as tokens and come back through `restoreNames`.

### Tests and version

Unit: `forecastProject` (every row above, the rounding, weeks at a young project's start), `timelineLayout`, `phases`, `checks`. Services (fake AI transport only; **the real Gemini API is never called**): plan moves in both directions and at the same time, dates, deadline, tasks with phase and due date, `progressByProject`, documents, limits, summary (happy path, invented quote dropped, injected instruction in a document changes nothing, stale, truncated, add action once), permissions (another PM: NOT_FOUND on reads, FORBIDDEN on writes; the page has no summary text), migration missing. E2E: `tests/e2e/project-plan.spec.js` runs the list, tabs, Move, deadline, add, tick, delete and Undo, a real PDF and a real `.docx` fixture read in the browser, and the other PM's view, with `/api/ai/**` stubbed in the browser. `APP_VERSION` '1.07'.

## 23. Pending requests card and project colours (company request, Daybook 1.08)

Two small asks from the owner, shipped first (the to-do and unfinished-task suggestions follow in 1.09 as section 24):

1. On the Company overview, the "Pending requests" card opens the requests.
2. Projects get a yellow colour label, and a small button that opens more colours, including any colour.

**Design:** `docs/design/todo-and-colours-prototype.html` (the approved copy of the design session's `prototype-standalone.html`; it runs on its own, it does not load the 1.07 prototype's `support.js`). Screens "Company overview" and "Colour label". Its look, layout and copy bind these screens; names and numbers are sample data; its top bar of screen buttons is a demo control, not Daybook UI. Build with Daybook's real components and tokens, never raw hex in CSS modules (the stored custom colour is the one exception, see below).

### Data (migration `016_project_color.js`, portable to MySQL 8.4)

- `projects.color`: `ENUM(...)` → `VARCHAR(7) NOT NULL DEFAULT 'blue'` (`ALTER TABLE ... MODIFY`, as in `011_auto_checkout.js`; existing values kept). Holds a preset (`blue, green, violet, orange, teal, pink, yellow`) or a lowercase `#rrggbb`. `down` sets every other value to `'blue'` and restores the six-value ENUM (custom colours are lost).

**Deploy before migrate:** every screen keeps working; reads don't change. The projects repo checks the column type once per process, like `reports/repo.hasTimerNote` (`information_schema.columns`, cached), and **before writing** a yellow or custom colour on the old ENUM throws `VALIDATION_FAILED` with `fields.color` "This colour needs the latest database update. Pick one of the first six for now." (So it never relies on strict mode: `knexfile.js` doesn't set `sql_mode`, and a non-strict host would store '' with only a warning.) It works once migrated, with no restart (the cache is refreshed when the check said ENUM and 60 seconds have passed).

**Migrating on the host:** `npm run migrate` printed only `Aborted` on the cPanel host (its process and thread limits). `migrate` and `seed` in `package.json` now start Node lean, like `worker:cron`, `doctor` and `reset` (`node --disable-wasm-trap-handler --v8-pool-size=2 node_modules/knex/bin/cli.js ...`), and README's cPanel steps run that line without npm and with `UV_THREADPOOL_SIZE=2` (`tests/unit/hostScripts.test.js`).

### Request 1: the Pending requests card is a link

- **Counts follow the viewer.** `getOverview({ viewer, ... })` takes the viewer and counts with `reports.countPendingEditRequestsFor(viewer)` and `projects.countPendingRequestsFor(viewer)` (CONTRACT §6), plus `attendance.countPendingCorrections({ viewer })` when the viewer has `attendance.correct` (0 otherwise), instead of the company-wide `countRequests` (which also counted the Admin's own edit requests that `/requests` hides). So the card's number and the page agree.
- `requestsKpi(counts, viewer)` (`src/modules/dashboard/requestsCard.js`, pure, with `requestsSub` and `requestsHref`; `overview.js` re-exports all three) adds `href`: `'/attendance'` when `edits + projects` is 0 and `corrections` is above 0 (fixes are handled there), otherwise `'/requests'` (also at 0, so the card behaves the same every time). The `href` is set only when `can(viewer, 'project_request.handle')` (for `/requests`) or `can(viewer, 'attendance.correct')` (for `/attendance`); otherwise the card is not a link.
- **Sub text** counts what is waiting, leaving out zeros, joined with ", ": "2 edits, 1 new project, 1 fix", "1 edit", "3 fixes", "2 new projects". At 0: "Nothing waiting". It may wrap under the number, like "Monday to today".
- **Kpi gets one prop** (ui-kit): `trailing` (an element shown at the top right, level with the label; the label gets right padding when it is set). CONTRACT §8's Kpi line lists `as`, `href` (passed through) and `trailing`.
- `overview/page.js` renders a KPI with `href` as `<Kpi as={Link} href={kpi.href} className={styles.kpiLink} trailing={<ChevronRight size={18} strokeWidth={1.8} />} ...>`. `.kpiLink`: `color: inherit; transition: border-color 120ms`; the chevron is `--muted`. At rest only the chevron is new (artboard 11 otherwise unchanged). Hover: border `--line-dashed`, chevron `--ink`, no underline (`a:hover` in `globals.css` underlines, so set `text-decoration: none`). Focus: the global ring (the `<a>` is the card, so the ring follows its radius). The accessible name is the card's text ("Pending requests 4 2 edits, 1 new project, 1 fix").
- **Requests page** (projects, `RequestsView.jsx` renders `AttendanceFixes.jsx`): when the viewer has `attendance.correct` and corrections are pending, a muted line under the pills: "1 attendance fix is waiting on Attendance." with "Open attendance" as a text link (plural "3 attendance fixes are waiting on Attendance."). No "Back" link: the Admin's sidebar has Overview. The Admin's sidebar has no Requests item, so nothing is highlighted on `/requests`; that is accepted.

### Request 2: yellow and more colours

- **Yellow preset** (hue 51°, its soft colours 56°, kept apart from marigold's 39° that means Urgent and Pending): `--label-yellow: #d4b300`, `--label-yellow-bg: light-dark(#f6f2c0, #32310f)`, `--label-yellow-text: light-dark(#565000, #e5da69)`, with the light values in the `@supports not` block (`themeFallback.test.js`). Text on its background 7.2:1 light, 9.2:1 dark; on `--urgent-bg` 7.7 / 10.6. The strong colour is 2.05:1 on white (marigold, already used for bars, is 1.83) and 7.9:1 on the dark surface. Label "Yellow".
- **Shared helper** `src/lib/projectColors.js` (pure, browser-safe; orchestrator file): `PROJECT_COLORS` (the seven presets), `MORE_COLORS` (`[{ key, label, hex }]`, below), `isPresetColor`, `isCustomColor(value)` (`/^#[0-9a-f]{6}$/`), `normalizeColor(value)` (trim and lowercase; nothing else), `colorProblem(hex)` → `null | 'light' | 'dark'` (contrast below 1.5:1 against `#ffffff` is light, against `#1a1e3a` is dark), `projectColorStyle(color)` → `{}` for a preset or anything invalid, `{ '--project': hex }` for a valid custom one. Every copy of the colour list (`projects/schemas.js`, `ProjectSquare.jsx`, `ColorSwatches.jsx`, `report/ProjectCard.jsx`) imports it instead.
- **More colours** (`MORE_COLORS`, 8, each checked in both themes, none close to a preset or a status colour): Coral `#e8603c`, Brown `#9a5b2e`, Olive `#7d8a12`, Lime `#4f9d1a`, Sky `#2f86d6`, Plum `#9c3fb8`, Magenta `#c0399a`, Slate `#5d6b85`. Stored as hex (custom colours), so the list can change later without a migration.
- **Validation** (`src/modules/projects/schemas.js`): `color` is a preset or a custom hex after `normalizeColor`; otherwise "Pick a colour label." A custom colour with a `colorProblem`: 'light' "This colour is too light to see. Pick a darker one."; 'dark' "This colour is too dark to see in the dark theme. Pick a lighter one." Create still defaults to `'blue'`. Audit as today (`project.update` with the new value).
- **How a custom colour shows**: one `.custom` class next to the preset classes in `ProjectSquare`, `ProjectLabel`, `ColorSwatches`, `report/ProjectPicker`, `team/UrgentList` and `GlobalSearch`, reading `--project` from the inline style: background `color-mix(in srgb, var(--project) 16%, var(--surface))`, text `color-mix(in srgb, var(--project) 35%, var(--ink))`, strong (bars, dots, swatches, the report card chevron) `var(--project)`. Squares keep the soft background with the text colour, as presets do. It follows light and dark by itself. For every colour `colorProblem` accepts, text stays at least 6:1 on its background and on the surface in both themes and on the light `--urgent-bg`, and at least 5.9:1 on the dark `--urgent-bg` (a few deep blues dip under 6; the lowest is `#0000d3` at 5.97:1). The eight More colours are at least 6:1 everywhere, and nothing comes near 4.5:1 (`projectColors.test.js`). `ProjectLabel` merges its own `style` with the caller's. **GlobalSearch** moves its project letter to the soft background with the text colour (white on yellow is 2.1:1).
- **Safe at render** (the database is never trusted for CSS): `projectColorStyle`, `resolveColor` (`chartColors.js`), `toneColor` (`ProgressBar.jsx`) and `report/ProjectCard.colorVars` re-check `isCustomColor` and fall back to the preset (or `{}`) otherwise; style objects only, never a CSS string built from the value. `GlobalSearch.jsx` stops passing `option.color` straight into `style`.
- **Drawer** (`ProjectDrawer.jsx`, "Colour label"): one row: Blue, Green, Violet, Orange, Teal, Pink, Yellow (native radios as today), then a 40 px "More colours" button: a 32 px dashed circle (`box-sizing: border-box`, as in the prototype; 1.5 px border and Palette icon `--muted`, 4.6:1) with `aria-label` "More colours", `aria-expanded`, `aria-controls` the panel. When the project's colour is not a preset, the button is filled with that colour and carries the selected ring, and its name is "More colours, custom colour chosen". The wrapper becomes `role="group"` with `aria-labelledby` the label; the radios keep one `name`. The row wraps on narrow screens (`flex-wrap` is already on).
- **The panel opens inline** under the row, inside the drawer body (it scrolls with the body, so nothing can be clipped; no popover, no bottom sheet): muted 13 px "More colours", the 8 swatches (same 32 px dots in 40 px boxes, buttons named after the colour, `aria-pressed`, the chosen one ringed; they wrap at 375 px), then "Any colour" (secondary, compact, Pipette icon) wrapping a native `<input type="color">` (value: the current custom colour, or `#2f86d6`). A swatch applies at once. The colour input applies on `change`; a colour with a `colorProblem` is not applied and its message shows in the field's error line (the server checks again). The panel stays open until the button is clicked again or a swatch is picked. **Escape** while focus is in the panel closes the panel only and puts focus back on the button: the panel's `onKeyDown` stops the event and prevents its default. The `Drawer` is a portal on `document.body`, and React handles a portal's events on its container, so the stopped Escape never reaches `useModal`'s document listener (`useModal.js:74,99`); that listener also skips a prevented key, which covers the panel outside a portal (where React's root, `document`, would share the node). Each call alone keeps the drawer open in the app; keep both. Escape elsewhere in the drawer closes the drawer as today. **Focus** on a dot is always the primary ring (2 px `--surface` gap, 2 px `--primary`), on the checked radio, the pressed swatch and the custom-filled More button too, where it replaces the colour ring (as in the prototype).
- The project's colour shows everywhere it does today (list square, labels, bars, urgent list, picker). Exports, Slack and AI use no colour.

### Files and owners

| Owner        | Files                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orchestrator | `db/migrations/016_project_color.js`, `src/lib/projectColors.js`, `src/app/globals.css` (yellow tokens and fallback), `src/config/version.js`, this section                                                                        |
| dashboards   | `src/modules/dashboard/overview.js` (viewer counts), `src/modules/dashboard/requestsCard.js` (`href`, sub), `(app)/overview/page.js` (+ css), `team/UrgentList` (+ css)                                                            |
| projects     | `src/modules/projects/{schemas,repo}.js` (column check), `(app)/projects/ColorSwatches.jsx` (+ css, the panel), `ProjectDrawer.jsx`, `(app)/requests/RequestsView.jsx` and `AttendanceFixes.jsx` (+ `page.module.css`, fixes line) |
| reports      | `report/ProjectCard.jsx` (`colorVars`), `report/ProjectPicker.jsx` (+ css `.yellow`, `.custom`)                                                                                                                                    |
| ui-kit       | `src/components/{Kpi,ProjectSquare,ProjectLabel,ProgressBar,chartColors,GlobalSearch}` (+ css), CONTRACT §8 lines                                                                                                                  |

### Tests and version

Unit: `projectColors` (normalise, presets, every `MORE_COLORS` passes, too light, too dark, `projectColorStyle` ignores bad values), the KPI sub ("1 new project", "Nothing waiting") and `href` (corrections only goes to `/attendance`, no permission gives no `href`). Services (`DB_NAME=daybook_test_<n>`): colours (yellow, palette hex, too light, too dark, invalid, uppercase hex is lowercased; before the migration a yellow or hex is refused with the message and nothing is written, also with a non-strict `sql_mode`); the overview count leaves out the Admin's own pending edit request. `themeFallback.test.js` covers the new tokens. E2E (`tests/e2e/colors.spec.js`): the Admin clicks Pending requests and lands on `/requests`; a PM picks Yellow, then Plum from More colours, presses Escape in the panel and the drawer stays open, saves, and sees the label on the list. `APP_VERSION` '1.08'.

Also update CONTRACT §8 (`Kpi` `as`/`href`/`trailing`; colour props accept a custom hex) and §9 (the owner rows above).

## 24. Today's to-do and unfinished-task suggestions (company request, Daybook 1.09)

Two asks from the owner, approved with the answers at the end of this section (12 Nov 2026):

3. Everyone who writes a daily report can write **today's to-do** in the morning, in the format the team already posts on Slack ("Project: Pine Tree lane" then "* task" lines), tick tasks off during the day, and find them already in the evening report.
4. With carry forward on, picking a project shows its tasks still open from past reports, to add to today, mark done already or mark not needed.

**Design:** the same prototype (`docs/design/todo-and-colours-prototype.html`), screens "Today", "Daily report", "Team" and "Slack"; light and dark, desktop and 390 px. Same rules as §23. UI copy has no dashes: the owner's "Project— X" is written "Project: X" everywhere Daybook writes it.

### Words

- **To-do** = the lines of the person's report for today, written before the work is done. **It is not a new list**: a to-do line _is_ a daily-report task line (`report_tasks`) of today's draft, so the morning plan and the evening report are the same rows. Ticked = Done; not ticked = In progress (Blocked keeps its tag and can be ticked to Done). There is still one priority-task list (CONTRACT 22); ticking a to-do line never closes a priority task.
- **Open task** = a line In progress or Blocked in a **submitted** report that no later line was carried from and that isn't closed. A **lapsed draft** (a draft that locked without being submitted, a missed day, and that no approved edit request reopened: `suggestions.isLapsedDraft`) never became a report, so its lines count for nothing here: they don't carry their source on, don't hide a suggestion by title, and don't stop Done already or carrying the task again (with its `first_reported_on`).
- **Closed** = the person said "Done already" (reason `done`) or "Not needed" (reason `dropped`) about an open task without bringing it into today. It is recorded on the old line only; the old report itself doesn't change (no new revision, no Slack update).
- **Suggestion** = an open task of the person from the last 30 days before today, on a project that is still active (or a project request still pending), with no later line of the person on the same project with the same normalised title (any status). Duplicates by normalised title: the newest wins. Newest first, at most 10 per project. Only while the person's `carryOver` preference is on.
- **Carried line** = a line created from a suggestion ("Add to today", or a typed or pasted title equal to a suggestion's on the same project): `carried_from_task_id` points to the source, and it copies the source's `first_reported_on`, `project_task_id` and `timer_note` (when `hasTimerNote`), exactly as `insertDraft` did.
- **Planned project** = a project in today's report at 0 minutes with no Done line.

> **Company rule (overrides the build guide 7.4.2 and CONTRACT §21; confirmed by the owner on 12 Nov 2026):** report drafts no longer start with copied unfinished tasks. With carry forward on, unfinished tasks are suggested when their project is picked (Request 4). `openForDate` and the edit-request draft (`editRequests.js:227`) stop calling `planCarryOver`; drafts that already exist are not changed.
>
> **Company rule (overrides `submit.js:38` and `timerCheck.js`):** a planned project may be submitted at 0 hours. It is saved with the report, so its tasks stay open and are suggested next time; it is left out of the Slack report text, the hour totals and the board's project list. A 0-hour project with a Done line still needs hours ("Hours must be above 0."). A 0-hour project with no tasks is dropped on submit, like empty rows. In required timer mode the "No timer time on this project today" check skips planned projects.

### Data (migration `017_todo.js`, portable to MySQL 8.4; additive; every length is also checked in zod)

- `daily_reports` gets `todo_posted_at DATETIME NULL`, `todo_slack_channel_id`, `todo_slack_ts` (same types as `slack_channel_id`, `slack_ts`) and `todo_post_hash CHAR(64) NULL` (sha256 of the plan last sent: project ids and line titles, no statuses, so ticking or a PM renaming a project never asks for an update). These columns are **never added to `REPORT_COLUMNS`** (`findById`, save and submit use it); they are read by a separate `repo.findTodoPost(reportId)`.
- `report_tasks` gets `carry_closed_at DATETIME NULL` and `carry_closed_reason ENUM('done','dropped') NULL`. Neither is in `taskVersion`/`contentVersion`, so closing never makes an open report tab stale. A line's `timer_note` is part of the version once set (Play writes it, see §21).
- Settings (`db/seeds/03_settings.js`, the settings schema, `settingsValues.js`): `slack_todo_channel_id`, `slack_todo_channel_name` (both null by default = to-dos are not posted). The owner's answer: to-dos go to **their own channel**, which the company creates; there is no fallback to the report channel.
- Outbox: `OUTBOX_KINDS` (`slack/schemas.js`) gains `todo_post`, `todo_update`; `related_type 'todo'`, `related_id` = `daily_reports.id`.
- No new table.

**Deploy before migrate:** Today, the report and every other screen keep working: to-do lines are ordinary report lines. `findTodoPost` catches errno 1054, logs one warning and returns "not posted". The suggestion read catches 1054 on `carry_closed_*`, logs one warning and runs again without that filter (so suggestions still work). "Post to Slack", "Done already" and "Not needed" throw `new AppError('TODO_UNAVAILABLE', { status: 503, message: 'This needs the latest database update. Ask an Admin.' })` (the `PLAN_UNAVAILABLE` pattern). Missing settings keys read as their defaults. It all works once migrated, with no restart.

### Request 3: today's to-do

#### On Today (attendance)

- **Place.** Desktop: Your day and This week; then "Working on" (only while a timer runs, directly under Your day as today); then the tasks row: the Urgent card (372 px) beside **Today's to-do** (`id="todo"`, the rest of the row; full width when there is no urgent project); then Priority tasks; then the report strip. **"My tasks this week" leaves Today** (see Choices; its lines are now either today's to-do or suggestions, and earlier days are in My log). Below 1024 px the order is Your day, Working on, Urgent, Today's to-do, This week, Priority tasks, the strip (the rows use `display: contents` and the cards get `order`). Shown to everyone with `report.self`, before and after check-in.
- **Header.** Title "Today's to-do", then muted "2 of 5 done" beside it (only with lines); subtitle "What you'll work on today. It becomes your report." On the right: "Paste a list" (secondary, compact; only once the list has a project, the empty state has its own) and the Slack button (below).
- **Empty** (centred like `EmptyState`, a 44 px ListChecks circle in `--primary-soft`): "Plan your day" / "Add what you'll work on today, by project. Your PM sees it, and it fills your report." with "Add project" (secondary, Plus) and "Paste a list" (secondary, ClipboardPaste). The reminder line (below) shows under them.
- **Groups**, one per project in report order: `ProjectLabel` (md) and a 32 px Trash2 icon button "Remove {project}" (`title` "Remove project"; a trash, so it doesn't look like the X that removes one line) (removes its lines too, Undo toast "Project removed."; refused with "This project has hours in your report. Remove it in the report." when its minutes are above 0). Then the suggestion box (Request 4), the lines, and an input "Add a task" (borderless, 44 px row). Enter adds the line and keeps focus for the next one; Escape clears it. While typing, the report's priority-task suggestions show ("Priority tasks on Studio Ubique", `matchSuggestions`); picking one links the line (`projectTaskId`). Pasting text with more than one line opens the paste dialog with it; its tasks before any heading start on this project (shown as its label with "Change", no red note). From the keyboard, "Add to today" or "Add all to today" that empties the suggestion box moves focus to "Add a task".
- **A line** (48 px): an 18 px checkbox (`accent-color: var(--primary)`, 36 px hit area, `aria-label` "Done: {title}", TaskCheck's pattern), the title (click or Enter to edit inline; Enter saves, Escape cancels; 2 to 500 characters), small tags: "From Wednesday" (neutral, carried lines; "From yesterday", or "From 2 Nov" beyond 6 days), "Blocked" (red soft), "Now" (green with dot); then two 32 px icon buttons (44 px at 640 px and below), muted until hover, always visible on touch: "Start a timer for {title}" (Play) and "Remove {title}" (X; hides it with an Undo toast "Task removed.", deleted when the toast ends). Done lines: muted, struck through.
- **Play** shows only when the person is checked in, not on a break and not checked out, timers aren't off, the group is an active project (not a project request), the line isn't Done and no timer runs on it. It calls `POST /api/me/todo/lines/[id]/timer`: `timers.start` with the project, the line's `projectTaskId` (left out when that priority task is closed) and `note` = the first 200 characters of the title; then, in the same request, the line's `timer_note` = that note, so Fill report from timers merges into this line (`reportTimers.lineFor` matches by `timerNote`) even if the title is reworded later. A set note is part of the report's version, so a report tab opened before Play gets "This report changed somewhere else" on its next save instead of saving the line without its note, and re-reads when it becomes visible. Refusals from `timers.start` are toasted as they come. Once it runs, Play goes (the line is "Now"); if Play had focus, focus moves to the line's title.
- **"Now"** = the person's running entry has the group's `project_id` and its normalised note equals the line's `timer_note` or its title.
- **TimerStartForm** (the Today timer form): after a project is picked, the note field offers that project's not-done to-do lines (same listbox as `matchSuggestions`, heading "Your to-do on Studio Ubique"). Picking one starts the timer through the same `.../lines/[id]/timer` route.
- **Priority tasks card**: each row gets a 32 px Plus icon button "Add to to-do: {title}" (44 px at 640 px and below). It adds a line to the to-do with the task's title and `projectTaskId` (creating the group). When a to-do line already links that task, the button is replaced by a muted check and "In to-do".
- **Add project**: a dashed full-width "Add project" button under the groups opens the report's `ProjectPicker` (no "Ask for a missing project" here; projects already in the list are greyed "In your to-do"; "2 still open" beside projects with suggestions, prop `showOpenCounts`, off in the timer form). Picking one adds the group with the input focused and its suggestion box.
- **Reminder line** (only while suggestions exist for projects not in the list): muted "Still open from past reports:" then each project as a text button with its count, "Acme booking app (2)". Clicking opens the **Still open dialog** (Request 4); it never adds a project by itself.
- **Slack button.** "Post to Slack" (primary, compact; only while Slack is on with a bot token, a to-do channel is set in Settings, and the list has a line: `slack.canPostTodo`). After the click: disabled "Posting…". Sent: muted check "Posted at 9:41 AM". Failed: red "Couldn't post to Slack." and "Try again" (secondary). After the list changes (not after a tick): "Update post" (secondary) beside "Posted at …", then "Updating…". Hidden when the list is empty. While a post is sending, the card asks `GET /api/me/todo` every 5 seconds for up to a minute.
- **After submit**: the card shrinks to its header: "Today's to-do" with subtitle "2 of 5 done. Your report is in." and no buttons (the strip already offers Edit report).
- **ReportStrip**, before submit, when the to-do has lines: body "Your to-do is already in it. Add the hours and check each status." (otherwise as today).
- **Saving**: every action is its own request, applied at once; the result replaces the card's state, except that an answer to a request sent before the one the card last took is dropped, and every change the answer may not hold yet (a write still on its way, or one that ended after the answer was read) stays on top of it, so a box never unticks itself between quick ticks (`today/todoSync.js`). The card re-reads on `router.refresh` (AutoRefresh) unless a write is in flight, with the same rule (the router runs refreshes one after another); text being typed is kept. Errors toast the API's message and put the line back. Undo toasts use `useToastSlot` like `NotificationUndo`.
- **Undo and later actions**: an add to a project whose line (same normalised title or priority task) or whole project waits behind the Undo toast, or whose DELETE is on its way, sends that DELETE first and waits for it before the add goes, so the add never lands in a row about to be deleted (paste, Plus, Still open dialog and "Add a task" alike). A click on a link to another page while such a DELETE waits sends it first and follows the link once it has answered (at most 4 s), so the next page (the report) is drawn without the removed lines.
- **Lines start In progress**, whatever "New tasks start as" says (that preference is for lines added in the report).
- **Narrow**: below 1024 px the header actions wrap under the title; at 640 px and below the buttons share one full-width row and "Posted at …" takes its own line. The paste and Still open dialogs are bottom sheets at 520 px and below. Dark theme from the tokens. Skeleton: a header bar and three 48 px rows in `today/loading.js`, in the new place.

#### Paste a list

- `Dialog` (560 px): title "Paste your to-do"; a textarea "Your list" (rows 8, max 20,000 characters); help: Start each project with "Project:" and each task with * or •. Your usual Slack list works as it is.
- Under it, live: "We found 3 projects and 5 tasks." and a preview per project heading: **exact match**: the `ProjectLabel` and a "Change" text button (which swaps in the Select); **close match**: a `Select` already set to the project, with muted "Matched from "Riverkraft website""; **no match**: red "No project called "Blue Harbour"." and a `Select` "Pick a project" (all pickable projects, plus "Skip these tasks"). Tasks before any heading: "These tasks have no project." and the Select. Lines already in the to-do show muted "Already in your to-do" and aren't added; a line equal to a suggestion shows "From Wednesday" (it is added as a carried line); "(Done)" shows a Done tag.
- Footer: Cancel and "Add 5 tasks" (primary; disabled while a group has no project and isn't skipped, or nothing is new; the count includes the new tasks of a group still waiting for its project, as the prototype). Done: toast "Added 5 tasks."
- **Parser** (`src/modules/reports/todoText.js`, pure, browser-safe): `parseTodoText(text)` → `{ groups: [{ heading, lines: [{ title, status }] }], loose: [...], skipped: n }`:
  - Lines are trimmed; blank lines skipped; spaces collapse.
  - Ignored anywhere: "Tasks" and "Today's to-do" alone, "Date: DD-MM-YYYY" and "Hours: 2h 15m" (Daybook's own formats). Ignored only before the first heading: "Name: …". Any other "Date: …" line is a task.
  - **Bullets**: `*`, `•`, `◦`, `▪`, `‣`, `+`, `-`, `–`, `—`, `·`, or a number with `.` or `)` **followed by a space** (`\d+[.)]\s+`). So "1.5h keyword audit" and "2.0 launch checklist" keep their text, and "1 web blog publish" keeps its number.
  - **Headings**: "Project" followed by `—`, `–`, `-` or `:` (spaces optional), then the name: always a heading ("Project— Pine Tree lane", "Project- Studioubique", "Project: Dotado"). "Project" followed only by a space: a heading only when the rest matches a project exactly ("Project kickoff call with client" is a task). A non-bullet line ending with ":" is a heading only before the first heading, or when its text matches a project ("Follow up with the client about:" under a heading is a task).
  - A non-bullet line under a heading is a task; lines before any heading are `loose`.
  - A trailing "(Done)", "(In progress)" or "(Blocked)" sets the status (Done = ticked); otherwise In progress.
  - Titles under 2 or over 500 characters are skipped and counted. Headings with no lines are left out. At most 20 projects and 50 tasks each, as the report.
  - `matchProject(heading, projects)`: normalise both (lowercase; accents and everything but letters and digits removed). Equal = exact ("Studioubique" = "Studio Ubique"). Else **close** = exactly one project whose normalised name starts with the heading's, or the heading's starts with the name's, with both at least 4 characters ("Riverkraft website" → "Riverkraft"; "Website SEO audit" never picks "SEO"). Else none.

#### How it becomes the report (reports)

- The first to-do write of the day creates today's draft (`openForDate`, without copied lines, see the company rule), then its project card (0 minutes) and the line. The evening report already has every project and task: ticked lines are Done, the rest In progress, Blocked stays Blocked. The person adds the hours, checks each status and submits; nothing is typed twice.
- Report page notice above the cards while the draft has a line and a project at 0 minutes: "Add the hours for each project and check each status. Tasks you ticked on Today are Done." (muted Card, Info icon).
- A planned project's card shows, under its head, muted "Not worked on today. Its tasks stay open." instead of an error (company rule). The Slack preview leaves it out.
- Writes from Today while the report is open in another tab make that tab show the existing "This report changed somewhere else" notice on its next save (unchanged); the report tab re-reads when it becomes visible (`ReportProvider.jsx:257-280`).

#### Who sees what (dashboards)

The to-do is part of the report, so whoever sees reports sees it: **the person, every PM and Admins (the CEO), live; not HR** (HR has no report view).

- **Team board** "Projects today" (PM and Admin), **before submit**: only the running timer's project (green "Now" and its label, as today) and a text button "To-do: 2 of 5 done" (ChevronDown) that opens a popover (380 px, menu surface; right-aligned on desktop, left-aligned at 640 px and below): "Priya's to-do", muted "Posted to Slack at 9:41 AM" or "Not posted to Slack" (only while posting is on: Slack on, a bot token and a to-do channel, the rule of the Today button, `slack.canPostTodo`), the groups with a filled green check or an empty circle per line, the tags as on Today, and "Open Priya Sharma's page". Planned projects are not shown as labels, so they don't read as worked. **After submit**: the submitted projects with hours, as today, plus the same button. A checked-in person with no lines: muted "No to-do yet". New filter pill "No to-do (2)" (`?filter=no-todo`): checked in, report not submitted, no lines.
- The board's Report cell reads "Draft" from the first to-do line (it is a draft report). That is expected.
- **Employee detail** (`/team/[userId]`): a "Today's to-do" card above Report history, read-only, subtitle "2 of 5 done · Posted at 9:41 AM" (or "Not posted"); empty: "No to-do yet today." Report history shows closed lines with a muted note: "Marked done on Thu, 12 Nov" or "Marked not needed on Thu, 12 Nov".
- **Tasks to watch** (`dashboard/repo.listOpenTasks`) and the stuck-task count leave out closed lines.
- No overview item and no reminder for missing to-dos in this release (the to-do is optional).
- The project report, Hours tab and AI PM summary still read submitted reports; planned projects add 0 minutes. Ask AI (`aiAsk/repo`: hours, people, days, task lines, project people) and a priority task's latest report (`projectTasks/repo.listReportLines`) leave planned entries out, so a planned line never reads as worked.

#### Slack (system)

- Posting is the person's choice: "Post to Slack" calls `reports.queueTodoPost({ user })`. In one transaction that locks the `daily_reports` row it builds the text with `formatTodo` and the hash, refuses an empty list ("Add a task first."), and calls `slack.queueTodoPost({ reportId, userId, text, hash, update })` (as the person, `username`/`icon_url` like reports) to `slackTodoChannelId` (never the report channel). Needs `slackEnabled` and a `slackTodoChannelId`; otherwise the button is hidden and the route answers `CONFLICT` (409) "Slack posting is off." Audit `report.todo_post` with the report id.
- **Delivery** mirrors `deliverReport`: a row is skipped when a newer to-do row exists for the same report (two quick clicks send one, up-to-date, message); a `todo_post` is sent as `chat.update` when the report already has `todo_slack_ts`; `MESSAGE_GONE` posts again. `markSent` stores the channel, ts, `todo_posted_at` and `todo_post_hash` through `reports.saveTodoSlackMessage`. The newer-row check (`slack/repo.js:42-60`) learns `related_type 'todo'`. `slack.latestTodoDelivery(reportId)` → `{ status, at }` gives the card its Posting / Posted / Couldn't post state.
- `post.changed` = the current plan's hash differs from `todo_post_hash`, so "Update post" shows after an edit, never after a tick.
- `formatTodo({ userName, workDate, entries })` in `@/modules/slack/format` (pure). Empty projects and titles are left out; done lines get " (Done)", blocked " (Blocked)"; escaped with `escapeSlackText` when queued:

```
Name: Priya Sharma
Date: 12-11-2026
Today's to-do

Project: Pine Tree Lane
• Monitoring google ads campaign and removing irrelevant search terms

Project: Studio Ubique
• 1 web blog publish
• Analysing the gsc stats to improve web blog content
• 1 listicle content post on linkedin

Project: Dotado
• 2 Web blog topic research
```

- **Settings → Slack**: one more field under the report channel, "Post to-dos to" (`Select`): "Don't post to-dos" (default), then the bot's channels. Help: "Pick the channel for people's morning to-do. Until one is picked, the Post to Slack button stays hidden. Add the Daybook app to the channel first." It writes `slackTodoChannelId`/`Name` (null for "Don't post to-dos").

### Request 4: unfinished tasks are suggested when you pick the project

- **Where**: a box under a to-do group the moment its project is added (picker, paste), and inside a report card when its project is picked ("Add another project", or changing a card's project). `ProjectPicker` shows muted "2 still open" beside a project with suggestions.
- **The box** (`--surface-muted`, 1px `--line` border, radius 12, padding 12 16): title "Still open from past reports", help "Add the ones you'll work on today. Mark the rest done or not needed." Each row: the title, its status tag (In progress primary soft, Blocked red soft), its day tag ("From Wednesday"), then "Add to today" (secondary, compact), "Done already" (secondary, compact, Check icon) and "Not needed" (text button). With two or more rows: "Add all to today" (text button). The box goes away when it is empty. Rows wrap under the title on phones.
  - **Add to today** = a carried line in today's list, keeping its status.
  - **Done already** = closes the old line with reason `done`. Today's report is not touched, so no project is forced into today. Toast "Marked done." with Undo. It leaves suggestions and Tasks to watch. (If the work was done today, use "Add to today" and tick it.)
  - **Not needed** = closes it with reason `dropped`. Toast "Marked not needed." with Undo. Same effects.
- **Still open dialog** (`Dialog`, 560 px, bottom sheet at 520 px and below), from the reminder line on Today or in the report: title "Still open from past reports", the same help, every suggestion grouped by project (`ProjectLabel` heading, then rows as above), footer "Close". "Add to today" here adds the project's group (or card) and the line; the other two never add a project.
- **Nothing is duplicated**: a suggestion disappears once any line (draft lines too) is carried from it, or a later line on the project has the same normalised title, or it is closed. Typing or pasting a title equal to a suggestion's on the same project makes that line carried, and so does renaming a line on Today to such a title (`updateTodoLine`: the line keeps its id, takes the source's `first_reported_on`, `project_task_id`, `timer_note` (its own when the source has none) and status (unless it is Done); a line already carried keeps its link).
- **Carry forward off** (My settings): no suggestions, no reminder line, no "still open" hints.
- **My settings** copy (preferences): the `carryOver` toggle becomes "Suggest my unfinished tasks", help "When you pick a project, its unfinished tasks from past reports show up." The key and its default (on) don't change.
- **Report save** (`taskInputSchema` gains `carriedFromTaskId`, positive integer, optional). In `save.js writeEntries` it is checked **only on lines being inserted**: the source must be the person's own line, in a submitted report before this day, on the same project (or request), In progress or Blocked, not closed, and not carried by another line, ignoring lines of this report that this same save deletes and lines of a lapsed draft; one claim per source per save; `carried_from_task_id` of an existing line never changes. When it passes, `first_reported_on`, `project_task_id` and `timer_note` come from the source; otherwise it is dropped and the line saves as new. The report card shows the existing "Carried over" tag while it has a carried line.

### Modules

- `@/modules/reports` (new files `todo.js`, `suggestions.js`; pure `todoText.js`):
  - `getTodo({ user, date?, timerState? })` → `{ workDate, reportId, editable, submitted, done, total, post: { state: 'none'|'sending'|'sent'|'failed', at, changed, postedAt }, slack: { canPost }, timer: { canStart }, groups: [{ entryId, project: { id, name, color } | request: { id, name }, minutes, lines: [{ id, title, status, done, projectTaskId, now, carriedFrom: { workDate, dayLabel } | null, canStart }] }], suggestions }`. Never creates the draft. `timer.canStart` and `line.canStart` are the Play rule.
  - Writes: `addTodoLine({ user, projectId?, projectRequestId?, title, projectTaskId?, carriedFromTaskId? })` → the to-do plus `added` (false for a duplicate) and `lineId`, `addTodoLines({ user, groups: [{ projectId | projectRequestId, lines: [{ title, status }] }] })` → `{ added, skipped, todo }`, `updateTodoLine({ user, id, title?, done? })`, `removeTodoLine({ user, id })`, `removeTodoProject({ user, entryId })` → the to-do, `startTodoTimer({ user, id })` → the to-do plus `timerState` (what `POST /api/timers/start` answers).
  - **Write flow** (no deadlocks on the first add): call `openForDate` **outside** the transaction (insert, catch ER_DUP); then in the transaction lock the existing row with `findByIdForUpdate`, re-read its entries under the lock, find or insert the project's entry, write the line. Retry the whole write once on errno 1213. Every transaction that inserts or links lines (the to-do writes, the report save and submit, closing a suggestion) runs at **READ COMMITTED** (`reports/writeTx.js` `lineTransaction`; a server whose binary log is in statement format refuses that with errno 1665, and then it falls back to the default level with one warning), and the report save and submit retry once on 1213 too: under REPEATABLE READ the share-locked read of a source's carriers took gap locks, and two people carrying at once deadlocked. The carriers are read plainly after `lockLines` locks the source FOR UPDATE (every claim and close locks it first). The project-request check (`confirmRequests`) reads the request's status and requester with its share lock, on the transaction's own connection, never through a second pool connection while the report row is locked. Refuse `REPORT_LOCKED` after submit ("Your report is in. Change tasks in the report.") and the report's limits ("A report can have up to 20 projects.", "A project can have up to 50 tasks.", "Write at least 2 characters."). A duplicate title on the same project (normalised) is skipped, not an error.
  - `listCarrySuggestions({ userId, date })` → `{ [projectKey]: [{ taskId, title, status, workDate, dayLabel }] }` (`projectKey` `p12` or `r4`; 20 projects, 10 lines each), one query plus the active-project check; `{}` while `carryOver` is off.
  - `closeSuggestion({ user, taskId, reason, undo?, ip? })` → `{ taskId, closed, reason }` (`reason` null after an undo): `NOT_FOUND` for a line that isn't the person's own or isn't open (never `FORBIDDEN`).
  - `queueTodoPost({ user, ip? })` → `{ queued: 'post' | 'update', todo }` (`todo` with `post.state` 'sending'); `saveTodoSlackMessage({ reportId, channelId, ts, hash, at })` (called by slack).
  - `submit.js`, `timerCheck.js`: the planned-project rule. `formatReport` input leaves out planned projects.
- `@/modules/slack`: `queueTodoPost`, `latestTodoDelivery`, delivery of `todo_post`/`todo_update`, `formatTodo` in `format.js`; `OUTBOX_KINDS` and the newer-row check.
- `@/modules/dashboard`: board row `todo: { total, done, post, groups } | null`, labels only after submit, the `no-todo` filter; `getEmployee` gets `todoToday`; `listOpenTasks` leaves out closed lines.
- `@/modules/timers`: unchanged; `startTodoTimer` calls `timers.start({ user, projectId, projectTaskId, note })`.
- **Client imports**: client components may import `@/modules/reports/todoText` (pure, browser-safe), an exception to §2 like `@/modules/slack/format` (whose `formatTodo` the card does not need, but may use).

### API

| Route                                                                                                    | Permission    | Notes                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `GET /api/me/todo`                                                                                       | `report.self` | today's to-do with suggestions                                                       |
| `POST /api/me/todo/lines` `{ projectId \| projectRequestId, title, projectTaskId?, carriedFromTaskId? }` | `report.self` | returns the to-do plus `added` and `lineId`                                          |
| `POST /api/me/todo/lines/bulk` `{ groups }`                                                              | `report.self` | the paste; returns `{ added, skipped, todo }`; reads its own body, over 128 KB → 413 |
| `PATCH /api/me/todo/lines/[id]` `{ title?, done? }`, `DELETE` same                                       | `report.self` | own line in today's draft only, else `NOT_FOUND`                                     |
| `POST /api/me/todo/lines/[id]/timer`                                                                     | `report.self` | starts a timer on the line (see Play); returns the to-do plus `timerState`           |
| `DELETE /api/me/todo/projects/[entryId]`                                                                 | `report.self` | 409 when the project has minutes                                                     |
| `POST /api/me/todo/slack`                                                                                | `report.self` | post or update → `{ queued, todo }`; 6 a minute per person                           |
| `POST /api/me/carry-suggestions/[taskId]/close` `{ reason: 'done' \| 'dropped', undo? }`                 | `report.self` | own open line only, else `NOT_FOUND`; → `{ taskId, closed, reason }`                 |
| existing `PUT /api/reports/[id]`                                                                         | unchanged     | tasks may carry `carriedFromTaskId`                                                  |
| existing `GET /api/team/today`, `team/[userId]`                                                          | unchanged     | now return `todo`, `todoToday`; HR still `FORBIDDEN`                                 |

**Rate limits are per person** (the office shares one IP, and `withRoute`'s `rateLimit` keys on IP): each handler calls ``checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`)`` as `api/me/preferences/route.js` does; 60 writes a minute, 6 Slack posts a minute, 120 reads of `GET /api/me/todo` a minute. Owner: reports (`me/todo/**`, `me/carry-suggestions/**`).

### Files and owners

| Owner        | Files                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orchestrator | `db/migrations/017_todo.js`, `db/seeds/03_settings.js`, `src/config/version.js`, this section                                                                                                                                                                                                                                                                                                                                     |
| reports      | `src/modules/reports/{todo,suggestions,todoText}.js` (+ `index`, `schemas`, `drafts`, `save`, `submit`, `timerCheck`, `repo`), `api/me/todo/**`, `api/me/carry-suggestions/**`, `(app)/report/CarrySuggestions.jsx`, `StillOpenDialog.jsx` (+ css), `report/ProjectCard.jsx` (planned line), `report/ProjectPicker.jsx` (+ css: "2 still open", `usedLabel`, `showOpenCounts`), `report/ReportEditor.jsx` (notice, reminder line) |
| attendance   | `(app)/today/TodoCard.jsx`, `TodoPasteDialog.jsx` (+ css), `page.js` and `page.module.css` (new order, no TasksCard), `todayData.js`, `TodayCards.jsx` (ReportStrip copy), `PriorityCard.jsx` (Add to to-do), `TimerStartForm.jsx` (to-do lines in the note), `loading.js`                                                                                                                                                        |
| dashboards   | `src/modules/dashboard/{team,employee,repo}.js`, `(app)/team/TodoPopover.jsx`, `TodoList.jsx` (+ css), `TeamBoardCells.jsx`, `TeamBoard.jsx`, `team/[userId]/page.js`, `ReportHistory.jsx` (closed note)                                                                                                                                                                                                                          |
| system       | `src/modules/slack/{format,service,outbox,schemas,repo}.js`, `src/modules/settings/schemas.js`                                                                                                                                                                                                                                                                                                                                    |
| people-admin | `(app)/settings/SlackSection.jsx` ("Post to-dos to"), `settingsValues.js`                                                                                                                                                                                                                                                                                                                                                         |
| preferences  | `(app)/my-settings/MySettingsSections.jsx`, `src/modules/preferences/schemas.js:36` (the `carryOver` label)                                                                                                                                                                                                                                                                                                                       |

### Tests and version

- **Unit**: `parseTodoText` (the owner's exact text gives 3 projects and 5 tasks; "Project—", "Project-", "Project:", "Project kickoff call with client" is a task; "1.5h keyword audit" and "2.0 launch checklist" keep their text; "1 web blog publish" keeps its number; "Date: confirm launch date with client" is a task; "Date: 12-11-2026" and "Name:" before a heading are ignored; "Follow up with the client about:" under a heading is a task; "◦ nested sub task" loses its bullet; every bullet; "(Done)"; loose lines; empty headings; length limits), `matchProject` (exact after normalising, close by prefix, "Website SEO audit" against "SEO" is none, two candidates = none), `formatTodo` (the owner's layout, Done and Blocked suffixes, empty groups left out), `dayLabel`.
- **Services** (`DB_NAME=daybook_test_<n>`, fake Slack transport): the first line creates the draft with no copied lines; **5 parallel first adds give one report and one entry**; tick and untick; remove line and project (refused with minutes); bulk with duplicates; a typed title equal to a suggestion becomes carried **and copies `timer_note` and `project_task_id`**; suggestions (30 days, every open day, newest wins, carried, closed, same later title and inactive excluded; carry forward off gives none); Done already and Not needed close the old line, leave today's report alone and drop it from Tasks to watch; `carriedFromTaskId` on report save (own and open: kept; someone else's, done, closed, other project, already carried: dropped; **remove and re-add in one save keeps the link**); **plan 2 projects, log hours on 1, submit: it passes, Slack shows one project, and the other project's lines are suggested tomorrow**; a Done line at 0 hours is refused; Start timer (refused before check-in, on a project request, on an inactive project; a closed priority task is dropped; a 300-character title gives a 200-character note and the line's `timer_note`; Fill merges into that line); Slack (post then update on the same ts, **two quick posts give one message**, posting off 409, `changed` after an edit and not after a tick, a failed delivery shows `failed`); `REPORT_COLUMNS` and the suggestion read before the migration; per-person rate limit; HR gets `FORBIDDEN` on `/api/team/*` with to-do data.
- **Rewrites** (carry-over now suggests): `tests/services/reportsCarryOver.test.js`, `reportsPriorityLinks.test.js`, `reportsTimerNote.test.js`, `dashboard.employee.test.js`, `tests/unit/reportPreferences.test.js`, and `reports.test.js` where it expects copied lines.
- **E2E** `tests/e2e/todo.spec.js`: an employee pastes the owner's text, ticks a line, sees no "Post to Slack" (the e2e server has no Slack connection, and the route answers 409 "Slack posting is off."; posting, updating and a failed post are covered with the fake transport by the service and card unit tests), picks a project with a suggestion, clicks Done already, opens the report, sees every line with the right status, leaves Dotado at 0 hours and submits; a PM opens the board popover; HR can't open it. `APP_VERSION` '1.09'.

Also update CONTRACT §7 ("Later sections add: ... reports → `me/todo/**`, `me/carry-suggestions/**` (24)"), §9 (the owner rows above) and §21 (the `carryOver` row of the preferences table and the "Carry-over off" bullet: carry forward now suggests, it no longer copies).

### Owner's answers (12 Nov 2026)

1. **One list.** The to-do is the start of today's report; planned projects can be submitted at 0 hours and their tasks come back next time.
2. **Suggest, don't copy.** The company rule above applies: drafts stop copying unfinished tasks.
3. **Slack: a separate to-do channel**, created by the company and picked by an Admin in Settings → Slack. Posts only when the person clicks "Post to Slack". No channel picked = no button.
4. **No preference** on "My tasks this week": the recommended option applies, the to-do replaces it on Today.

Not choices, stated for the record: the to-do is optional (no reminder, no CEO alert in this release); PMs and Admins see it live, HR doesn't, as with reports.

## 25. HR tools, breaks and missing check-outs (company request, Daybook 1.10)

Twelve asks from the owner, approved for one release (scope of 19 Nov 2026), shipped as version
'1.10' with **one** new migration, `db/migrations/018_hr_tools.js` (017 and earlier are never
edited):

- **A.** Time removed from a timer as away time is a break (a bug: HR never saw it).
- **B.** A pop-up on Today for the person's own missing check-outs (promised to the company).
- **1.** Morning HR summary and evening wrap-up. **2.** Breaks for HR: who is on a break, every
  break of a day, fixing a break. **3.** Half day, short day and left early marks. **4.** Month view
  and one Excel for the month. **5.** Automatic check-in reminder and Remind buttons (the "Nudge"
  promised to the company). **6.** Company holidays. **7.** The full missing check-out list with
  suggested times and bulk fix. **8.** One person's attendance month for HR. **9.** Leave days.
  **10.** Late count this month, "Needs a look this month" and the late alert to HR.

Written against the code at `bbb146e` (1.09). Names marked **new** don't exist yet; every other
name is in the code. The proposed migration is `scratch/design-1.10/018_hr_tools.js` (with its pure
backfill rule `scratch/design-1.10/removedSpans018.js`, for `db/lib/`) and the settings defaults
`scratch/design-1.10/settings-additions.js`; all three are part of this section.

**Design:** no artboard exists for these screens. The orchestrator first builds
`docs/design/hr-tools-prototype.html` (standalone, the real tokens, as §23 and §24 did) from this
section: Attendance day for HR with the new cells and side cards, Month, Person month, Missing
check-outs, Holidays, Leave with Mark leave, the break list, and Today with the missing check-out
pop-up and the removed-time row; light and dark, 1440 and 390 px. Its look, layout and copy bind
every builder's new screens; where it and this section differ, this section wins and the prototype
is fixed.
The scope is approved, so builders don't wait for a sign-off on it. Everything is built from
artboard 09 (Attendance: KPIs, side cards, the day table, `RowAction`) and artboard 01 (Today), with
the existing components only (`Card`, `CardHeader`, `DataTable`, `Dialog`, `Field`, `Input`, `Select`,
`Textarea`, `Toggle`, `Segmented`, `FilterPills`, `Menu`, `StatusCell`, `Tag`, `Badge`, `Kpi`,
`Avatar`, `EmptyState`, `Skeleton`, `DateSwitcher`, `Breadcrumb`, `MonthCalendar`, `useToast`) and
the design tokens; light and dark, desktop, below 1024 px and 390 px. Dialogs are bottom sheets at
520 px and below (§24). Below 1024 px every `DataTable` becomes stacked cards (`data-label`). The
wide tables (Missing check-outs, the month, the person month's "Each day") are cards from 1024 to
1279 px too (`DataTable` `stackBelow={1280}`), and the person month's days take the full width
below 1440 px, so no column hides behind a sideways scroll on a laptop. On a phone (640 px and
below) HR's controls have a 44 px hit area: the row menus ("...", Attendance, Holidays, Leave) and
their items, Fix and Remind on the Missing check-outs cards, the bulk bar's buttons, a missing
check-out's Fix, and the leave sheet's "Delete leave" and `Segmented` items.

**Copy:** short and plain, no dashes, except the ranges the existing helpers write
(`formatDayRange` "Mon, 23 – Wed, 25 Nov", `clockRange` "1:10–1:42 PM"). **A day is always written
with `formatDayShort`** ("Fri, 13 Nov"): the owner's "Fri 13 Nov" is written "Fri, 13 Nov", as §24
wrote the owner's "Project— X" as "Project: X". Example people: Priya Sharma, Vishal Saini, Karan
Mehta (employees), Neha Kapoor (HR).

### Words

**Days**

- **Weekday** = a date whose ISO weekday is in Settings, Working days (`settings.workingDays`).
- **Holiday** = one company-wide date with a name ("Guru Nanak Jayanti"), the same for everyone
  (new table `holidays`). A festival of three days is three rows. A holiday on a date that isn't a
  weekday is kept but changes nothing until that weekday becomes a working day.
- **Working day** = a weekday **that is not a holiday**. Every place that asked
  `isWorkingDay(date, workingDays)` now asks this (the table "Every place that decides a working
  day").
- **Leave** = a range of dates HR or an Admin marked for one person (new table `leave_entries`).
  Only the working days inside the range are leave days: Friday to Monday is 2 days, and a holiday
  inside a leave isn't a leave day. A half day (first or second half) is always one date.
- **Half-day split** = the middle of the person's own shift (`users.shift_start`/`shift_end`, else
  `officeStart`/`officeEnd`), rounded down to the minute: 9:30 to 6:30 gives **2:00 PM**. First
  half = until the split; second half = from the split.
- **The person's day** (`PersonDay`) = what Daybook expects of one person on one date. One pure
  function decides it (`attendance.personDay`, below); every job and screen asks it.
- **Expected** = 1 on a working day; 0.5 with half-day leave; 0 on a day that isn't a working day,
  with full-day leave, before the person's `joined_on`, after the day they left (`leftOn`, the
  company date of `users.deactivated_at`), or for someone who doesn't track attendance.
- **Own late mark** = `PersonDay.lateMark`: `attendance.lateMarkFor({ shiftStart, settings })`
  (§16), the split plus the company's grace on first-half leave, none when expected is 0.
- **Day end** = `PersonDay.dayEnd`: the person's own shift end (`shiftEnd`, else `officeEnd`), or
  the split on second-half leave. Left early, the "check out" and "check in" reminds, the evening
  "still checked in" list and the away "I had left" offer all use it. The self-fix limit uses the
  own shift end (`PersonDay.shiftEnd`, the owner's words), never the split.
- **Off** = expected 0 and no check-in: "Holiday", "On leave" or "Day off" (a weekday the company
  doesn't work).
- **Presence** = what the Where column and every "Not checked in" count say about a person at a
  moment: `office`, `wfh`, `unverified` (from the check-in, as today), else `holiday`, `day_off`,
  `on_leave`, or `not_checked_in` only when the person is expected now.
- **Colours** (one mapping everywhere: `StatusCell`, `MonthCalendar`, `Tag`s, the Team board): leave
  = teal (`--label-teal-bg` / `--label-teal-text`), holiday = green (`--green-soft` /
  `--green-text`), day off = neutral.
- **Last working day** = the latest working day before a date, within 14 days
  (`attendance.lastWorkingDayBefore`). The "Missing check-out" number covers `missingWindow`: from
  the last working day to yesterday, so a weekend or holiday never hides Friday's.

**Breaks**

- **Break** = one `attendance_breaks` row. It now has a **source**: `self` (Start break on Today,
  every row before 1.10) or `away` (time removed from a timer).
- **Away break** = a finished break with source `away` and `end_reason 'away'`. It is saved when
  the person answers "Remove, it was a break", and rebuilt by migration 018 for Removes since
  1 Nov 2026. **It counts exactly like any other break everywhere**: one "Breaks" total, the
  allowance, the Over tag, the notice, worked time, Excel, the month view, AI HR notes, Ask. Only
  the break list (item 2) and Today's timer card tell it apart.
- **Away span** = a stretch inside one of **today's timer entries** (`source 'timer'`, running or
  finished) that the person is asked about. It is made of **pieces** that follow each other within
  150 s (`MERGE_GAP_MS`): idle or locked Idle Detection segments (`source 'system'`, as in 1.09),
  and **no-data gaps**. It has **ended** when a later segment of any state starts after it. Its
  `kind` is `away` when it holds at least one idle or locked segment, else `no_data`.
- **No-data gap** = more than 150 s (`CONTINUE_MS`, the heartbeat's limit) between the end of one
  screen-time segment and the start of the next, **both with `source 'system'`** (laptop asleep,
  browser closed). A gap next to a window-only segment never counts (window mode can't tell away
  from working elsewhere, §11), and neither does the time before the day's first segment or after
  its last one. It also counts only when **someone else's screen time was recorded during it,
  more than 150 s from both its ends** (`activity.anyoneSeenBetween`): a failed heartbeat is
  dropped, not queued (`ActivityTracker.track.js` answers `retry`), so while Daybook is down or
  restarting nobody reports, and such a gap is never asked about. The 150 s are there because two
  people's heartbeats are up to that far apart: a colleague's last beat before an outage, or first
  beat after it, can fall just inside the person's gap although nobody reported during the outage.
  So a gap of 300 s or less never counts.
- **Put back** = the person's undo of a Remove, from Today: the away break goes and the time goes
  back on the timer.
- **Break fix** = HR (or an Admin) changes a break's end or deletes it, with a reason, audited.

**Time and marks**

- **Worked** = present minus breaks, exactly `attendance/rules.js workedMinutes(row, breaks, at,
tz)` (§15). A missing check-out has no worked time.
- **Finished day** = a row with `checkoutStatus` `checked_out`, `auto` or `corrected`.
- **Marks** (item 3) are worked out when read, never stored: **Half day**, **Short day**, **Left
  early**. A day has at most one of Half day and Short day; Left early can come with either.
- **Effective late** = the late minutes a day counts with: `attendance.late_minutes` as stored
  (kept right by `applyDayRules` when a holiday or leave changes), and 0 whenever the day has no
  late mark (`PersonDay.lateMark` null: not a working day, full-day leave, not employed). Every
  reader (the day list, the Late pill and KPI, marks, "4th this month", the month view, Needs a
  look, the alert, the summaries, AI HR notes) uses it.
- **Payroll month** = the period HR pays by. `payroll_month_start_day` 1 = the calendar month;
  26 = the 26th to the 25th of the next month, **named after the month it ends in** ("November
  2026" = 26 Oct to 25 Nov 2026). Its key is that month, `YYYY-MM`. "This month" in this section
  means the payroll month.
- **Present day** (month) = a working day with a check-in: 1, or 0.5 with half-day leave. It goes to
  Office (office and unverified) or WFH by `location`, so Office + WFH = Present.
- **Day off worked** = a check-in on a day that isn't a working day (weekend or holiday). Counted on
  its own, never in "Days present", never marked, never late.
- **Leave day** = full 1, first or second half 0.5, paid or unpaid; only on working days.
- **Absent day** = a working day **before today** with no check-in: 1, or 0.5 with half-day leave,
  0 with full-day leave. Today is never absent ("Not checked in yet"). Per person and past working
  day: present + leave + absent = 1.
- **Missing report** = a day with a check-in and no submitted report, for people with
  `report.self`; today only from `reportReminderAt` (the HR notes rule, §20). HR only ever sees yes
  or no, never the report.
- **Needs a look** = someone whose payroll month so far has at least `late_alert_days` late days,
  or that many short days (half and short together), or that many missing reports.

**Check-outs and reminders**

- **Missing check-out** = an `attendance` row with `checkout_status 'missing'` (set by the 00:05 job
  `markMissingCheckouts`, `attendance/service.js:214`). **Unfixed** = still `'missing'`; the same
  set `repo.listMissing` / `repo.countMissing` read (active people who track attendance; Admins'
  rows hidden from non-Admins, §16). In the month view (item 4) a **missing check-out (month)** is a
  row of the period that was marked missing at midnight, fixed since or not (audit action
  `attendance.mark_missing` on the row, or still `'missing'`); **not fixed** = still `'missing'`.
  An **auto check-out (month)** = audit action `attendance.auto_checkout` on the row, or
  `checkoutStatus 'auto'` (a later fix turns `auto` into `corrected`; the audit row keeps it
  counted).
- **Suggested time** = the last moment Daybook saw the person working on that work date, computed
  as auto check-out does: `lastSeenWorking({ segments, timerAt, breaks, at })`
  (`attendance/autoCheckout.js:53`: active screen time of any source, window-mode idle, the timer's
  last run, break starts and ends) with `at` = the earlier of now and the end of the work date;
  used only when it is after the row's check-in (`autoCheckoutTime`'s rule), cut to the minute.
  For a past work date `timerAt` is the end of the last **finished** timer entry
  (`timers.lastRanByUser`): a timer still running from a past date gives no sign (`lastRanAt` would
  answer "now"), so the pop-up and HR's list always show the same time. Otherwise there is **no
  suggestion**. It is one time, never the segments: the only value derived from screen time that HR
  ever sees.
- **Self-fix limit** (the owner's rule) = max(own shift end (`PersonDay.shiftEnd`), suggested time
  - 15 minutes) on a day the person was expected (`day.expected > 0`, half-day leave included). On a
    day with expected 0 (not a working day, full-day leave, before joining) there is no shift, so it
    is the suggested time + 15 minutes, and with no suggestion every time goes to HR. Never past 23:59
    of the work date. A time after check-in and at or before the limit is **saved straight away**; a
    later time **goes to HR** as a `check_out` correction request (the existing flow).
- **Past last seen** = a check-out the person entered themselves that is more than 15 minutes after
  the suggested time, or entered with no suggestion. HR sees a marigold "Check" tag beside "By
  Priya" (items 5 and 8). Worked out from `attendance.checkout_suggested_at` when read, never
  stored as a flag.
- **Entered by** = who typed the check-out of a row that was missing: the person (pop-up), or HR
  (Fix, bulk fix, and any later HR Edit of that check-out, so it always names whoever typed the time
  shown). Stored on the row (new `attendance.checkout_entered_by`, `checkout_entered_at`, and
  `checkout_suggested_at` = the suggestion the person saw, null for HR), shown as "By Priya". An
  approved correction request clears all three (the row reads "Corrected" as today).
- **Remind** = one message to one person about one **kind**, sent by HR or an Admin from
  Attendance, or by Daybook (the automatic check-in reminder). Kinds (new ENUM):
  - `check_in`: presence `not_checked_in` today, the own late mark has passed and the day end
    hasn't (someone on second-half leave isn't asked after the split);
  - `break`: on a break now and today's breaks are over `breakAllowanceMinutes` (never while the
    allowance is 0);
  - `check_out`: still checked in (open row today) after the day end, and not a `break` case;
  - `missing_checkout`: has at least one unfixed missing check-out (any day) **without a pending
    `check_out` correction** (the person already told HR a time: B's rule), and today is a working
    day for them without full-day leave.
    Every remind is one row in new `attendance_reminders`, and a bell notification (so a desktop push,
    §14) plus a Slack DM.
- **The 30-minute rule**: at most one remind per person per kind per 30 minutes, automatic ones
  included (constant `REMIND_EVERY_MINUTES = 30`, not a setting).
- **HR recipients** (summaries) = active people with role `hr`; the active Admins when there is no
  HR (the rule of `aiSummaries/hrNotes.js:47 recipients()`). Each recipient's message only covers
  people they may see (`showsAttendanceOf(recipient, person)`, §16) and never themselves. Alerts
  about one person go to `pickRecipients(pools, person)` (`attendance/recipients.js`: HR, or the
  Admins when there is no other HR; about an Admin, the other Admins only).

### Company rules (owner, scope of 19 Nov 2026)

> **Away time is a break (overrides §15 "Away time"):** removed away time is a break. "Remove" ends
> the timer at the span's start and saves the span as an away break, in the same transaction. The
> question is asked about every one of today's timer entries (not only the running one), also for
> gaps with no screen time (Idle Detection only), and an away span that starts at or after the
> person's day end (less the left early grace) offers "I had left, check me out at 6:42 PM" instead
> of "Remove".
>
> **HR fixes breaks (overrides §15 "HR edits and corrections never touch breaks"):** HR and Admins
> may change a break's end or delete it, with a reason. Their edits of check-in and check-out still
> never touch breaks (the overlap clips them), and no HR change ever touches a timer.
>
> **Holidays (overrides build guide 7.2.4 and 7.10, §15 "Reminder", §16 "Late grace", §19 and §20
> "Weekly HR notes"):** a company holiday is not a working day. On a holiday there are no late marks,
> no "Not checked in", no timer, report or check-in reminders, no PM summary and no HR summary,
> exactly as on a weekend. Someone who checks in on a holiday is working: the row is saved with
> `is_working_day = 0` and `late_minutes = 0` (weekend work, migration 003), and the check-out
> reminder, auto check-out and the midnight missing check-out rule apply to them as on any day.
>
> **Leave:** full-day leave = expected 0: not "Not checked in", no late mark, no check-in reminder.
> First-half leave = expected from the split: late after the split plus the company's grace
> (`lateAfter − officeStart`, as `lateMarkFor`). Second-half leave = expected until the split: the
> late mark is the normal one and the day end is the split. A check-in on a leave day is always
> allowed and counts as worked; the leave stays until HR changes it.
>
> **Half-day leave and the marks:** full-day leave: no marks, never absent. First-half leave: no Half
> day mark; Short day when worked is under half the short-day time (240 min by default); Left early
> against the day end as usual. Second-half leave: late as usual; no Half day mark; Short day under
> half the short-day time; Left early against the split. A check-in on a full-day leave day counts
> as a present day (the check-in wins, leave 0), is flagged "Checked in on a leave day" for HR, and
> gets its marks as a full working day (Half day and Short day at full size, Left early against the
> shift end), matching present 1.
>
> **Shorter shifts:** the half-day and short-day times are for the office day (`officeStart` to
> `officeEnd`). For someone whose own shift is shorter, both scale by own shift ÷ office day (never
> above 1): a 6-hour shift against the 9-hour office day marks Short day under 320 min and Half day
> under 180.
>
> **Own check-out (overrides build guide 7.8, where only HR changes a past attendance row):** a
> person may enter their own missing check-out from Today without HR, within the self-fix limit.
> Later times still need HR (a correction request). Every such save is audited and shown to HR as
> "By <name>". A time more than 15 minutes after Daybook last saw them working gets HR's "Check"
> tag, and a save for a day in an earlier payroll month tells HR.
>
> **Privacy:** HR summaries, reminders, alerts, the month view, the person month and the Excel files
> never contain report content or screen-time detail. They may say whether a report is submitted
> and may show one suggested check-out time (the last time Daybook saw someone working, as auto
> check-out uses). The leave type and pay go only to `attendance.correct` viewers and the person;
> the note only to HR and Admins, and never to the person it is about (not even when they are HR).
> Calendar reads leave the type, pay and note out unless the caller asks (`leaveDetail`), so PMs,
> dashboards and Gemini never get them. No attendance IP leaves the screens that show it today.

### The person's day (one rule)

`src/modules/attendance/calendar.js` (**new**, pure, no database):

```js
PersonDay = {
  date: 'YYYY-MM-DD',
  weekday: boolean, // ISO weekday in settings.workingDays
  holiday: { id, name } | null, // a holiday on this date (any weekday)
  isWorkingDay: boolean, // weekday && !holiday; what attendance.is_working_day stores
  employed: boolean, // tracksAttendance !== false && (!joinedOn || joinedOn <= date)
  //   && (!leftOn || date <= leftOn)
  leave: { id, part: 'full' | 'first_half' | 'second_half' } | null, // only when isWorkingDay &&
  // employed; with leaveDetail also paid: boolean and
  // leaveType: 'casual' | 'sick' | 'other'
  wfhApproved: boolean, // an approved wfh_requests row covers the date
  expected: 0 | 0.5 | 1,
  shiftStart: 'HH:mm', // own shiftStart, else officeStart
  shiftEnd: 'HH:mm', // own shiftEnd, else officeEnd
  split: 'HH:mm', // halfDayAt()
  expectedStart: 'HH:mm' | null, // shiftStart; split for first_half; null when expected 0
  expectedEnd: 'HH:mm' | null, // shiftEnd; split for second_half; null when expected 0
  dayEnd: 'HH:mm', // expectedEnd ?? shiftEnd
  lateMark: 'HH:mm' | null, // lateMarkFor(); split + grace for first_half; null when expected 0
  label: string | null, // 'Holiday: Guru Nanak Jayanti' | 'On leave' | 'On leave, first half'
  // | 'On leave, second half' | 'Day off' | null
};
```

- `personDay({ date, person, settings, holiday, leave, wfhApproved })` → PersonDay. `person` =
  `{ id, role, tracksAttendance, joinedOn, leftOn, shiftStart, shiftEnd }` (`leftOn` = the company
  date of `users.deactivated_at`, null while active). A leave on a date that isn't a
  working day is ignored (`leave: null`). A shift whose end isn't after its start falls back to the
  office hours for the split.
- `halfDayAt({ person, settings })` → `'HH:mm'`.
- `presenceOf({ day, row, at, tz })` → `'office' | 'wfh' | 'unverified' | 'not_checked_in' |
'on_leave' | 'holiday' | 'day_off'`: (1) a row → `whereOf(row)` (`rules.js`, unchanged); (2)
  `day.holiday && day.weekday` → `holiday`; `!day.isWorkingDay` → `day_off`; (3) `!day.employed` →
  `day_off` (a guard: callers already leave out people who hadn't joined); (4) full leave →
  `on_leave`; first-half leave and `at` (company clock, today only) before `expectedStart` →
  `on_leave`; (5) otherwise `not_checked_in` (second-half leave included: they were expected in the
  morning).
- `leaveFraction(day)` → 0, 0.5 or 1.
- `dayCounts({ day, row, past })` → `{ expected, present, office, wfh, dayOffWorked, holiday,
leave, leavePaid, leaveUnpaid, absent, conflict }` (numbers, halves allowed; `past` = the date is
  before today):
  - not employed, or the person's `leftOn` without a row: all 0 (a leaver is never absent);
  - not a working day: `dayOffWorked` 1 with a row; `holiday` 1 when `day.holiday && day.weekday`;
  - working day, f = `leaveFraction(day)`: with a row, f = 1 gives `present` 1, `leave` 0 and
    `conflict 'leave_and_checkin'`, else `present` 1 − f and `leave` f; without a row `leave` f
    and `absent` = `past ? 1 − f : 0`. `office`/`wfh` split `present` by `row.location`
    (`unverified` counts as office); `leavePaid`/`leaveUnpaid` split `leave` by `day.leave.paid`.
    The month view, the person month and the AI HR notes count with it, so they agree.
- `lateMinutesForDay({ checkInAt, day, settings })` → `day.lateMark === null ? 0 :
lateMinutesFor({ checkInAt, date: day.date, lateAfter: day.lateMark, tz })` (whole minutes).
- `effectiveLateMinutes({ row, day })` → `!row || day.lateMark === null ? 0 : row.lateMinutes`.
- Constants: `LEAVE_PARTS`, `LEAVE_TYPES`, `LEAVE_TYPE_LABELS` (`{ casual: 'Casual', sick: 'Sick',
other: 'Other' }`), `PART_LABELS` (`{ full: 'Full day', first_half: 'First half', second_half:
'Second half' }`).

`src/modules/attendance/dayRules.js` (**new**, the loaders; queries in **new** `calendarRepo.js`):

- `loadCalendar({ from, to, userIds?, leaveDetail = false }, trx?)` → `Calendar`: one query for
  holidays in the range, one for leave entries overlapping it (of `userIds` when given), one for
  approved WFH requests overlapping it, `settings.getAll()` once. `Calendar` = `{ from, to,
available, holidays: Map<date, { id, name }>, isWorkingDay(date), holidayOn(date),
dayFor(person, date) → PersonDay, workingDaysBetween(a, b) }`. `available` is false before 018
  (no holidays, no leave). Ranges up to 400 days (longer → `VALIDATION_FAILED`, a programming
  error). **Without `leaveDetail` a PersonDay's `leave` is `{ id, part }` only.** Attendance passes
  `leaveDetail: true` only for `attendance.correct` viewers; the person's own Today and My log pass
  it; worker reads that write their own text pass it; dashboards, `aiAsk` and `aiSummaries` never do.
- `getDay({ person, date, withWfh = false, leaveDetail = false }, trx?)` → PersonDay (two small
  queries; three with WFH). Check-in, HR edits, corrections, Today and the away question use it.
  `getDay` and `loadCalendar` always read `holidays` from the table, never the `companyDay` cache.
- `companyDay(date)` → `{ date, weekday, holiday: { id, name } | null, isWorkingDay }`, cached in the
  process for 30 s per date like settings; holiday writes clear the writing process's cache (other
  processes, the worker included, catch up within 30 s).
- `lastWorkingDayBefore(date)` → the last working day before `date` within 14 days, else the day
  before.
- `applyDayRules({ userIds?, from, to, reason, actorId }, trx, write)` → `{ result, changed: [{
rowId, userId, workDate, before: { lateMinutes, isWorkingDay }, after }] }`: inside the caller's
  transaction it loads the calendar for the range, runs `write(trx)` (the holiday or leave change;
  `result` is what it returns), loads the calendar again, and compares each person's PersonDay
  before and after. **Only rows whose day changed** (`isWorkingDay` or `lateMark` differs) are
  touched: they are locked by primary key in **`work_date, user_id` order** (as
  `repo.listOpenBefore`, so it never deadlocks with the 00:05 `markMissingCheckouts`, which has no
  retry); late = `lateMinutesForDay` with the after-day and the stored `check_in_at`, flag =
  `day.isWorkingDay`; a row is updated only when a value differs, and each update is audited
  (`attendance.day_rules`, `before`/`after` = `{ lateMinutes, isWorkingDay }`, the reason). Rows
  whose day didn't change keep their stored values even when Late after or the person's shift
  changed since (§16 "Late minutes are stored at check-in" still holds). It never touches check-in
  or check-out times, `checkout_status`, `source` or breaks. A leave update that changes only
  `paid`, `leaveType` or `note` doesn't call it.
- `recheckDayRules({ userIds?, from, to, since, reason }, trx)` → `{ changed }`: after a holiday or
  leave write has committed, its writer runs this once in a new transaction for the same dates:
  rows **created at or after `since`** (the write's start) whose stored flag or late minutes differ
  from the calendar now are fixed the same way. So a check-in that committed while the write ran
  (it read the calendar before the write) ends with the holiday's flag 0 and late 0.
- `rules.js computeLateMinutes` and `workingDayFlag` take an optional `day` (PersonDay): late =
  `lateMinutesForDay`, flag = `day.isWorkingDay`; without `day` they behave as before.
- `day.js missingWindow(workDate, workingDays, holidays?)`: the window starts at
  `lastWorkingDayBefore` (holidays skipped like non-working days), so the Tuesday after a Monday
  holiday covers Friday to Monday.

Calendar reads (A, new `calendarReads.js` over `calendarRepo.js`): `listHolidaysBetween(from, to)`
→ `[{ date, name }]`; `nextHoliday(from, { withinDays })` → `{ date, name } | null`;
`listOnLeave(date, { viewer })`, `listUpcomingLeave({ viewer, from, to, limit })` and
`getMyLeave({ user, from, to })` (item 9 gives their shapes). The holiday and leave writes and the
Holidays and Leave pages are F's.

**Other modules call only the attendance service** (`attendance.loadCalendar`, `personDay`,
`presenceOf`, `dayCounts`, `effectiveLateMinutes`, `companyDay`, `lastWorkingDayBefore`,
`listOnLeave`, `listHolidaysBetween`), never `calendarRepo`. `modules/dashboard/repo.js`,
`aiSummaries/repo.js` and `aiAsk/repo.js` don't read the new tables themselves, so the rule lives
in one place.

### Data (migration `018_hr_tools.js`, portable to MySQL 8.4; every length is also checked in zod)

One file, owner orchestrator (proposed: `scratch/design-1.10/018_hr_tools.js`). It exports `config =
{ transaction: false }` (knex 3 reads it per migration, `Migrator._useTransaction`), so `up` gets
plain knex: DDL commits on its own on both servers anyway, and the backfill needs its own short
transactions. (On a fresh database, as in tests and e2e, `migrate:latest` then runs 001 to 018
without the batch transaction; DDL in them committed on its own already.)

**Each table change is ONE SQL statement**, so on both servers it either happens or it doesn't.
knex's `createTable` and `alterTable` send the unique keys and foreign keys as separate statements
(checked with `toString()` on knex 3.3.0: `create table`, then `alter table ... add unique`, then
`alter table ... add constraint ... foreign key`). A run the host stops ("Aborted") or an error only
MySQL 8.4 raises could leave those out, the rerun's `hasTable` would skip them for good, and every
1062-based rule of this section (the holiday clash, the once-a-day reminder, the once-a-month alert,
the once-a-day summary) would stop working without an error. So each new table is one raw `CREATE
TABLE` with inline `PRIMARY KEY`, `UNIQUE KEY`, `KEY` and `CONSTRAINT ... FOREIGN KEY` clauses and an
explicit `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` (raw DDL would otherwise
get MySQL 8.4's `utf8mb4_0900_ai_ci`), guarded by `hasTable`; each existing table gets ONE raw `ALTER
TABLE` with all its new columns, its ENUM change and its foreign keys, guarded by `hasColumn` on its
first new column. Every identifier is backtick-quoted; constraint and index names are knex's defaults
(`<table>_<column>_foreign`, `<table>_<columns>_unique`, `<table>_<columns>_index`). The schema
statements run on one pinned connection (a `knex.transaction` used only to pin it) that first runs
`SET SESSION lock_wait_timeout = 30` (both servers): an ALTER blocked by a long query fails with 1205
after 30 s instead of queueing every check-in behind it; run the line again. The host stopping a run
("Aborted") doesn't stop its CREATE or ALTER on the server, which finishes it on its own; a rerun
that checked before it committed sends the same statement, which waits for it and fails with 1050
or 1060. That error is "already there" when `hasTable` / `hasColumn` then says so, and the run goes
on (any other error, or the check still saying no, fails as before).

1. **`holidays`** (company-wide, one row per date): `id`; `holiday_date` DATE NOT NULL, UNIQUE
   `holidays_holiday_date_unique` (company date); `name` VARCHAR(80) NOT NULL; `created_by`,
   `updated_by` BIGINT UNSIGNED NULL FK `users`; `created_at`, `updated_at` (`CURRENT_TIMESTAMP`
   defaults, as the `timestamps` helper of migrations 003 and 010).
2. **`leave_entries`** ("leave" is a reserved word in MySQL): `id`; `user_id` NOT NULL FK `users` ON
   DELETE CASCADE; `from_date`, `to_date` DATE NOT NULL (company dates, both included); `part`
   ENUM('full','first_half','second_half') NOT NULL DEFAULT 'full'; `paid` TINYINT(1) NOT NULL
   DEFAULT 1; `leave_type` ENUM('casual','sick','other') NOT NULL DEFAULT 'casual'; `note`
   VARCHAR(300) NULL (HR and Admins only); `created_by`, `updated_by`; timestamps; KEY (`user_id`,
   `from_date`), KEY (`from_date`, `to_date`). Overlap query: `user_id = ? AND from_date <= :to AND
to_date >= :from` (no SQL date functions). Deletes are hard deletes, audited with the whole row in
   `before`.
3. **`attendance_reminders`** (one row per remind sent): `id`; `user_id` NOT NULL FK `users` ON DELETE
   CASCADE (who was reminded); `kind` ENUM('check_in','break','check_out','missing_checkout') NOT
   NULL; `work_date` DATE NOT NULL (company date it was sent); `sent_by` NULL FK `users` ON DELETE SET
   NULL (null = Daybook); `sent_at` DATETIME NOT NULL; `auto_key` VARCHAR(40) NULL (automatic
   reminders only, `'check_in:2026-11-19'`); timestamps. UNIQUE (`user_id`, `auto_key`) (NULLs never
   collide on either server), KEY (`user_id`, `kind`, `sent_at`) (the 30-minute claim locks this
   range), KEY (`work_date`) (every list and the cleanup filter on it first).
4. **`attendance_alerts`** (one row per HR alert or summary per person and period): `id`; `user_id`
   NOT NULL FK `users` (RESTRICT); `kind` VARCHAR(30) NOT NULL (`'late_days'`, `'hr_morning'`,
   `'hr_evening'`; VARCHAR so later kinds need no ALTER); `period_key` VARCHAR(10) NOT NULL (the
   payroll month `'2026-11'` for `late_days`, the date `'2026-11-19'` for a summary); `days` SMALLINT
   UNSIGNED NOT NULL DEFAULT 0 (late days when sent; 0 for summaries); `created_at` DATETIME NOT NULL
   DEFAULT CURRENT_TIMESTAMP; UNIQUE (`user_id`, `kind`, `period_key`). **For the summary kinds
   `user_id` is the recipient.**
5. **`attendance`**, one ALTER: `checkout_entered_by` BIGINT UNSIGNED NULL FK `users` ON DELETE SET
   NULL, `checkout_entered_at` DATETIME NULL, `checkout_suggested_at` DATETIME NULL (the suggested
   time the person saw when they entered their own check-out; null for HR's) and
   `checkout_prompt_hidden_on` DATE NULL ("Not now" on the pop-up). **Never added to `ROW_COLUMNS`**
   (`attendance/repo.js:35`, every attendance read uses it); read by new `checkoutEntered.js` and
   `missingRepo.js`. `is_working_day` and `late_minutes` keep their meaning and are rewritten only by
   `applyDayRules` and `recheckDayRules`.
6. **`attendance_breaks`**, one ALTER: `MODIFY end_reason ENUM('self','checkout','timer','midnight',
'away','hr') NULL` (values added at the end, as migration 011 did for `checkout_status`) **in the
   same statement as** `source` ENUM('self','away') NOT NULL DEFAULT 'self' (existing rows become
   `self`), `away_entry_id` BIGINT UNSIGNED NULL FK `time_entries.id` **ON DELETE SET NULL** (the
   entry the time came off: the head of a split, or the moved or trimmed entry; Put back uses it),
   `changed_by_id` BIGINT UNSIGNED NULL FK `users` (RESTRICT) and `changed_at` DATETIME NULL (the last
   HR or Admin fix). Neither new FK column is a base column of `open_user_id`, so MySQL error 3192
   doesn't apply (as `paused_entry_id`). Every 1.10 write of `end_reason 'away'` or `'hr'` also
   writes `source` or `changed_by_id`, so before this statement it fails with 1054 (caught), never
   with 1265 on a strict server or a silent '' on a lenient one (`knexfile.js` sets no `sql_mode`).
   **Never added to `BREAK_COLUMNS`.**
7. **Backfill of away breaks** (after the schema; the pure rule `removedSpans({ entries, breaks, row
})` → `{ spans, skipped }` lives in new `db/lib/removedSpans018.js`, no `@/` imports, imported by
   the migration with a relative path (knex loads only `db/migrations`), unit tested):
   1. Plain reads (no locks) pick the person-days: `time_entries` with `work_date >= '2026-11-01'`,
      `source 'timer'`, and `stop_reason 'away'` or `started_at = away_checked_until AND created_at <
started_at`; distinct `user_id, work_date`, oldest first.
   2. Each person-day runs in its own short READ COMMITTED transaction (retried up to 3 times on 1213
      or 1205): find that day's attendance row and lock it **by primary key** (`SELECT id FROM
attendance WHERE id = ? FOR UPDATE`, §15's first lock, so a live 1.10 Remove or check-out of
      that person and day waits instead of racing it); then read the person-day's `time_entries`,
      then its `attendance_breaks`.
   3. **Split Removes:** each timer entry P with `stop_reason 'away'`; R = P's next entry that day by
      start (ties by id). R must have P's project, `source 'timer'`, and **`R.created_at =
P.updated_at` to the second**: 1.09's `removeAwayTime` wrote P's `updated_at` and R's
      `created_at` from the same `at`, and MySQL's rounding or MariaDB's truncation treats both the
      same way. A fresh timer (`running.js start`: `createdAt = startedAt`), a resumed one
      (`resumeAfterBreak`: `createdAt = nowDate()`) or a hand-added one never matches. Span =
      `[P.ended_at, R.started_at]` whether R was kept or moved on by a later Remove,
      `away_entry_id = P.id`.
   4. **Moved starts:** each timer entry R that step 3 didn't pair, with `away_checked_until IS NOT
NULL AND started_at = away_checked_until AND created_at < started_at` (a timer row is created at
      its first start). Span = `[R.created_at, R.started_at]`, exactly what the move took off the
      timer; `away_entry_id = R.id`.
   5. Skip a span under 1 minute, without an attendance row that day, not inside the row's present
      window (`[check_in_at, check_out_at]`; an open or missing row has no end), or overlapping a
      break of the person (an open one has no end), an entry of the person, or a span already chosen.
      Overlap is half-open, to the second (`a.start < b.end && b.start < a.end`; touching isn't
      overlap).
   6. Insert each span: `source 'away'`, `end_reason 'away'`, `attendance_id` of that day's row,
      `paused_entry_id` null, `away_entry_id`, `created_at = updated_at = now`; and one `audit_logs`
      row: actor null, `action 'attendance.away_backfill'`, `entity_type 'attendance'`, `entity_id` the
      row, `after { breakId, startedAt, endedAt }`, reason "Removed timer time counted as a break
      (1.10)". Daily reports are never read or written. A second run inserts nothing (every span then
      overlaps the break it made).
   7. At the end one line on stdout (not under `NODE_ENV=test`): `018: rebuilt 12 away breaks (3
skipped)`, which the lean migrate line shows. Cost: one short transaction per person-day with a
      Remove since 1 Nov (tens to a few hundred), a few seconds.
   8. Not found, on purpose: a Remove before 1 Nov; a moved start later answered Keep (its
      `away_checked_until` moved on); a split whose tail the person deleted; a split head changed by
      hand since (its `updated_at` moved on); a Remove that the still-running 1.09 web process answers
      after its person-day was read (Risks: Restart right after migrate).
8. **The deploy day's late alerts are claimed:** `job_runs` rows `late_alerts:<company date now>`,
   `late_alerts:<date>#2` and `#3` (the three `runAttempts` keys of item 10) with `job 'late-alerts'`,
   `status 'done'`, `started_at = finished_at = created_at = updated_at = now`, errno 1062 ignored.
   The company date comes from the `timezone` settings row (JSON), else
   `process.env.DEFAULT_TIMEZONE`, else 'Asia/Kolkata', through `Intl.DateTimeFormat('en-CA', {
timeZone })`. So HR's first late alerts come at office end of the next working day, after the
   Admin has set Settings → Attendance marks; that run alerts once for everyone already at the limit
   this payroll month.
9. No other table changes, no `time_entries` change, no new index elsewhere, no new permission key
   (viewing is `attendance.view_all`, changing is `attendance.correct`).

`down` (each object checked first, so a stopped `down` runs again): deletes `attendance_breaks` rows
with `source 'away'` (worked time goes back to the 1.09 numbers) and the `attendance.away_backfill`
audit rows; sets `end_reason 'hr'` to `'self'`; drops the two `attendance_breaks` foreign keys (each
checked in `information_schema.TABLE_CONSTRAINTS`); then **one** ALTER drops the four columns and
shrinks the ENUM together, so on the way back too a 1.10 write fails with 1054, never 1265; drops the
`attendance` foreign key, then its four columns in one ALTER; then drops `attendance_alerts`,
`attendance_reminders`, `leave_entries` and `holidays`. The claimed `job_runs` rows stay (they are
run records).

**Settings** (11 new keys, `db/seeds/03_settings.js` by the orchestrator, proposed in
`scratch/design-1.10/settings-additions.js`; a missing row reads as the default through
`settings/service.js normalizeValue`, since the live server never seeds): see "Settings" below.

**Notification types** (all new): `attendance.checkin_reminder` (automatic),
`attendance.remind_check_in`, `attendance.remind_break`, `attendance.remind_check_out`,
`attendance.remind_missing_checkout`, `attendance.hr_summary`, `attendance.hr_evening_summary`,
`attendance.late_alert`, `attendance.self_checkout_past` (item B), `holiday.past_changed` (item 6),
`leave.marked`, `leave.changed`, `leave.removed`. Reused: `attendance.edited` (break fixes, HR's
missing check-out fixes, a late mark a holiday changed), `attendance.break_over_allowance` (now also
after Remove). Slack outbox rows are `kind 'dm'` with `related_type 'attendance_reminder'` (id = the
reminder) or `'hr_summary'` (id = the recipient's user id).

**Audit actions** (all new). Every action about one person's day uses `entityType 'attendance'`
and `entityId` = the attendance row id, so the person month's "Changes" reads them in one query:
`attendance.away_checkout`, `attendance.away_put_back`, `attendance.away_backfill` (migration 018),
`attendance.break_change`, `attendance.break_delete` (before and after carry `breakId`),
`attendance.self_checkout`, `attendance.fix_missing`, `attendance.day_rules`. Others:
`attendance.remind` (`entityType 'attendance_reminder'`), `holiday.create`, `holiday.update`,
`holiday.delete` (`entityType 'holiday'`), `leave.create`, `leave.update`, `leave.delete`
(`entityType 'leave'`, before/after = `{ userId, fromDate, toDate, part, paid, leaveType, note }`,
`reason` on update and delete). Remove, Keep, automatic reminders, summaries and alerts are not
audited (like `timer.reminder`).

### Deploy before migrate (errno 1054 and 1146)

The code ships before the migrate line runs (README "Updating": `git pull` and `npm ci`, then
migrate, then Restart; lsnode may respawn the web process with 1.10 code before Restart, and the
worker cron runs 1.10 from the next minute). Every existing screen and job keeps working as 1.09, and
every new feature either reads as empty or answers one sentence.

- **One guard**, new `src/modules/attendance/migration018.js` (the `projectPlan/migrationGuard.js`
  pattern): `isMissing018(error)` (errno 1146 or 1054); `guard018Read(area, read, fallback)`;
  `guard018Write(area, write)` throws `new AppError('UPDATE_NEEDED', { status: 503, message: 'This
needs the latest database update. Ask an Admin.' })`; `try018Write(area, write)` swallows the
  error and returns null (for an extra statement inside a transaction: MySQL and MariaDB roll back
  only that statement, so the transaction goes on). One warning per area per process: "The 1.10
  database update is missing (run npm run migrate); <area> is off". Areas: `calendar` (holidays and
  leave), `breaks` (away breaks and break fixes), `checkouts` (entered by, the pop-up), `reminders`,
  `alerts`. **`UPDATE_NEEDED` is the only new error code for this**; there is no
  `BREAKS_UNAVAILABLE`, `CALENDAR_UNAVAILABLE` or other per-feature code.
- Nothing caches "missing" longer than the 30 s `companyDay` cache, so everything works once
  migrated, without a restart.

| Feature                                               | Before 018                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The person's day                                      | holiday and leave reads answer "none" (`available: false`): `personDay` falls back to the weekday rule, check-in saves late minutes as 1.09, the worker's `companyNow` says `holiday: null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A. Remove                                             | `resolveAway` works out `planRemoval` first, then calls `saveAwayBreak` **before** the timer change; it catches 1054 (`try018Write`) and returns null. Null on a finished entry, whatever its plan (1.09 only ever asked about the running one) → `UPDATE_NEEDED` and the transaction rolls back, so nothing changes. On the running entry (always a `split` or a `move`) it goes ahead as 1.09 (the split writes the head's `updated_at` and the copy's `created_at` from one `at`), no notice, `savedAsBreak: false`, and 018 rebuilds it. While `removed` reads as unavailable, `getState` asks only about the running entry, as 1.09 (whose plan is always a split or a move), so a finished entry's question isn't offered before 018. Keep, Left, no-data spans and the accuracy rule need no column and work |
| A. Put back, 2. Change end, Delete                    | `UPDATE_NEEDED` 503; `state.removed` is `[]`; the break list reads with `needsUpdate: true` and shows that sentence instead of the buttons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A and 2. Reads                                        | new break columns are read only through `breakRepo.readWithBreakColumns(read)`: on 1054 it reads again without them (every row `source 'self'`, no `changedBy`). "On break since", the `on_break` filter and the Present button use existing columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ENUM safety                                           | 018 widens `end_reason` in the same statement that adds `source` and `changed_by_id`, and every write of `'away'` or `'hr'` also writes one of them, so before 018 such a write fails with 1054 (caught), never 1265 or a silent ''                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B. Pop-up                                             | `listMyMissingCheckouts` answers `{ items: [], autoOpen: false }`: no pop-up, no line; "Request a correction" still works; Save and Not now answer `UPDATE_NEEDED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7. Missing list                                       | the KPI link, the full list, the pending-correction marks and the suggestions work (existing tables); "By" and "Reminded" lines are empty; HR's Fix, bulk fix, Edit and approved corrections write the entered-by columns with `try018Write` (one warning)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. Remind, Remind selected, Remind all                | `UPDATE_NEEDED` 503 (the buttons and menu items stay, as §24); the check-in reminder job first reads today's `check_in` reminders through `guard018Read('reminders', read, () => null)` and on null returns `{ reminded: 0, unavailable: true }` before any claim (one warning per process, no error per person)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1. Summaries                                          | sent as usual (holidays and leave count 0); the once-a-day claim (`attendance_alerts`) falls back to `notifications.hasRecent` on 1146                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3, 4, 8, 10. Marks, month, person month, Needs a look | work; holidays and leave count 0, and the month view and the person month show one muted notice: "Holidays and leave aren't counted yet. This needs the latest database update. Ask an Admin."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10. Late alert                                        | 018 claims the deploy day's run (Data step 8); a run before 018 catches 1146 on its first insert, logs one warning, sends nothing and returns `{ alerted: 0, unavailable: true }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6, 9. Holidays and leave                              | `GET /api/holidays` answers `available: false`; the Holidays and Leave pages and the "Leave and holidays" card show the sentence in a muted `Card` with an Info icon instead of their buttons; the row menu leaves out Mark leave and Edit leave (no menu at all when nothing else is in it); every write and the preview answer `UPDATE_NEEDED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Day Excel                                             | the "Check-out entered by" column stays empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cleanup                                               | the old-reminders step counts 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Checking                                              | `npm run doctor` shows "✗ 1 database update not run: 018_hr_tools.js. Run the migrate line in README Updating." until it has run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### A. Away time counts as a break

Root cause (verified with `scratch/bug-away/awayVsBreaks.test.js`): `src/modules/timers/away.js`
`removeAwayTime` (called by `resolveAway`) only splits the timer (`time_entries`) and never writes
`attendance_breaks`, which every HR screen reads (`attendance/day.js listDay`, `exportDay`, AI HR
notes, Ask). A person who answered "Remove" for a 45 minute lunch showed "Present 5h, no breaks, no
Over tag", while a colleague who pressed Start break showed "Worked 4h 15m, Breaks 45m, Over 15m".

#### Finding the span (timers, new `timers/awayRules.js`, pure; `rules.js` re-exports `awaySpans` and `findAwaySpan` so every import keeps working)

- `awaySpans(segments)` builds pieces from one work date's segments in time order: an idle or locked
  `system` segment is a piece; the gap between two `system` segments more than 150 s apart is a
  piece; an `active` segment or any `window` segment ends a span. Pieces within 150 s merge. Each
  span carries `ended`, `kind` and `startsIdle` (its first piece is an idle segment).
- `findAwaySpan({ segments, startedAt, endedAt, checkedUntil, at, minMinutes, idleMinutes })`: the
  entry's window is `[max(startedAt, checkedUntil), min(endedAt ?? at, at)]`. The first ended span
  that overlaps it is clipped to it. **Accuracy:** when the span `startsIdle`, its start moves back
  by `activityIdleMinutes` (Idle Detection only says "idle" that long after the last input), never
  before the window's start; a locked or no-data start doesn't move. The length check (at least
  `timerAwayMinutes`) uses the moved span. Returns `{ from, to, minutes, kind }` or null.
- `getState` asks about **today's timer entries, oldest first**, the running one included: the
  first entry with a span wins (one question at a time). Manual entries are never asked about. It
  is worked out when `blocked` is `null` **or `'checked_out'`** (the question survives Stop, Switch
  project, Start break and Check out; it goes at midnight, since only today counts). One
  `activity.getDay` read per state; none while screen time is off or today has no timer entry. A
  `no_data` piece counts only when new `activity.anyoneSeenBetween({ workDate, from, to,
exceptUserId })` (activity; the gap less `CONTINUE_MS` (150 s) at each end, then one query on
  the `work_date` index: `started_at < to - 150 s AND ended_at > from + 150 s AND user_id <> ?
LIMIT 1`, read only when such a gap was found and is longer than 300 s, else false) says someone
  else's screen time was recorded during it, away from its edges. **Before 018** (`listAwayBreaks`
  reads as unavailable) only the running entry is asked about, as 1.09.
- **Cost.** In 1.09 the screen-time read ran only while a timer ran; now it runs on every 60 s chip
  poll for every timer user with an entry today, until midnight. With no running entry and today's
  row closed, the `away` part of the state is kept per process for 5 minutes per person (a `Map` by
  user id in `state.js`, cleared by any timer or attendance write of that person in the process),
  so after check-out it is read at most every 5 minutes.
- **Left offer:** `away.left = { clock, shiftEndClock }` (both `'HH:mm'`; `shiftEndClock` = the day
  end) instead of the Remove choice when all hold: the span's `from` is at or after the person's
  **day end minus `leftEarlyGraceMinutes`** (`attendance.getDay`, read only when such a span was
  found; the idle accuracy rule can move a 6:28 PM start before a 6:30 PM day end); its entry is the person's
  latest entry today (by `startedAt`); no break of the day starts at or after `from`; today's row
  is open, or closed by the person's own check-out (`checkout_status 'checked_out'`) at or after
  `to`.

#### Answers (`timers.resolveAway`, new `timers/awayAnswer.js`)

- One `repo.transaction` (READ COMMITTED, 3 tries on 1213). **Lock order (§15):** the entry is read
  first without a lock; then `attendance.lockDay({ userId, workDate: entry.workDate })` (the
  timer's own date); then always `repo.lockById(entryId)`: whether it runs is read from the locked
  row and its id must match, so a Stop or Switch that committed in between is seen (never a false
  `CONFLICT` or the wrong row). Under the lock: the entry must be the person's, `source 'timer'`, and its
  `workDate` must be today's company date, else `BAD_REQUEST` "Only today's timers can be changed."
  The span is worked out again and must equal the one sent, to the second, else `CONFLICT` "That
  away time changed. Refresh and try again." (as 1.09). Locking the row first matters now: the
  break insert takes a shared lock on the attendance row (foreign key), which would deadlock with a
  check-out holding the row and waiting for the timer.
- **keep**: the entry's `away_checked_until = to` (finished entries too).
- **remove**: `planRemoval({ entry, from, to })` (pure) picks one of four changes. The head is kept
  when it has at least 1 minute (`from − startedAt`); the tail when the entry runs, or has at least
  1 minute after `to`:
  - **split** (head and tail): the entry ends at `from` (`stop_reason 'away'`, `away_checked_until
= from`); a copy (project, task, note, source) starts at `to` with `away_checked_until = to`,
    running when the entry ran (end it first, the running index is unique), else ending at the old
    end with the old stop reason (so Today's `pausedEntry` still finds a timer a break paused).
    **The head's `updated_at` and the copy's `created_at` come from one `at`**, so a split made
    before 018 is found by the backfill;
  - **move** (no head): the entry starts at `to` (`away_checked_until = to`), as 1.09 did;
  - **trim** (finished, no tail): the entry ends at `from` and keeps its stop reason;
  - **drop** (finished, nothing left): the entry is deleted.
    **First**, in the same transaction, `attendance.saveAwayBreak({ userId, attendanceId, workDate,
startedAt, endedAt, awayEntryId }, trx)` saves **the time the timer loses**, in whole seconds
    (`wholeSecond`): split `[from, to]`; move `[entry.startedAt, to]`; trim `[from, entry.endedAt]`;
    drop `[entry.startedAt, entry.endedAt]`; `source 'away'`, `end_reason 'away'`, `paused_entry_id`
    null, `away_entry_id` = the entry (null for drop). Then the timer change. Before 018 it returns
    null: a trim or drop then throws `UPDATE_NEEDED` and the transaction rolls back; a split or move
    goes ahead as 1.09. A span that overlaps an existing break of the day (only possible after an HR
    fix) is refused: `CONFLICT` "That time overlaps a break. Keep it, or ask HR." Still under the
    attendance row lock, after the insert, `attendance.breakTotalsIn({ userId, workDate, breakId },
trx)` works out the day's break minutes `before` (without this break) and `total` and returns
    `crossed` (`allowance > 0 && before <= allowance && total > allowance`). **After commit** (the
    transaction may run again), `attendance.noticeOverAllowance({ userId, crossed, total })` sends the
    1.09 notice (`attendance.break_over_allowance`) only when `crossed`. The row lock orders a Remove
    against an End break or another Remove of that person and day, so exactly one of them sees the
    crossing.
- **left** (only when the state offered `left`; checked again under the locks, else `CONFLICT`
  "That away time changed. Refresh and try again."): locks row, open break, entry;
  `attendance.checkOutAtLeft({ userId, workDate, at: from, ip }, trx)` (new `attendance/leftAt.js`)
  closes the open row at `from` (`checked_out`, `check_out_ip` = the request's) or moves the
  person's own check-out back to `from`; audit `attendance.away_checkout` (actor = the person,
  before and after `auditView`). The entry ends at `from` with `stop_reason 'checkout'` (running or
  not), `away_checked_until = from`. No break is saved. After commit, `emit('attendance.checked_out')`
  when the row was open.
- Remove and Keep are not audited (start and stop aren't, §15).

#### Put back (`timers.putBackAway`, new `timers/awayPutBack.js`)

- Only an away break of the person, of today, that nobody else changed (`changed_by_id` null). Lock
  order: `attendance.lockDay` (today), `attendance.lockAwayBreak({ userId, breakId }, trx)`, then
  `repo.lockForUserDate` (every entry of the day). Let E = the `away_entry_id` entry:
  - E ends at the break's start (split or trim): the entry of the same project starting at the
    break's end (the tail) starts at the break's start instead; with no tail, E ends at the break's
    end again (`away_checked_until = end`);
  - E starts at the break's end (move): E starts at the break's start again;
  - otherwise (E deleted or changed by hand since), or when any other entry overlaps the span: the
    timer is not changed (`restored: false`).
- The break is exactly the time the timer lost, so Put back restores the entry to the break's start
  and end, to the second. The break is always deleted (`attendance.deleteAwayBreak(breakId, trx)`;
  the person says they were working, as Keep would have). Audit `attendance.away_put_back` (entity the attendance row, the
  break in `before`). No notice.
- Timers off: `TIMERS_OFF`. Not the person's, not away, not today: `NOT_FOUND` "We couldn't find
  that removed time." Changed by HR: `CONFLICT` "HR changed this break. Ask HR if it needs fixing."
  Before 018: `UPDATE_NEEDED`.

#### Other timer rules that change

- `timers/entries.js checkOverlap` reads `attendance.listBreakDetails` (detail columns, with the
  1054 fallback): Add time or an edit over an away break says "That overlaps time you removed from
  your timer from 1:00 to 1:45. Put it back first." (other breaks keep their message).
- `lockOwnToday` moves from `entries.js` to `shared.js` (exported) so the away files share it.
- `schemas.AWAY_DECISIONS` adds `'left'`.

#### Readers that count away breaks

| Reader                                 | File                                                                 | How away breaks count                                              | Change                                                                           |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Break and worked minutes               | `attendance/rules.js` `breakMinutesWithin`, `workedMinutes`          | every row of the day, clipped to the present window, overlaps once | none                                                                             |
| HR day list, Present cell, Over tag    | `attendance/day.js listDay` (`repo.listBreaksByDate`)                | every row                                                          | adds `onBreakSince`, `breakCount`; `on_break` filter; `summary.onBreak` (item 2) |
| Day Excel                              | `exportDay` (moves to `dayExport.js`)                                | "Breaks (minutes)", "Worked (hours)" through `listDay`             | none (no separate away column: one total)                                        |
| Month view, month Excel, person month  | `attendance/month.js summarizeRange` (`monthRepo.listBreaksByRange`) | every row, through `breakMinutesWithin`                            | new (item 4)                                                                     |
| Check-out answer, Today tile and toast | `checkout.js`, `service.getMyToday`                                  | every row                                                          | none                                                                             |
| Report gap notice                      | `(app)/report/page.js workedFor`                                     | `attendance.listBreaks`                                            | none                                                                             |
| Allowance notice                       | `breaks.js` → `noticeOverAllowance`                                  | every row                                                          | also called after Remove                                                         |
| HR evening wrap-up, Remind `break`     | `hrSummaryData.js`, `remindRules.js`                                 | `overAllowanceMinutes` from `listDay`                              | new (items 1 and 5)                                                              |
| AI HR notes                            | `aiSummaries/hrNotes.js countWeek`                                   | `overAllowanceMinutes` from `listDay`                              | none for breaks                                                                  |
| Ask Daybook                            | `aiAsk/attendance.js`, `aiAsk/repo.listBreaks`                       | every row                                                          | none                                                                             |
| Team board "On break"                  | `dashboard/repo.listOpenBreaks`                                      | open rows only; away rows are never open                           | none                                                                             |
| Timer reminder                         | `timers/worker.js breaksByUser`                                      | a break's end counts as "since"                                    | none                                                                             |
| Auto check-out and the suggested time  | `autoCheckout.lastSeenWorking`                                       | start and end; the end is when the person came back                | none                                                                             |
| Add time defaults                      | `today/timerData.addTimeDefaults` (breaks from `getMyToday`)         | every row                                                          | none                                                                             |

New readers count with `breakMinutesWithin` over every row and label breaks with `breakView.js`.

#### The away question (shell: `TimerAwayDialog.jsx`, `TimerChip.jsx`, `TimerChip.clock.js`)

- Still asked by the sidebar chip only. New: the chip also asks about `initialState.away` on mount
  (page visible), so a question survives a page load after Stop or Check out; it waits while another
  `[role="dialog"][aria-modal="true"]` is open (the check-out dialog) and asks on the next load. It
  already loads on `daybook:timers-changed` and every 60 s. It always wins over Today's missing
  check-out pop-up (B), which waits for it.
- Title (unchanged): "Your timer kept running".
- Text (`awayQuestion(away)`):
  - `away`: "You were away 32 min (1:10–1:42 PM) while your acme-app timer ran."
  - `no_data`: "Daybook didn't hear from your computer for 40 min (1:10–1:50 PM) while your
    acme-app timer ran."
  - with `left`: "You were away from 6:42 PM to 8:52 PM while your acme-app timer ran, after your
    shift ended at 6:30 PM." (`no_data`: "Daybook didn't hear from your computer from 6:42 PM to
    8:52 PM while your acme-app timer ran, after your shift ended at 6:30 PM.")
- Muted line under it (`awayHelp(away)`): "Remove takes this time off your timer and counts it as a
  break." / with `left`: "Checking out ends your day at 6:42 PM and stops your timer there."
- Buttons: "Keep, I was working" (secondary, `data-autofocus`, so Enter never removes time) and
  "Remove, it was a break" (primary); with `left` the second is "I had left, check me out at 6:42
  PM" (primary). They stack full width at 520 px and below. Escape and × put the question away
  until the page is shown again (1.09).
- Toasts: Keep "Kept as work"; Remove "Counted as a break", body "32 min came off your acme-app
  timer." (before 018: "Away time removed", same body); Left "Checked out at 6:42 PM", body "Your
  acme-app timer stopped then too."; error "Couldn't save your answer" with the API's message.

#### Today: removed time and Put back (attendance: `TimerCard`, `TimerEntries`, new `TimerRemovedRow.jsx`)

- Today's away breaks (`state.removed`) sit in the "Working on" entry list in time order, as a muted
  row: the range ("1:00–1:45", `entryRange`), "Away, removed from your acme-app timer" ("Away,
  removed from your timer" when that entry is gone), the duration ("45m") and a text button "Put
  back" (compact; `aria-label` "Put back 1:00 to 1:45 PM on your timer", "to" rather than the dash,
  which screen readers read badly; 44 px hit area at 640 px and below; loading while it works). Shown after check-out too (the card already shows "You've checked
  out. You can still fix today's times below."); not shown while timers are off or for a break HR
  changed.
- Put back goes through `useTimerActions.run` (state, `daybook:timers-changed`, refresh). Toasts:
  "Time put back", body "45 min went back on your acme-app timer."; not restored: "Break removed",
  body "We couldn't put the time back on your timer. Add it with Add time."
- "Tracked today" and the "Your day" tile ("Worked so far · 45m break") follow.

#### Settings (people-admin: `TimersSection.jsx`)

- "Ask about away time after (minutes)" help becomes: "Idle, locked or no screen time this long
  while a timer runs: people keep it as work or count it as a break." No new setting
  (`timerAwayMinutes`, `activityIdleMinutes`, `breakAllowanceMinutes` stay as they are).

### 2. Breaks for HR

#### Rules (attendance, new `attendance/breakFixes.js`)

- **On break now** (`listDay`): `onBreakSince` = the start of the person's open break of that date,
  only when the date is today and the row is open; else null. Away breaks are never open, so they
  never show "On break". `breakCount` = the day's breaks. `FILTERS`/`MATCHES` add `on_break`
  (`onBreakSince !== null`); `summarize` adds `onBreak`.
- **Break fix**: permission `attendance.correct`; the actor may change the person
  (`showsAttendanceOf`: an Admin's row is `NOT_FOUND` for HR) and is not the person (`assertNotSelf`:
  "You can't change your own attendance. Ask another HR person or an Admin."). The break must belong
  to the row in the URL. One `repo.transaction`: lock the attendance row by primary key, then the
  break `FOR UPDATE`, then read the day's other breaks.
  - **Change end** `{ endClock, reason }`: `clockOn(workDate, endClock)`; at least 1 minute after
    the start ("End must be after the start." / "Add at least 1 minute."); not in the future ("That
    time hasn't come yet."); by the row's check-out when it has one ("The break must end by the
    check-out (6:30 PM)."); not the current end ("That's already the end time."); no overlap, to
    the minute, with another break of the day ("That overlaps another break (2:00 to 2:15 PM).");
    not after the start of a timer entry that starts after the break's start ("A timer started at
    2:00 PM. Pick 2:00 PM or earlier.", read with new `timers.listEntriesFor(userId, workDate)` after
    the locks; no timer lock is needed), so a break never runs into tracked work.
    Saves `ended_at`, `end_reason 'hr'`, `changed_by_id`, `changed_at`; the source stays. An open
    break ends there (this is how HR fixes a forgotten End break still running); its paused timer
    is not resumed.
  - **Delete** `{ reason }`: deletes the row (an open one too).
  - Reason required, at most 500 (`requireReason`). Audit `attendance.break_change` /
    `attendance.break_delete` (entity the attendance row; before and after `{ breakId,
startedAt, endedAt, endReason, source }`), reason, ip. The person is told with the existing
    `tellPerson` (moved from `hr.js` to `tellPerson.js` by A, type `attendance.edited`): "Neha Kapoor changed a break in
    your attendance for Thu, 19 Nov" / "Neha Kapoor deleted a break from your attendance for Thu,
    19 Nov", link `/log?month=2026-11`.
- **Notice**: `endBreak` and Remove work out `before`, `total` and `crossed` inside their
  transaction, under the attendance row lock, after the end or the insert (`breakTotalsIn`, which
  replaces the after-commit read of `breaks.js breakTotals`); after commit `noticeOverAllowance({
userId, crossed, total })` sends it only when `crossed`, so two breaks that end close together send
  it exactly once. HR fixes never send it.

#### UI (attendance: new `BreaksButton.jsx`, `BreakListDialog.jsx`, `BreakListHost.jsx`, `BreakFixForm.jsx` + `BreakListDialog.module.css`)

- **Present cell** (layout in "The Attendance day screen"): while on a break today, a marigold `Tag`
  "On break" (`padX={6}`, `dot`, as on the Team board, `TeamBoardCells.jsx:32`) and a muted "since
  1:10" (`formatTime`, the Today pill's words) under the
  worked time. When the row has a break (finished or open), the whole cell is a button
  (`BreaksButton`: no border, `--ink` text, underline on hover, the focus ring of `Button`), its
  name the visible text plus a visually hidden " See breaks". It opens the break list. Everyone who
  sees Attendance (`attendance.view_all`: PM read-only, HR, Admin) can open it.
- **Filter pill** "On break (2)" (`?filter=on_break`, `summary.onBreak`) last, only when the date is
  today; the date switcher's links drop `on_break`. Empty: "Nobody is on a break" / "People on a
  break show up here."
- **Break list** (`Dialog`, 480 px): title "Priya Sharma's breaks"; description "Thu, 19 Nov ·
  Breaks 1h 5m · Over 5m" ("On break since 1:10 · " before "Breaks" while on one; " · Over" only
  when over). One row per break, oldest first:
  - the range "1:10–1:45 PM" (`clockRange`), "Since 1:10 PM" while open; the duration on the right
    ("35m", "25m so far");
  - a muted line: "Break", "Away, removed from timer" or "On break now", then " · " and a note when
    there is one: "Ended at check-out", "Ended when a timer started", "Closed at midnight", "Changed
    by Neha Kapoor";
  - for someone who may fix it: text buttons "Change end" ("End break" while open) and "Delete"
    (danger tone);
  - **Change** opens under the row (`BreakFixForm`): `Field` "Ends at" (`Input type="time"`, the
    current end; for an open break empty, help "When did the break end?"),
    `Field` "Reason" (`Textarea` rows 2, help "Saved in the audit log."), "Save" (primary, compact)
    and "Cancel" (text). Errors show under their field (`fields.endClock`, `fields.reason`);
  - **Delete** opens under the row: "Delete this break? Its time counts as worked again.", the
    Reason field, "Delete break" (danger, compact) and "Cancel".
  - Muted foot line: HR or Admin: "Fix a break someone forgot to end. Your reason is saved with
    every change."; their own row: "Your own breaks. Another HR person or an Admin can change
    them."; before 018: "Fixing breaks needs the latest database update. Ask an Admin."; a PM sees
    no foot line and no buttons. Footer: "Close" (secondary).
  - Loading: three 44 px `Skeleton` rows; failed: "Couldn't load the breaks." and "Try again"
    (secondary); no rows left: "No breaks on this day."
  - After a save the list is replaced by the answer and the page refreshes (`router.refresh`).
    Toasts "Break changed" / "Break deleted"; other errors toast "Couldn't save the break" with the
    API's message. On Attendance the list is held outside the rows (`BreakListHost` around the
    Everyone table), so when the refresh takes the row out of the On break filter the list stays
    open with its answer; closed, focus goes to the card's title when that row is gone.
  - **Focus**: Change end, End break and Delete move focus to the form's first field; Cancel returns
    it to that button; after a save or delete focus goes to the dialog's title (`tabIndex -1`) and a
    visually hidden `role="status"` says "Break changed" / "Break deleted". The Present cell button,
    Change end, End break and Delete have a 44 px hit area at 640 px and below.
- HR never sees the project, the kind of away span or any screen time here: only times and the
  label "Away, removed from timer". The same dialog opens from the person month's Breaks cell
  (item 8).

### B. Missing check-out pop-up on Today

#### Who and which rows

- People with `attendance.self` who track attendance (`user.tracksAttendance`), on `/today`.
- Rows: the person's own, `checkout_status 'missing'`, `work_date` from today minus 30 days to
  yesterday, with **no pending `check_out` correction** for that date (those already show in
  "Waiting for HR: Check-out time on ..."). Newest first, at most 30.
- **Auto-open**: once per page load, when there is a row whose `checkout_prompt_hidden_on` is not
  today. It opens 1.5 s after hydration and only while no other modal is open (no element
  `[aria-modal="true"]` in the document; the away question of A wins), checking again every 2 s
  for up to a minute. AutoRefresh's `router.refresh` never reopens it. **Opened from the bell or
  Slack** (`/today?checkout=missing`: the midnight `notifyMissing` notification and the
  `missing_checkout` reminder link there), Today's page passes `openMissing` and the dialog opens on
  load even when the rows were hidden today (still after the away question), then the address
  becomes `/today` (`router.replace`). The bell on Today itself (and a desktop notification
  clicked while Today is open) follows the link without loading the page again: `openMissing`
  turning true asks once more, so the dialog opens then too.

#### The dialog (new `MissingCheckoutDialog.jsx`, `Dialog` width 440)

- Title "You didn't check out on Fri, 13 Nov"; description "What time did you leave?".
- Body:
  - muted 14 px: "You checked in at 9:32 AM."
  - `Field` label "Time you left", `Input type="time"` (44 px, `data-autofocus`), prefilled with
    the suggested time; help with a suggestion "Daybook last saw you working at 6:41 PM.", without
    "Daybook has nothing to suggest for that day."
  - **Over the limit** (live, as soon as the typed time is after the row's `limitClock`): a box
    (`role="status"`, `--marigold-soft`, text `--marigold-text`, radius 10, padding 10 12) "After
    7:00 PM, HR checks the time first." and a `Field` "Reason for HR" with `Textarea` (rows 3, max
    500), help "It goes to HR as a correction request." A row with no limit (a day off with no
    suggestion, `limitAt` null) shows the box from the start: "That wasn't a working day for you, so
    HR checks the time first."
- Footer: muted "1 of 3" at the left (only with two or more rows), "Not now" (secondary), primary
  "Save", or "Send to HR" while over the limit.
- Field errors (under the field, from the API's `fields`): "Enter the time you left.", "The
  check-out must be after the check-in.", "That time hasn't come yet.", "Add a reason for HR."
- **Save** → `POST /api/attendance/me/missing-checkouts/[id]/fix`. Saved: toast "Check-out saved",
  body "Fri, 13 Nov, 6:41 PM."; sent: toast "Sent to HR", body "HR will check your check-out for
  Fri, 13 Nov."; then the next row (the answer's `missing.items`), or the dialog closes and the
  page refreshes. Error: toast "Couldn't save your check-out" with the message, tone error.
- **Focus**: the body is keyed by `attendanceId`, so `data-autofocus` focuses the time again on
  the next row; a visually hidden `role="status"` says "Saved. Next: Mon, 16 Nov."
- **Not now**, Escape and the close button → `POST /api/attendance/me/missing-checkouts/hide`
  (sets today on every listed row) and close; no toast. The rows come back tomorrow, and a new
  missing day comes up the morning after it is marked.
- **The line** (new `MissingCheckoutPrompt.jsx`, first line of the `.help` box above
  `CorrectionLinks`, shown while rows exist, hidden or not): one row "You didn't check out on Fri,
  13 Nov." + text button "Add the time"; several "You have 3 missing check-outs." + "Add the times".
  It opens the dialog at the first row.
- The midnight notification to the person (`notifyMissing`, `service.js:246`) changes its body to
  "Add the time you left on Today." (was: 'Send HR the time you left from Today, under "Request a
  correction".') and its link to `/today?checkout=missing`.

#### Saving (attendance, new `missingSelf.js`)

- `fixMyMissingCheckout({ user, attendanceId, checkOut, reason, ip })`: `checkOut` 'HH:mm' on the
  row's work date (`resolveTimes`, so never in the future). In `repo.transaction` (READ COMMITTED,
  deadlock retry): lock the row by primary key (`repo.findById(id, trx, { forUpdate: true })`, the
  first lock of §15's order; nothing else is locked: breaks and timers of that day were closed by
  the midnight rules). A row that isn't the person's own, or is older than 30 days → `NOT_FOUND`
  "We couldn't find that missing check-out." (ids can't be probed). The person's own row read under
  the lock that is no longer `'missing'` → `CONFLICT` "This check-out was just fixed. Refresh to see
  it." (so of two parallel saves one saves and the other gets this); one that has a pending
  `check_out` correction → `REQUEST_ALREADY_PENDING`. Check-out must be after check-in
  (`assertOrder`).
  - **Within the limit** (`selfFixLimit` with `attendance.getDay` for the row's date):
    `closeMissingRow` updates with `WHERE checkout_status = 'missing'` (0 rows → the same
    `CONFLICT`) to `check_out_at`, `checkout_status 'corrected'`, `checkout_entered_by = user.id`,
    `checkout_entered_at = now`, `checkout_suggested_at = suggestedAt` (null without one); audit
    `attendance.self_checkout` (before/after `auditView`, `after.suggestedClock`, `after.limitClock`,
    `after.pastLastSeen`, reason "Entered from Today", the request's `ip`). No notification, except:
    when the row's work date is before the current payroll month's `from`
    (`payrollPeriod(payrollMonthOf(today, startDay), startDay).from`), after commit
    `pickRecipients(pools, person)` get a bell `attendance.self_checkout_past`: title "Priya Sharma
    entered a check-out for Fri, 23 Oct", body "6:30 PM. That day is in the October 2026 payroll
    month.", link `/attendance/people/12?month=2026-10`.
  - **Over the limit**: no reason → `VALIDATION_FAILED` on `reason` "Add a reason for HR."; with a
    reason (2 to 500) `attendance.requestCorrection({ user, type: 'check_out', workDate, checkOut,
reason }, trx)` runs **inside the transaction that holds the row lock** (`requestCorrection`
    gains an optional `trx`: with it, it reads the pending request `FOR UPDATE`, inserts and tells
    HR in that transaction; HR is told in the app and by Slack DM, `slackRequestsNotify`, as today).
    A double tap on "Send to HR" waits on the row lock, then finds the first request and gets
    `REQUEST_ALREADY_PENDING`: one request, one HR notification. The row stays missing and leaves
    the pop-up.
  - The limit and the suggestion are computed again inside the request (never trusted from the
    page).
- `hideMissingCheckoutPrompt({ user })` → `{ hiddenOn }`: one UPDATE of the listed rows'
  `checkout_prompt_hidden_on`.
- Timers and breaks of that day are not changed; worked time follows the new check-out
  (`breakMinutesWithin` clips breaks). A check-out after midnight can't be entered (as for
  corrections today).

### 7. Missing check-outs for HR: the full list, suggested times, bulk fix, Remind selected

#### The number card and the list agree

- KPI "Missing check-out" (`kpis`) keeps its value and sub ("from yesterday", "since Friday": rows
  in `missingWindow`, holidays skipped). It becomes a link to the list, written out as §23 did:
  `<Kpi as={Link} href="/attendance/missing" className={styles.kpiLink}
trailing={<ChevronRight size={18} strokeWidth={1.8} className={styles.kpiChevron} />} ...>`,
  with `.kpiLink` and `.kpiChevron` copied from `overview/page.module.css` (colour inherit,
  `--line-dashed` border on hover, no underline, the global focus ring). When the total still to fix
  is larger than its value it gets `footer` "12 to fix in all" (`getDaySummary` adds
  `missingTotal`); every KPI's bar stays level with the others (G's `Kpi` change: the body above the
  bar grows, so each bar sits at the card's bottom). So the card says "new since the last working
  day" and the list says "all still to fix", with the same total.
- The month view's "Missing check-outs" counts rows **marked** missing in the period, with "not
  fixed" beside it; the labels stay distinct (item 4).

#### Side card on Attendance (`MissingCard`, moves to its own file `MissingCard.jsx`)

- Header "Missing check-outs" with `Badge` "12 to fix" (label "12 to fix") when the total is above 0.
- Up to 5 rows as today, as artboard 09: title "Priya Sharma, Fri 13 Nov" (`attendanceData.js:183`
  keeps removing the comma; the `formatDayShort` copy rule doesn't apply to this artboard text); sub
  on two lines, "Marked at midnight" and "Suggested 6:41 PM" (when there is one), then the
  `ReminderNote` (item 5). One action, as the artboard: Fix (the existing `RowAction kind="fix"`, its
  check-out field now prefilled with the suggestion and a help line "Suggested: 6:41 PM, the last
  time Daybook saw them working."). Remind is on the full list. A row with a pending `check_out`
  correction shows muted "Asked HR for 7:10 PM" instead of Fix.
- Footer: text link "See all 12" to `/attendance/missing` (replaces "N more to fix."), shown whenever
  the total is above 0.

#### The list page `/attendance/missing` (new, `requirePage('attendance.view_all')`)

- `TopBar` title "Missing check-outs", subtitle "12 to fix, newest first" ("Nothing to fix" when
  empty), breadcrumb "Attendance" (`/attendance`) › "Missing check-outs".
- For `attendance.correct` (HR, Admin), a muted `Card` (Info icon, as §24's report notice):
  "Suggested times come from the last time Daybook saw each person working. Check before you save."
- `Card padding="none"` with a `DataTable` (new `MissingTable.jsx`, client), 50 rows a page, newest
  day first, then name. The card's head row (always visible, above the table) has the title "Still
  to fix" and, for `attendance.correct`, a labelled checkbox "Select all on this page"
  (indeterminate when some are selected). The column header has no checkbox: `DataTable` hides
  `thead` below 1280 px (`stackBelow={1280}`, `DataTable.module.css`).

  | Column    | Content                                                                                                                                  |
  | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | (select)  | 18 px checkbox, 44 px hit area, `aria-label` "Select Priya Sharma, Fri, 13 Nov"                                                          |
  | Person    | `Avatar` 34, name, designation                                                                                                           |
  | Day       | "Fri, 13 Nov", muted "Yesterday" or "Monday" (`formatRelativeDay`), else nothing                                                         |
  | Check-in  | "9:32"                                                                                                                                   |
  | Suggested | "6:41 PM", or muted "None"; with a pending `check_out` correction, muted "Asked HR for 7:10 PM" under it                                 |
  | Check-out | `Input type="time"` 120 px, prefilled with the suggestion, `aria-label` "Check-out for Priya Sharma on Fri, 13 Nov"; row errors under it |
  | Reminded  | `ReminderNote` (D): "10:05 by Neha" (today) or "Tue, 17 Nov by Neha", else "—"                                                           |
  | Action    | "Fix" and "Remind" (text buttons, small; 44 px hit area at 640 px and below)                                                             |

  PMs (`attendance.view_all` without `attendance.correct`) get Person, Day and Check-in only: no
  selection, suggestions, inputs or actions. The viewer's own rows: checkbox and input disabled,
  Action reads muted "Your own. Fix it from Today." A row with a pending `check_out` correction:
  checkbox, input and Fix disabled, Action reads muted "Handle it under Corrections", and it is never
  reminded (B's rule). Admins' rows are not listed for HR (§16).

- **Bulk bar** (replaces the head row's right side while one or more rows are selected): "3 selected"
  in a `role="status"` span, D's `RemindSelectedButton` ("Remind selected", secondary, compact,
  `BellRing`), "Fix selected" (primary, compact), "Clear" (text). Below 1024 px it is sticky at the
  bottom of the viewport (16 px gutter, `--surface`, `--line` top border); at 640 px and below
  "Clear" sits at the end of the count's line and the other two buttons share one full-width row,
  each 44 px to tap.
- **A row's Fix** opens the existing `RowAction kind="fix"` dialog with Check-out prefilled from the
  row's input (the suggestion): one dialog for one fix, everywhere.
- **Fix selected**: selected rows without a time get the input's error state with "Add a time." and
  focus moves to the first; otherwise new `MissingFixDialog.jsx` (`Dialog` 520) opens: title "Fix 3
  check-outs" (one row: "Fix Priya Sharma's check-out"), description "Each one is saved with the time
  in its row. The person is told.", a list "Priya Sharma, Fri, 13 Nov: 6:41 PM, suggested" / "Karan
  Mehta, Mon, 16 Nov: 7:00 PM", `Field` "Reason" (`Textarea`, required, 2 to 500; prefilled "Used
  Daybook's suggested time." when every row keeps its suggestion), help "Saved with each change in
  the audit log." Footer Cancel and "Fix 3 check-outs" (one row: "Save"). Done: toast "Fixed 3
  check-outs"; partly: "Fixed 2 check-outs", body "1 couldn't be saved. See the row.", the row shows
  its message in red under the input and **focus moves to the first failed row's input**; then
  `router.refresh()`.
- **Remind selected** (D's button): one remind `missing_checkout` per distinct person (no dialog).
  Toast "Reminded 3 people"; partly "Reminded 2 people" with the first skip message as body ("Karan
  Mehta was reminded at 10:05. You can remind again at 10:35."), plus "1 more not sent." when there
  are more.
- Paging footer: "Showing 1 to 50 of 72" with "Previous" and "Next" text links (`?page=2`).
- Empty: `EmptyState` "No missing check-outs" / "Everyone's check-outs are in."
- `loading.js`: a header bar and six 54 px rows. Below 1280 px the table becomes cards
  (`stackBelow={1280}`; stacked label and value below 1024 px), the checkbox at the card's top
  left.

#### Rules (attendance, new `missingHr.js`)

- `listMissingCheckouts` moves from `day.js` to `missingHr.js` and gains `{ offset = 0, suggest =
false }`; the index keeps its name. `suggest` is passed only for `attendance.correct` viewers.
  Items gain `pendingCorrection: { id, checkOutClock } | null` (one query on pending `check_out`
  corrections for the listed rows) and `reminded`.
- `missingCheckoutsFor(userIds)` (new) → `Map<userId, [{ attendanceId, workDate }]>`: unfixed rows
  without a pending `check_out` correction, newest first (D's `missing_checkout` kind and messages).
- `fixMissingCheckouts({ actor, items, reason, ip })`: `requireReason`; 1 to 50 items; each item in
  its own `repo.transaction`: lock the row (`findRowForUpdate`'s rules: an Admin's row is
  `NOT_FOUND` for non-Admins, the actor's own is refused with "You can't change your own
  attendance. Ask another HR person or an Admin."), still `'missing'` (else "Already fixed."), no
  pending `check_out` correction (else "Handle it under Corrections.", so HR never saves over the
  person's own request, which approving later would overwrite),
  `resolveTimes` and `assertOrder` (messages as `hr.updateRow`); update with `WHERE checkout_status
= 'missing'` to `check_out_at` and `'corrected'`, then `checkoutEntered.markCheckoutEntered` (a
  separate statement through `try018Write`, so bulk fix works before 018); audit `attendance.fix_missing` (before/after, reason, `after.suggested`
  true when the time equals the suggestion); notify the person (`attendance.edited`) "Neha Kapoor
  entered your check-out for Fri, 13 Nov", body "6:41 PM.", link `/log?month=2026-11`. Returns `{
fixed: [{ attendanceId, checkOutAt }], failed: [{ attendanceId, field, message }] }`; one failure
  never stops the others.
- `hr.updateRow` (HR's Edit and Fix on the day page): a new check-out on a row that was `'missing'`
  **or has `checkout_entered_by` set** sets `checkout_entered_by = actor.id`, `checkout_entered_at =
now` and `checkout_suggested_at = null` (`checkoutEntered.markCheckoutEntered`, through
  `try018Write`), so a row never says "By Priya" for a time Neha typed. `decisions.applyCorrection`
  for `check_out` clears all three (`checkoutEntered.clearCheckoutEntered`). As the bulk fix, it
  refuses a row still `'missing'` (read under its row lock) that has a pending `check_out`
  correction, whatever it changes: `CONFLICT` "Handle it under Corrections." with `fields.checkOut`
  the same sentence, which `RowAction` shows under Check-out.
- `decisions.applyCorrection` reads the person's day (`getDay`) only after it has locked the row,
  so an approval that waited on a holiday or leave write's `applyDayRules` counts late minutes from
  the calendar that write committed (a new `missing_day` row is covered by `recheckDayRules`).
- **Suggestions** (new `checkoutSuggest.js`, `suggestCheckoutTimes(rows)`): per row
  `activity.getDay(userId, workDate)` (the read auto check-out already uses, `autoCheckout.js:170`;
  never `getTeamDay`, which loads every person's segments of the day, `activity/service.js:195`) and
  that day's breaks (`repo.listBreaksByUserDate`); per date one `timers.lastRanByUser({ workDate,
userIds })` (wraps the existing `timers/repo.lastEndedByUser`: finished entries only); then the
  pure `suggestedCheckoutAt` per row. A past day's suggestion doesn't change, so it is kept in a
  per-process `Map` by attendance id (at most 1,000 entries, the oldest dropped first; a break fix of
  that row clears it: `checkoutSuggest.js` listens for `attendance.break_fixed`, which
  `breakFixes.js` emits after commit). A cold `/attendance/missing` page makes at most 50 small
  per-person reads; B's pop-up uses the same function, so both always show the same time.

### 5. Reminders: one Remind mechanism, the automatic check-in reminder, Remind buttons

#### The mechanism (attendance, new `reminders.js`, `reminderRepo.js`, `remindRules.js`, `reminderMessages.js`)

- `claimAndSend({ person, kind, actor, since, autoKey }, details)` (internal) is **the only way a
  reminder is sent**. In `repo.transaction(run, { isolationLevel: 'repeatable read' })` (the WFH
  request pattern, `findOverlappingWfh` with `forUpdate`): `SELECT … FROM attendance_reminders
WHERE user_id = ? AND kind = ? AND sent_at >= ? FOR UPDATE` (the index range and its gap are
  locked, so two sends at once wait or deadlock, and the retry sees the first). A row found →
  skipped (`too_soon`, with `nextAt` = its `sent_at` + 30 min). Else insert the reminder,
  `notifications.notify` (bell, so also the desktop push), `slack.queueDm({ slackUserId, text,
settingKey: 'slackAttendanceRemind', relatedType: 'attendance_reminder', relatedId })` and, for
  HR, audit `attendance.remind`, all in that transaction. errno 1062 on `auto_key` → skipped. Three
  deadlocks → skipped with "Something else changed at the same moment. Try again."
  - `since` = now − 30 minutes for HR; the start of today (company) for the automatic check-in
    reminder, so it never comes after any check-in reminder of that day.
  - Reminders never lock attendance, breaks or timers (§15's order is untouched); the state is read
    just before the claim, so one that crosses a check-in by a second is accepted.
- `remind({ actor, kind, userIds, ip })` (HR, Admin): distinct ids, 1 to 50. Per person, in this
  order (so HR learns nothing about an Admin from which message comes back): exists and active,
  `showsAttendanceOf(actor, person)` (else skipped `not_allowed` "We couldn't find that person."),
  not the actor ("You can't remind yourself."), tracks attendance, and the kind applies now
  (`remindKindFor` on a fresh `listDay` item of today with its PersonDay; `missingCheckoutsFor` for
  `missing_checkout`), else skipped `not_needed`. Returns `{ sent: [{ userId, name, sentAt }], skipped: [{ userId, name,
reason: 'too_soon' | 'not_needed' | 'not_allowed', message, nextAt? }] }`.
- `remindKindFor(item, ctx)` (pure) → kind or null, for a `listDay` item (with `item.day`) plus
  `ctx = { now, today, date, settings, missing }`: the first three kinds only on today's view;
  `missing_checkout` on any date's missing row. Order: `break` first, then `check_out`, then
  `check_in`. By the Words above: `check_in` needs `where === 'not_checked_in'`, now at or after
  `day.lateMark` and before `day.dayEnd`, so holidays, days off and full-day leave never qualify
  (skip message after the day end: "Priya Sharma's day has ended."). `missing_checkout` needs a row
  from `missingCheckoutsFor` and today's PersonDay a working day without full-day leave (skip
  messages "Priya Sharma is on leave today." / "Today isn't a working day.").
- `listReminders({ since, userIds?, kinds? })` → `[{ userId, kind, sentAt, sentBy: { id, name } |
null }]` newest first (`[]` before 018): it filters `work_date >= <company date of since>` (KEY
  `work_date`) before `sent_at >= since`, so the 60 s refresh never scans 180 days.
  `deleteOldReminders(before)` deletes `WHERE work_date < ?` (the company date 180 days back).
- Constants `REMIND_KINDS`, `REMIND_EVERY_MINUTES = 30`.

**Messages** (`reminderMessages.js`, pure; bell title, bell body, Slack DM; names and the sender
escaped with `escapeSlackText`; link `/today`, and `/today?checkout=missing` for `missing_checkout`
so the pop-up opens even after "Not now"; "Neha Kapoor" = the sender's full name):

| Kind                  | Bell title                                | Bell body                                                                                  | Slack DM                                                                                                   |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `check_in`, automatic | You haven't checked in yet                | Your day started at 9:30 AM. Check in on Today when you start work.                        | You haven't checked in yet. Your day started at 9:30 AM. `<origin/today\|Check in on Today>`               |
| `check_in`, HR        | Neha Kapoor reminded you to check in      | You haven't checked in today. Check in on Today when you start work.                       | \*Neha Kapoor\* reminded you to check in. You haven't checked in today. `<…\|Check in on Today>`           |
| `break`               | Neha Kapoor reminded you about your break | You've been on a break since 1:10 PM. Your breaks today are 1h 20m, over the 1h allowance. | \*Neha Kapoor\* reminded you about your break. (bell body) `<…\|End your break on Today>`                  |
| `check_out`           | Neha Kapoor reminded you to check out     | You're still checked in. Check out on Today if you're done for the day.                    | \*Neha Kapoor\* reminded you to check out. You're still checked in. `<…\|Open Today>`                      |
| `missing_checkout`    | Neha Kapoor asked for your check-out time | You didn't check out on Fri, 13 Nov. Add the time you left on Today.                       | \*Neha Kapoor\* asked for your check-out time. You didn't check out on Fri, 13 Nov. `<…\|Add it on Today>` |

Notification types: `attendance.checkin_reminder` (automatic), else `attendance.remind_<kind>`.
`missing_checkout` with two days: "You didn't check out on Fri, 13 Nov and Mon, 16 Nov. Add the times
you left on Today."; three or more: "You have 3 missing check-outs, the latest on Mon, 16 Nov. Add
the times you left on Today." "Your day started at" = `day.expectedStart` (`formatClock`; the split
on first-half leave). Durations `formatDuration`.

#### The automatic check-in reminder (worker `checkin-reminders`, new; `attendance/checkinReminders.js`)

- `attendance.sendCheckinReminders(today)` → `{ reminded }`. Every minute while
  `checkinReminderMinutes > 0`; returns at once when `companyDay(today).isWorkingDay` is false (a
  weekend or a holiday). Due: active, tracked, `attendance.self`, presence `not_checked_in` (no row
  today, employed, not on full-day leave, not before the split on first-half leave), now at or after
  `day.lateMark + checkinReminderMinutes`, before `day.lateMark + checkinReminderMinutes + 60
minutes` (a worker that was down sends nothing more than an hour late, like checkout-reminder's
  rule) and before `day.dayEnd`. It first reads today's `check_in` reminders through
  `guard018Read('reminders', read, () => null)`; null (before 018) → `{ reminded: 0, unavailable:
true }` before any claim. Each due person goes through
  `claimAndSend` with `kind 'check_in'`, no actor, `since` = start of today and `autoKey
'check_in:<date>'` (its run key per person; no `job_runs` row, like timer reminders).
- Reads per tick when something can be due: active tracked people, today's rows, today's `check_in`
  reminders, one `loadCalendar` for today. An HR "Remind to check in" earlier that day stops it (the
  `since` range covers it).

#### Remind on Attendance (`attendance.correct` only; HR and Admin)

- **Action cell** (layout in "The Attendance day screen"): the remind lives in the row's `RowMenu`
  ("...", F), never as a separate button, so the Action column keeps one line. When `remindKindFor`
  gives a kind, the row isn't the viewer's own and the 30 minutes have passed, the menu's first item
  is the remind (`remindMenuItem` from D's `remindItem.js`, `BellRing` 14 px): "Remind to check in" /
  "Remind about the break" / "Remind to check out" / "Ask for the check-out time", so on touch HR
  can tell which one it sends. Under the line, the muted `ReminderNote` (D, 12 px, `--muted`, at
  most 2 lines): "Reminded 10:05 by Neha" (sender's first name; "by Daybook" for the automatic one;
  an earlier day "Reminded Tue, 17 Nov by Neha"). Within the 30 minutes the item isn't in the menu
  and the line gets `title` "You can remind again at 10:35". The line shows the person's latest
  reminder of the row's kind: sent today for the first three kinds, sent on or after the row's date
  for `missing_checkout`.
- **Remind all** (new `RemindAllButton.jsx`, D): in the Everyone card head, for `canCorrect` on
  today, when the filter is `not_checked_in` or `on_break`: "Remind all (3)" (secondary, compact,
  `BellRing`). It sends one `POST /api/attendance/reminders { kind, userIds }` for the listed rows
  whose `remindKindFor` gives that kind and that aren't within the 30 minutes; toasts as for
  "Remind selected"; hidden when the count is 0.
- **Sending** (`useRemind()` from D's `useRemind.js`, used by the menu item, Remind all, Remind
  selected and the list's Remind) → `POST /api/attendance/reminders { kind, userIds }`. Sent: toast
  "Reminder sent", body "Sent to Priya Sharma."; skipped `not_needed`: toast "No reminder needed",
  body the message; `too_soon`: "Not sent yet", body the message (both in the toast's default tone:
  ToastProvider has only `success` and `error`); API errors (`UPDATE_NEEDED` included): "Couldn't
  send the reminder" with the API's message, tone error; then `router.refresh()`. Skip messages:
  "Priya Sharma was reminded at 10:05. You can remind again at 10:35.", "Priya Sharma has checked
  in.", "Priya Sharma isn't over the break allowance now.", "Priya Sharma has checked out.", "Priya
  Sharma's day hasn't ended yet.", "Priya Sharma's day has ended.", "Priya Sharma has no missing
  check-outs now.", "Priya Sharma is on leave today.", "Today isn't a working day.", "Priya
  Sharma isn't late yet." (`check_in` before their late mark), "Priya Sharma hasn't checked in."
  (`check_out` without a row), "Priya Sharma is on a break now." (`check_out` while it is a break
  case), "Rahul Verma doesn't check in." (not tracked)
- **Out cell**: under the time, muted "By Priya" (first name of `checkout_entered_by`) with a
  visually hidden "Check-out entered " before it (screen readers hear "Check-out entered by Priya")
  and `title` "Priya Sharma entered this check-out on Thu, 19 Nov". Shown to every Attendance viewer
  (PMs included); it is not screen-time data. **For `attendance.correct` viewers**, when the person
  entered it themselves and it is past last seen, a marigold `Tag` "Check" (`padX={6}`) follows it,
  `title` "Priya entered 6:30 PM. Daybook last saw them working at 1:05 PM." (no suggestion:
  "Daybook had no sign of work after the check-in."). This is the one allowed derived time.
- PMs see no remind, no reminder lines and no Check tag.

### 1. Morning HR summary and evening wrap-up (attendance, new `hrSummary.js`, `hrSummaryData.js`, pure `hrSummaryText.js`)

#### When and to whom

- **Morning** (worker `hr-summary`, new): on working days (`companyDay(today).isWorkingDay`, so not
  on holidays), at or after `hrSummaryAt`, before `officeEnd` (a summary that would arrive after
  office hours is not sent), while `hrMorningSummary` is on. `runAttempts('hr-summary',
'hr_summary:<date>', …)` (3 attempts, 10 minutes apart, `worker/runOnce.js:95`; attempts 2 and 3
  always run, which the claim below makes safe).
- **Evening wrap-up** (worker `hr-evening-summary`, new): same days, while `hrEveningSummary` is on,
  at or after `officeEnd` + 30 minutes (23:59 at the latest), key `hr_evening_summary:<date>`, type
  `attendance.hr_evening_summary`.
- **Once per recipient per day**: each recipient's send is one transaction that first inserts
  `attendance_alerts (user_id = the recipient, kind 'hr_morning' | 'hr_evening', period_key = the
date 'YYYY-MM-DD', days 0)`, then the bell row and the Slack DM. Errno 1062 = already sent: skip.
  A failed send rolls its claim back, so a later attempt sends it. Deleting the bell notification
  (the bell's Delete and swipe hard-delete it, `notifications.remove`) never brings it back. Before
  018 (errno 1146 on the claim) it falls back to `notifications.hasRecent` since the start of today.
- To each HR recipient: one bell notification (so a desktop push on every browser where they turned
  on "Show on this computer", while `pushEnabled`) and one Slack DM (`settingKey 'slackHrSummary'`,
  skipped without a `slackUserId`). Daybook has no per-person mute per notification type; these are
  the existing per-person channel choices. Link: morning `/attendance?filter=not_checked_in` when
  that count is above 0, else `/attendance`; evening `/attendance`.
- Data is read once with no viewer (`listDay(today)` with its calendar), then filtered per recipient
  (`showsAttendanceOf`, and never the recipient). The waiting counts come from new
  `hrSummaryRepo.countWaiting({ hideAdmins, excludeUserId: recipient.id })` → `{ corrections, wfh }`
  (two counts): the recipient's own requests are left out, since `decisions.loadPending` and
  `wfhDecisions.loadPending` answer `FORBIDDEN` to them.
- Every name in the Slack text is escaped with `escapeSlackText` (as `reminderMessages.js`).

#### Morning content

- **Not checked in**: presence `not_checked_in` at send time, the Attendance pill's set (leave,
  holidays and days off are already out), so the summary and the screen agree. Someone whose own
  late mark hasn't passed is listed with "(starts 11:00)" (`day.expectedStart`).
- **Late**: rows today with effective `lateMinutes > 0`, most late first, "Vishal Saini 22m".
- **On leave**: `listOnLeave(today)`, "Meera Nair, first half" / "second half" / the name only for a
  full day.
- **Working from home**: rows today with `location 'wfh'`, plus people not checked in yet whose
  `day.wfhApproved` is true.
- **Waiting for you**: pending correction requests and pending WFH requests (counts, never the
  recipient's own).
- **Missing check-outs from <day>**: rows still missing in `missingWindow(today)` (holidays
  skipped); "from yesterday" / "since Friday" as the KPI.
- Bell title (200 max): "Morning attendance: 3 not checked in, 2 late"; when both are 0 "Morning
  attendance: everyone has checked in"; only one part when the other is 0 ("Morning attendance: 2
  late").
- Bell body (shown on 2 lines): the other counts above 0, count first, joined with " · ": "1 on
  leave · 2 WFH · 3 waiting for you · 1 missing check-out from yesterday"; none: "Nothing is waiting
  for you."
- Slack (lines with nothing are left out; at most 15 names a line, then "and 4 more"):

```
*Morning attendance, Thu, 19 Nov* (10:00 AM)
*Not checked in (3):* Priya Sharma, Karan Mehta, Rohit Verma (starts 11:00)
*Late (2):* Vishal Saini 22m, Ankit Rana 8m
*On leave (1):* Meera Nair, first half
*Working from home (2):* Neha Kapoor, Sam Lee
*Waiting for you:* 1 correction request, 2 work from home requests
*Missing check-outs from yesterday (1):* Karan Mehta
<https://daybook.example/attendance|Open Attendance>
```

With every list empty the second line is "Everyone has checked in and nothing is waiting for you."

#### Evening content

- **Still checked in**: open rows today whose day end has passed, "Priya Sharma (since 9:32)". Open
  rows whose day end hasn't passed are counted as "1 still on their shift".
- **Reports not in**: checked in today, `report.self`, no submitted report today (yes or no only,
  `reports.listSubmittedUserIds`).
- **Over the break allowance**: `overAllowanceMinutes > 0` today (away breaks included), "Karan
  Mehta, over by 25m".
- **Auto check-outs since <last working day>**: rows of `missingWindow(today)` (the last working day
  to yesterday, so weekend and holiday ones show too) with an `attendance.auto_checkout` audit row
  (`audit.listForEntities`, the month rule, so a row fixed since still counts), plus today's when
  `autoCheckoutAt` is before the send time; "Rohit Verma at 6:12 PM on Fri, 13 Nov".
- Bell title: "Evening attendance: 4 still checked in"; when that is 0 but rows are open "Evening
  attendance: 1 still on their shift"; with no open row "Evening attendance: everyone has checked
  out". Body, count first: "3 reports not in · 2 over the break allowance · 1 auto check-out since
  Fri, 13 Nov" / "Nothing else to look at."
- Slack: `*Evening attendance, Thu, 19 Nov* (7:00 PM)` then `*Still checked in (4):*` (ending with
  "and 1 still on their shift" when some are), `*Reports not in (3):*`, `*Over the break allowance
(2):*`, `*Auto check-outs since Fri, 13 Nov (2):*` lines as above, and the Attendance link; all
  empty: "Everyone has checked out and every report is in."
- `attendance.sendHrMorningSummary(today)` and `sendHrEveningSummary(today)` → `{ sent }`.

### 3. Half day, short day, left early

Pure rule `dayMarks({ row, day, worked, settings })` in new `src/modules/attendance/marks.js`:

- Only on a **finished** row of a working day of the person with `day.expected > 0` (so never on
  weekends, holidays or before joining). Open rows (today, still checked in) and missing check-outs:
  no marks. **One exception:** on a day where `dayCounts` gives `conflict 'leave_and_checkin'`
  (full-day leave with a check-in), the marks use expected 1: Half day and Short day at full size,
  Left early against `shiftEnd`, matching present 1.
- `factor = min(1, ownShiftMinutes / officeMinutes)` (1 without an own shift); `half =
round(halfDayUnderMinutes × factor)`; `short = round(shortDayUnderMinutes × factor ×
day.expected)`. With half-day leave (`expected` 0.5) the Half day mark is off.
- **Half day** = `half > 0`, no half-day leave and worked `< half`. **Short day** = not Half day,
  `short > 0` and worked `< short`. At the defaults: 269 min is Half day, 270 to 479 Short day, 480
  none; on half-day leave Short day under 240.
- **Left early** = check-out (company time) more than `leftEarlyGraceMinutes` before `day.dayEnd`
  (own shift end, or the split on second-half leave); `leftEarlyMinutes` = how much before. An auto
  check-out counts (its time is the last sign of work, §19).
- Returns `{ halfDay, shortDay, leftEarly, leftEarlyMinutes }`.

**Attendance day page** (`listDay` items gain `marks` and an item-level `lateMinutes` = effective
late; `MATCHES.late` and `summarize` use `item.lateMinutes`, so the Late pill and KPI follow it;
`attendance.lateMinutes` on the row stays as stored):

- Present cell: a marigold `Tag` "Half day" or "Short day" (`padX={6}`) last, `title` "Worked 3h
  50m, under 4h 30m".
- Out cell: under the time (and the "Auto" tag), a marigold `Tag` reading "Early" with a visually
  hidden "Left 25m " before it (screen readers hear "Left 25m early", so keyboard and touch users
  get the minutes too), `title` "Left 25m before their shift ended at 6:30 PM". The person month
  (wider) shows the tag as "Early 25m".
- Day Excel: see "The Attendance day screen".

### 4. Month view and one Excel for the month

#### Payroll month (new `attendance/payroll.js`, pure)

- `payrollPeriod(month, startDay)` → `{ month, from, to, label, rangeLabel }`: start 1 → the
  calendar month, `rangeLabel` null; start d → from = day d of the month before, to = day d−1 of
  `month`. `label` "November 2026" (`formatMonth`), `rangeLabel` "26 Oct to 25 Nov"
  (`formatDayMonthShort`).
- `payrollMonthOf(date, startDay)` → start 1: `monthOf(date)`; else the next month from day d on.
  So 25 Nov 2026 → '2026-11', 26 Nov 2026 → '2026-12', 26 Dec 2026 → '2027-01'.
- `resolvePayrollMonth(month, settings)` → the asked month, or the current one when not `YYYY-MM` or
  after the current one (like `resolveDate`); `period.isCurrent`, `prevMonth`, `nextMonth` (null for
  the current one). **Without `month`**, while today is within the first 3 days of a new period, it
  answers the **previous** payroll month (`defaulted: 'previous'`): the month page, its export, the
  person month and the Leave page then open the period that just closed, the DateSwitcher label
  reads "Last month" and the next arrow leads to the current one. Needs a look and the late alert
  always use the current period.

#### One month function (every reader reuses it)

`attendance.summarizeRange({ from, to, viewer?, userIds?, withDays? })` (new, `attendance/month.js`;
pure core in new `monthRules.js`: `summarizePerson`, `classifyDay`, `needsLookReasons`, `ordinal`).
Readers: the month view, the month Excel, the person month, Needs a look, the late alert. The HR
summaries and the AI HR notes keep reading `listDay` per day (a single day each), with the same
rules.

- **Reads** (about 8 queries plus one per 500 attendance rows of the period, the audit chunks; no
  per-day loop): people `users.listTrackedForRange({ from, to })` (new, people-admin: tracked, active
  or deactivated on or after `from`, joined by `to`; `leftOn` = the company date of `deactivatedAt`,
  passed to `personDay`), then `showsAttendanceOf(viewer, person)`; rows
  `monthRepo.listRowsByRange({ userIds, from, to })` (`ROW_COLUMNS` plus the three entered-by
  columns, the `user_id, work_date` unique index); breaks `monthRepo.listBreaksByRange({ userIds,
from, to })` (same filter as `repo.listBreaksByDate`; every break, away ones included); history
  `audit.listForEntities({ entityType: 'attendance', entityIds: rowIds, actions:
['attendance.mark_missing', 'attendance.auto_checkout'] })` (new, system; ids in chunks of 500);
  report days `reports.listSubmittedDays({ userIds, from, to })` (new, reports); `loadCalendar({ from,
to, userIds, leaveDetail: true })` (holidays, leave, approved WFH); settings.
- **Returns** `{ from, to, through, today, holidays: [{ date, name }], available: { holidays, leave
}, people: MonthPerson[] }`, `through = min(to, today)`, people in id order (as `listDay`).
- `MonthPerson` = `{ user: { id, name, initials, avatarUrl, role, status, designation,
departmentName, email }, joinedOn, leftOn, workingDays, workingDaysSoFar, holidays, presentDays,
officeDays, wfhDays, daysOffWorked, leave: { paid, unpaid, total, planned }, absentDays, lateDays,
lateMinutes, halfDays, shortDays, leftEarlyDays, workedMinutes, breakMinutes, overAllowanceDays,
missingCheckouts, missingNotFixed, autoCheckouts, selfEnteredCheckouts, selfEnteredPastLastSeen,
reports: { expected, submitted, missing } | null, needsLook: [{ key, count, label }], days? }`. Day
  counts may be halves (0.5).
- `MonthDay` (only with `withDays`) = `{ date, kind: 'working' | 'day_off' | 'holiday' | 'future',
employed, isToday, day: PersonDay, holiday: { name } | null, leave: { part, paid, type, note } |
null, row: { id, checkInAt, checkOutAt, location, officeVerified, note, lateMinutes,
checkoutStatus, source } | null, where: 'office' | 'unverified' | 'wfh' | 'not_checked_in' |
'absent' | 'on_leave' | 'holiday' | 'day_off', present, leaveDays, absent, lateMinutes,
presentMinutes, breakMinutes, workedMinutes, overAllowanceMinutes, marks, checkout: { wasMissing,
auto, notFixed, enteredBy, pastLastSeen, suggestedAt }, report: 'submitted' | 'not_submitted' |
'due' | null, conflict: 'leave_and_checkin' | null }`. `row` never carries `checkInIp` or
  `checkOutIp` (not in the month view, the person month or the month Excel). `leave.note` is null
  when the viewer is the person it is about.
- Rules: the Words, `dayCounts`, `effectiveLateMinutes`, `dayMarks`. **Every count covers days up to
  `through`, except `workingDays` and `holidays`, which cover the whole period** (`workingDaysSoFar`
  stops at `through`). Leave on days after `through` is `leave.planned`, never in `leave.total`.
  Per person, present + `leave.total` + absent = working days so far while employed. Worked, breaks
  and over allowance over every row (days off included); an open row of **today** counts live (as
  `listDay`); **an open row from a day before today counts like a missing check-out** (no present
  or worked time, and "not fixed" under Check-outs), whether or not `auto_mark_missing_checkout` has
  run, so a forgotten check-out never adds 14 hours to the payroll Excel. `overAllowanceDays` = days
  with breaks over `breakAllowanceMinutes` (0 = none). Holidays counted per person = holidays on a
  working weekday while employed. Working days follow **today's** `workingDays` setting for past
  months too. `selfEnteredCheckouts` = rows whose `checkout_entered_by` is the person;
  `selfEnteredPastLastSeen` = those past last seen.

#### `getMonth` and the page `/attendance/month`

- `attendance.getMonth({ viewer, month?, filter? })` (new) → `{ period, filter, counts: { all,
needs_look, late, short, absent, leave, missing }, totals: { workingDays, workingDaysSoFar,
holidays, lateDays, latePeople, lateAverageMinutes, shortDays, leftEarlyDays, leaveDays,
unpaidLeaveDays, absentDays, absentPeople }, rules: { halfDayUnderMinutes, shortDayUnderMinutes,
leftEarlyGraceMinutes, lateAlertDays }, available, people }`. Filters: `all`, `needs_look`,
  `late` (at least 1 late day), `short` (half or short at least 1), `absent`, `leave`, `missing`
  (missing check-outs at least 1).
- **Page** (new `(app)/attendance/month/page.js`, `monthData.js`, `MonthTable.jsx`,
  `page.module.css`, `loading.js`): `requirePage('attendance.correct')` (HR and Admin; a PM gets
  `/no-access`). `TopBar` title "Attendance", subtitle "November 2026 so far" / "November 2026"
  (start day 1) or "November 2026, 26 Oct to 25 Nov" (" so far" while current). Actions: `Segmented`
  "Day" (`/attendance`) / "Month" (`/attendance/month`), `label="View"`; `DateSwitcher` label "This
  month" or "Oct 2026", `prevLabel` "October 2026", `nextLabel` "December 2026" or "No later
  months"; `Button variant="secondary"` "Download Excel" → `/api/attendance/month/export?month=2026-11`,
  `download="attendance-2026-11.xlsx"`, `prefetch={false}`. No `AutoRefresh`.
- **KPIs** (5 `Kpi`s, the day page's `.kpis` grid): "Working days" value 22, sub "14 so far, 1
  holiday" (or "no holidays"), percent so far ÷ all, primary; "Late days" value 9, sub "by 4
  people", percent late people ÷ people, marigold; "Short days" value 5, sub "3 left early",
  marigold; "Leave" value 6.5, sub "1 unpaid" (or "all paid"), teal; "Absent" value 2, sub "by 2
  people", red.
- **The table** (`Card padding="none"`, head like `EveryoneCard`): title "Everyone, November 2026",
  `FilterPills` "All (24)", "Needs a look (3)", "Late (9)", "Short days (5)", "Absent (2)", "On
  leave (4)", "Missing check-outs (3)" (`?filter=`, the month kept). `DataTable` columns (numbers in
  `--font-heading-stack`, tabular; a muted line is 12 px `--muted`; "—" when there is nothing):
  - "Person": `Avatar` 34, the name as a link to `/attendance/people/[id]?month=2026-11`,
    designation; a marigold `Tag` "Needs a look" when it applies, with a muted line under it naming
    the reasons joined with " · " ("5 late days · 4 short days"; no `title`, so keyboard and touch
    users read them too); muted "Joined Wed, 4 Nov" / "Left Tue, 10 Nov" inside the period.
  - "Present": "19.5", muted "of 21 days" (a past month: `workingDays` while employed) or "of 14
    days so far" (the current month: `workingDaysSoFar`), muted "18 office · 1.5 WFH", muted "+1 day
    off" when `daysOffWorked > 0`, muted "1 holiday" when `holidays > 0`.
  - "Leave": "1.5", muted "1 paid, 0.5 unpaid", muted "1 day planned" for leave after today.
  - "Absent": "1" in `--red-text`.
  - "Late": "4", muted "1h 12m".
  - "Short days": half + short, muted "1 half day", muted "2 left early" ("0" instead of "—" when a
    muted line shows).
  - "Worked": "152h 30m" (`formatDuration`), muted "Breaks 18h 10m", red `Tag` "Over on 3 days".
  - "Check-outs": "2 missing" in `--red-text`, muted "1 not fixed", muted "1 auto", muted "2 entered
    themselves" and, when some are past last seen, marigold "1 to check".
  - "Reports": "18 of 20", "2 missing" in `--red-text`; "—" without `report.self`.
- Empty states (`EmptyState compact`, "Show everyone" link off `all`): all "Nobody tracks attendance
  yet" / "People who check in show up here."; needs_look "Nothing stands out" / "Nobody reached 4
  late days, short days or missing reports."; late "Nobody was late"; short "No short days"; absent
  "Nobody was absent"; leave "Nobody took leave"; missing "No missing check-outs".
- Foot under the table, muted 13 px, from `rules`: "Half day: worked under 4h 30m. Short day: worked
  under 8h. Left early: out more than 15m before their shift ended. Worked is present time less
  breaks. Holidays and leave are never absent." ("Half days are off." / "Short days are off." when
  0.)
- Before 018: the notice above the table (Deploy before migrate).
- Narrow: TopBar actions wrap; KPIs as on the day page; below 1280 px each person is a card
  (`stackBelow={1280}`). Skeleton: the KPI row and 8 rows of 64 px.

#### The month Excel (new `attendance/monthExport.js`)

- `attendance.exportMonth({ viewer, month?, userId? })` → `xlsxResponse` input,
  `summarizeRange({ withDays: true })`. Filename `attendance-2026-11.xlsx`, one person
  `attendance-2026-11-vishal-saini.xlsx`. `xlsxResponse` builds the whole workbook in memory
  (`writeBuffer`), so one file covers at most 200 people (more: 400 "Too many people for one file.
  Download one person's month instead.") and one month export is built at a time per process (a
  module flag; a second one answers 429 "An export is being built. Try again in a minute."). Numbers stay numbers (halves as 0.5, hours `0.00`),
  clocks 24-hour `HH:mm` (as `exportDay`). Never report text, never screen time.
- Sheet 1 "Summary 26 Oct to 25 Nov" (start day 1: "Summary November 2026"), one row per person:
  Name, Email, Designation, Department, Working days, Days present, Office days, WFH days, Worked
  on days off, Paid leave days, Unpaid leave days, Holidays, Absent days, Late days, Late (minutes),
  Half days, Short days, Left early (days), Worked (hours), Breaks (hours), Days over break
  allowance, Missing check-outs, Not fixed yet, Auto check-outs, Check-outs entered themselves,
  Entered after last seen, Reports submitted, Missing reports, Joined, Left, Planned leave days
  (last, so the payroll columns stay together).
- Sheet 2 "Days 26 Oct to 25 Nov", one row per person per listed day, **up to `through` only**
  (every working day while employed, every day with a check-in, every holiday on a working weekday,
  every leave day): Name, Email, Date (`YYYY-MM-DD`), Day ("Mon"), Day type ("Working day", "Day off",
  "Holiday: Diwali"), Where ("Office", "Office (unverified)", "WFH", "On leave", "Absent", "Not
  checked in", blank), Leave ("Full day", "First half", "Second half"), Leave paid ("Paid",
  "Unpaid"), Leave type ("Casual", "Sick", "Other"), Leave note, Check-in, Check-out, Check-out
  status (`CHECKOUT_WORDS`), Check-out entered by, Entered after last seen ("Yes" or blank), Late
  (minutes), Present (hours), Breaks
  (minutes), Worked (hours), Over allowance (minutes), Half day, Short day, Left early (minutes),
  Absent (0, 0.5, 1), Report ("Submitted", "Not submitted", blank), Note (the attendance note).

### 8. One person's attendance month for HR

- `attendance.getPersonMonth({ viewer, userId, month? })` (new, `attendance/personMonth.js`, titles
  in new `personChanges.js`) → `{ period, person: { id, name, initials, avatarUrl, email,
designation, departmentName, role, status, tracksAttendance, joinedOn, leftOn, shift: "Shift 9:30
AM to 6:30 PM" }, totals: MonthPerson (no days), days: MonthDay[] (oldest first, the listed days
of the month Excel), tones: { [date]: tone }, changes: [{ id, at, actor: { id, name } | null,
action, title, details: string[], reason, note }], changesMore, canChange, available }`.
  `NOT_FOUND` "We couldn't find that person." for an unknown id or an Admin when the viewer isn't
  one (§16). Someone who doesn't track attendance and has no row in the month gets the page with
  "Their attendance isn't tracked." Own month: viewable, no actions (`assertNotSelf`).
- **Changes** = `audit.listForEntities({ entityType: 'attendance', entityIds: the month's row ids,
actions, limit: 51 })` with the allow-list `attendance.create`, `attendance.edit`,
  `attendance.correct`, `attendance.confirm_office`, `attendance.self_checkout`,
  `attendance.fix_missing`, `attendance.break_change`, `attendance.break_delete`,
  `attendance.away_checkout`, `attendance.away_put_back`, `attendance.day_rules`,
  `attendance.away_backfill` (never `mark_missing` and `auto_checkout`, which show as tags on the
  day, nor `attendance.unverified_office`, whose reason is the person's check-in note; a future
  action never shows untitled), plus `audit.listForEntities({ entityType: 'leave', entityIds: the leave entries
touching the month })`, merged by audit id with the `audit.listForType({ entityType: 'leave', since: 400
days before the month starts, actions })` rows whose `before` or `after` has the person's `userId`
  and dates touching the month (a deleted leave, or one moved to another month, keeps its rows here),
  and `attendance.listLeave({ viewer, userId, from, to })` for leave without
  an audit change (a change's `note` is null when the viewer is the person it is about); newest first, at most 50 (`changesMore`). Actor names from `users.findByIds`.
  Never the audit `ip`. Titles and details (`formatDayShort`, `formatTimeAmPm`):
  - `attendance.create`: "Neha Kapoor added Mon, 9 Nov", detail "In 9:40 AM, out 6:30 PM, Office".
  - `attendance.edit`: "Neha Kapoor changed Fri, 13 Nov", one detail per changed field: "Check-in
    9:58 AM to 9:30 AM", "Check-out none to 7:10 PM", "Place WFH to Office".
  - `attendance.correct`: "Neha Kapoor approved a correction for Fri, 13 Nov", the same details;
    `reason` = the person's reason, `note` = `after.handlerNote`.
  - `attendance.confirm_office`: "Neha Kapoor confirmed the office check-in on Tue, 3 Nov".
  - `attendance.self_checkout`: "Priya Sharma entered the check-out for Fri, 13 Nov", detail
    "Check-out 6:41 PM"; past last seen: "Check-out 6:30 PM, Daybook last saw them at 1:05 PM" (no
    suggestion: "Check-out 6:30 PM, no sign of work after the check-in").
  - `attendance.fix_missing`: "Neha Kapoor entered the check-out for Fri, 13 Nov", detail
    "Check-out 6:41 PM, suggested" (", suggested" only when `after.suggested`).
  - `attendance.break_change`: "Neha Kapoor changed a break on Thu, 19 Nov", detail "Break from
    1:10 PM, end 3:40 PM to 1:55 PM".
  - `attendance.break_delete`: "Neha Kapoor deleted a break on Thu, 19 Nov", detail "Break 1:10 PM
    to 1:45 PM".
  - `attendance.away_checkout`: "Priya Sharma checked out from the timer question on Thu, 19 Nov",
    detail "Check-out none to 6:42 PM".
  - `attendance.away_put_back`: "Priya Sharma put back time removed from a timer on Thu, 19 Nov",
    detail "Break 1:00 PM to 1:45 PM removed".
  - `attendance.day_rules`: "Late mark updated on Fri, 13 Nov", detail "Late 22m to none" (or
    "Working day to not a working day") and "Because: Holiday added: Diwali" (the audit reason); the
    time line reads "by Neha Kapoor, Thu, 19 Nov, 10:02 AM".
  - `attendance.away_backfill`: "Daybook counted time removed from a timer as a break on Mon, 2
    Nov", detail "Break 1:00 PM to 1:45 PM" (no actor: the time line reads "by Daybook").
  - Leave: "Neha Kapoor marked leave for Mon, 2 – Tue, 3 Nov" (`formatDayRange`), detail "Casual,
    paid, full day", `note` = the leave note; `leave.update` "Neha Kapoor changed leave for …",
    `leave.delete` "Neha Kapoor removed leave for …", with their reason.
- **Page** (new `(app)/attendance/people/[userId]/page.js`, `personMonthData.js`,
  `PersonDays.jsx`, `PersonChanges.jsx`, `page.module.css`, `loading.js`):
  `requirePage('attendance.correct')`; the id through a new `userIdParamSchema` (`notFound()` when
  invalid or NOT_FOUND).
  - `TopBar` breadcrumb "Attendance" (`/attendance`), "November 2026" (`/attendance/month?month=`),
    the name; title the name; subtitle "November 2026 so far, 26 Oct to 25 Nov" (rules as the month
    page). Actions: `DateSwitcher` (payroll months, the same labels), "Download Excel"
    (`/api/attendance/month/export?month=2026-11&userId=12`).
  - **Profile card** (as Employee detail's): `Avatar` 64, designation and department, the shift
    line, "Joined 4 March 2024" or "Left on Tue, 10 Nov"; six stats: "19.5 of 21" "Days present"
    ("10 of 14 so far" in the current month, the month table's rule);
    "1.5" "Leave days"; "1" "Absent days"; "4" "Late days, 1h 12m"; "3" "Short days, 2 left early";
    "152h 30m" "Worked".
  - **"Each day"** card, subtitle "Weekends show only when they checked in.": `DataTable` columns
    "Day" ("Thu, 19 Nov", muted "Today" or the holiday name), "Where" (`StatusCell`: office, wfh,
    unverified; "Absent" with status `missing`; "Not checked in" for today; `on_leave` and
    `holiday`; "Day off"), "Check-in" (time, "Late 22m", "4th this month"), "Out" (time, "Auto" and
    "Early 25m" tags, "Missing" in red, "By Priya" and, past last seen, the "Check" tag), "Breaks" ("45m", red "Over 15m"; a
    `BreaksButton` that opens item 2's break list), "Worked" ("7h 40m", "Half day" / "Short day"
    tags), "Report" ("Submitted", "Not submitted" in `--red-text`, "Due 6:30 PM", "—"; yes or no
    only, never the content), and for `canChange` the existing `RowAction` (add, edit, fix,
    confirm) built by `actionFor` (moved from `attendanceData.js` to a shared
    `(app)/attendance/rowActions.js`). A leave conflict row shows muted "Checked in on a leave day".
  - **Calendar** card: `MonthCalendar` from `dashboard.buildCalendar({ range: { from, to }, toneOf
})`, tones from `tones`: office, wfh, late, missing (absent), `leave` (new tone), `holiday` (new
    tone), future, weekend; legend "Office, WFH, Late, Absent, Leave, Holiday".
  - **"Changes this month"** card, subtitle "By HR, Admins and the person, with their reasons.":
    each change: title (14 px semibold), details (13 px), "Reason: …", "HR note: …", the time muted
    ("Thu, 19 Nov, 10:02 AM"). Empty: "No changes this month." More: "Showing the latest 50."
  - Layout: profile card full width; then a 2-column grid (days left, calendar and changes in a 340
    px right column) at 1440 px and up; below 1440 px the days take the full width with the
    calendar and changes side by side under them, and below 1280 px each day is a card
    (`stackBelow={1280}`); one column below 1024 px (profile, calendar, days, changes). Skeleton:
    profile bar, a 46 px calendar grid, 10 day rows.
- Links in: the day table's names (`canCorrect` only; PMs see plain names), the month table's names,
  Needs a look, the late alert.

### 10. Late count this month, Needs a look, the late alert

#### "4th this month" (day page, new `attendance/needsLook.js`)

- `attendance.lateCountsFor({ date, userIds })` → `{ [userId]: { nth, label, title, alert } }` for
  the people late that day: `nth` = effective late days in the payroll month of `date` from its
  first day up to `date`, this day included. One query (`monthRepo.listLateDays({ userIds, from,
to })`: rows with `late_minutes > 0`) plus `loadCalendar`, then `effectiveLateMinutes` (the same
  rule as the month summary, so the two always agree).
- Check-in cell: a third line under "Late 22m", 12 px `--muted`: "4th this month" ("1st", "2nd",
  "3rd", "11th", "12th", "13th", "21st"…; shown for every late day, the first included). At or over
  `lateAlertDays` it is `--marigold-text`, semibold. `title`: "4th late day in November 2026" (start
  day 1) or "4th late day in November 2026 (26 Oct to 25 Nov)". Shown to every viewer of Attendance
  (PMs too: it only counts late marks they can already see day by day). `GET /api/attendance` items
  gain `lateCount` the same way.

#### Needs a look this month

- `attendance.getNeedsLook({ viewer })` → `{ period, threshold, total, items: [{ user, href,
reasons: [{ key: 'late' | 'short' | 'reports', count, label }] }] }` for the **current** payroll
  month through today, from `summarizeRange`. Sorted by the sum of the counts, then name. Admins
  only for an Admin viewer (§16). The day page refreshes every 60 s (`today/AutoRefresh.jsx`), so
  the answer is kept per process for 5 minutes, keyed by the payroll month and whether the viewer
  is an Admin (like settings' 30 s cache); a leave or holiday write clears it in that process.
- Labels, count first: "5 late days", "4 short days" (half days and short days together), "4
  missing reports" (`plural`). Only the reasons at or over the threshold are listed.
- **Card** (new `(app)/attendance/NeedsLookCard.jsx` + css), HR and Admin only (`canCorrect`), in the
  day page's side column under "Missing check-outs", whatever day is shown: `CardHeader` title
  "Needs a look this month", subtitle "November 2026 so far" (start day 1) or "26 Oct to 25 Nov so
  far". Up to 6 rows: `Avatar` 30, the name as a link to the person month, then the reasons as
  `Tag`s (late and short marigold, reports red), wrapping under the name below 1024 px. Empty:
  "Nothing stands out this month." Foot, muted: "Listed at 4 late days, short days or missing
  reports." More: "3 more in the month view." (link `/attendance/month?filter=needs_look`).

#### The late alert to HR (worker `late-alerts`, new; `attendance/lateAlerts.js`)

- Every minute; on a working day at or after `officeEnd` (company time): `runAttempts('late-alerts',
'late_alerts:<date>', () => attendance.sendLateAlerts(date))` (3 attempts, 10 minutes apart; safe,
  since `attendance_alerts` is unique). Not on a holiday (`sendLateAlerts` returns `{ alerted: 0,
holiday: true }`). No upper time: a worker that was down all evening still sends it that day.
  **Migration 018 claims the deploy day's three keys** (Data step 8), so the first alerts come on
  the next working day, after the Admin has set the payroll month.
- `attendance.sendLateAlerts(today)`: `summarizeRange` over the current payroll month through today,
  no viewer (everyone); for each **active** person with `lateDays >= lateAlertDays`, one
  transaction with its own try/catch (one failing person never stops the others): insert
  `attendance_alerts (user, 'late_days', periodKey, lateDays)`; errno 1062 = already told this
  period, skip; else `notifications.notify` to `pickRecipients(pools, person)`. **On the first
  working day of a payroll period** it also checks the previous period through its last day (its
  own `period_key`), so a run missed on a period's last day still alerts: that alert reads
  "Vishal Saini was late 5 times last month", "5 late days in October 2026, 1h 30m in all.".
  Type `attendance.late_alert`; title "Vishal Saini was late 4 times this month"; body "4 late days
  so far in November 2026, 1h 12m in all."; link `/attendance/people/12?month=2026-11`. Desktop
  push comes with the bell row (§14). No Slack DM. **The person is not told.** Returns `{ alerted,
checked }`.
- Once per person per payroll month even if the setting changes: lowering it alerts at the next
  run; raising it after an alert sends nothing more that month. Changing the payroll start day
  re-cuts the periods (a new key), documented, not prevented.

### 6. Company holidays (attendance, new `attendance/holidays.js`)

#### Holidays page (`/attendance/holidays`, `requirePage('attendance.view_all')`)

- **TopBar**: title "Holidays", subtitle "Days the office is closed. Nobody is expected in, so there
  are no late marks or reminders.", breadcrumb "Attendance" (`/attendance`) › "Holidays". Actions: a
  year `DateSwitcher` (label "2026", prev "2025", next "2027"; `?year=`; years from last year to next
  year, the arrow past them is disabled with label "No earlier years" / "No later years"), and for
  `attendance.correct` "Add holiday" (primary, Plus).
- **Card** (`padding="none"`): `CardHeader` title "2026", subtitle "3 holidays, 1 still to come"
  ("1 holiday", "No holidays"). `DataTable` columns: **Date** ("Tue, 24 Nov", `formatDayShort`),
  **Name**, **Status** (`Tag` sm: "Today" primary, "Past" neutral, "Not a working day" neutral when
  the weekday isn't in `workingDays`; nothing for days to come), and for `attendance.correct` a
  `Menu` "Actions for Guru Nanak Jayanti" with "Edit" and "Delete" (tone danger).
- **Empty**: `EmptyState` "No holidays in 2026" / "Add the days the office is closed." with "Add
  holiday" (secondary); for PMs the body is "HR adds the days the office is closed." and no button.
- **Add / Edit dialog** (`Dialog`, 480 px, so the three footer buttons fit on one line): title
  "Add holiday" / "Edit holiday". `Field` "Date" (`Input type="date"`); `Field` "Name" (`Input`,
  placeholder "Diwali", help "Shown on Attendance
  and on everyone's Today."). The Date starts empty (`min` and `max` from Limits). Live muted line
  when the date is before today: "This day has passed. Late marks of anyone who checked in that day
  are removed, and Admins are told." (today: "This is today. Late marks of anyone who checked in
  today are removed, and Admins are told."). Footer: Cancel, "Save and add another" (secondary, Add
  only: saves, clears Name and Date, focus to Date) and "Add holiday" / "Save" (primary, `loading`
  while saving). Toast "Holiday added" / "Holiday saved", body "Guru
  Nanak Jayanti, Tue, 24 Nov". Errors show under their field.
- **Delete dialog**: title "Delete Guru Nanak Jayanti?", description "Tue, 24 Nov becomes a working
  day again. Late marks of anyone who checked in that day are worked out again." (for today or an
  earlier day " Admins are told." is added). Footer Cancel and "Delete" (danger). Toast "Holiday
  deleted".
- Skeleton `holidays/loading.js`: the top bar, a header bar and four 54 px rows.

#### Rules

- `listHolidays({ year })` → `{ year, available, items: [{ id, date, name, dayLabel, weekday, past,
today }], upcoming }` (`listHolidaysBetween` and `nextHoliday` are A's calendar reads);
  `createHoliday({ actor, date, name, ip })`,
  `updateHoliday({ actor, id, date?, name?, ip })` → the holiday; `deleteHoliday({ actor, id, ip })`
  → `{ id }`.
- Each write: one `repo.transaction` (READ COMMITTED): `applyDayRules({ from, to, reason, actorId },
trx, write)` around the holiday row's insert, update or delete (the old and new date on a move;
  reasons "Holiday added: Diwali", "Holiday moved: Diwali", "Holiday removed: Diwali"), audit
  `holiday.*`; after commit the `companyDay` and Needs a look caches are cleared in this process and
  `recheckDayRules({ from, to, since: the write's start, reason })` runs once in its own transaction.
  The unique key refuses a second holiday on a date (errno 1062 → `CONFLICT`). Report reminders,
  summaries and notices already sent are not sent again or taken back.
- **A write that touches today or an earlier date and changed at least one row**, after commit:
  the active Admins other than the actor get a bell `holiday.past_changed`: title "Neha Kapoor added
  a holiday on Fri, 13 Nov" / "Neha Kapoor moved a holiday to Fri, 13 Nov" / "Neha Kapoor deleted a
  holiday on Fri, 13 Nov", body "12 attendance rows changed." plus " Neha Kapoor's own row is one of
  them." when it is (the one write path where HR changes their own late mark), link
  `/attendance/holidays?year=2026`; and each person whose late minutes changed gets
  `attendance.edited` "Your late mark for Fri, 13 Nov changed", body "Holiday removed: Diwali.",
  link `/log?month=2026-11`.
- **Check-in** on a holiday: allowed; `is_working_day = 0`, `late_minutes = 0` (`getDay` in
  `checkIn`).
- **Attendance** (any day shown): on a holiday a muted notice `Card` (new `DayNotice.jsx`, compact,
  Info icon, `role="status"`) above the table: "Holiday: Guru Nanak Jayanti. Nobody is expected in,
  so there are no late marks or reminders." On a weekday the company doesn't work: "Not a working
  day. Nobody is expected in." Everyone without a check-in shows "Holiday" (or "Day off") in Where
  and is not counted in "Not checked in".
- **Today** (the person): notice "Today is a holiday: Guru Nanak Jayanti. Check in only if you're
  working."; the Check in card subtitle "Office hours 9:30 to 6:30. No late mark today." (instead of
  "Late after 9:30."). Under the help links, a muted line "Next holiday: Guru Nanak Jayanti, Tue, 24
  Nov." when one is within 14 days.
- Every other place: the table "Every place that decides a working day".

### 9. Leave days (attendance, new `attendance/leave.js`, checks in `leaveRules.js`)

No employee leave requests and no balances in this release.

#### Leave page (`/attendance/leave`, `requirePage('attendance.correct')`: HR and Admins only, since the type and the note are theirs)

- **TopBar**: title "Leave", subtitle "Leave HR has marked. People on leave aren't counted absent or
  reminded.", breadcrumb "Attendance" › "Leave". Actions: a `DateSwitcher` that walks **payroll
  months** (`resolvePayrollMonth`, the month page's labels: "November 2026"; `?month=YYYY-MM`, from
  January of last year to December of next year; the subtitle adds "26 Oct to 25 Nov" when the start
  day isn't 1), so the Leave card and the month view's Leave count the same days; and "Mark leave"
  (primary, Plus).
- **Filter**: `Select` "Person" ("Everyone", then the tracked, active people the viewer may see, by
  name), kept in `?userId=`.
- **Card**: `CardHeader` title "November 2026", subtitle "5 people, 7.5 working days" ("1 person,
  0.5 day", "No leave"). `DataTable` columns: **Person** (Avatar 34 + name + designation), **Days**
  (`formatDayRange`, plus muted ", first half" / ", second half"), **Working days** ("2 days", "1
  day", "0.5 day": the entry's leave days inside this payroll period; muted "of 5" when the entry has
  more outside it; muted "1 day checked in" when some of them have a check-in, since those count as
  present in the month view),
  **Type** ("Casual", "Sick", "Other"), **Pay** (`Tag` green "Paid" / neutral "Unpaid"), **Note**
  (one line, full text in `title`, "—" when empty or when the entry is about the viewer), **Marked
  by** (muted "Neha Kapoor, 12 Nov"), and
  a `Menu` "Actions for Priya Sharma's leave" with "Edit" and "Delete" (danger). An entry shows in
  every month it touches. Newest first by `from_date`, 50 a page with the usual pager.
- **Empty**: "No leave in November" / "Mark leave when someone tells HR they'll be away." with "Mark
  leave" (secondary).
- Skeleton `leave/loading.js`.

#### Mark leave dialog (new `(app)/attendance/LeaveDialog.jsx`, shared by the Leave page, the Attendance row menu and the "Leave and holidays" card)

- `Dialog` (520 px), title "Mark leave" / "Edit leave" (description "Priya Sharma" when editing).
- `Field` "Person" (`Select`, required): tracked, active people the viewer may change (never the
  viewer; never an Admin for a non-Admin). Preset and disabled when opened from an Attendance row or
  when editing.
- `Field` "First day" and `Field` "Last day" (`Input type="date"`; from the Leave page or the card
  both start at today, from a row at the row's date); Last day follows First day until
  the person picks one of its own (the WFH dialog's rule, `wfhOptions.js`), and never stays before
  it.
- `Field` "Part of the day", rendered without `htmlFor` (a `<label>` can't name a group): `Segmented
label="Part of the day"` (the group's `aria-label`) with the help tied to the group by
  `aria-describedby`: "Full day", "First half", "Second half". The halves are disabled (Segmented's
  new per-item `disabled`, G) while the days differ, with help "Half days are for one day."; with one day the help
  reads "First half: until 2:00. Second half: from 2:00." (the person's split, from the preview).
- `Field` "Type" (`Select`): "Casual", "Sick", "Other". `Field` "Pay" (`Segmented label="Pay"`, as
  above): "Paid" (default), "Unpaid".
- `Field` "Note" (`Textarea`, rows 2, optional, max 300), help "Only HR and Admins see the note."
- Editing only: `Field` "Reason for the change" (`Textarea`, required), help "Saved in the audit
  log."
- **Live preview** (`role="status"`, from `GET /api/leave/preview`, sent 300 ms after the last
  change; while waiting, muted "Counting working days…"; on an error, muted "Couldn't check these
  dates. Saving checks them again." and Save stays enabled): "2 working days: Mon, 23 – Wed, 25 Nov." / "Half a working day." / "1 working day." Then
  muted notes, one per line: "Tue, 24 Nov is a holiday (Guru Nanak Jayanti) and isn't counted." /
  "Sat, 28 Nov isn't a working day and isn't counted." (at most 3, then "and 2 more days off"),
  marigold "Priya checked in on Mon, 23 Nov. The check-in stays.", red "Priya already has leave on
  Mon, 23 Nov." and red "No working days in these dates."
- Footer: Cancel and "Mark leave" / "Save" (primary; disabled while the preview shows an overlap or
  no working days). When editing, a "Delete leave" text button (danger) at the footer's start opens
  the **delete dialog** (new `LeaveDeleteDialog.jsx`): title "Delete this leave?", description
  "Priya Sharma, Mon, 23 – Wed, 25 Nov. These days count as working days again.", `Field` "Reason"
  (required), footer Cancel and "Delete" (danger).
- Toasts: "Leave saved" / "Leave deleted", body "Priya Sharma, Mon, 23 – Wed, 25 Nov". Errors toast
  the API's message, field errors show under their field; `router.refresh()` after a save.

#### Rules

- F: `listLeave({ viewer, month?, from?, to?, userId?, limit, offset })` → `{ items: LeaveEntry[],
total }` (`month` = the payroll period); `previewLeave({ actor, userId, fromDate, toDate?, part,
excludeId? })` → `{ workingDays, split, offDays: [{ date, why: 'holiday' | 'not_working', name?
}], checkIns: [date], overlap: { fromDate, toDate } | null }`; `createLeave({ actor, userId,
fromDate, toDate?, part, paid, leaveType, note?, ip })`, `updateLeave({ actor, id, ...changes,
reason, ip })` → LeaveEntry; `deleteLeave({ actor, id, reason, ip })` → `{ id }`.
- `LeaveEntry` = `{ id, user: { id, name, initials, designation, role, status }, fromDate, toDate,
days, part, partLabel, paid, leaveType, typeLabel, note, workingDays, createdBy: { id, name } |
null, createdAt, updatedBy, updatedAt }`. `note` is null when the entry is about the viewer (an HR
  person's own leave on the Leave page, the person month and the month Excel). `workingDays` counts
  the entry's leave days inside the asked payroll period, with `checkedInDays` beside it.
- A's reads have fixed shapes: `listOnLeave(date, { viewer })` → `[{ user, part, checkedIn,
leaveType?, paid? }]` (type and pay only for `attendance.correct`); `listUpcomingLeave({ viewer,
from, to, limit })` → the same items plus `fromDate`, `toDate`; `getMyLeave({ user, from, to })`
  → `[{ id, fromDate, toDate, part, partLabel, paid, leaveType, typeLabel, markedBy: { name } }]`,
  **never `note`**; `getMyToday.upcoming.leave` is that shape and the My log day's `leave` is `{
part, paid, leaveType }`.
- `previewLeave` runs the write flow's person checks first, in the same order (below), with
  `NOT_FOUND` "We couldn't find that person." for a missing or inactive person **and** for one the
  actor may not see (`showsAttendanceOf`), so HR can't read an Admin's check-in dates, shift or
  leave through it; `excludeId` is used only when that entry belongs to `userId`.
- **Write flow**: check the input (Limits) and the person, in this order (so HR learns nothing about
  an Admin from which error comes back): exists and active (`users.findById`, else `NOT_FOUND`),
  `showsAttendanceOf(actor, person)` (else `FORBIDDEN` "Only an Admin can mark an Admin's leave."),
  `assertNotSelf`, tracks attendance (else `CONFLICT`); `updateLeave` and `deleteLeave` check the
  same with the entry's `userId`; count working days with `loadCalendar` (0 → `VALIDATION_FAILED`); then one
  `repo.transaction(fn, { isolationLevel: 'repeatable read' })` (the WFH pattern: the overlap read
  `FOR UPDATE` locks the gap a double tap would use; a deadlock retries up to 3 times): find an
  overlapping entry of the person (excluding this one) → `CONFLICT`; the insert or update inside
  `applyDayRules({ userIds: [userId], from, to, reason, actorId }, trx, write)` over the old and new
  days (an update that changes only `paid`, `leaveType` or `note` skips it); audit `leave.*`; notify
  the person; after commit `recheckDayRules` for that person and those days, and the Needs a look
  cache is cleared. An Admin's leave is `NOT_FOUND` by id for non-Admins (§16).
- Bell to the person (link `/today` for today or later, else `/log?month=YYYY-MM`): `leave.marked`
  "Neha Kapoor marked leave for you: Mon, 23 – Wed, 25 Nov" (", first half" for a half), body
  "Casual, paid."; `leave.changed` "Neha Kapoor changed your leave: Mon, 23 – Tue, 24 Nov", same
  body; `leave.removed` "Neha Kapoor removed your leave on Mon, 23 – Wed, 25 Nov". The note is never
  in the notification. No Slack.

#### On Attendance (`/attendance`)

- **Where cell**: `on_leave` → `StatusCell` "On leave" and, for a half, a muted line under it "First
  half" / "Second half" (the "Late 38m" line's style). `holiday` → "Holiday". `day_off` → "Day off".
  Someone on leave who checked in keeps their Office/WFH cell with the muted line "On leave" / "On
  leave, first half". A not-checked-in person with approved WFH gets the muted line "WFH approved"
  (`attendance.correct` viewers only: WFH requests are the approvers' and the person's, §17, so
  `day.wfhApproved` is false for PMs).
  For `attendance.correct` viewers the cell's `title` adds "Sick leave, unpaid"; PMs see "On leave"
  and the part only.
- **Filter pill** "On leave (2)" (`?filter=on_leave`, after "Not checked in", shown only when the
  count is above 0 or it is selected): everyone with leave that day, checked in or not. Empty state: "Nobody is on leave" / "Leave HR marks shows here." "Not
  checked in" counts `presence === 'not_checked_in'` only.
- **"Leave and holidays" card** (new `LeaveCard.jsx`, side column, last; everyone with
  `attendance.view_all`): title "On leave today" (or "On leave, Mon, 9 Nov" for an earlier day);
  rows: Avatar 30, name, muted part ("Full day", "First half", "Second half"), for HR and Admins " ·
  Sick, paid", and muted "Checked in" when they did. Empty: "Nobody is on leave." Then, for HR and
  Admins, "Coming up" with the leave starting in the next 7 days (at most 5 rows: "Rahul Verma, Mon,
  23 – Wed, 25 Nov"). Then muted "Next holiday: Guru Nanak Jayanti, Tue, 24 Nov" (within 60 days).
  Footer text buttons: "Mark leave" (HR, Admin; opens the dialog), "All leave" (HR, Admin;
  `/attendance/leave`), "Holidays" (`/attendance/holidays`).
- **Row menu** (`RowMenu`, F; HR and Admin, rows other than their own): after D's remind item,
  "Mark leave" (person and date preset), or "Edit leave" when the person has leave that day. Before
  018 these items are left out (no menu at all when nothing else is in it).

#### On Today (the person)

- A notice `Card` in the "Still working?" slot (new `TodayDayNotice.jsx`, compact, CalendarDays
  icon, `role="status"`; the "Still working?" line shows under it when both apply):
  - full day: "You're on leave today. Check in only if you're working." and a muted second line
    "Casual leave, paid. Marked by Neha Kapoor."
  - first half: "You're on leave for the first half of today, until 2:00." (muted second line as
    above)
  - second half: "You're on leave for the second half of today, from 2:00."
  - holiday: see item 6.
- **Check in card** subtitle uses `day.lateMark`: "Office hours 9:30 to 6:30. Late after 2:00." on
  first-half leave; "No late mark today." on full-day leave.
- **This week** bars (`todayData.weekDays`): a past or current holiday or full-leave day without
  hours shows `display` "Holiday" / "Leave", `faded`.
- Under the help links: muted "Leave coming up: Mon, 23 – Wed, 25 Nov." (the next own leave starting
  tomorrow to 14 days ahead, part added for a half day).

#### Other screens

- **Team board** (PM, Admin; `dashboard/team.js`, `shared.summarizeDay`): a new last group `{ key:
'off', title: 'Off today', tone: 'teal' }` (the tone of its bar segment, as every other group's,
  `team.js:28-30` and `223-225`) holding everyone whose presence is `on_leave`, `holiday` or
  `day_off`, each with a `Tag` "On leave" / "On leave, first half" (teal), "Holiday" (green) or "Day
  off" (neutral), never the type. "Not checked in" (group, KPI, segment) counts only `not_checked_in`; the
  attendance bar gains a segment `{ key: 'off', label: 'Off today', color: 'teal' }`.
  `checkedInKpi` sub "of 26 people, 2 off" when some are off. On a holiday the subtitle ends " ·
  Holiday: Guru Nanak Jayanti".
- **Overview** (`dashboard/overview.js`): "Attendance this week" asks the calendar per day: "Not
  checked in" = for today `presenceOf` at now (first-half leave before the split counts as Off, as
  on Attendance and the Team board), for past days expected people without a check-in; a new segment "Off" (teal) = people on full-day
  leave; a holiday column is `faded` with its `title` "Holiday: Guru Nanak Jayanti". "Hours this
  week" counts only working days so far.
- **Employee detail** (`dashboard/history.js`, `calendar.js`): history rows also for holiday and
  leave days; Where "On leave" / "Holiday" without a check-in, Report "—" (`'off'`) on a day with
  expected 0 and no report. The month calendar gets tones `holiday` and `leave` (legend "Holiday",
  "Leave"), shown for days to come too, so planned leave is visible. PMs never see the type.
- **My log** (`reports/monthLog.js`, the person's own): each day carries `holiday` and `leave` (own
  type and pay); `rowStatus` answers `holiday` or `on_leave` for an off day with no check-in and no
  report (`StatusCell` "Holiday" / "On leave"); a half day adds the muted line "First half on
  leave". KPIs: "of N working days" = working days while employed, leave included (the month view's
  "of 21 days"); "not checked in" = absent from `dayCounts` (a half-leave no-show counts 0.5). The
  My log Excel gets "Day type" and "Leave" columns like Attendance's (the person's own type and pay,
  never the note).

### Every place that decides a working day (and how each changes)

| Place (today)                                                                                                                  | Decides                                      | 1.10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/time.js` `isWorkingDay(date, workingDays)`, `workingDaysBetween(from, to, workingDays)`                               | weekday only                                 | optional last argument `holidays` (a `Set` or array of dates): skipped when given. Old calls unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/time.js` `lateMinutesFor({ ..., workingDays })`                                                                       | 0 off weekdays                               | unchanged; callers pass `day.lateMark` through `lateMinutesForDay`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/worker/clock.js` `companyNow().workingDay`                                                                                | weekday                                      | `workingDay = (await attendance.companyDay(date)).isWorkingDay`; the result adds `holiday`. So `report-reminder`, `ai-pm-summary`, `timer-reminders` and the new jobs (`checkin-reminders`, `hr-summary`, `hr-evening-summary`, `late-alerts`) skip holidays.                                                                                                                                                                                                                                                                                                          |
| `src/modules/timers/worker.js:125` `sendReminders` re-check                                                                    | weekday                                      | `(await attendance.companyDay(today)).isWorkingDay`. People who checked in on leave are working: reminded as usual.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/worker/jobs/aiHrNotes.js:16`, `aiSummaries/calendar.js:38` `lastWorkingDayOfWeek`                                         | last weekday of the week                     | holidays skipped (`lastWorkingDayOfWeek(date, workingDays, holidays)`), and the job runs when `date >=` that day inside the same ISO week (a Friday holiday added on Friday morning still gets the notes that day; `runAttempts` keeps it to once a week).                                                                                                                                                                                                                                                                                                             |
| `aiSummaries/hrNotes.js:73` `countWeek`                                                                                        | `workingDays += 1` per weekday               | `workingDays` counts working days; each person adds `holidays`, `leaveDays` (0.5 steps) and `expectedDays` from `dayCounts`, and late days use effective late. `missingCheckOuts` and `autoCheckOuts` follow the month rules (marked missing by audit or still missing; auto by audit or status; `loadWeek` reads `audit.listForEntities` once for the week's row ids). The prompt adds: "holidays are company holidays; leaveDays are days HR marked as leave (a half day is 0.5). Neither is an absence." The leave type, pay and note are **never** sent to Gemini. |
| `aiAsk/attendance.js:56-65` `daysWithoutCheckIn`                                                                               | weekday without a row                        | the sum of `expected` on days without a row (holidays and full leave out, a half-leave no-show 0.5). `attendance_summary` adds per person `leaveDays` and a top-level `holidays: [{ date, name }]` (at most 50). `aiAsk/prompt.js` adds "Company holidays and leave days are not working days." Type and pay never. `OUT_STATUS.corrected` becomes 'Corrected' (a person may now enter their own); with `attendance.checkoutEnteredFor(rowIds)` a row whose `checkout_entered_by` is its own person reads `checkOutNote: 'Entered by the person'`.                     |
| `attendance/rules.js` `computeLateMinutes`, `workingDayFlag`                                                                   | weekday                                      | take an optional `day` (PersonDay).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `attendance/service.js:156` `checkIn`                                                                                          | weekday                                      | `getDay({ person: user, date })` before the insert; late and flag from it. `getMyToday` adds `day`, `upcoming: { leave, holiday }` and `missing` (`listMyMissingCheckouts`).                                                                                                                                                                                                                                                                                                                                                                                           |
| `attendance/hr.js:182` `createForUser`, `updateRow` (new check-in)                                                             | weekday                                      | `getDay` for the row's person and date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `attendance/decisions.js:64` `applyCorrection` (missing day, check-in)                                                         | weekday                                      | `getDay`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `attendance/day.js:121` `missingWindow`                                                                                        | last weekday before                          | `lastWorkingDayBefore` (holidays skipped).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `attendance/day.js` `listDay`, `filterDay`, `summarize`, `exportDay`                                                           | "Not checked in" = no row (even at weekends) | items add `day` (type and pay only with `leaveDetail`) and `where = presenceOf(...)`; filters add `on_leave`, `on_break`; summary adds `onLeave`, `off`, `holiday`, `onBreak`. `listDay(date, { viewer, calendar?, leaveDetail? })` takes a preloaded calendar (HR notes read 7 days).                                                                                                                                                                                                                                                                                 |
| `attendance/service.js` `markMissingCheckouts`, `autoCheckout.js`, `checkoutReminder` job                                      | open rows only                               | unchanged: they act only on people who checked in, holiday or leave alike.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `reports/reminders.js` `sendReportReminders`                                                                                   | job gate + checked in today                  | unchanged code: the gate skips holidays; people on leave have no check-in so aren't reminded; someone who checks in on leave is.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `reports/monthLog.js:75,107,177`                                                                                               | weekday                                      | the calendar for the month (My log).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `reports/queries.js:52` `listStuckTasks`, `dashboard/employee.js:61-91` `daysInProgress`, `isStuckTask`                        | working days since first reported            | holidays skipped (`workingDaysBetween(..., holidays)`); leave doesn't change task age.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dashboard/employee.js:120` `periodStats`                                                                                      | stored `isWorkingDay`                        | unchanged code; holiday rows now store 0, so they leave the average check-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `dashboard/overview.js:51` `hoursKpi`, `:172` `attendanceWeek`                                                                 | weekday                                      | the calendar (Overview).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `dashboard/history.js:170` `buildHistory` expected                                                                             | weekday                                      | `day.expected > 0`, plus holiday and leave days shown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dashboard/calendar.js:36` `buildCalendar`, `dayTone`                                                                          | weekday columns                              | columns stay the working weekdays; `dayTone({ date, row, profile, today, day })` adds `holiday`, `leave`; `buildCalendar` takes optional `range` and `toneOf` (item 8).                                                                                                                                                                                                                                                                                                                                                                                                |
| `dashboard/team.js:34`, `shared.js:97` `summarizeDay`                                                                          | no row = Not checked in                      | `presenceOf` (Team board).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `(app)/today/todayData.js:83` `weekDays`                                                                                       | weekday                                      | holiday and leave labels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `(app)/today/wfhOptions.js:200` `nextWorkingDay`, `todayWfh.js:35`                                                             | next weekday                                 | holidays skipped (passed from `todayWfh.js`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `(app)/screen-time/screenTimeView.js:170` `rangeSummary`, `(app)/log/screenTime.js:21`, `(app)/team/[userId]/screenTime.js:43` | weekday bars                                 | a holiday without data draws no bar (pass `holidays`). Averages are per day with data, unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dashboard/repo.js:285`, `aiAsk/repo.js:226`, `attendance/repo.js:47` (`is_working_day` column)                                | stored flag                                  | unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `db/demo/calendar.js`, `settings` (Working days)                                                                               | weekday                                      | unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### The Attendance day screen, all together (`/attendance`)

Every item adds to the same page; this is the one layout (builder A puts it together, the others
supply their pieces; see "Files and owners").

- **TopBar actions**: HR and Admin get the `Segmented` "Day" (`/attendance`) / "Month"
  (`/attendance/month`), `label="View"`, value "day", first; then the `DateSwitcher` and "Download
  Excel" as today. PMs see what they see today.
- **KPIs**: the five of today. "Present": sub "of 24 people, 2 off" when `summary.off > 0` (leave,
  holiday or day off without a check-in) and percent = present ÷ (tracked − off), so HR's number
  matches the Team board's `checkedInKpi`; "In office", "WFH" and "Late" keep their percent over the
  same expected count. "Late" counts effective late. "Missing check-out" is item 7's link with
  `footer` "12 to fix in all".
- **Day notice** (`DayNotice.jsx`, item 6) under the KPIs on a holiday or a day that isn't a working
  day; then the WFH requests card (unchanged).
- **Everyone card pills**: "All", "Late", "WFH", "Not checked in", "On leave", "Unverified", "On
  break" (today only). "On leave" and "On break" show only when their count is above 0 or they are
  the selected filter, so the pills fit beside the title at 1440 as artboard 09's five do. `FILTERS
= ['all', 'late', 'wfh', 'not_checked_in', 'on_leave', 'unverified', 'on_break']`. New empty
  states: on_leave "Nobody is on leave" / "Leave HR marks shows here."; on_break "Nobody is on a
  break" / "People on a break show up here." For `canCorrect` on today with the `not_checked_in` or
  `on_break` filter, D's `RemindAllButton` follows the pills.
- **Cells** (new `DayCells.jsx`: `WhereCell`, `CheckInCell`, `OutCell`, `PresentCell`, `ActionCell`;
  `AttendanceCards.jsx` keeps the cards; column widths as artboard 09 except Action, below; each line
  shows only when it applies). **Every new muted line** (12 px, line height 15) uses `white-space:
normal; overflow-wrap: anywhere` and may take 2 lines, never the `nowrap` of `.late` and `.breaks`
  (Check-in has about 73 px of content, Where about 90, Out about 57, Present about 65):
  - **Person**: `Avatar`, the name (a link to the person month for `canCorrect`), designation.
  - **Where**: `StatusCell` (`office`, `wfh`, `unverified`, `not_checked_in`, `on_leave`,
    `holiday`, `day_off`); muted line "First half" / "Second half" (on leave), "On leave" / "On
    leave, first half" (checked in on a leave day), "WFH approved" (not checked in;
    `attendance.correct` viewers only); `title` "Sick leave, unpaid" for `attendance.correct`
    viewers.
  - **Check-in**: the time; "Late 22m" (effective); "4th this month".
  - **Out**: the time; "Auto" tag; "Early" tag; muted "By Priya" (with the hidden "Check-out entered
    " before it); HR's "Check" tag; or red "Missing".
  - **Present** (the whole cell is the `BreaksButton` when the row has a break): the worked time (or
    present time without breaks); marigold "On break" tag (with `dot`) and muted "since 1:10";
    muted "Breaks 45m"; red "Over 15m"; marigold "Half day" or "Short day" tag.
  - **Note**: as today; for `canCorrect` viewers it takes what the wider Action column leaves (at
    least 96 px at 1440).
  - **Action** (`canCorrect`, not the viewer's own row, as today): **one line** with the existing
    `RowAction` button and F's `RowMenu` ("...", label "More for Priya Sharma"), which holds, in
    order, D's remind item (item 5) and "Mark leave" / "Edit leave" (item 9); under the line D's
    `ReminderNote` (at most 2 lines). The Action column widens from 95.66 to 120 px for `canCorrect`
    viewers (the Note column gives it up). Rows without a reminder line stay 54 px. A checks it with
    `shot.mjs` and `compare.py` against `09-attendance` at 1440 and 1280 px.
- **Side column** is two wrappers. `.sideAct` holds Corrections (HR, Admin) and Missing check-outs
  (`MissingCard`) and keeps today's rule (above the table below 1440 px, `order: -1`, the 280 px
  auto-fit grid). `.sideInfo` holds Needs a look this month (HR, Admin) and Leave and holidays
  (`LeaveCard`) and goes **after** the table below 1440 px (`order: 1`, the same grid), so on a 1366
  or 1280 px laptop the day table stays near the top. At 1440 and up both stack in the 340 px column
  in this order.
- **`listDay` item** (one shape for every reader): `{ user, attendance, day: PersonDay, where,
presentMinutes, breakMinutes, workedMinutes, overAllowanceMinutes, lateMinutes (effective),
marks, onBreakSince, breakCount, checkoutEnteredBy: { id, name, at, self, pastLastSeen,
suggestedAt } | null }`. `listDay(date, { viewer, calendar?, leaveDetail })`: `day.leave` carries
  `leaveType` and `paid` only with `leaveDetail` (Attendance passes it for `attendance.correct`
  viewers; worker reads with no viewer pass it), and `day.wfhApproved` is false for viewers without
  `attendance.correct`. `checkoutEnteredBy` comes from `checkoutEntered.checkoutEnteredFor(rowIds)`
  (empty before 018); `pastLastSeen` and `suggestedAt` are only filled for `attendance.correct`
  viewers. `listForDay` items add `lateCount`. `summarize` adds `onLeave`, `off`, `holiday` (`{ name
} | null`), `onBreak`; `getDaySummary` adds `missingTotal`.
- **Day Excel** (`dayExport.js`): Where words add "On leave", "Holiday", "Day off"; "Late
  (minutes)" is effective late; seven columns are added **at the end**, so existing column positions
  don't move: "Day type" ("Working day", "Holiday: Diwali", "Day off"), "Leave" ("Full day", "First
  half", "Second half", plus ", casual, paid" for `attendance.correct` viewers; the month Days
  sheet's words), "Late this month" (the nth, blank when not late), "Half day" ("Yes" or blank),
  "Short day", "Left early (minutes)", "Check-out entered by" (name, or empty).
- Page data: `attendanceData.js` keeps `loadAttendance`; `tableRow`, `presentOf` and `kpis` move to
  new `dayRows.js`, `actionFor` to new `rowActions.js` (shared with the person month). The loader
  adds, for HR and Admin, `remindData.js` (D: `listReminders` and `remindKindFor`), `lateCountsFor`
  and `getNeedsLook` (E), `listOnLeave`, `listUpcomingLeave` and `nextHoliday` (A's calendar reads).
- **`loading.js`**: a 130 px `Segmented` skeleton before the DateSwitcher for HR and Admin, and four
  side skeletons split as the side column (two above, two after the table below 1440 px), so nothing
  jumps when the page loads.

### Today, all together (`/today`)

- Notices slot (under the top bar): `TodayDayNotice` (holiday or leave), then the "Still working?"
  line when it applies.
- Check in card subtitle from `day.lateMark` (item 9); This week bars with "Holiday" / "Leave".
- "Working on": the removed-time rows with "Put back" (A).
- The `.help` box, top to bottom: `MissingCheckoutPrompt` (B), `CorrectionLinks` (as today), muted
  "Next holiday: …" and "Leave coming up: …" lines (items 6 and 9).
- Dialogs: the away question (the sidebar chip, A) always first; the missing check-out pop-up (B)
  waits until no modal is open. `TodayPage` now takes `{ searchParams }` (async) and passes
  `openMissing` (`?checkout=missing`) to `MissingCheckoutPrompt`.
- `getMyToday` (`GET /api/attendance/me/today`) adds `day` (with `leaveDetail`), `upcoming: {
leave, holiday }` (the `getMyLeave` shape: never the note) and `missing`
  (`listMyMissingCheckouts`).

### Settings (Admin, Settings)

Eleven new keys (snake_case in `db/seeds/03_settings.js`, camelCase in `settings.getAll()`;
`settings/schemas.js` `settingsUpdateSchema`, `settings/service.js` `CLOCK_KEYS` / `BOUNDED_KEYS`,
`settingsValues.js` `KEYS`, `numberFields.js` `NUMBERS`):

| Key                        | Default | Rule and message                                                                      | Where            |
| -------------------------- | ------- | ------------------------------------------------------------------------------------- | ---------------- |
| `half_day_under_minutes`   | 270     | 0 to 720, 0 = off: "Half day must be between 0 and 720 minutes (0 turns it off)."     | Attendance marks |
| `short_day_under_minutes`  | 480     | 0 to 720, 0 = off: "Short day must be between 0 and 720 minutes (0 turns it off)."    | Attendance marks |
| `left_early_grace_minutes` | 15      | 0 to 240: "The left early grace must be between 0 and 240 minutes."                   | Attendance marks |
| `payroll_month_start_day`  | 1       | 1 to 28: "The payroll month must start on a day from 1 to 28."                        | Attendance marks |
| `hr_morning_summary`       | true    | boolean                                                                               | HR updates       |
| `hr_summary_at`            | '10:00' | clock; while the summary is on, at or after `lateAfter` and before `officeEnd`        | HR updates       |
| `hr_evening_summary`       | false   | boolean; sent at `officeEnd` + 30 min (not a setting)                                 | HR updates       |
| `checkin_reminder_minutes` | 30      | 0 to 240, 0 = off: "The reminder must be between 0 and 240 minutes (0 turns it off)." | HR updates       |
| `late_alert_days`          | 4       | 1 to 31: "Late days must be between 1 and 31." Also the Needs a look threshold        | HR updates       |
| `slack_attendance_remind`  | true    | boolean, the `queueDm` setting key of every remind                                    | Slack            |
| `slack_hr_summary`         | true    | boolean, the `queueDm` setting key of both HR summaries                               | Slack            |

- Cross checks (new, in `settings/schemas.js`, like `checkAutoCheckout`): `checkDayMarks(current,
parsed)`: while both are above 0, half must be below short, else `VALIDATION_FAILED` on
  `halfDayUnderMinutes` "Half day must be less than the short day time."; `checkHrSummary(current,
parsed)`: when `hrMorningSummary`, `hrSummaryAt`, `lateAfter` or `officeEnd` is sent and the
  summary is on, `hrSummaryAt` must be at or after `lateAfter` ("Pick a time at or after the late
  mark (9:30).": an earlier summary would list everyone) and before `officeEnd` ("Pick a time before
  office hours end."), `VALIDATION_FAILED` on `hrSummaryAt`.
- **Section "Attendance marks"** (`id="attendance-marks"`, new `AttendanceMarksSection.jsx`, after
  "Check-in" in `SettingsNav.SECTIONS`), subtitle "How Attendance marks half days, short days and
  early check-outs, and when the payroll month starts." Four `NumberField`s, `grid2`:
  - "Half day when worked under (minutes)", help "Worked time is present time less breaks. 270 is
    4h 30m. 0 turns it off."
  - "Short day when worked under (minutes)", help "480 is 8h. 0 turns it off."
  - "Left early grace (minutes)", help "Checking out more than this before their shift ends shows
    Left early."
  - "Payroll month starts on day", help "1 for calendar months. 26 runs from the 26th to the 25th
    and is named after the month it ends in."
- **Section "HR updates"** (`id="hr-updates"`, new `HrUpdatesSection.jsx`, after "Attendance
  marks"), subtitle "Reminders people get, and what HR hears from Daybook each day.":
  - Toggle "Morning summary for HR", help "Who isn't in, who's late or away, and what's waiting. On
    working days, not on holidays."; `ClockField` "Send at" (`hrSummaryAt`, shown with the toggle,
    `SHOWN_WITH`).
  - Toggle "Evening wrap-up for HR", help "At 7:00 PM, half an hour after office hours end: who's
    still in, reports not in and long breaks." (the time follows `officeEnd`).
  - `NumberField` "Remind people who haven't checked in after (minutes)", help "Counted from each
    person's late mark. 0 turns it off."
  - `NumberField` "Tell HR after this many late days", help "Once per person each payroll month.
    People with this many late days, short days or missing reports also show under Needs a look."
- **Slack section** `SWITCHES` gains `slackAttendanceRemind` "Send attendance reminders", help
  "Check-in reminders and the ones HR sends from Attendance." and `slackHrSummary` "Send HR the
  daily summaries", help "The morning summary and the evening wrap-up, as a direct message."
- **Timers and breaks**: the help text in A.

### Modules

- `@/modules/attendance` (owner attendance). `repo.js` (436 lines), `hr.js` (307), `day.js` (292)
  and `service.js` (291) are at the size limit, so new code goes into new files (`hr.js` and
  `service.js` only gain calls; `getMyToday`'s new fields are built in new `myToday.js`; `exportDay`
  and `listMissingCheckouts` leave `day.js`; `tellPerson` moves from `hr.js` to new
  `tellPerson.js`, exported); the new files with queries are `calendarRepo.js`,
  `calendarWriteRepo.js`, `breakRepo.js`, `missingRepo.js`, `reminderRepo.js`, `hrSummaryRepo.js`,
  `monthRepo.js` and `checkoutEntered.js` (precedent: `reports/todoRepo.js`). Exported from
  `index.js`:
  - **The person's day**: `personDay`, `presenceOf`, `leaveFraction`, `dayCounts`, `halfDayAt`,
    `lateMinutesForDay`, `effectiveLateMinutes`, `LEAVE_PARTS`, `LEAVE_TYPES`, `LEAVE_TYPE_LABELS`,
    `PART_LABELS`; `loadCalendar`, `getDay`, `companyDay`, `clearCompanyDayCache()` (F's holiday
    writes call it), `lastWorkingDayBefore`, `applyDayRules`,
    `recheckDayRules`; the calendar reads `listHolidaysBetween`, `nextHoliday`, `listOnLeave`,
    `listUpcomingLeave`, `getMyLeave`; `dayMarks`; `payrollPeriod`, `payrollMonthOf`,
    `resolvePayrollMonth`; `checkoutEnteredFor`.
  - **Day list**: `listDay(date, { viewer, calendar?, leaveDetail? })`, `filterDay`, `listForDay`,
    `summarize`, `getDaySummary`, `missingWindow(workDate, workingDays, holidays?)`, `exportDay` (now in
    `dayExport.js`), `resolveDate` (items as in "The Attendance day screen").
  - **A and 2 (breaks)**, for timers inside its transaction after `lockDay`: `saveAwayBreak({ userId,
attendanceId, workDate, startedAt, endedAt, awayEntryId }, trx)` → BreakRow | null (null before
    018), `breakTotalsIn({ userId, workDate, breakId }, trx)` → `{ before, total, crossed,
overAllowanceMinutes }`, `lockAwayBreak({ userId, breakId }, trx)` →
    BreakDetail | null (`UPDATE_NEEDED` before 018), `deleteAwayBreak(breakId, trx)`,
    `checkOutAtLeft({ userId, workDate, at, ip }, trx)` → AttendanceRow; reads
    `listAwayBreaks(userId, workDate)`, `listBreakDetails(userId, workDate)` → BreakDetail[]
    (BreakRow + `source`, `awayEntryId`, `changedById`, `changedAt`; 1054 fallback);
    `noticeOverAllowance({ userId, crossed, total })` (after commit; sends only when `crossed`); HR `listBreaksForRow({ viewer, attendanceId })`, `changeBreakEnd({
actor, attendanceId, breakId, endClock, reason, ip })`, `deleteBreak({ actor, attendanceId,
breakId, reason, ip })` → BreakList `{ attendanceId, workDate, dayLabel, isToday, person: { id,
name }, breakMinutes, overAllowanceMinutes, onBreakSince, canChange, ownRow, needsUpdate,
breaks: [{ id, startedAt, endedAt, startClock, endClock, minutes, open, source, endReason,
label, note, changedBy: { id, name } | null }] }`; pure `breakView.js` `breakLabel(item)`,
    `breakNote(item, changedByName)`, `toBreakView(item, ctx)`. BreakList also carries `description`
    ("Thu, 19 Nov · On break since 1:10 · Breaks 1h 5m · Over 5m", the dialog's subtitle) and
    `canCorrect`; `breakTotalsIn` counts finished breaks only (an open break counts once it ends,
    so a Remove and an End break that cross the allowance together send one notice);
    `getOpenBreak(userId, trx, { forUpdate })` gains the lock option (Left locks the open break).
  - **B and 7 (check-outs)**: `listMyMissingCheckouts({ user })` → `{ items: [{ attendanceId,
workDate, checkInAt, location, suggestedAt: Date | null, limitAt: Date | null }], autoOpen }`;
    `fixMyMissingCheckout({ user, attendanceId, checkOut, reason?, ip })` → `{ outcome: 'saved',
row } | { outcome: 'sent', correction }`, both with `missing` (the fresh list);
    `hideMissingCheckoutPrompt({ user })` → `{ hiddenOn }`; `listMissingCheckouts({ limit = 20,
offset = 0, viewer, suggest = false })` → `{ items: [AttendanceRow & { user, suggestedAt?,
pendingCorrection: { id, checkOutClock } | null, reminded: { sentAt, sentBy } | null, own }],
total }`; `missingCheckoutsFor(userIds)` → `Map<userId, [{ attendanceId, workDate }]>`; `fixMissingCheckouts({ actor, items: [{
attendanceId, checkOut }], reason, ip })` → `{ fixed, failed }`; `suggestCheckoutTimes(rows)` →
    `Map<attendanceId, Date | null>`; pure `missingRules.js` `suggestedCheckoutAt({ row, segments,
timerAt, breaks, tz })` and `selfFixLimit({ row, day, suggestedAt })` → `{ limitAt: Date | null,
basis: 'shift_end' | 'suggestion' | 'none' }` (reusing the exported `lastSeenWorking`);
    `checkoutEntered.js` (A) `checkoutEnteredFor(rowIds)` → `Map<attendanceId, { by: { id, name },
at, self, suggestedAt, pastLastSeen }>`, `markCheckoutEntered({ rowId, userId, suggestedAt =
null }, trx)`, `clearCheckoutEntered(rowId, trx)`; corrections: `requestCorrection(input, trx?)`.
    `listMyMissingCheckouts` items also carry `checkInClock`, `suggestedClock` and `limitClock`
    ('HH:mm' company time, or null); `missingCheckoutsFor` keys only people who have rows.
  - **5 (reminders)**: `remind({ actor, kind, userIds, ip })`, `listReminders({ since, userIds?,
kinds? })`, `remindKindFor(item, ctx)`, `REMIND_KINDS`, `REMIND_EVERY_MINUTES`,
    `deleteOldReminders(before)`, worker `sendCheckinReminders(today)`.
    `remindKindFor`'s `ctx` also takes `todayDays: Map<userId, PersonDay>` (a past date's
    `missing_checkout` needs today's day); `ReminderNote` takes `tz?` (else `reminded.tz`) and
    `bare?` (no "Reminded ", for the missing list's Reminded column).
  - **1 (summaries)**: worker `sendHrMorningSummary(today)`, `sendHrEveningSummary(today)`;
    `hrSummaryRepo.countWaiting({ hideAdmins, excludeUserId, today })` → `{ corrections,
wfh }` (`today`: a WFH request whose last day has passed isn't counted).
  - **4, 8, 10 (month)**: `summarizeRange`, `getMonth`, `exportMonth`, `getPersonMonth`,
    `getNeedsLook`, `clearNeedsLookCache()` (F's writes call it), `lateCountsFor`, worker
    `sendLateAlerts(today)`; pure `monthRules.js`
    `summarizePerson`, `classifyDay`, `needsLookReasons`, `ordinal`; `monthRepo.js`
    `listRowsByRange`, `listBreaksByRange`, `listLateDays`. Also
    `exportMonthResponse(input)` → the download `Response` (it holds this process's one export
    slot while the file is written, so the 429 is honest; the route uses it); `summarizeRange` and
    `getMonth` also return `through` and `today`; `getPersonMonth` also returns `untracked`, and
    each change a `byLine`.
  - **6 and 9 (calendar writes and pages, F)**: `listHolidays`, `createHoliday`, `updateHoliday`,
    `deleteHoliday`; `listLeave`, `previewLeave`, `createLeave`, `updateLeave`, `deleteLeave`;
    `getLeaveEntry(id, { viewer })`, `listLeavePeople({ viewer, forChange = true })` → `[{ id,
name, designation }]` (the dialog's Person list). LeaveEntry also carries
    `entryWorkingDays` (the whole entry; `workingDays` = its days inside the period) and
    `checkedInDays` (full-day entries only); `listHolidays` also returns `today`, `firstYear` and
    `lastYear`, and its `upcoming` is a count (the holidays after today).
  - Schemas: `schemas.js` keeps the existing ones and `FILTERS`; new schemas live in
    `breakSchemas.js` (`breakChangeSchema`, `breakDeleteSchema`), `missingSchemas.js` (self fix,
    hide, bulk fix, `reminderSchema`), `monthSchemas.js` (`monthQuerySchema` `{ month?, filter? }`,
    `monthExportQuerySchema` `{ month?, userId? }`, `personMonthQuerySchema`,
    `userIdParamSchema`; month "Use a month like 2026-11.", the regex of `reports/schemas.js
isoMonth`) and `calendarSchemas.js` (holiday and leave bodies and queries).
- `@/modules/timers` (owner timers): `getState({ user })` adds `away.kind: 'away' | 'no_data'`,
  `away.running`, `away.left: { clock, shiftEndClock } | null` and `removed: [{ breakId, from, to,
fromClock, toClock, minutes, projectName | null }]` (today's away breaks no one else changed,
  oldest first; `[]` with no entries, timers off or before 018); `resolveAway({ user, entryId, from,
to, decision: 'keep' | 'remove' | 'left', ip? })` → state + `answer: { decision, minutes,
projectName, savedAsBreak, breakId, checkedOutAt }`; `putBackAway({ user, breakId })` → state +
  `answer: { restored, minutes, projectName }`; pure `awayRules.js` `awaySpans`, `findAwaySpan`,
  `planRemoval({ entry, from, to })` → `{ kind: 'split' | 'move' | 'trim' | 'drop' }`,
  `leftOffer(...)`; `shared.lockOwnToday`; new `listEntriesFor(userId, workDate)` → bare entries
  oldest first (the break fix's check); `lastRanByUser({ workDate, userIds })` → `Map<userId, Date |
null>` (one query, `repo.lastEndedByUser`, finished entries only; added by the orchestrator
  before the builders start, so C needn't wait for B). `forgetAway(userId?)` clears the
  5-minute away cache; Put back is audited `attendance.away_put_back` with `before` the break and
  `after { breakId, restored }`; Left deletes an entry it would leave with under 1 minute.
- `@/modules/activity` (owner activity; B): new `anyoneSeenBetween({ workDate, from, to,
exceptUserId })` → boolean (screen time more than 150 s inside [from, to]; `repo.existsOtherBetween`
  on the shrunk stretch, one query on the `work_date` index, `LIMIT 1`; none for 300 s or less).
- `@/modules/reports` (owner reports): export `listSubmittedUserIds(userIds, workDate)` (the existing
  `repo.listSubmittedUserIds`, `reports/repo.js:89`); new `listSubmittedDays({ userIds, from, to })`
  → `{ [userId]: string[] }` (one query on `daily_reports`, `status 'submitted'`; dates only).
- `@/modules/users` (owner people-admin): new `listTrackedForRange({ from, to })` → PublicUser[] with
  `deactivatedAt`.
- `@/modules/audit` (owner system): new `listForEntities({ entityType, entityIds, actions?, limit? })`
  → rows as `listForEntity` (before/after parsed), newest first; ids chunked by 500; uses the
  `entity_type, entity_id` index. New `listForType({ entityType, since, actions? })` → the same rows
  of one type written on or after `since`, newest first (the person month's deleted or moved leave).
- `@/modules/dashboard` (owner dashboards; G owns `calendar.js` and `index.js`, H the rest):
  `buildCalendar({ month, attendance, profile, ctx, range?, toneOf? })` exported as
  `dashboard.buildCalendar`; the person month's data loader (app layer)
  calls it, never the attendance module (no module cycle). `dayTone` takes `day`.
- `MonthCalendar` (owner shell): tones `leave` and `holiday`, and an optional `legendItems` prop
  (default `CALENDAR_LEGEND`, unchanged for Employee detail). `StatusCell` (owner ui-kit): statuses
  `on_leave`, `holiday`, `day_off`.
- Worker (`src/worker/jobs/`, new): `checkinReminders.js` (`checkin-reminders`, every minute, no run
  key), `hrSummary.js` (`hr-summary`, `runAttempts`), `hrEveningSummary.js` (`hr-evening-summary`,
  `runAttempts`), `lateAlerts.js` (`late-alerts`, `runAttempts` keys `late_alerts:<date>`, `#2`,
  `#3`); O adds all four to `MINUTE_JOBS` in `cron.js` before `cleanupJob` (none is in `SLOW_JOBS`)
  and to `JOBS` in `index.js`; `cleanup.js` gains `oldReminders` (`attendance.deleteOldReminders`, 180 days). Each
  tick is a few indexed reads when nothing is due, so the one-process-per-minute cron stays lean.
  In `cron.js` `closeOpenTimersJob` moves before
  `markMissingCheckoutsJob`, so a timer still running from yesterday is closed before its row is
  marked missing.
- **Client imports**: `BreakListDialog` uses `clockRange` from `@/components/TimerChip.clock`
  (client-safe, already shared with Today). Client components may import the pure
  `@/modules/attendance/calendar` constants (`PART_LABELS`, `LEAVE_TYPE_LABELS`), an exception to
  §2 like `@/modules/reports/todoText`.

### API

| Route                                                               | Permission            | Body / returns                                                                                                     | Errors and limits                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| existing `GET /api/timers/current`                                  | `report.self`         | state with `away.kind`, `away.left`, `removed`                                                                     | unchanged                                                                                                                                                                                                                                                   |
| existing `POST /api/timers/away`                                    | `report.self`         | `{ entryId, from, to, decision: 'keep' \| 'remove' \| 'left' }` → state + `answer`                                 | `CONFLICT`, `BAD_REQUEST`, `TIMERS_OFF`, `VALIDATION_FAILED`; 60 a minute                                                                                                                                                                                   |
| `POST /api/timers/away/[breakId]/put-back`                          | `report.self`         | no body → state + `answer`                                                                                         | `NOT_FOUND`, `CONFLICT`, `TIMERS_OFF`, `UPDATE_NEEDED`; 60 a minute                                                                                                                                                                                         |
| existing `GET /api/attendance/me/today`                             | `attendance.self`     | adds `day`, `upcoming`, `missing`                                                                                  | unchanged                                                                                                                                                                                                                                                   |
| `POST /api/attendance/me/missing-checkouts/[id]/fix`                | `attendance.self`     | `{ checkOut, reason? }` → `{ outcome, row \| correction, missing }`                                                | own missing row of the last 30 days, else `NOT_FOUND`; `VALIDATION_FAILED` (`checkOut`, `reason`), `CONFLICT`, `REQUEST_ALREADY_PENDING`, `UPDATE_NEEDED`; 20 a minute                                                                                      |
| `POST /api/attendance/me/missing-checkouts/hide`                    | `attendance.self`     | no body → `{ hiddenOn }`                                                                                           | `UPDATE_NEEDED`; 10 a minute                                                                                                                                                                                                                                |
| existing `GET /api/attendance?date=&filter=`                        | `attendance.view_all` | `filter` adds `on_leave`, `on_break`; items as in "The Attendance day screen" plus `lateCount`                     | unchanged                                                                                                                                                                                                                                                   |
| existing `GET /api/attendance/summary`                              | `attendance.view_all` | adds `onLeave`, `off`, `holiday`, `onBreak`, `missingTotal`                                                        | unchanged                                                                                                                                                                                                                                                   |
| existing `GET /api/attendance/export?date=`                         | `attendance.view_all` | Where words, effective late, six columns at the end                                                                | unchanged                                                                                                                                                                                                                                                   |
| existing `PATCH /api/attendance/[id]`                               | `attendance.correct`  | also stores `checkout_entered_by` for a new check-out on a missing row                                             | unchanged                                                                                                                                                                                                                                                   |
| `GET /api/attendance/[id]/breaks`                                   | `attendance.view_all` | BreakList of attendance row `id` (at most 50 breaks)                                                               | `NOT_FOUND` (no row, an Admin's for a non-Admin); 120 a minute                                                                                                                                                                                              |
| `PATCH /api/attendance/[id]/breaks/[breakId]`                       | `attendance.correct`  | `{ endClock: 'HH:mm', reason }` → BreakList                                                                        | `FORBIDDEN` (own row), `NOT_FOUND`, `VALIDATION_FAILED`, `UPDATE_NEEDED`; 60 a minute                                                                                                                                                                       |
| `DELETE /api/attendance/[id]/breaks/[breakId]`                      | `attendance.correct`  | `{ reason }` → BreakList (a body on DELETE, as `push/subscriptions`)                                               | same                                                                                                                                                                                                                                                        |
| `POST /api/attendance/missing-checkouts/fix`                        | `attendance.correct`  | `{ items: [{ attendanceId, checkOut }], reason }` → `{ fixed, failed }` (per-row messages, 200 even when all fail) | 1 to 50 items, reason 2 to 500; reads its own body, over 16 KB → 413; 10 a minute                                                                                                                                                                           |
| `POST /api/attendance/reminders`                                    | `attendance.correct`  | `{ kind, userIds }` → `{ sent, skipped }`                                                                          | kind one of the four, 1 to 50 ids; `UPDATE_NEEDED`; 30 a minute                                                                                                                                                                                             |
| `GET /api/attendance/month?month=&filter=`                          | `attendance.correct`  | `getMonth` (a later month reads as the current one)                                                                | 60 a minute                                                                                                                                                                                                                                                 |
| `GET /api/attendance/month/export?month=&userId=`                   | `attendance.correct`  | the month Excel                                                                                                    | `userId` unknown or a hidden Admin → `NOT_FOUND`; over 200 people → 400 "Too many people for one file. Download one person's month instead."; another export building in this process → 429 "An export is being built. Try again in a minute."; 10 a minute |
| `GET /api/attendance/people/[userId]/month?month=`                  | `attendance.correct`  | `getPersonMonth`                                                                                                   | `NOT_FOUND`; 60 a minute                                                                                                                                                                                                                                    |
| `GET /api/attendance/needs-look`                                    | `attendance.correct`  | `getNeedsLook` (current payroll month)                                                                             | 60 a minute                                                                                                                                                                                                                                                 |
| `GET /api/holidays?year=`                                           | `attendance.view_all` | `{ year, available, items, upcoming }`                                                                             | 120 a minute                                                                                                                                                                                                                                                |
| `POST /api/holidays`                                                | `attendance.correct`  | `{ date, name }` → 201 the holiday                                                                                 | `CONFLICT` same date, `VALIDATION_FAILED`, `UPDATE_NEEDED`                                                                                                                                                                                                  |
| `PATCH /api/holidays/[id]`, `DELETE /api/holidays/[id]`             | `attendance.correct`  | `{ date?, name? }` → the holiday; DELETE → `{ id }`                                                                | `NOT_FOUND`; a move runs the day rules on both dates                                                                                                                                                                                                        |
| `GET /api/leave?month=&from=&to=&userId=&limit=&offset=`            | `attendance.correct`  | `listResult` of LeaveEntry                                                                                         | Admins' leave only for Admins                                                                                                                                                                                                                               |
| `POST /api/leave`                                                   | `attendance.correct`  | `{ userId, fromDate, toDate?, part, paid, leaveType, note? }` → 201 LeaveEntry                                     | `CONFLICT`, `FORBIDDEN`, `VALIDATION_FAILED`, `UPDATE_NEEDED`                                                                                                                                                                                               |
| `PATCH /api/leave/[id]`                                             | `attendance.correct`  | `{ fromDate?, toDate?, part?, paid?, leaveType?, note?, reason }` → LeaveEntry                                     | reason required                                                                                                                                                                                                                                             |
| `DELETE /api/leave/[id]`                                            | `attendance.correct`  | `{ reason }` → `{ id }`                                                                                            | reason required                                                                                                                                                                                                                                             |
| `GET /api/leave/people`                                             | `attendance.correct`  | `{ today, people: [{ id, name, designation }] }` (Mark leave's Person list)                                        | 120 a minute (the calendar reads)                                                                                                                                                                                                                           |
| `GET /api/leave/preview?userId=&fromDate=&toDate=&part=&excludeId=` | `attendance.correct`  | the dialog's live line; never writes                                                                               | `NOT_FOUND` (also a person the actor may not see), `FORBIDDEN`, `CONFLICT`, `UPDATE_NEEDED`                                                                                                                                                                 |

- **Rate limits are per person** (the office shares one IP): each handler calls
  ``checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`)`` as `api/me/preferences/route.js` does.
  Holidays and leave share 60 writes and 120 reads a minute (the preview included).
- Zod messages: `endClock` with `clockString('Enter the end time.')`, `reason` with
  `reasonText('a reason', 500)`, ids plain digits (else 404); `month` "Use a month like 2026-11.",
  `filter` "Pick a filter: needs_look, late, short, absent, leave or missing.", `userId` "That id is
  not valid."; `FORBIDDEN` for PMs and employees on `attendance.correct` routes (`withRoute`).
- New static segments (`me`, `month`, `people`, `needs-look`, `missing-checkouts`, `reminders`) sit
  beside the existing dynamic `api/attendance/[id]`; Next.js matches a static segment first, and
  `attendanceAdminRoutes.test.js` gets a case that `PATCH /api/attendance/12` still reaches `[id]`.
  `api/leave/preview` sits beside `api/leave/[id]` the same way.
- **Pages**: `/attendance/missing` (`attendance.view_all`; actions for `attendance.correct`),
  `/attendance/month` and `/attendance/people/[userId]` (`attendance.correct`),
  `/attendance/holidays` (`attendance.view_all`; changes for `attendance.correct`),
  `/attendance/leave` (`attendance.correct`). Pages read through the services. The sidebar's
  Attendance item already lights up for every `/attendance/*` path (longest-prefix match in
  `navigation.js`); no new sidebar item.

### Limits

- Remind: 1 to 50 people a call; at most one per person per kind per 30 minutes; reminder rows kept
  180 days. Bell titles at most 200 characters, bodies at most 500; Slack summary lines at most 15
  names, then "and 4 more".
- Pop-up: rows of the last 30 days, at most 30; reason 2 to 500. Missing list: 50 rows a page; bulk
  fix 1 to 50 items, body at most 16 KB.
- Break list: at most 50 breaks; break fix reason at most 500.
- Month: at most 500 people in one summary (more: the first 500 by id and one warning); months from
  2020-01, a later one reads as the current one; Changes the latest 50; Needs a look card 6 rows;
  the month Excel at most 200 people (the Days sheet at most 200 × 31 rows), one export built at a
  time per process. `loadCalendar` ranges at most 400 days.
- Holidays: dates from 1 January of last year to 31 December of next year: "Pick a date from 1 Jan
  2025 to 31 Dec 2027."; name trimmed, 2 to 80 characters: "Name the holiday (2 to 80
  characters)."; at most 60 a year: "A year can have up to 60 holidays." Clash: `CONFLICT` "There's
  already a holiday on Tue, 24 Nov." (`fields.date`).
- Leave: "Pick the first day."; "The last day can't be before the first day."; at most 366 days in
  one entry: "Mark up to a year at a time."; a half day needs one day: "Half days are for one day.
  Pick the same first and last day."; "No working days in these dates."; note at most 300: "Keep
  the note to 300 characters or fewer."; reason (update, delete) 2 to 500: "Add a reason."; part,
  type and pay from their lists. Overlap: `CONFLICT` "Priya Sharma already has leave on Mon, 23
  Nov." (`fields.fromDate`; the first overlapping day). Own leave: `FORBIDDEN` "You can't mark your
  own leave. Ask another HR person or an Admin." An Admin's, for HR: `FORBIDDEN` "Only an Admin can
  mark an Admin's leave." Not tracked: `CONFLICT` "Rahul Verma doesn't check in, so there's no
  leave to mark." Missing: `NOT_FOUND` "We couldn't find that person." / "That leave no longer
  exists." / "That holiday no longer exists."
- Cost, honestly: the day page refreshes every 60 s while visible. For HR it adds the calendar,
  `lateCountsFor`, reminders and entered-by reads (small, indexed), plus `getNeedsLook`, a
  month-wide `summarizeRange` that is cached 5 minutes per process. The Missing check-outs card and
  page read one person-day of screen time per row without a cached suggestion (at most 50 on a cold
  page). `getState` makes one `activity.getDay` read and one away-breaks query per 60 s poll for
  every timer user with an entry today, until midnight (1.09: the screen-time read only while a
  timer ran); after check-out the away part is cached 5 minutes per person.

### Files and owners

Eight builders, A to H, so no file has two owners; O is the orchestrator. A file listed for one
builder is edited only by that builder. Where a builder's page or component needs another builder's
piece that doesn't exist yet, it adds a stub with the props below (the §6 stub rule) and the owner
replaces it. `attendance/index.js` (A) spreads five barrels, one per builder: `breakExports.js` (B),
`checkoutExports.js` (C), `reminderExports.js` (D), `monthExports.js` (E), `calendarExports.js` (F);
A creates each as a stub and its owner fills it. A moves code another builder will own as that file's
starting content (the stub rule): the 1.09 `listMissingCheckouts` from `day.js` into C's
`missingHr.js`, and `MissingCard` from `AttendanceCards.jsx` into C's `MissingCard.jsx`, so the page
works before C lands.

| Owner                                                    | Builder                  | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| orchestrator                                             | O (first)                | `db/migrations/018_hr_tools.js` and `db/lib/removedSpans018.js` (the proposals in `scratch/design-1.10`), `db/seeds/03_settings.js` (11 keys, `settings-additions.js`), `src/config/version.js` ('1.10'), `src/lib/time.js` (`holidays` argument) and `tests/unit/time.test.js`, `src/lib/permissions.js` (`attendance.correct` text "Edit attendance, handle correction requests, mark leave and holidays"), `timers.lastRanByUser` (in `src/modules/timers/worker.js` and the `service.js` re-export; B owns both files afterwards), `tests/unit/migration018Away.test.js`, `docs/design/hr-tools-prototype.html`, `.github/workflows/migration-check.yml` (new: a `mysql:8.4` service container runs migrate up, down for 018, up, and `tests/services/migration018.test.js`; never touches the deploy branch, no npm dependency)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| orchestrator                                             | O (last)                 | `src/worker/cron.js` and `src/worker/index.js` (register `checkin-reminders`, `hr-summary`, `hr-evening-summary`, `late-alerts` in `MINUTE_JOBS` before `cleanupJob`, none in `SLOW_JOBS`; `closeOpenTimersJob` before `markMissingCheckoutsJob`), `README.md` ("Deployment notes" bullet and the 1.10 "Updating" steps below), `scripts/doctor.js` (a "Database" line from `db.migrate.list()`: "✓ Database is up to date" or "✗ 1 database update not run: 018_hr_tools.js. Run the migrate line in README Updating."), `db/demo/*` (a holiday, leave, an away break, a missing check-out with a reminder, a self-entered check-out past last seen, a person at 4 late days and a short day), `tests/e2e/{breaks,missing-checkout,attendance-month,holidays-leave}.spec.js`, `tests/services/migration018.test.js` (+ `migration018Kit.js`, `migration018World.js`), `docs/CONTRACT.md` (this section and the edits listed after Tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| attendance                                               | A (core)                 | `src/modules/attendance/{migration018,calendar,calendarReads,calendarRepo,dayRules,marks,payroll,dayExport,checkoutEntered,myToday,tellPerson,leaveReads}.js` (new), `day.js`, `rules.js`, `schemas.js` (`FILTERS`), `index.js` (+ the five barrel stubs), `service.js` (`checkIn`, `getMyToday` through `myToday.js`, `notifyMissing` body and link), `hr.js` (`getDay`, entered-by rule, `tellPerson` moved out), `decisions.js` (`getDay`, `clearCheckoutEntered`); `src/worker/clock.js` (`companyDay`); `api/attendance/route.js` (`lateCount`); `(app)/attendance/DayCells.jsx` (new), `{dayRows,rowActions}.js` (new), `AttendanceCards.jsx`, `attendanceData.js`, `page.js`, `page.module.css`, `loading.js` (+ css); `(app)/today/page.js` (`searchParams`, placing B, C and F's pieces), `todayData.js`, `page.module.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| attendance, timers, activity, shell                      | B (breaks)               | `src/modules/attendance/{awayBreaks,breakFixes,breakView,breakRepo,breakSchemas,leftAt,breakExports}.js`, `breaks.js` (`breakTotalsIn`, `noticeOverAllowance`); `api/attendance/[id]/breaks/route.js`, `api/attendance/[id]/breaks/[breakId]/route.js`; `(app)/attendance/{BreaksButton,BreakListDialog,BreakListHost,BreakFixForm}.jsx` + `BreakListDialog.module.css`; `(app)/today/TimerRemovedRow.jsx` (new), `TimerEntries.jsx` (+ css), `TimerCard.jsx`, `timerData.js`, `useTimerActions.js`; `src/modules/timers/{awayRules,awayAnswer,awayPutBack}.js` (new), `away.js`, `rules.js` (re-exports), `state.js`, `shared.js`, `entries.js`, `schemas.js`, `service.js`, `worker.js` (`sendReminders` gate), `repo.js`; `api/timers/away/route.js`, `api/timers/away/[breakId]/put-back/route.js`; `src/modules/activity/{service,repo}.js` (`anyoneSeenBetween` only); `src/components/TimerAwayDialog.jsx` (+ css), `TimerChip.jsx`, `TimerChip.clock.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| attendance                                               | C (check-outs)           | `src/modules/attendance/{missingSelf,missingHr,missingRepo,missingRules,missingSchemas,checkoutSuggest,checkoutExports}.js`, `corrections.js` (optional `trx`); `api/attendance/me/missing-checkouts/[id]/fix/route.js`, `api/attendance/me/missing-checkouts/hide/route.js`, `api/attendance/missing-checkouts/fix/route.js`; `(app)/attendance/MissingCard.jsx` (+ css), `RowAction.jsx` (suggested prefill), `(app)/attendance/missing/{page,loading,missingData}.js`, `(app)/attendance/missing/{MissingTable,MissingFixDialog,missingCells}.jsx` (+ css); `(app)/today/{MissingCheckoutPrompt,MissingCheckoutDialog}.jsx` (+ css), `todayMissing.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| attendance, system                                       | D (reminders, summaries) | `src/modules/attendance/{reminders,reminderRepo,remindRules,reminderMessages,checkinReminders,hrSummary,hrSummaryData,hrSummaryText,hrSummaryRepo,reminderExports}.js`; `api/attendance/reminders/route.js`; `(app)/attendance/{ReminderNote,RemindAllButton,RemindSelectedButton}.jsx` (+ css), `{useRemind,remindItem,remindData}.js`; `src/worker/jobs/{checkinReminders,hrSummary,hrEveningSummary}.js` (new), `cleanup.js` (`oldReminders`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| attendance, system                                       | E (month)                | `src/modules/attendance/{monthRules,monthRepo,month,monthExport,personMonth,personChanges,needsLook,lateAlerts,monthSchemas,monthExports}.js`; `api/attendance/month/route.js`, `api/attendance/month/export/route.js`, `api/attendance/people/[userId]/month/route.js`, `api/attendance/needs-look/route.js`; `(app)/attendance/month/**`, `(app)/attendance/people/[userId]/**`, `(app)/attendance/NeedsLookCard.jsx` (+ css); `src/worker/jobs/lateAlerts.js` (new)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| attendance                                               | F (holidays, leave)      | `src/modules/attendance/{holidays,leave,leaveRules,calendarSchemas,calendarWriteRepo,calendarExports}.js` and `{holidayRules,holidayNotices,calendarEffects,leaveList,leavePreview}.js` (split out to stay under 300 lines); `api/holidays/route.js`, `api/holidays/[id]/route.js`, `api/leave/route.js`, `api/leave/[id]/route.js`, `api/leave/preview/route.js`, `api/leave/people/route.js`, `api/holidays/calendarRoute.js` (the shared rate limits and `:id`, not a route); `(app)/attendance/holidays/{page,loading,holidaysData}.js`, `(app)/attendance/holidays/{HolidayTable,HolidayDialog,HolidayDeleteDialog}.jsx` (+ css); `(app)/attendance/leave/{page,loading,leaveData}.js`, `(app)/attendance/leave/{LeaveTable,LeaveFilter}.jsx` (+ css); `(app)/attendance/{LeaveDialog,LeaveFields,LeaveDeleteDialog,LeaveCard,DayNotice,RowMenu}.jsx` (+ css), `{leaveForm,useLeavePreview}.js`; `(app)/today/TodayDayNotice.jsx` (new), `todayDay.js` (new: notices, week labels, "coming up" lines), `CheckInCard.jsx` (subtitle), `todayWfh.js`, `wfhOptions.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| system, people-admin, reports, ui-kit, shell, dashboards | G (platform)             | `src/modules/settings/{schemas,service}.js` (+ `crossChecks.js`, `officeNetworks.js`, `parse.js`, split out to stay under 300 lines; 11 keys, `checkHrSummary`, `checkDayMarks`, `CLOCK_KEYS`, `BOUNDED_KEYS`, `getAll` JSDoc); `src/modules/audit/{service,repo}.js` (`listForEntities`); `src/modules/users/{service,repo}.js` (`listTrackedForRange`); `src/modules/reports/{service,repo}.js` (export `listSubmittedUserIds`, new `listSubmittedDays`); `(app)/settings/{AttendanceMarksSection,HrUpdatesSection}.jsx` (new, + `HrUpdatesSection.module.css`), `(app)/settings/{SettingsForm,SettingsNav,SlackSection,TimersSection}.jsx` (two Slack switches, the timers help), `(app)/settings/{settingsValues,numberFields,page}.js` (`KEYS`, `HR_CLOCKS.hrSummaryAt` (not `CLOCKS`, whose keys `autoCheckoutSettings.test.js` pins), `SHOWN_WITH`, `NUMBERS`), `loading.js` (two more nav skeleton widths); `src/components/StatusCell.jsx` (+ css: `on_leave` "On leave" teal, `holiday` "Holiday" green, `day_off` "Day off" neutral), `Segmented.jsx` (+ css: an optional `disabled` per item; a button gets `disabled`, a link item renders as a span with `aria-disabled`, text `--muted` at 50%, no hover), `Kpi.jsx` (+ css: an empty spacer `span` with `flex: 1 0 0` before the footer, so in a grid row every bar sits at the card's bottom 8 px under the tallest content; a wrapper `div` would break the `.kpi > p:nth-child(2)` rules of `team/page.module.css` and `projects/[id]/HoursTab.module.css`; cards of equal height look as today), `MonthCalendar.jsx` (+ css: tones `leave` teal and `holiday` green, dots for both, optional `legendItems` prop, default `CALENDAR_LEGEND`); `src/modules/dashboard/{calendar,index}.js` (`buildCalendar` gains `range` and `toneOf`, `dayTone` takes `day` and answers `holiday` and `leave`, `dashboard.buildCalendar` exported) |
| dashboards, reports, ai, activity                        | H (readers)              | `src/modules/dashboard/{team,shared,overview,history,employee,service}.js` and new `{teamBoard,overviewWeek,employeeTasks}.js` (split out to stay under 300 lines), `repo.js` (`listCheckInsBetween(from, to)` replaces `countAttendanceByDay`; `listTrackedPeopleDay` adds the shift); `src/components/WeekBars.jsx` (+ css: a day's `title`, `faded` on a stacked column), `(app)/overview/page.js` (the Off legend item when `attendanceWeek.hasOff`), `src/modules/reports/logExport.js` (Day type and Leave columns); `(app)/team/**` except `[userId]/screenTime.js` (Off today group and tags, history Where and Report cells); `src/modules/reports/{monthLog,queries}.js` (My log, stuck tasks skip holidays); `(app)/log/**` except `screenTime.js` (status cells, KPI words, Day type and Leave columns); `src/modules/aiSummaries/{hrNotes,calendar}.js`, `src/modules/aiAsk/{attendance,prompt}.js`, `src/worker/jobs/aiHrNotes.js` (runs on or after the week's last working day, holidays skipped, within that ISO week); `(app)/screen-time/screenTimeView.js`, `(app)/log/screenTime.js`, `(app)/team/[userId]/screenTime.js` (no bar for a holiday without data)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Stub props and contracts the others code against: `BreaksButton({ row, children })` and
`BreakListDialog({ attendanceId, open, onClose, personName? })` (B); `MissingCard({ missing })`
and, on Today, `MissingCheckoutPrompt({ missing, openMissing })` (C); `ReminderNote({ reminded,
nextAt, tz?, bare? })`, `RemindAllButton({ kind, users })`, `RemindSelectedButton({ users, onDone,
className? })`, `useRemind()` → `{ send(kind, users: [{ id, name }]) → Promise<{ sent, skipped }>,
busy }` and `remindMenuItem({ kind, user, send })` → a `Menu` item (D); `NeedsLookCard({ data })`
(E); `RowMenu({ person, date, leave, remind, canMarkLeave })`, `DayNotice({ day })`,
`LeaveCard({ data })` and, on Today, `TodayDayNotice({ day, upcoming })` (F).

**README** (O). (a) A "Deployment notes" bullet: "Daybook 1.10 (HR tools): run the migrate line
before the restart; nothing new to install. Migration 018 adds four tables, adds columns to
attendance and attendance_breaks (each table is copied once: a few seconds in which check-ins wait),
and rebuilds away breaks for timer Removes since 1 Nov 2026, so Breaks and Worked for those days
change on Attendance and in the Excel files. Tell HR before payroll. If the line stops with Aborted,
run the unlock line, then the migrate line again (Updating, 1.10 step 2); it continues where it
stopped." (b) "Updating", as numbered copy-paste steps: "For 1.10: 1. phpMyAdmin → Export a
backup. 2. The three lines as usual (it prints `018: rebuilt N away breaks`); if it stops with
Aborted (a stopped run leaves `knex_migrations_lock` locked, so the same line alone answers
"Migration table is already locked"), the migrate line with `migrate:unlock` in place of
`migrate:latest` once, then the migrate line again, each in its own code block. 3. Press Restart
right away. 4. As Admin, before the next working morning: Settings →
Attendance marks (Payroll month starts on day), Settings → HR updates (the morning summary at 10:00
and check-in reminders after 30 minutes are on by default), Settings → Slack (two new switches),
Attendance → Holidays (add this year's). 5. Tell the team that check-in reminders start the next
working day. HR's first late alerts come at office end of the next working day."

### Tests and version

- **Unit**:
  - `tests/unit/attendanceCalendar.test.js` (A): `personDay` on a weekday, a weekend, a holiday on a
    weekday and on a weekend, before `joined_on`, after `leftOn` and on `leftOn` itself (employed;
    `dayCounts` all 0 without a row), for an untracked person, with full, first-half and
    second-half leave, and with leave on a holiday (ignored); without `leaveDetail` `leave` is `{
id, part }` only; `halfDayAt` (9:30 to 6:30 → 14:00; own 10:00 to 19:00 → 14:30; a shift ending
    before it starts → office hours); `lateMark` (full day = `lateMarkFor`; first half with Late
    after 9:35 and office 9:30 → 14:05; second half = the normal mark; null when expected 0);
    `dayEnd` (shift end, the split on second-half leave); `presenceOf` every branch (first half
    before and after the split, today and a past day); `dayCounts` (half-leave no-show: leave 0.5,
    absent 0.5; half leave with a check-in: present 0.5, leave 0.5; full leave with a check-in:
    present 1, leave 0, `conflict`; holiday with a check-in: `dayOffWorked` 1, holiday 1, present 0);
    `effectiveLateMinutes`; `lastWorkingDayBefore` and `missingWindow` (Tuesday after a Monday
    holiday → Friday to Monday). `tests/unit/time.test.js` (O): `isWorkingDay` and
    `workingDaysBetween` with and without `holidays`.
  - `tests/unit/attendanceMarks.test.js` (A): 269 Half day, 270 and 479 Short day, 480 none; 0 turns
    each off; out 6:14 PM with shift end 6:30 and grace 15 is Left early (16m), 6:15 is not; own
    shift end 7:00 PM; auto check-out counts; open row, missing, weekend, holiday, full leave without
    a check-in: none; **full leave with a 10:00 to 11:00 check-in: present 1 and Half day**;
    first-half leave: no Half day, Short day under 240, Left early against the shift end;
    second-half leave: Left early against the split; a 10:00 to 4:00 shift scales to 180 and 320.
  - `tests/unit/attendancePayroll.test.js` (A): start 1 is the calendar month (February 2028 has 29
    days); start 26: November 2026 = 2026-10-26 to 2026-11-25, January 2027 = 2026-12-26 to
    2027-01-25; `payrollMonthOf` 25 Nov → 2026-11, 26 Nov → 2026-12, 26 Dec 2026 → 2027-01; start
    28; `resolvePayrollMonth` clamps a later month and bad input, and **without a month on the first
    3 days of a period answers the previous one** (`defaulted: 'previous'`), from the 4th the
    current one.
  - `tests/unit/attendanceMonthRules.test.js` (E): present + leave.total + absent = 1 on every past
    working day; joined and deactivated mid-period: no absent outside; today never absent; **leave
    after today is `leave.planned`, not in `total`**; office + WFH = present; over allowance days;
    missing via audit (fixed) and via status (not fixed); **an open row from yesterday counts as a
    missing check-out, not fixed, with no worked time**; auto via audit after a correction; missing
    reports only from `reportReminderAt` today, `null` without `report.self`; `selfEnteredCheckouts`
    and `selfEnteredPastLastSeen`; `needsLookReasons` at and under the threshold, labels count
    first; `ordinal` 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 101st, 111th.
  - `tests/unit/timerAwayRules.test.js` (B): a `system` gap over 150 s is a piece, 150 s or less is
    not; a gap next to a `window` segment never; gap merged with idle and locked neighbours into one
    span (`kind 'away'`); a gap alone is `no_data`; ended only with a later segment; idle start moved
    back by `activityIdleMinutes`, never before the entry start or `away_checked_until`, not for
    locked or gap starts; the length check uses the moved span (21 min idle + 5 asks at 25); a
    finished entry's window ends at its end; `planRemoval` split, move, trim, drop at the 1 minute
    edges, **and the lost-time span of each** (move `[startedAt, to]`, trim `[from, endedAt]`, drop
    the whole entry); `leftOffer` (before and at the day end, **6:28 PM with a 6:30 PM day end and
    grace 15 is offered, 6:14 PM is not**, own `shiftEnd` over `officeEnd`, the split on second-half
    leave, a later entry, a later break, a row HR corrected). `tests/unit/timerCardClock.test.js`
    (B): the three texts, the help line and the button labels. `tests/unit/breakView.test.js` (B):
    labels and notes. `tests/unit/timersRules.test.js` (B): unchanged imports through the re-exports.
  - `tests/unit/migration018Away.test.js` (O, `removedSpans` from `db/lib/removedSpans018.js`): split, moved start, Keep after a
    split still found, moved start then Keep not found, tail deleted, **tail deleted then a fresh
    same-project timer answered Keep gives nothing, a resumed timer gives nothing, a tail moved by a
    second Remove gives one span `[P.ended_at, R.started_at]`, a split head edited by hand since
    (`updated_at` moved) gives nothing**, an overlapping manual row and an overlapping break skipped,
    touching is not overlapping, a span outside the row's present window skipped, no row skipped, 31
    Oct ignored, under a minute skipped.
  - `tests/unit/attendanceMissingRules.test.js` (C): `suggestedCheckoutAt` (active, window idle and
    timer signs; system idle and locked are not; before check-in → null; cut to the minute; `at`
    capped at the end of the work date); `selfFixLimit` (the own shift end, **also on second-half
    leave, never the split**; suggestion + 15 min; 23:59 cap; no suggestion on a working day →
    shift end; **a Saturday, a holiday and full-day leave: suggestion + 15 only, and no suggestion →
    `limitAt` null, basis `none`**).
  - `tests/unit/attendanceRemindRules.test.js` (D): `remindKindFor` (late mark not passed, holiday,
    full-day leave, first-half leave before and after the split mark, second-half leave reminds
    **before the split and not after**; break over and within the allowance, allowance 0; open row
    before and after the day end; missing on a past date, **not with a pending `check_out`
    correction, not while today is full-day leave or not a working day**; break wins over
    check-out). `reminderMessages` (every row of the table, one, two and three missing days, the
    `?checkout=missing` link, Slack escaping of "<Neha & co>"); `hrSummaryText` (the exact Slack
    blocks with "Not checked in" and "(starts 11:00)", empty lines left out, the all-clear lines,
    count-first bell bodies, "1 still on their shift", "Auto check-outs since Fri, 13 Nov", 15 names
    then "and 4 more", **a person named "<Neha & co>" comes out escaped**, title under 200 and body
    under 500 characters).
  - Settings (G): `checkHrSummary` (before the late mark, after office end, the summary off),
    `checkDayMarks`, the ranges; `Segmented` with a disabled item (button and link);
    `buildCalendar` with `range` and `toneOf`, `dayTone` holiday and leave. The leave form model
    (F): Last day follows First day, halves disabled across days, the preview's waiting and error
    lines.
- **Services** (`DB_NAME=daybook_test_<n>`, fake Slack transport):
  - `tests/services/timersAwayBreak.test.js` (B): **the `bug-away` scenario turns green**: after
    Remove, Vishal's Attendance row shows Present 5h, worked 4h 15m, "Breaks 45m", "Over 15m", the
    Excel says Breaks 45 and Worked 4.25, his timer split is unchanged from 1.09 (the head's
    `updated_at` equals the copy's `created_at`), and he gets one `attendance.break_over_allowance`;
    a second break later sends no second notice. Remove on a finished entry after Stop, Switch
    project, Start break (End break still resumes) and Check out; trim and drop; **a move saves
    `[startedAt, to]`**; Keep on a finished entry; a no-data gap offered for Idle Detection only,
    **and only when someone else's screen time was recorded during it (`anyoneSeenBetween`)**,
    never for a Daybook outage whose neighbours' heartbeats are staggered around it (real beats,
    daytime and after the day end, `timersAwayOutage.test.js`);
    Remove of an entry not of today `BAD_REQUEST`; a span over an HR-changed break `CONFLICT`.
    **Races**: Remove and Check out at once (both finish, no deadlock, the break is inside the row);
    two Removes of one span give one break (the other `CONFLICT`); **a Stop that commits between
    the read and the lock gives no false `CONFLICT`** (`lockById`); **a Remove and an End break that
    cross the allowance together send exactly one notice** (`crossed` in the transaction); a
    deadlock retried once sends one notice. Left: open row checked out at `from` with the timer, a
    closed own check-out moved back, audit row, not offered with a later entry or a corrected row.
    Put back for split, move, trim (exact seconds restored, not asked again), a deleted entry
    (`restored: false`, break gone), an overlapping manual row, HR-changed `CONFLICT`, someone
    else's `NOT_FOUND`. Add time over an away break refused with the new message. After check-out
    the away part of the state is read at most every 5 minutes (query counter). Rewrites:
    `timersAway.test.js` (Remove now saves a break; finished entries are asked about),
    `attendance.breaks.test.js` (the notice is decided in the transaction), `timersRoutes.test.js`
    (`left`, put-back route), `activity.test.js` (`anyoneSeenBetween`).
  - `tests/services/attendanceBreakFixes.test.js` (B): change a forgotten open break (ends, `hr`, no
    timer resumed), shorten a check-out-ended break, every validation message **including "A timer
    started at 2:00 PM. Pick 2:00 PM or earlier."**, delete, audit rows on the attendance entity, the
    person's notification, own row `FORBIDDEN`, an Admin's row `NOT_FOUND` for HR (an Admin may), PM
    `GET` allowed and `PATCH` `FORBIDDEN`, an employee `FORBIDDEN`; `listDay` `onBreakSince`,
    `on_break`, `summary.onBreak`; per-person rate limit.
  - `tests/services/attendance.missingSelf.test.js` (C): within the limit saves `'corrected'` with
    the three entered-by columns, audit and no HR notification; **last seen 1:05 PM, entered 6:30
    PM: saved, `after.pastLastSeen` true, and `listDay` gives HR the Check tag data (a PM's item has
    none)**; after the limit without reason → `VALIDATION_FAILED` on `reason`, with reason → a pending
    `check_out` correction, HR notified and the row leaves the pop-up; **a double tap on Send to HR
    gives one correction and `REQUEST_ALREADY_PENDING`**; **a Saturday check-in of 20 minutes: 6:30
    PM goes to HR**; **start day 26, a save for Fri, 23 Oct on 19 Nov tells HR
    (`attendance.self_checkout_past`)**; before check-in refused; someone else's row and an
    older-than-30-days row → `NOT_FOUND`, an already fixed own row → `CONFLICT`; **two parallel saves
    give one save and one `CONFLICT`**; HR fixing at the same moment; Not now hides until tomorrow
    (`setNowForTests` the next day shows it again); no screen time → no suggestion and the limit is
    the shift end; a timer still running from that date gives no sign. Rewrite:
    `attendance.corrections.test.js` (`requestCorrection` with a `trx`).
  - `tests/services/attendance.missingHr.test.js` (C): full list paging, `total` equals the rows
    listed and the KPI footer total; suggestions only for `attendance.correct`, read per row with
    `activity.getDay` and kept per process; **a row with a pending `check_out` correction:
    `pendingCorrection` set, bulk fix puts it in `failed` with "Handle it under Corrections.", and
    `missingCheckoutsFor` leaves it out**; bulk fix with suggested and typed times, a row without a
    time, the actor's own row, an Admin's row for HR, partial failures; audit, `attendance.edited`
    notification, the entered-by columns; `updateRow` on a missing row sets them, **a self-fix then
    an HR Edit reads "By Neha" with `checkout_suggested_at` null**, and an approved correction clears
    them; `missingWindow` skips a holiday Friday.
  - `tests/services/attendance.reminders.test.js` (D): each kind sent and refused when it no longer
    applies; **five parallel reminds of one person and kind send one**; a second after 31 minutes is
    sent; another kind is not blocked; self, Admin for HR (`not_allowed`, the same message whether
    the Admin is active or tracked) and deactivated are skipped; `check_in` after the day end
    skipped; `missing_checkout` with a pending correction or on a leave day skipped; Slack DM only
    with `slackAttendanceRemind` on and a `slackUserId`; a notification row (push) every time; audit
    for HR only. `tests/services/attendance.checkinReminders.test.js` (D): due at late mark + 30 for
    the company and for an own shift; once a day (two ticks, two processes); none on a weekend, a
    holiday or full-day leave; first-half leave reminded after the split mark + 30; an HR remind
    earlier that day stops it; 0 turns it off; after the day end none; **a worker down until the
    afternoon sends nothing more than an hour late**; before 018 one warning and no error per person.
  - `tests/services/attendance.hrSummary.test.js` (D): HR recipients, Admins when there is no HR;
    Admins' attendance hidden from HR and shown to Admins; the recipient left out, **and the
    recipient's own pending correction not counted under Waiting**; leave excluded and not-yet-late
    people listed with "(starts …)" under Not checked in; approved WFH listed; a failed attempt
    resends only to those without one; **deleting the morning bell row before attempt 2 sends
    nothing again** (the `attendance_alerts` claim); not on a holiday or weekend, not after office
    end; the link carries `?filter=not_checked_in`; evening off by default, its lists (an away break
    counts over the allowance; a weekend auto check-out shows on Monday; an open row before its day
    end counts as "still on their shift"); Slack per `slackHrSummary`, names escaped.
  - `tests/services/attendance.month.test.js` (E: `summarizeRange` with a 26 start, holidays and
    leave; HR never sees an Admin, an Admin does; a leaver is listed up to their last day and never
    absent after it; **the query budget "8 plus one per 500 attendance rows"** with a query counter;
    away breaks counted; planned leave apart; an open row from yesterday as missing);
    `attendance.monthExport.test.js` (two sheets and their names, every header, numbers are numbers,
    one person's file, the Days sheet stops at today, **201 people → 400, a second export while one
    builds → 429**, no report task title, screen-time value or IP anywhere in the workbook);
    `attendance.personMonth.test.js` (an HR edit with its reason, a correction with its note, a
    confirm, a break change, a self check-out with "Daybook last saw them at", a leave record, an
    `away_backfill` row, `mark_missing`, `auto_checkout` and `unverified_office` not listed, **no
    `ip`, `checkInIp` or `checkOutIp` in the body**, an Admin's month `NOT_FOUND` to HR, own month
    without actions and with leave notes null); `attendance.lateAlerts.test.js` (3 late days nothing;
    the 4th → one bell row to HR, none to the person; a second attempt the same day nothing; a 5th day
    nothing; the next payroll month alerts again; **one person whose notify fails doesn't stop the
    others**; **on the first working day of a period the previous one is checked through its last
    day**; an Admin's late days go to the other Admins; a holiday date sends nothing; first-half
    leave late only after the split mark; `job_runs` late-alerts rows are deleted in `beforeEach`,
    since migration 018 claims today's); `attendance.lateCount.test.js` (4th; holiday and full-day
    leave skipped; across the 26th); `attendanceMonthRoutes.test.js` (HR and Admin 200, PM and
    employee `FORBIDDEN`, bad month 400, export content type and filename, per-person rate limit).
    `attendancePage.test.js` additions (A: marks and "4th this month" in rows, Needs a look only for
    `canCorrect`, the Present KPI "2 off", the On leave and On break pills only when above 0).
  - `tests/services/attendanceHolidays.test.js`, `attendanceLeave.test.js` (F): holiday create,
    edit, move, delete, audit rows; same date → `CONFLICT`; the 61st of a year refused; a date
    outside the window refused; PM `FORBIDDEN` on writes, employee `FORBIDDEN` on GET. **Check-in on
    a holiday** → `is_working_day 0`, late 0. **Adding a holiday for a past day with a late row** →
    late 0 and flag 0, one `attendance.day_rules` audit, the person told, **and the Admins told with
    " Neha Kapoor's own row is one of them." when HR's own late row was in it**; **deleting it**
    restores the late minutes. **A check-in that commits while a holiday for today is being added
    ends with flag 0 and late 0** (`recheckDayRules`). `listDay` on a holiday: nobody
    `not_checked_in`, summary `notCheckedIn 0`. Worker on a holiday (`setNowForTests`):
    `companyNow().workingDay` false, no report reminder, no timer reminder, no PM summary, no HR
    summary, no check-in reminder, no late alert; HR notes run on Thursday when Friday is a holiday.
    Leave: full multi-day across a weekend and a holiday counts the working days only; a half needs
    one day; **5 parallel creates for the same person and day save one** (the others `CONFLICT`);
    own leave and HR marking an Admin's `FORBIDDEN`; an Admin may; untracked person `CONFLICT`; no
    working days `VALIDATION_FAILED`; update and delete need a reason; the person is notified (title,
    no note). **HR's preview of an Admin → `NOT_FOUND` and no `checkIns`**. **First-half leave,
    check-in at 14:10** → late 10m (Late after 9:30); full leave → late 0; **first-half leave added
    after a 13:45 check-in** recomputes late 4h 15m to 0, and deleting the leave restores it;
    **Late after changed since a check-in, then a leave note edit leaves the late minutes
    unchanged**. `listDay`: full leave → `on_leave`, not in Not checked in; first half → `on_leave`
    before 14:00 and `not_checked_in` after; filter `on_leave`; a PM viewer gets `day.leave` without
    `leaveType` and `paid` and `day.wfhApproved` false. The Leave page with start day 26 lists 26 Oct
    to 25 Nov. **`GET /api/attendance/me/today` and the My log Excel contain no note text; HR's own
    entry has `note: null`.**
  - Readers (H): Team board Off today group (teal) and counts, **a PM's `/team` and `/team/[userId]`
    payloads contain no `leaveType` or `paid`**; Overview "Not checked in" today with first-half
    leave; My log days and KPIs ("of N working days" counts leave days); HR notes numbers include
    `holidays` and `leaveDays`, missing and auto by the month rules, and **the prompt never contains
    the leave type, paid or unpaid, or the note**; Ask Daybook skips holidays and leave and reads a
    self-entered check-out as "Entered by the person". Rewrites: `aiSummariesHr.test.js` (the new
    numbers), `dashboard*.test.js` where "Not checked in" counted weekend days, `reportsMyLog.test.js`.
  - Platform (G): `settings.test.js` (the 11 keys, ranges, `checkHrSummary`, `checkDayMarks`,
    defaults with the rows missing), `settingsValues.test.js`, `users.test.js`
    (`listTrackedForRange`), audit `listForEntities` (chunks of 500, actions filter, newest first),
    reports `listSubmittedDays`.
  - `tests/services/migration018.test.js` (O; a test database migrated to 017, then to 018): every
    UNIQUE key and FK of 018 exists (`information_schema.TABLE_CONSTRAINTS` and `STATISTICS`);
    COLUMN_TYPE, IS_NULLABLE and COLLATION_NAME of every new column and TABLE_COLLATION
    `utf8mb4_unicode_ci` of every new table (as `todoMigration.test.js`); **after dropping
    `attendance_alerts` by hand, `up` creates it again and skips the rest**; before 018, Today
    without the pop-up and with `removed: []`; **a Remove on a finished entry answers 503
    `UPDATE_NEEDED` and the entry is unchanged; only the running entry is asked about**; a Remove of
    the running entry falls back to the 1.09 split with one warning and `savedAsBreak: false`; the
    break list reads with `needsUpdate: true`; Put back, Change and Delete, the reminders route, the
    pop-up's writes, holiday and leave writes and the preview answer 503 `UPDATE_NEEDED` with the
    sentence; HR's Fix and bulk fix work without the entered-by columns; Attendance, the month view,
    Today, the Excel files, the Team board and the worker clock read as 1.09; the check-in reminder
    job sends nothing and logs once; the late alert returns `unavailable`. **Migration**: 1.09-style
    Removes on 31 Oct and 2 Nov give one away break (2 Nov) and one `attendance.away_backfill` audit
    row; a second `up` inserts nothing; today's three `late_alerts` keys are claimed;
    `daily_reports`, `report_entries` and `report_tasks` are byte for byte unchanged; `down` removes
    the away rows, their audit rows and every 018 table and column. After migrating, everything works
    without a restart. The workflow runs this file on MySQL 8.4 too.
- **E2E** (O; the e2e browser can't run Idle Detection, so the breaks spec uses a seeded split and
  away break):
  - `tests/e2e/breaks.spec.js`: the employee sees "Away, removed from your acme-app timer" on Today
    and puts it back; HR opens Priya's Present cell, sees "Away, removed from timer", changes a
    forgotten break's end with a reason and sees "Changed by"; a PM opens the list read-only.
  - `tests/e2e/missing-checkout.spec.js`: an employee with a missing row sees the dialog, keeps the
    suggested time and saves; another types a late time, adds a reason and it shows under "Waiting
    for HR"; HR opens the KPI link, selects two rows with the head-row checkbox, fixes them with one
    reason, reminds a third with Remind selected and sees "Reminded 10:05 by Neha" on Attendance; a
    PM sees the list without actions.
  - `tests/e2e/attendance-month.spec.js`: HR opens Attendance, switches to Month, sees a row with its
    numbers and a "Needs a look" tag with its reasons line, filters Late, opens Vishal's month, sees
    each day and an HR change with its reason, downloads the Excel (filename checked); the PM sees
    no Month switch and `/attendance/month` is no-access.
  - `tests/e2e/holidays-leave.spec.js`: HR adds a holiday for today; Attendance shows "Holiday: …"
    and no one "Not checked in"; an employee's Today shows "Today is a holiday: …" and "No late mark
    today."; HR deletes it, then marks first-half leave for another employee from the row's "..."
    menu; that employee's Today shows "You're on leave for the first half of today, until 2:00."
    and "Late after 2:00."; a PM sees "On leave" on Attendance without the type and gets the
    no-access page on `/attendance/leave`.
- **Screens** (every builder with UI): `shot.mjs` and `compare.py` against the prototype, and A's
  day page against `09-attendance` at 1440 and 1280 px, light and dark, 390 px.
- `APP_VERSION` '1.10'.

Also update the other CONTRACT sections as listed in "Other sections" below (O, with this section).

### Other sections

- **§6**: settings `getAll` gains the 11 keys; attendance gains the exports listed in "Modules"; timers
  `lastRanByUser`, `listEntriesFor`, `putBackAway`, the `getState` and `resolveAway` additions;
  reports `listSubmittedUserIds`, `listSubmittedDays`; users `listTrackedForRange`; audit
  `listForEntities`; dashboard `buildCalendar`; activity `anyoneSeenBetween`.
- **§7**, "Later sections add": "timers → `timers/away/[breakId]/put-back`; attendance →
  `attendance/[id]/breaks/**`, `attendance/me/missing-checkouts/**`,
  `attendance/missing-checkouts/fix`, `attendance/reminders`, `attendance/month/**`,
  `attendance/people/**`, `attendance/needs-look`, `holidays/**`, `leave/**` (25)". Downloads: add
  Attendance month → `GET /api/attendance/month/export?month=YYYY-MM&userId=` (`attendance.correct`,
  attendance).
- **§8**: `StatusCell` statuses `on_leave`, `holiday`, `day_off`; `Segmented` items take `disabled`;
  `Kpi` keeps its bar at the card's bottom; `MonthCalendar` tones `leave` and `holiday` and the
  `legendItems` prop.
- **§9**: the owner rows of "Files and owners" with "(CONTRACT 25)"; page permissions add
  `/attendance/missing` and `/attendance/holidays` `attendance.view_all`, `/attendance/month`,
  `/attendance/people/[userId]` and `/attendance/leave` `attendance.correct`.
- **§10**: service tests that need MySQL 8.4 run in `.github/workflows/migration-check.yml`.
- **§11**: no-data gaps (Idle Detection only, someone else's screen time recorded in them) are read
  for the away question; HR still never sees segments, only one suggested check-out time.
- **§15**: Data: `end_reason` adds `away` and `hr`; `attendance_breaks` adds `source`,
  `away_entry_id`, `changed_by_id`, `changed_at`. "Break end": the allowance notice is decided in
  the transaction (`breakTotalsIn`) and also follows a Remove. "HR edits and corrections never touch
  breaks" becomes: their check-in and check-out edits never touch breaks; HR may change a break's
  end or delete it with a reason (§25 item 2). "Away time": replaced by §25 A (every one of today's
  timer entries, no-data gaps, Remove saves an away break, Left, Put back). "Locks and races": Remove
  locks the timer's own date's attendance row, then the entry by id; a break fix locks the
  attendance row by primary key, then the break.
- **§16**: late marks follow the person's day (holidays, leave, the split), rewritten only by
  `applyDayRules` and `recheckDayRules`.
- **§17**: `nextWorkingDay` skips holidays; "WFH approved" on Attendance is for approvers only.
- **§19**: `lastSeenWorking` is shared by the suggested check-out time (finished timers only for a
  past date); `notifyMissing`'s new body and `/today?checkout=missing` link; the 00:05 jobs close
  timers before marking missing check-outs.
- **§20**: HR notes count holidays and leave and read missing and auto check-outs by the month rules;
  `lastWorkingDayOfWeek` skips holidays; Ask Daybook's "Corrected" wording.
- **§21**, "3. Notifications": add "Reminders from HR and from Daybook, and for HR the morning
  summary and the evening wrap-up (CONTRACT 25), come to the bell and, where Show on this computer is
  on, as desktop notifications. There is no per-type mute in this release; Slack DMs follow the
  company's switches in Settings → Slack."

### Order of work

1. **O first**: migration 018 from the proposal, with `removedSpans` and its unit test; the 11
   settings keys in the seeds; `src/lib/time.js` `holidays` argument; `timers.lastRanByUser`;
   version '1.10'; the permissions text; the prototype; the MySQL 8.4 workflow. Run migrate up,
   down for 018, up again on a copy (a `daybook_test_<n>` database), never the live "daybook"
   database, and once on MySQL 8.4 through the workflow.
2. **A and G in parallel.** A: `migration018.js`, the person's day (`calendar.js`, `dayRules.js`,
   `calendarRepo.js`, `calendarReads.js`), `marks.js`, `payroll.js`, `checkoutEntered.js`, the
   `day.js` split (`dayExport.js`, the merged `listDay` item, `FILTERS`, `summarize`), `getDay` in
   check-in, HR edits and corrections, the worker clock, and the shared layout (`DayCells.jsx`,
   `dayRows.js`, `rowActions.js`, the Attendance and Today pages) with the barrels and stubs. G: the
   settings keys and screens, `listForEntities`, `listTrackedForRange`, `listSubmittedUserIds` and
   `listSubmittedDays`, `StatusCell`, `Segmented`, `Kpi`, `MonthCalendar`, `buildCalendar`.
3. **Then B, C, E, F and H in parallel**, each in its own files: B (A and item 2), C (B and 7), E (3
   on screens, 4, 8, 10; needs G), F (6, 9), H (Team board, Overview, Employee detail, My log, AI,
   screen time; needs G).
4. **D once C and G are in** (5 and 1: it needs `missingCheckoutsFor`, `listSubmittedUserIds` and
   `listForEntities`). C and F code against D's stubs meanwhile.
5. **O last**: register the four jobs in `src/worker/{cron,index}.js` and move
   `closeOpenTimersJob` before `markMissingCheckoutsJob`; replace any stub left; demo data; the four
   e2e specs; `migration018.test.js` across every feature; README; doctor; the CONTRACT updates;
   then the build.

### Choices made in this section (for the owner to confirm)

1. **Day format**: every new string writes a day as "Fri, 13 Nov" (the app's format), including the
   owner's pop-up text "You didn't check out on Fri 13 Nov"; only the Missing check-outs side card
   keeps artboard 09's "Priya Sharma, Fri 13 Nov".
2. **Away**: with the "I had left" offer the dialog shows Keep and "I had left" only (no third
   button), offered from 15 minutes (the left early grace) before the day end; Put back always
   deletes the away break and restores the timer when it safely can; the idle accuracy rule always
   applies (no setting); a no-data gap is asked about only when someone else's screen time was
   recorded during it (so a Daybook restart never asks); the backfill starts on 1 Nov 2026 and
   leaves alone the cases it can't tell apart from a person's own edits.
3. **Break fixes**: HR changes only a break's end (as asked), not its start, and never past a timer
   that started later; PMs see the break list read-only, like the rest of Attendance.
4. **Missing check-outs**: a page (`/attendance/missing`), not a drawer; closing the pop-up (Escape,
   ×) counts as "Not now"; HR's fixes and later edits are marked "By" too, and an approved correction
   clears the mark. **On a day off, full-day leave or before joining there is no shift, so the
   self-fix limit is the suggested time + 15 minutes, and with no suggestion the time goes to HR.**
   A self-entered time more than 15 minutes after Daybook last saw the person gets HR's "Check" tag
   (the owner's max() rule is kept). A self-save for a day in an earlier payroll month tells HR.
5. **Reminders**: two new Slack switches instead of reusing `slackRemind` (whose label is about
   reports); the 30-minute rule is a constant and counts Daybook's own reminder; the check-in
   reminder starts at the person's late mark (on first-half leave, the split plus the grace) and is
   never sent more than an hour late; on Attendance the remind is an item in the row's "..." menu,
   with "Remind all" for the Not checked in and On break filters; the Action column widens from
   95.66 to 120 px for HR so the row stays one line.
6. **Summaries**: HR only (Admins when there is no HR), like the weekly HR notes; "Not checked in"
   is the Attendance pill's set (the owner's "not checked in yet, excluding people on leave"); the
   morning time can't be before Late after and the summary isn't sent once office hours have ended;
   the evening wrap-up (7:00 PM) lists the auto check-outs since the last working day.
7. **Month**: the month view, the month Excel and the person month are for HR and Admins only;
   "4th this month" and the marks show to every viewer of the day page; a payroll month is named
   after the month it ends in, and on the first 3 days of a period the month screens open the one
   that just closed; one number (`late_alert_days`) for late days, short days and missing reports;
   the late alert goes out once a day at office end, bell and desktop only, starting the working day
   after the deploy; "Missing check-outs" in the month counts days marked at midnight, fixed later or
   not; the month Excel covers up to 200 people.
8. **Half-day leave**: the split is the middle of the person's shift (not a setting); on second-half
   leave Left early is measured against the split; a check-in on a full-day leave day counts present
   (leave 0) with the marks of a full day, and is flagged, with no automatic change.
9. **Holidays**: one holiday per date, one date per row (no half-day or department holidays);
   weekends now read "Day off" on Attendance and the Team board instead of "Not checked in";
   changing a holiday or leave rewrites the late minutes of the days it changes with today's late
   mark and the person's current shift, audited per row; a change to today or a past day tells the
   Admins and the people whose late mark changed.
10. **Privacy**: PMs see who is on leave and the part of the day, never the type, pay or note, and
    don't see "WFH approved"; the person never sees HR's leave note.
11. **Design**: the orchestrator's prototype binds the new screens; with the scope approved, builders
    don't wait for a separate sign-off on it.

### Risks to watch

- No-data gaps: Chrome Memory Saver or frozen background tabs can stop Idle Detection heartbeats
  while someone works in other apps, which brings more questions (Keep answers them). Checking every
  one of today's entries asks, on deploy day, about earlier spans of that day. In a team where only
  one person's screen time is recorded at a time, laptop-asleep gaps are never asked about.
- The `attendance` and `attendance_breaks` ALTERs each copy their table once (adding a foreign key
  with `foreign_key_checks` on is `ALGORITHM=COPY` on both servers): check-ins and breaks wait a few
  seconds; a blocked ALTER gives up after 30 s (`lock_wait_timeout`) and the line is run again.
  Deploy after 7 PM.
- Removes that the still-running 1.09 web process answers between the backfill's read of that
  person-day and the restart are not rebuilt: press Restart right after migrate.
- The backfill changes Breaks and Worked for days since 1 Nov, which HR may already have exported;
  the README note says to tell HR before payroll.
- The production engine is still unconfirmed; 018 is checked on MySQL 8.4 only in CI (the
  workflow), never on the host before the live migrate.
- HR ending a forgotten open break doesn't resume the paused timer; Put back after the entry was
  deleted or edited only removes the break (`restored: false`).
- The 30-minute rule and leave writes rely on REPEATABLE READ gap locks with deadlock retry (the
  WFH pattern); many parallel clicks can end in "Something else changed at the same moment. Try
  again."
- Working days for past months follow today's `workingDays`; changing `payroll_month_start_day`
  re-cuts periods and can send a second late alert in the overlapping days.
- Month counts of missing and auto check-outs depend on the audit rows `attendance.mark_missing` and
  `attendance.auto_checkout`; deleted leave doesn't show in the person month's Changes except
  through its `leave.delete` audit row, and rows of a deleted or moved leave written more than 400
  days before the month starts aren't looked for.
- `companyDay` is cached 30 s per process, so the worker may lag a holiday edit by up to 30 s;
  `getDay` and `loadCalendar` read holidays directly, and `recheckDayRules` fixes a check-in that
  committed during a holiday or leave write.
- A self-entered time can be as late as the person's shift end even when Daybook last saw them
  much earlier; HR sees "By" with a "Check" tag when it is more than 15 minutes after the last time
  Daybook saw them working, and the month view counts those days.
- Per-process caches (Needs a look 5 minutes, suggestions, the away part of the timer state) are
  cleared only in the process that wrote; on a host with more than one web process another may
  show the old value for up to 5 minutes.

## 26. Bell sound and preview (company request, Daybook 1.11)

The owner asked for the bell to tell people about new notifications while Daybook is open,
approved for one release on 23 Nov 2026, shipped as version '1.11' with **no migration** and **no
new npm dependency**:

1. **Live bell.** While Daybook is open, the bell notices new notifications by itself (a light
   live check, about every 30 s while a Daybook tab is visible and about 60 s while all are
   hidden); the desktop-push message from `public/sw.js` still refreshes at once.
2. **Preview card.** A card slides in under the bell for every new notification: icon, title, one
   or two lines of body, time, "Open", "Mark as read" and a close X. It hides itself after about
   6 s and stays while the pointer or keyboard focus is on it. Three or more arriving together show
   one summary card ("3 new notifications"). On a phone it comes from the top.
3. **Sound.** A short soft sound Daybook makes itself (synthesized, not copied from any app). Once
   per batch, never several in a row, and only one open Daybook tab plays it. Default: sound for
   important notifications only. Each person can change it in My settings, and **picks which sound**
   they hear: Chime (the default), Soft bell, Ding or Pop (owner, 23 Nov 2026).
4. **My settings.** A Sound choice (Important only, the default; All; Off), a "Choose a sound" choice
   (Chime, Soft bell, Ding, Pop; picking one plays it) with a "Play sound" button, and a "Show a
   preview" switch (default on).
5. **No double alert.** While a Daybook window is in front, Daybook shows its own preview instead
   of the system pop-up, where the browser's rules allow skipping it; when Daybook is closed or in
   the background, desktop notifications work as in 1.10.
6. **First load is quiet.** Loading a page never rings or previews what was already there; only
   notifications newer than what this tab has seen.
7. **Same text, same privacy.** The preview shows exactly the bell's text.

Written against the code at `37578ea` (1.10), with the groundwork in `scratch/design-1.11/map.md`
(the system as it is) and `scratch/design-1.11/browser.md` (browser rules, with sources). Names
marked **new** don't exist yet; every other name is in the code.

**Design:** `docs/design/bell-preview-prototype.html` (standalone, the real tokens, as §23 to §25),
built by the orchestrator's prototype step before the builders start: Today with one card under the
bell, the stack of three, the summary card, the Report page (no bell) with a card just under the top
bar at the right, the open bell list taking a new item, My settings → Notifications with the new rows; light and
dark, 1440, 1024 and 390 px. Its look and copy bind B's and C's screens; where it and this section
differ, this section wins and the prototype is fixed. Build with the tokens only (never raw hex in
CSS modules), lucide icons, and the existing `Toggle`, `Segmented`, `Button`, `useToast`.

**Copy:** short and plain, sentence case, no dashes. A card's title, body and time are the bell's
own: the row's `title` and `body` as stored, and the time as `NotificationItem` writes it ("Today
at 9:41 AM", "Yesterday at 6:05 PM", "Monday at 9:41 AM", "13 November at 9:41 AM":
`formatRelativeDay` gives the full weekday and `D MMMM`). Example people:
Vishal Saini (employee), Neha Kapoor (HR).

### Words

- **Notification** = one `notifications` row (the bell), unchanged.
- **Cursor** = the highest notification `id` a tab has seen. It starts at AppFrame's `latestId`
  (the person's newest notification id when the page was rendered, 0 when they have none) and is
  raised to each live check's `latestId` and by the bell's own load (`markSeen`, below). It never
  goes down and survives client navigations (the provider lives in the layout); a full page load
  starts a new one. The provider reads `latestId` once, when it mounts (`useState(() =>
latestId)`). A newer value from a later `router.refresh()` (AutoRefresh, Mark all as read, any
  save) is ignored, because raising the cursor from it would skip notifications that arrived since
  the last live check.
- **New notification** (for one tab) = a notification of the signed-in person with an `id` above
  the tab's cursor when the tab learns about it, still unread (`readAt` null) and not hidden in
  the bell (a delete waiting for its Undo). An item read elsewhere, deleted, restored by Undo or
  marked unread again is never new: its id is at or below the cursor, or it is read.
- **Live check** = one `GET /api/notifications?after=<cursor>` (below). Run by the leader tab, and
  at times by another tab (the watchdog, an answer to the service worker, fallback mode).
- **Leader tab** = the one Daybook tab per browser and person that runs the live checks
  (`navigator.locks`), sharing each answer with the other tabs (`BroadcastChannel`). The others
  are **followers**.
- **In front** = the page's `document.visibilityState === 'visible'` and `document.hasFocus()`;
  in the service worker, `client.focused && client.visibilityState === 'visible'`. **Visible** =
  `visibilityState === 'visible'` (front tab of a window that isn't minimised; it may be on another
  monitor, without focus).
- **Batch** = the new notifications a tab learns about from the first one until 1.5 s later
  (`BATCH_WINDOW_MS = 1500`), from one or more answers. One batch gives at most one chime and at
  most one summary card.
- **Important notification** = one that asks the reader to act today: check in or out, end a
  break, add a missing time, start a timer, send a report, decide someone's request, or drop other
  work for an urgent project. Answers to the reader's own requests, changes someone already made,
  confirmations and summaries (except HR's morning list) are not important. Fixed per type in
  `ALERT_TYPES` (table below).
- **Preview card** = the small card for one new notification. **Summary card** = one card for a
  batch of 3 or more. **Stack** = the cards on screen, at most 3 (2 on a phone), newest on top.
- **Chime** = the short sound Daybook synthesizes with Web Audio: the one the person picked in "Choose
  a sound" (`bellTone`: Chime, Soft bell, Ding or Pop). Never a sound file.
- **Sound tab** = the one tab allowed to chime for a batch, named in each result (`soundTabId`):
  the tab in front when its audio runs, else the checking tab (usually the leader) when its audio
  runs, else the newest tab whose audio runs. When no Daybook tab of the browser is in front and
  desktop push is active, no tab chimes (the system notification makes the sound).
- **Desktop push active** = in this browser, `Notification.permission === 'granted'` and the service
  worker has a push subscription (the bell's "Show on this computer" is on), while the company's
  `pushEnabled` is on and keys are set (AppFrame's `pushKey`).
- **Alerted** = this browser already alerted the person about a notification: a tab chimed for a
  batch holding it (the record's `chimed` list), or showed its card while in front (`shown`). An id
  is alerted when it is in either list. Kept in `localStorage` (below).

> **Company rule (overrides CONTRACT §14, "Every bell notification is also shown on the person's
> computer"; owner, 23 Nov 2026):** while a Daybook window is in front and answers that it shows the
> notification itself, the service worker shows no system notification, except for Apple push
> endpoints (Safari revokes a subscription after 3 pushes without one). A system notification for
> something this browser already alerted, or that comes while a Daybook window is in front with
> Sound set to Off, is shown silent (never on Apple endpoints: iPhone and iPad ignore `silent`, so
> the page leaves the sound to the system there). When no Daybook window is in front,
> desktop notifications are exactly as in 1.10, with the computer's own sound whatever the Sound
> choice.
>
> **Company rule (overrides CONTRACT §21 "There is no per-type mute in this release"):** the Sound
> choice is the only per-type difference: Important only chimes for the types marked important.
> There is still no per-type mute of the bell, the cards or desktop notifications.

### Data (no migration)

- **No new table, no new column.** The three preferences (`bellSound`, `bellTone`, `bellPreview`)
  are new keys in `user_preferences.prefs`
  (JSON, migration 013): only values that differ from the defaults are stored, so every existing
  row reads the defaults at once (`withDefaults`). Rolling back to 1.10 ignores the stored keys
  (`withDefaults` drops unknown keys).
- The live check reads `notifications` through the existing indexes only: the primary key and
  `(user_id, read_at)`. There is no separate `user_id` index (migration 005 adds the
  `(user_id, read_at)` index before the foreign key, so the foreign key uses it). `user_id = ? AND
id > ? ORDER BY id DESC LIMIT 21` is either a primary key range over the rows newer than the
  cursor (a handful for a fresh cursor) or a `(user_id, read_at)` lookup with a small sort.
  `MAX(id) WHERE user_id = ?` reads the person's entries of `(user_id, read_at)`. The unread count is
  today's `countUnread` on `(user_id, read_at)`. All are cheap at Daybook's size (read rows go after
  180 days), and 1.11 adds no index. A runs `EXPLAIN` once on a test database with the demo data and
  writes the plan in the PR; no test asserts it.
- `localStorage` (per browser, never sent): `daybook.live.<userId>` = `{ chimeAt, chimed: [[id,
at], ...], shown: [[id, at], ...] }` (each list keeps the last 50 ids; entries older than 10
  minutes are dropped). `chimed` = ids a tab chimed for; `shown` = ids whose card a tab showed while
  in front. Every read and write is in try/catch; without storage (private mode, blocked) each tab
  keeps the same record in memory.

### Important notifications (`src/modules/notifications/alerts.js`, new, pure, browser-safe)

`ALERT_TYPES` is the one list: a frozen object `{ [type]: 'important' | 'normal' }` with **every**
type Daybook creates (43 today: 19 important, 24 normal). Group and icon come from the type's prefix
(`ALERT_GROUPS`). The table is the contract; the test pins it.

| #   | Type                                 | Important | Group      | Why                                                                                          |
| --- | ------------------------------------ | --------- | ---------- | -------------------------------------------------------------------------------------------- |
| 1   | `attendance.checkin_reminder`        | yes       | attendance | You are past your late mark: check in now.                                                   |
| 2   | `attendance.remind_check_in`         | yes       | attendance | HR asks you to check in now.                                                                 |
| 3   | `attendance.remind_break`            | yes       | attendance | HR asks you to end a long break.                                                             |
| 4   | `attendance.remind_check_out`        | yes       | attendance | HR asks you to check out.                                                                    |
| 5   | `attendance.remind_missing_checkout` | yes       | attendance | HR asks you for a missing check-out time.                                                    |
| 6   | `attendance.checkout_reminder`       | yes       | attendance | Your day has ended: check out, or carry on.                                                  |
| 7   | `attendance.auto_checkout`           | yes       | attendance | Daybook checked you out; if you are still working, you need to act now.                      |
| 8   | `attendance.missing_checkout`        | yes       | attendance | Add the time you left. The HR copy shares the type; both come at 00:05, so they seldom ring. |
| 9   | `attendance.unverified_office`       | yes       | attendance | HR is asked to confirm an office check-in today.                                             |
| 10  | `attendance_correction.requested`    | yes       | attendance | HR is asked to decide a correction; the person waits.                                        |
| 11  | `attendance.hr_summary`              | yes       | attendance | HR's morning list of who isn't in yet, to act on now. Once a working day.                    |
| 12  | `wfh_request.created`                | yes       | calendar   | An approver is asked to decide, often for today.                                             |
| 13  | `project.urgent`                     | yes       | project    | A project became urgent: it changes today's work.                                            |
| 14  | `project_request.created`            | yes       | project    | A PM or Admin is asked to decide a project request.                                          |
| 15  | `report_edit.requested`              | yes       | report     | The approver is asked to decide; the person can't edit until then.                           |
| 16  | `report.reminder`                    | yes       | report     | Your report isn't in yet: send it now.                                                       |
| 17  | `timer.reminder`                     | yes       | timer      | No timer is running: start one now. At most once an hour.                                    |
| 18  | `timer.stopped_midnight`             | yes       | timer      | Check your report before it locks. Comes at 00:05, so it seldom rings.                       |
| 19  | `system.test`                        | yes       | system     | The doctor's test: with the default choice it checks the whole path, sound included.         |
| 20  | `attendance_correction.approved`     | no        | attendance | The answer to your own request.                                                              |
| 21  | `attendance_correction.rejected`     | no        | attendance | The answer to your own request.                                                              |
| 22  | `attendance.self_checkout_past`      | no        | attendance | For HR's records; no deadline.                                                               |
| 23  | `attendance.edited`                  | no        | attendance | HR already changed it; for your information.                                                 |
| 24  | `attendance.break_over_allowance`    | no        | attendance | Comes from your own click when a break ends.                                                 |
| 25  | `attendance.hr_evening_summary`      | no        | attendance | A wrap-up at the end of the day.                                                             |
| 26  | `attendance.late_alert`              | no        | attendance | A pattern over the month, not about now.                                                     |
| 27  | `holiday.past_changed`               | no        | calendar   | Another Admin already changed it.                                                            |
| 28  | `leave.marked`                       | no        | calendar   | HR already marked it; for your information.                                                  |
| 29  | `leave.changed`                      | no        | calendar   | HR already changed it.                                                                       |
| 30  | `leave.removed`                      | no        | calendar   | HR already removed it.                                                                       |
| 31  | `wfh_request.approved`               | no        | calendar   | The answer to your own request.                                                              |
| 32  | `wfh_request.declined`               | no        | calendar   | The answer to your own request.                                                              |
| 33  | `project.created`                    | no        | project    | You are the PM of a new project; nothing to do this minute.                                  |
| 34  | `project.member_added`               | no        | project    | For your information.                                                                        |
| 35  | `project_request.approved`           | no        | project    | The answer to your own request.                                                              |
| 36  | `project_request.declined`           | no        | project    | The answer to your own request.                                                              |
| 37  | `project_task.added`                 | no        | task       | New work to plan; a PM adding many tasks would chime for every member.                       |
| 38  | `project_task.changed`               | no        | task       | As above.                                                                                    |
| 39  | `report_edit.sent`                   | no        | report     | Confirms your own click.                                                                     |
| 40  | `report_edit.approved`               | no        | report     | The answer to your own request (you have 24 hours).                                          |
| 41  | `report_edit.declined`               | no        | report     | The answer to your own request.                                                              |
| 42  | `ai.pm_summary`                      | no        | ai         | An evening read.                                                                             |
| 43  | `ai.hr_notes`                        | no        | ai         | A weekly read.                                                                               |

- `ALERT_GROUPS` (prefix → group): `attendance.`, `attendance_correction.` → `attendance`;
  `leave.`, `holiday.`, `wfh_request.` → `calendar`; `project.`, `project_request.` → `project`;
  `project_task.` → `task`; `report.`, `report_edit.` → `report`; `timer.` → `timer`; `ai.` → `ai`;
  `system.` → `system`.
- Functions: `alertLevel(type)` → `'important' | 'normal'` (`'normal'` for an unknown type),
  `isImportant(type)`, `alertGroup(type)` → a group (`'system'` for an unknown prefix),
  `isClassified(type)`, `assertClassified(type)` (throws `Error('Notification type "x.y" has no
alert level. Add it to ALERT_TYPES (CONTRACT 26).')`).
- **New types must be classified.** `notifications.notify` calls `isClassified(type)` after its
  schema parse (so after the early return for no recipients): under Vitest (`process.env.VITEST`)
  an unclassified type throws through `assertClassified`, so the creating module's service test
  fails; in production it logs `logger.warn({ type }, 'notification type has no alert level')` once
  per type per process and writes the rows as before (a notification never fails the caller's
  change, and `notify` runs inside the caller's transaction). `notify` reads `process.env.VITEST` at
  call time, not at import, so a test can switch it off. The unit test below also scans the source.
- Client components may import `@/modules/notifications/alerts` (pure, no imports), an exception to
  §2 like `@/modules/reports/todoText` (CONTRACT 24).

### The live check (shell, B: `src/components/live/`)

#### Where it runs

- **new** `LiveNotifications` (client) is mounted once in `AppFrame`, around `AppShell`, inside
  `ToastProvider`, so it runs on every signed-in page, with or without a bell (the bell is on 7
  pages only and the top bar scrolls away). Props: `{ userId, latestId: number | null, tz, push:
boolean, children }` (`tz` = `all?.timezone`, the value TopBar's `bellData` passes to the bell;
  `push` = `Boolean(pushKey)`). It renders `children`, then the stack and the announcement region.
  AppFrame gives it `key={user.id}`: when someone else signs in on this browser, the next render of
  an open page (a `router.refresh()`, such as Today's auto refresh) mounts a fresh provider for
  them, with a new store and the cursor of that render (quiet), never the last person's store.
- AppFrame reads `latestId` with `safely(notifications.latestId(user.id), null, 'shell: could not
read the latest notification', user.id)`, in the existing `Promise.all`. With `null`, the tab's
  first answer sets the cursor and alerts nothing.
- Without the provider (the dev shell demo, `src/app/dev/shell/page.js`), `useLiveNotifications()`
  returns null and the bell works exactly as in 1.10.

#### Leader and followers (`liveLeader.js`, `liveChannel.js`)

- Each tab asks for the lock `daybook-live-<userId>` (`navigator.locks.request(name, { signal },
() => held)`, `held` a promise resolved when the tab stops). The tab holding it is the leader; the
  others wait in line. Locks are granted in the order asked, so the leader is the oldest open tab and
  its cursor is never ahead of the others'. A tab that becomes leader runs a check at once. Chrome's
  Energy Saver doesn't freeze a tab holding a lock another tab waits for (browser.md §2). A leader
  whose lock is taken by the watchdog (below) sees its `request()` promise reject with an
  `AbortError`; when it wakes it stops its loop and asks for the lock again as a follower.
- Channel `new BroadcastChannel('daybook-live-<userId>')`. A `BroadcastChannel` never delivers a
  message to the object that posted it, so the checking tab passes its answer to its own result
  handler directly, then posts it, and every tab handles it the same way. The same holds for
  `read`, `read-all` and `prefs`: the posting tab applies them itself. Each tab keeps one channel
  object per name (a second object with the same name in the same tab would receive the first one's
  posts). Messages (all with `userId`; a message for another id is ignored):
  - `{ type: 'presence', tabId, visible, front, audio, at }`: every tab on mount, on
    `visibilitychange`, window `focus` and `blur`, `resume`, on each `statechange` of its audio
    context, every 30 s while visible, and `{ ..., gone: true }` on `pagehide` and on `freeze` (a
    frozen page can neither check nor chime; it posts again on `resume`). `audio` =
    `getChimePlayer().state() === 'running'`. Every tab keeps the latest per `tabId` (any tab may
    run a check) until that tab's `gone` (**new** `livePresence.js` `createPresences({ now, selfId
})`): `front` and `visible` count only from presences of the last 75 s (`frontTabId`, the poll
    delay), `audio` from the latest of each tab however old, because a hidden tab posts only when
    something changes. A tab that gets a presence from a `tabId` it doesn't know yet (a tab just
    opened) posts its own at once, so the newcomer knows which older hidden tabs run audio.
    `tabId` = `crypto.randomUUID()` (or a random string) per page load.
  - `{ type: 'check-now', tabId }`: a follower that becomes visible, or got a service worker
    message. The leader checks at once unless its last check started less than 5 s ago
    (`CHECK_GAP_MS = 5000`; then at the 5 s mark, one check for all requests in between).
  - `{ type: 'result', userId, items, more, unreadCount, latestId, checkedAt, frontTabId,
soundTabId }`: each successful answer, from whoever checked (duplicates are harmless: the cursor
    drops what was seen).
  - `{ type: 'read', ids, unreadCount }` and `{ type: 'read-all', unreadCount: 0 }` (the count from
    the write's answer): a tab marked something read (a card, the bell, Mark all as read). Every tab
    sets `unread` from them, closes those cards and drops those items from its open batch and queue
    (`read-all`: every item learned before it), and its bell marks them read.
  - `{ type: 'prefs', userId, bellSound?, bellTone?, bellPreview? }` on channel
    `daybook-live-prefs`: My settings saved one of the three (C calls
    `postPreferenceChange(values)`, without a userId: `liveChannel.js` adds the one the provider
    set with `setPreferenceUser(userId)`, and a tab ignores a `prefs` message whose `userId` is
    another person's). The posting tab applies it through `onPreferenceChange` (its local
    listeners), the others from the channel. Tabs use it until their next `router.refresh()` brings
    the stored values.
- `frontTabId` = the `tabId` of the newest presence with `front: true` (the checking tab counts
  itself), else null. `soundTabId` = the front tab when its presence says `audio: true`; else the
  checking tab when its own audio runs (usually the leader); else the tab of the newest presence
  with `audio: true`; else the front tab, else the checking tab (it then finds `'no_audio'`).
- **Fallback** (no `navigator.locks` or no `BroadcastChannel`, or either throws): every tab is its
  own leader with its own loop, `frontTabId` is unknown (null), `soundTabId` is the tab itself, and
  the chime claim (below) keeps it to one chime.
- **Watchdog**: a visible follower that has had no result for 75 s (`WATCHDOG_MS`) takes the lead
  with `navigator.locks.request(name, { steal: true }, () => held)` (no `signal`: it can't be
  combined with `steal`) and checks at once (a frozen or sleeping leader, Edge sleeping tabs). It
  then runs the loop as the leader, so a visible tab checks every 30 s again. The 75 s count from
  the later of the tab's last result and the moment its own lead was stolen: while every check
  fails (offline, a restart answering 5xx), two visible tabs take the lead from each other at most
  once per 75 s, never back and forth, and the error backoff holds.
- `window.__daybookLive = { checkNow, cursor, isLeader }` is set on mount and removed on unmount:
  `checkNow()` runs one check in this tab, skipping the 5 s gap, broadcasts it, and resolves after
  its answer has been handled (its new items are in the batcher). The e2e uses it; it only reads the
  person's own notifications, like the loop.

#### The loop (`liveRules.js` `pollDelay`, pure)

- The leader runs `await check()`, then `setTimeout(loop, delay)`: the next timeout is set **after**
  the awaited fetch, so Chrome never treats it as a timer chain and never slows it to once a minute
  (browser.md §2). Never `setInterval`.
- **One timer and one check at a time per tab.** Every trigger (the timeout, `check-now`, a service
  worker message, becoming visible, `online`, `pageshow`, taking the lock, `checkNow()`) first
  clears the pending timeout. A trigger that comes while a check is in flight is remembered and runs
  once right after it, never in parallel. After each answer, success or error, the one next timeout
  is set with `pollDelay`.
- `delay` = 30,000 ms while any Daybook tab of the browser is visible (its own state or a fresh
  presence), else 60,000 ms, each times a random factor from 0.9 to 1.1 so browsers opened at the
  same moment drift apart.
- **At once** (still at most one check per 5 s): when the leader takes the lock; on a service worker
  message (below); when a tab becomes visible (a follower posts `check-now`); on window `online`
  (failures reset); on `pageshow` with `persisted` (a page back from the back-forward cache asks for
  the lock again and checks).
- **Errors** (a network error, 429, 5xx and any other answer that isn't 2xx, 401 or 403): the next
  delay is `min(base × 2^failures, 300,000 ms)` (30, 60, 120, 240, then 300 s while visible).
  Nothing is shown to the person; the bell keeps its last count. A success resets it. (The server
  sends no `Retry-After`, so the tab doesn't read one.)
- **Stops** (clears timers, releases the lock, closes both channels, removes listeners and
  `window.__daybookLive`): on a 401 or 403 answer (signed out, deactivated); when an answer's
  `userId` isn't the tab's `userId` (someone else signed in on this browser in another tab; the
  stale page shows nothing of theirs); on unmount (signing out navigates to `/login`, outside the
  app layout); on `pagehide`. A stopped tab starts again only with a new page load (or `pageshow`
  persisted while still signed in).

#### One check

- `GET /api/notifications?after=<cursor>` (`after=0` when the cursor is null) with `fetch(url, {
credentials: 'same-origin', cache: 'no-store', signal })`, reading `{ data }` itself as
  `sendHeartbeat` does in `ActivityTracker.track.js`, **never `api`** (`apiFetch` sends the whole
  page to /login on a 401, and every waiting tab would follow as it takes the lock). This lives in
  **new** `liveCheck.js` `checkOnce({ fetch, after, signal })` → `{ ok: true, answer }` | `{ stop:
true }` (401 or 403: the loop stops and the page stays as it is) | `{ retry: true }` (the
  failures above). A check that hasn't answered in 20 s (`CHECK_TIMEOUT_MS = 20000`) is aborted
  and is `{ retry: true }` (the backoff applies), even when a fetch ignores its signal: one
  stalled request (a dead keep-alive socket, a stuck host process, a captive portal) never holds
  the loop and the triggers waiting behind it. Signature `checkOnce({ fetch, after, signal,
timeoutMs, setTimer, clearTimer })`.
- The answer is used only when `answer.userId === userId`. Otherwise the tab stops (below) before
  anything else: no store update, no cursor change, nothing to the bell, the batcher or the channel.
- The answer updates the store: `unread = unreadCount`; the cursor of the checking tab and of every
  tab that handles the result: `cursor = max(cursor, latestId)`.
- `gapMs`: when a tab handles a result, it is the result's `checkedAt` minus the newest `checkedAt`
  this tab handled before (its own answers and broadcast ones; tabs of one browser share the
  computer's clock), or minus its mount time when it has handled none. So a follower that becomes
  leader isn't stale on its first check. It only decides whether a chime is stale.
- New items (`liveRules.newItems(items, cursor, hidden)`): `id > cursor` (the cursor **before**
  this answer), `readAt === null`, not in the store's hidden set. With a null cursor, none (it is the
  baseline). They go to the tab's batcher. Every item (read or not) of the answer goes to the bell
  through the store, so an open list shows it.

#### Batches (`liveBatch.js`, pure with injected timers)

- `createBatcher({ windowMs: 1500, onFlush })`: the first new item starts a batch; items from later
  answers within 1.5 s of that first one join it (by id, no duplicates); at 1.5 s the batch is
  flushed. At flush time items read meanwhile (`read` by id; `read-all` drops every item learned
  before it; from this tab or another) or hidden in the bell are dropped, in the open batch and in
  the queue (below) alike; an empty batch does nothing. The batch's `gapMs` is the largest of the
  answers that brought its items.
- The flush runs, in this order: cards (if any), the announcement, the chime decision.

#### Service worker messages (`swAnswer.js`, pure)

`public/sw.js` (A) posts `{ type: 'daybook:notification', ask: true, id, userId, mustShow }` with a
`MessageChannel` port to every Daybook window on every push, and after showing a system
notification `{ type: 'daybook:notification', os: true, id, silent }` without a port. The provider
listens on `navigator.serviceWorker` (`message`):

- **An ask**: it answers on the port at once, before any fetch, with `answerPush(...)` →
  `{ shown, alerted, osSound }`:
  - `sameUser` = `Number(data.userId) === userId` (a payload without `userId`, from a 1.10 worker,
    is never the same user);
  - `inRecord` = `data.id` is in the alerted record (`chimed` or `shown`);
  - `alerted` = `sameUser` and (`inRecord`, or the tab is in front and its Sound choice is
    `'off'`): the system notification is then shown silent (not on Apple endpoints, below);
  - `running` = the tab isn't stopped, isn't in its own error backoff, and has handled a successful
    answer (its own or a broadcast result) in the last 75 s (`WATCHDOG_MS`), so a follower behind a
    frozen or backing-off leader never claims it shows the notification;
  - `canSound` = the Sound choice is `'off'`, or this tab's audio runs, or another tab's latest
    presence says `audio: true` (however old). A tab in front that nobody has clicked since it
    loaded (just opened, reloaded, opened from a desktop notification) has no audio yet: without
    another tab whose audio runs it must not silence the system notification, or an important
    reminder would come with no sound at all. (The ask carries no type, so this holds for every
    notification: one that isn't important then gets the system notification as in 1.10.)
  - `shown` = `sameUser`, the tab is in front, `running`, `canSound`, "Show a preview" is on or the
    bell list is open, and either `data.id > cursor`, `inRecord`, or `data.id` is in this tab's
    open batch, its queue or its stack (`pendingIds`: the cursor rises before the flush, so an item
    learned a moment before the push still counts). (An id the page already had when it loaded,
    and never alerted, answers `false`: the system notification shows as before.) A modal open in
    front still answers `true`: its cards wait (below).
  - `osSound`: when the tab is in front, `!alerted` and (`!shown` or `data.mustShow`), the id goes
    into the tab's `osSound` set: the system notification will make the sound, so this tab won't
    chime for it. A tab not in front adds ids only from the `os: true` message (a hidden sound tab
    must still chime when the tab in front answered `shown`).
  - Then, if it answered `shown: true`, it runs the check itself at once and broadcasts the result,
    whoever leads: the system notification was skipped because of this tab, and a leader that Edge
    put to sleep or Chrome froze can't answer `check-now`. Otherwise it posts `check-now` (or checks
    itself when it is the leader or in fallback).
- **An `os: true` message**: when `silent` is false, the id goes into `osSound` in every tab (this
  is how tabs not in front learn it, and it closes the rare race where focus moved between the
  answer and the worker's decision; the 1.5 s batch window gives it time to arrive). No new check.
- `NotificationBell` no longer listens for `daybook:notification` itself (the provider does and the
  bell gets the items through the store). Open 1.10 pages keep their listener until they reload:
  they ignore the port and reload their list, as before.

### Preview cards (shell, B: `PreviewStack.jsx`, `PreviewCard.jsx`, `PreviewStack.module.css`)

#### When cards show (`liveRules.planCards`, pure)

At a batch's flush, in this order:

1. "Show a preview" off → no cards, no announcement.
2. The tab isn't visible → no cards (no one would see them; the bell's dot and count update).
3. The bell list is open (the store's `bellOpen`) → no cards; the open list already shows the items
   at the top (the bell merges them). The announcement is still made (below).
4. **Wait** → the items go into the tab's queue when any of these holds:
   - a modal is open (`document.querySelector('[aria-modal="true"]')`: `Dialog`, `Drawer`, the
     away question);
   - a list of suggestions is open (`document.querySelector('[role="combobox"][aria-expanded=
"true"]')`: GlobalSearch's results, which open at the card's height and width, and the
     pickers);
   - the stack is paused (pointer or focus in it, below), so the cards never move under the pointer.

   When none holds any more, every queued item is planned as one batch (3 or more → one summary card
   and one announcement). An item is dropped 5 minutes after it was queued, by the tab's own clock
   (never by `createdAt`; the bell has it). The chime is not delayed. The tab watches with one
   `MutationObserver` on `document.body` (`childList`, `subtree`, `attributes` with
   `attributeFilter: ['aria-modal', 'aria-expanded']`), connected only while the stack or the queue
   has entries, its callback run at most once per animation frame.

5. Otherwise: a batch of 1 or 2 → one card each, the newest on top; 3 or more → one summary card.

- **Stack**: at most 3 entries (`MAX_CARDS`; a summary counts as one), newest on top; at 640 px and
  narrower at most 2 (`MAX_CARDS_PHONE`), and in a window under 500 px high at most 1
  (`MAX_CARDS_SHORT`, `SHORT_WINDOW_PX = 500`), so the stack never covers most of a phone screen
  or runs off a short window. A new entry goes on top; the oldest beyond the limit leaves at once
  (its leave animation, not marked read). An entry never leaves to make room while the pointer or
  focus is in it (new items wait while the stack is paused, rule 4).
- **A modal or list opens while cards show** (the same observer): the stack hides at once
  (`hidden`, every entry's time paused). It shows again when no modal or open list is left, each
  entry with at least 2,000 ms (`RESUME_MIN_MS`); entries hidden for more than 5 minutes are
  dropped. A card is therefore never on screen over a `Dialog`, a `Drawer` or the search results.
- Opening the bell list closes every card at once (not marked read), and none show while it stays
  open.
- A `read` or `read-all` from the store (a card here, the bell, another tab) closes the cards of
  those items; a summary closes when all its items are read. A card that holds focus isn't closed by
  a `read` from elsewhere: it goes when focus leaves it.
- Cards shown while the tab is **in front** add their ids to the record's `shown` list
  (`markAlerted`), so a later system notification for them is silent.

#### Timing

- Each entry hides itself 6,000 ms after it appears (`CARD_MS = 6000`).
- **Pause**: while the pointer is over the stack (from its first `pointermove` or `pointerdown` on
  the `<ol>` until `pointerleave`; not `pointerenter`, which Chrome also fires when a card appears
  under a mouse that isn't moving, so a card that lands under a resting pointer hides on time and
  never holds back the next ones) or
  focus is inside it (`focusin`/`focusout` with `relatedTarget` outside), every entry's time stops.
  When both end, each resumes with what it had left, at least 2,000 ms (`RESUME_MIN_MS = 2000`, the
  rule of `undoResumeMs`).
- The time runs while the tab is hidden (a card isn't kept for someone who left).

#### Single card

- `<li>` → `<article aria-labelledby={titleId} aria-describedby={bodyId}>` (no `aria-describedby`
  without a body):
  - **Icon** (`aria-hidden`): lucide, 18 px, `strokeWidth` 1.8, in a 32 × 32 tile, radius
    `var(--radius-control)`, `--primary-soft` with `--primary-text`. By `alertGroup(type)`:
    attendance `Clock`, calendar `CalendarDays`, project `FolderKanban`, task `ListTodo`, report
    `FileText`, timer `Timer`, ai `Sparkles`; system and anything else the bell's own `BellIcon`
    (not lucide's bell, which looks different from the top bar's), exported from
    `NotificationBell.jsx` by B with a `size` prop (default 20, so the bell is unchanged) and drawn
    at 18 px here.
  - **Title** (`<p id>`): the row's `title`, 14/20, 600, `--ink`, at most 2 lines
    (`-webkit-line-clamp: 2`), `overflow-wrap: anywhere`.
  - **Body** (`<p id>`, only when the row has one): 13/18 (`--text-small`), `--muted`, at most 2
    lines.
  - **Time**: `<time dateTime={createdAt}>` with the bell's text ("Today at 9:41 AM"; B moves the
    bell item's expression into `NotificationBell.list.js` `itemTime(item, tz, today)` and both
    use it), 12/16 (`--text-tag`), `--muted`, 4 px above.
  - **Actions** (10 px above, gap 8, wrap): **Open** only when `isInAppLink(link)`: a `next/link`
    `<Link href={link}>` styled as a small primary button (32 px high, padding `0 12px`, radius 8,
    `--primary` with `--on-primary`, 13 px 600, no underline, hover `--primary-hover`); then **Mark
    as read**: a text button (32 px, padding `0 10px`, radius 8, `--primary` text, 13 px 600, hover
    `--primary-soft`).
  - **Close**: a 32 × 32 button at the top right (`top: 6px; right: 6px`, absolutely placed, last in
    the DOM), lucide `X` 16 px `--muted`, hover `--surface-muted` with `--ink`, `aria-label`
    "Dismiss" (the app toasts' name).
  - Open, Mark as read and Dismiss each have `aria-describedby={titleId}` (the card's title), as the
    bell row's buttons do, so repeated buttons can be told apart.
- **Open** = the bell item's click (`useNotificationActions.open`): marks it read at once
  (optimistic `PATCH /api/notifications/[id] { read: true }`, the store learns it and broadcasts
  `read`), and for a plain left click waits up to `SAVE_BEFORE_NAVIGATE_MS` (400) for the save, then
  `router.push(link)`; a slow save refreshes after. A modifier or middle click is left to the
  browser (new tab) and still marks it read. The card closes at once. (B shares the code:
  `usePreviewActions` uses the same helpers and constant, exported from `NotificationBell.actions.js`
  and `NotificationBell.list.js`.)
- **Mark as read** = the same PATCH; the card closes at once; a failure puts nothing back on screen
  and toasts "Couldn't mark it as read" (tone error, the bell's copy), and the bell list (if loaded)
  reloads quietly.
- **Close X** (and Escape, below) = the card goes; the item stays unread.
- An unread item with no in-app link shows only Mark as read.

#### Summary card

- Same box. Icon `BellIcon` (18 px). Title "3 new notifications" (the batch's count; with `more` from the API:
  "More than 20 new notifications"). Body line 1: the newest item's title, 1 line, 13/18 `--ink-2`;
  line 2: "and 2 more" (`--muted`; "and 1 more" never happens, a summary has at least 3; with
  `more`: "and more"). Time: the newest item's.
- Actions: **See them** (small primary button) and **Mark these as read** (text button); Close X
  "Dismiss". Each has `aria-describedby={titleId}`, as on a single card.
  - **See them**, on a page with a bell (the store has a registered bell): closes the stack and
    opens the bell list (store `openBell`; focus goes to the bell button, as after pressing it).
    On a page without a bell: the summary is replaced, in one step, by the newest `k` items not
    read meanwhile (another tab, the bell) as single cards (fresh 6 s each, started only when the
    stack isn't paused), `k` = the stack's limit (3, 2 on a phone); other cards past the limit leave
    (their animation). The swap keeps the pause (the pointer that pressed it is still there), where
    focus came from, and the queue (`useStack` `replace(key, singles, limit)`; with no unread item
    left the summary just leaves). Focus, if it was in the summary,
    goes to the top card's first button. Its label is then "See them" when the batch has exactly `k`
    items and "See the newest {k}" when it has more (`seeLabel(count, maxCards, hasBell)`). In a
    short window (limit 1) without a bell the button isn't shown: the summary already names the
    newest.
  - **Mark these as read**: `POST /api/notifications/read-all { ids }` with the batch's ids (at most
    50, the newest); the card closes; `read` broadcast; failure toasts "Couldn't mark them as read"
    (tone error, the bell's copy).
  - With `more` (over 20), the second button is **Mark all as read** instead (`POST
/api/notifications/read-all {}`, the bell's copy and failure toast, `read-all` broadcast),
    because the batch's ids would miss the rows past the 20.

#### Place, size, layers

- The stack is a `<section aria-label="New notifications">` with an `<ol>`, rendered by the provider
  after `children` (like the toasts' region, at the end of the shell) and only while it has
  entries. `position: fixed; z-index: 65; width: 360px; max-width: calc(100vw - 32px)`; the section
  has `pointer-events: none` and each card `pointer-events: auto`, so the gaps never block clicks.
  Cards: gap 8 px.
- **641 px and wider**, `top` = the registered bell button's `getBoundingClientRect().bottom + 8`
  (where the bell list opens); on a page without a bell, the bottom of the page's top bar
  (`document.querySelector('#main header')`, TopBar's `<header>`, the only `header` in `main`)
  `+ 8`, so a card never covers the top bar's own buttons (Submit report, Save, New project). The
  value is used when it is from 8 to 240, else 16 px (the top bar has scrolled away).
- **641 px and wider**, `right`: with a registered bell, `clientWidth -
bell.getBoundingClientRect().right` (`document.documentElement.clientWidth`, so the scrollbar
  doesn't count), at least 16 and at most `clientWidth - cardWidth - 16`, so the card's right edge
  matches the bell list's (the list opens at the bell's right edge; on Team, Overview and Ask the
  avatar comes after the bell, and below 1024 px the actions row starts at the left). Without a
  bell: 32 px at 1024 and wider (the main area's padding), 24 px from 641 to 1023, decided by
  AppShell's own media query (`matchMedia('(max-width: 1023px)')`, which counts the scrollbar),
  not by `clientWidth` (a 1030 px window with a 15 px scrollbar still has 32 px padding).
- `top` and `right` are measured when the stack goes from empty to shown and on `resize` while
  shown (not on scroll: once shown it stays put, like a toast).
- **640 px and narrower** (phone): `top: max(12px, env(safe-area-inset-top))`, `left: 16px`,
  `right: 16px`, width auto (358 px at 390), no bell anchor: it comes from the top.
- **Card box**: `display: grid; grid-template-columns: 32px minmax(0, 1fr); column-gap: 12px;
padding: 12px 44px 12px 12px` (room for the X), `background: var(--surface)`, `border: 1px solid
var(--line)`, `border-radius: var(--radius-tile)` (12 px), `box-shadow: 0 16px 40px
color-mix(in srgb, var(--navy) 14%, transparent)` (the bell list's).
- **Touch** (`@media (hover: none)`) and 640 px and narrower: Open and Mark as read are 44 px high,
  the X 44 × 44 (`top: 0; right: 0`), padding-right 52 px.
- **Light and dark**: tokens only; every token used is a `light-dark()` one, so nothing else changes.
  No new tokens (so `themeFallback.test.js` is unchanged).
- **Layers** (z-index): page, bell list and GlobalSearch 40, sidebar scrim 44 and drawer 45,
  `Drawer` 50, `Dialog` 60, **preview stack 65**, toasts and Undo toasts 70, `Menu` and Team
  `TodoPopover` 80, skip link 100, LaunchSplash 1000. The stack hides while a modal or a list of
  suggestions is open (above), so a card is never on screen over a `Dialog`, a `Drawer` or the
  search results; 65 only keeps it above the page. Toasts sit at the bottom, cards at the top: they
  never overlap on desktop.
- **Motion**: enter `live-in` 180 ms `cubic-bezier(0.2, 0.8, 0.2, 1)` from `opacity: 0;
transform: translateY(-8px)` (from the bell); phone `translateY(-16px)` (from the top). Leave 140 ms
  ease-in to `opacity: 0; transform: translateY(-4px)`, then removed: on an `animationend` that
  comes while the card is leaving and from the card itself (`event.target ===
event.currentTarget`, so the end of the enter animation or of a child's never counts), with a
  250 ms safety timeout. Reduced motion: no rule in the module; the global rule in `globals.css`
  cuts both animations to 0.01 ms, so `animationend` still fires and a card appears and goes at
  once. When `matchMedia('(prefers-reduced-motion: reduce)').matches`, a leaving card is also
  removed without waiting for `animationend`.

#### Keyboard and screen readers

- Cards never take focus when they appear (WCAG 4.1.3). Tab order inside a card: Open, Mark as
  read, Dismiss. The region is a landmark ("New notifications"), reachable from the landmark list;
  every item is also in the bell, so a card that hides before someone reaches it loses nothing
  (WCAG 2.2.1).
- **Escape**: with focus in a card, it closes that card. Anywhere else, it closes every card (they
  stay unread) when no modal is open and nothing else used the key: a `keydown` listener on
  `document`, bubble phase, that checks `!event.defaultPrevented` (Menu, GlobalSearch, the bell and
  `useModal` already call `preventDefault`).
- **Focus never hides under a card** (WCAG 2.4.11): when focus moves to an element outside the
  stack whose box lies completely under a card (`focusin` on `document`, comparing
  `getBoundingClientRect()`), the stack closes at once (not marked read).
- When a card holding focus closes (any button, Escape, its time), focus moves to the next card's
  first control. When no card is left, it goes back to the element that had focus before focus
  entered the stack (the `relatedTarget` of the first `focusin` into the stack, if it is still in
  the page and not in the stack), else to the bell button, else to `main` (already
  `tabIndex={-1}` in AppShell). Each of these is focused with `{ preventScroll: true }`: a card
  closed with the mouse or a tap on a page scrolled down never jumps the page to the bell.
- **Announcement**: one `<div role="status" className="visually-hidden">` rendered by the provider
  from mount, always present (a region added with its text is often not read). It is made when a
  batch's cards actually appear: for queued items when they leave the queue, never while a modal is
  open (a screen reader ignores a live region outside an `aria-modal` dialog). While the bell list
  is open (no cards), the same text is announced at the flush. Never when preview is off or the tab
  is hidden. `announcement(batch)`: 1 item → "New notification: {title}"; 2 or more (two cards or a
  summary) → "{n} new notifications. The newest: {title}"; with `more` → "More than 20 new
  notifications. The newest: {title}". Bodies are never read out. The text is cleared first and set
  on the next animation frame, and cleared again 5 s later. Never `role="alert"`.

### The chime (shell, B: `chime.js`, `chimeGate.js`)

#### The sounds (`scheduleChime(ctx, t0, tone)`, `TONES`, `CHIME`)

Four short sounds, each picked by the person in My settings (`bellTone`, default `'chime'`). All are
plain sine oscillators with gain envelopes. No file, nothing to download. Each note of a sound is
played as one sine per **partial** (`hz * ratio`), each partial with its own gain and decay.

| Tone (`bellTone`)  | Notes (`hz` at `at` s)                                             | Partials (`ratio`, `gain`, `decay` s)                | Attack s | Stop after s | Master |
| ------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- | -------- | ------------ | ------ |
| `chime` "Chime"    | E5 659.25 at 0, then B5 987.77 at 0.12                             | (1, 1, 0.50), (2, 0.25, 0.25)                        | 0.010    | 0.52         | 0.16   |
| `bell` "Soft bell" | G5 783.99 at 0                                                     | (1, 1, 1.20), (2.76, 0.30, 0.60), (5.40, 0.12, 0.30) | 0.005    | 1.22         | 0.14   |
| `ding` "Ding"      | C6 1046.5 at 0                                                     | (1, 1, 0.60), (2, 0.20, 0.30)                        | 0.005    | 0.62         | 0.14   |
| `pop` "Pop"        | 880 at 0, gliding to 440 over 0.08 s (`glideTo: 440, glide: 0.08`) | (1, 1, 0.12)                                         | 0.004    | 0.14         | 0.20   |

For every partial of every note (`start = t0 + note.at`):

| Part   | Value                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pitch  | `frequency.setValueAtTime(hz * ratio, start)`; with `glideTo`, also `frequency.exponentialRampToValueAtTime(glideTo * ratio, start + glide)`      |
| Attack | gain `setValueAtTime(0, start)`, `linearRampToValueAtTime(partial.gain, start + attack)` (no click)                                               |
| Decay  | gain `exponentialRampToValueAtTime(0.001, start + decay)` (never to 0)                                                                            |
| Stop   | each oscillator `stop(start + stopAfter)`; `onended` disconnects its nodes                                                                        |
| Master | one gain node per play at `master` (the sum of a sound's partial gains × master stays under 0.5, so no clipping)                                  |
| Start  | `t0 = ctx.currentTime + 0.01`; the master gain node is disconnected 300 ms after the last oscillator stops (`t0 + lastNote.at + stopAfter + 0.3`) |

`TONES` exports exactly these numbers as a frozen object (`{ chime: { label: 'Chime', notes: [{ hz:
659.25, at: 0 }, { hz: 987.77, at: 0.12 }], partials: [{ ratio: 1, gain: 1, decay: 0.5 }, { ratio:
2, gain: 0.25, decay: 0.25 }], attack: 0.01, stopAfter: 0.52, master: 0.16 }, bell: { ... }, ding: {
... }, pop: { ... } }`), `TONE_NAMES = ['chime', 'bell', 'ding', 'pop']`, and `CHIME = TONES.chime`.
`scheduleChime(ctx, t0, tone = 'chime')` uses only them (an unknown name plays `chime`), so the test
can check the calls. Chime is the E5 then B5 pair with a quiet octave (oscillators at 659.25,
1318.5, 987.77 and 1975.54 Hz).

#### The player (`getChimePlayer()`, one per page)

- **No `AudioContext` at page load.** While the Sound choice isn't Off and `window.AudioContext ||
window.webkitAudioContext` exists, the provider adds passive capture listeners on `window` for
  `pointerdown`, `pointerup`, `keydown`, `touchend` and `click`. Every such event calls
  `unlock(event)` until the context runs. It does nothing when `!event.isTrusted`
  (`ServiceWorker.jsx`'s `mayLeaveFor` dispatches a synthetic click) or when
  `navigator.userActivation && !navigator.userActivation.isActive` (a touch `pointerdown` or Escape
  is not a gesture: creating the context there gives Chrome's "not allowed to start" warning and
  leaves Safari locked). Otherwise it creates the context if there is none (**inside the gesture**,
  as Safari needs), calls `resume()` without awaiting it and starts a 1-sample silent buffer. It
  does this on every such event, not only the first: on a touch screen the `pointerup` or
  `touchend` unlocks it. The listeners are removed in `onstatechange` when `state` becomes
  `'running'`. Firefox and Safari still report `'suspended'` right after the gesture (the spec
  queues the change), so `state` is never tested synchronously. An `onstatechange` to `suspended`
  or `interrupted` (iPhone, a locked screen) adds them again.
- `ready()` → `Promise<boolean>`: true with the test hook; no context → false (the person never
  clicked: no sound, the card still shows); running → true; else `Promise.race([ctx.resume()
.catch(() => {}), wait(300)])` (a `resume()` can stay pending for ever, browser.md §1), then
  whether it is running. It never makes a sound.
- `play({ ids, tone })` only schedules the person's sound (`scheduleChime(ctx, t0, tone)`, `tone`
  from `useBellTone()`, or calls the test hook). It is called only after `ready()` was true and
  `claimChime` returned `'play'`. A sound is never queued for later.
- **Test hook**: when `typeof window.__daybookChime === 'function'`, `play()` and `playChimeNow()`
  call `window.__daybookChime({ reason, ids, tone })` (`reason` `'batch'` or `'test'`; `ids` `[]`
  for a test) instead of making a sound, `ready()` is true, and no context is made. Production never
  defines it; the e2e does with `page.addInitScript`.
- `playChimeNow(tone)` (My settings' "Play sound" and picking a sound in "Choose a sound"), called
  synchronously in the click handler before any `await`: it creates or resumes the context, starts
  the silent buffer and schedules that sound at once (a context that is still starting plays it as
  soon as it runs), whatever the Sound choice, the sound tab and the rate limit. It then resolves `{ played }`, where `played` = `ctx.state ===
'running'` after `await Promise.race([ctx.resume().catch(() => {}), wait(300)])`. When `played`
  is false, the chime's master gain is disconnected at once, so a context that starts later never
  plays it late. It never reads or writes the alerted record (`chimeAt`, `chimed`), so a sound
  tried in My settings never holds back a batch's chime.
- `chime.js` touches no browser API when it is imported (node tests import `TONE_NAMES` from it);
  `getChimePlayer()` makes the page's player on first use. The UI's labels are `TONE_CHOICES`'
  (My settings); `TONES[name].label` is the same text.

#### When it chimes (`liveRules.shouldChime`, pure, then `claimChime`)

At a batch's flush, the first rule that matches decides (the reason is returned, for tests):

1. Sound choice `'off'` → `'off'`.
2. `'important'` and no item of the batch `isImportant` → `'not_important'`.
3. Any item of the batch is in the tab's `osSound` set, or desktop push is active with an Apple
   subscription (Safari always shows the system notification and iPhone and iPad ignore `silent`)
   → `'os'` (the system notification sounds).
4. The batch's `gapMs > 150,000` (the browser was asleep, offline or frozen: the items may be
   minutes old) → `'stale'`. Cards still show.
5. The tab isn't the sound tab → `'not_sound_tab'`. When `frontTabId` is null and desktop push is
   active, no tab is: the system notification makes the sound. Otherwise the tab is the sound tab
   when its `tabId` is the result's `soundTabId` (Leader and followers, above; for a batch from
   several answers, the newest answer's). Push state comes from `pushActive.js`
   `desktopPushActive()` → `{ active, apple }`: permission, then `navigator.serviceWorker.ready` and
   `pushManager.getSubscription()`, at most 500 ms, unknown = not active; `apple` = the
   subscription endpoint's host is `push.apple.com` or ends in `.push.apple.com` (the test of
   `isApplePush`).
6. `await player.ready()` is false → `'no_audio'`, before claiming, so a tab that can't play never
   blocks one that can (and `soundTabId` already prefers a tab whose audio runs).
7. `claimChime({ ids, now })` (inside `navigator.locks.request('daybook-chime-<userId>', ...)` when
   available): reads the record; `now - chimeAt < 10,000` (`CHIME_MIN_GAP_MS`) → `'too_soon'`; any
   id in `chimed` → `'done_elsewhere'` (ids in `shown` don't count: a card of this same flush has
   just written them); else writes `chimeAt = now`, adds the ids to `chimed` → `'play'`, and only
   then the tab calls `play({ ids, tone })` (`liveSound.js` `decideChime` runs rules 1 to 7).

So: one chime per batch, at most one every 10 s per browser (a batch inside the 10 s gets cards and
no sound, never a late sound), one tab per browser, never on first load (nothing is new then, and
no gesture has unlocked the audio), and nothing at all with Off.

#### Page side, with desktop push (the rule in one place)

| Daybook in this browser                   | Desktop push active | System notification (sw.js)                               | Page chime (per the Sound choice)                                                   | Cards           |
| ----------------------------------------- | ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| A tab in front, preview on (or list open) | yes, not Apple      | none (the page answered `shown`)                          | the sound tab: the front tab when its audio runs, else another tab whose audio runs | in visible tabs |
| The same, but no tab's audio runs yet     | yes, not Apple      | shown with the OS sound (not `canSound`)                  | none (`osSound`)                                                                    | in visible tabs |
| A tab in front, preview off               | yes, not Apple      | shown with the OS sound; silent when Sound is Off         | none (`osSound`)                                                                    | none            |
| A tab in front                            | yes, Apple          | shown (`mustShow`), with the OS sound                     | none (the system notification sounds, rule 3)                                       | in visible tabs |
| Visible but not in front, or all hidden   | yes                 | shown with the OS sound (silent if alerted, not on Apple) | none (rule 5)                                                                       | in visible tabs |
| A tab in front                            | no                  | n/a                                                       | the sound tab, as in the first row                                                  | in visible tabs |
| Visible but not in front, or all hidden   | no                  | n/a                                                       | the leader if its audio runs, else the newest tab whose audio runs                  | in visible tabs |
| Closed                                    | yes                 | shown with the OS sound, as in 1.10                       | n/a                                                                                 | n/a             |

### Desktop push (system, A: `public/sw.js`, `src/modules/push/{payload,service}.js`)

#### Payload

- `buildPayload(notification, appUrl, { mustShow = false } = {})` → JSON `{ id, userId, title,
body, url }` plus `mustShow: true` only when asked (`userId` = `notification.userId`, a number; no
  `type`, no other personal data; the size stays far under 4 KB).
- **new** `isApplePush(endpoint)` → true when the endpoint's host is `push.apple.com` or ends with
  `.push.apple.com` (Safari's `web.push.apple.com`); a bad URL → false.
- `planDeliveries` builds the payload per subscription: `mustShow: isApplePush(subscription.endpoint)`
  (at most two variants per notification). Nothing else in sending changes.

#### `public/sw.js` `push` (exact rule)

```js
const ASK_MS = 1000;

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(readPush(event)));
});

async function handlePush(data) {
  const id = data.id ? String(data.id) : String(Date.now());
  const title = typeof data.title === 'string' && data.title ? data.title : 'Daybook';
  const mustShow = data.mustShow === true || (await appleSubscription());
  const windows = await daybookWindows().catch(() => []); // matchAll({ type: 'window', includeUncontrolled: true }), same origin
  const answers = await Promise.all(windows.map((client) => askWindow(client, data, mustShow)));
  const shownInFront = windows.some(
    (client, i) => client.focused && client.visibilityState === 'visible' && answers[i].shown,
  );
  if (shownInFront && !mustShow) return; // the page in front shows its own card (CONTRACT 26)
  const silent = !mustShow && answers.some((answer) => answer.alerted); // iOS ignores silent
  await self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: ICON,
    badge: BADGE,
    tag: `daybook-${id}`,
    timestamp: Date.now(),
    data: { url: samePath(data.url) },
    ...(silent ? { silent: true } : {}),
  });
  tellShown(windows, data.id, silent); // each window: { type: 'daybook:notification', os: true, id: id ?? null, silent }, a closed one skipped
}
```

- `askWindow(client, data, mustShow)`: a `MessageChannel`; posts `{ type: 'daybook:notification',
ask: true, id: data.id ?? null, userId: data.userId ?? null, mustShow }` with `port2`; resolves
  `{ shown: reply.shown === true, alerted: reply.alerted === true }` on the first reply, or
  `{ shown: false, alerted: false }` after `ASK_MS` or on any error. All windows are asked at once,
  so a push waits at most 1 s.
- `appleSubscription()`: `self.registration.pushManager.getSubscription()` and `isApplePush`'s host
  test inline (the worker can't import modules); any error → false.
- Everything runs inside `event.waitUntil`. The skip needs **all** of: a window that reports
  `focused` and `visible` in the worker's own snapshot, that window's page answering `shown` within
  1 s (it checked `visibilityState` and `hasFocus()` itself), and a non-Apple subscription. Chrome
  needs only a visible tab, Firefox only an open one (browser.md §3), so the skip is always within
  their rules; Safari always shows. In a rare race the worst cases are one Chrome "This site has been
  updated in the background" notice or one of Firefox's 16 quota points.
- `silent: true` (Chrome 43, Edge 17, Firefox 132, Safari 16.6 on macOS; ignored on iPhone and
  iPad; never with `vibrate`, which Daybook doesn't use) only when a window says this browser
  already alerted it (or is in front with Sound Off), and never with `mustShow`: on Apple the page
  doesn't chime (rule 3), so the system notification keeps its sound there. Otherwise no `silent`,
  so the computer decides the sound as in 1.10. No `renotify`, `requireInteraction` or `actions`.
- `notificationclick`, `install`, `activate`, `fetch`, `openPath`, `askPage` and the existing
  `daybook:open` flow don't change. The old `tellPages()` goes: the ask is the new message, with
  the same `type`, so a page still on the 1.10 bundle reloads its bell on it (and doesn't answer, so
  the notification shows after 1 s, as in 1.10).

### The bell with the live check (shell, B: `NotificationBell.jsx`, `.actions.js`, `.list.js`)

- `useLiveNotifications()` (from **new** `src/components/live/LiveNotifications.jsx`) → null, or the
  store: `{ userId, unread, subscribe(listener) → unsubscribe, setUnread(n), reportRead(ids,
readAt, unreadCount), reportReadAll(readAt), reportHidden(id, hidden), registerBell({ button,
open }) → unregister, setBellOpen(open), markSeen(latestId) }`, plus for the cards and the
  engine `cursor`, `bellOpen`, `hidden`, `hasBell()`, `bellButton()` and `openBell()`. Events to
  listeners: `{ kind: 'items', items }` (every row of an answer, newest first; sent for every
  answer, even an empty one, because the bell re-reads `unread` on each event), `{ kind: 'read',
ids, readAt }`, `{ kind: 'read-all', readAt }`, `{ kind: 'openBell' }`. **new** `markSeen(id)` =
  `cursor = max(cursor, id)`.
- With the store, the bell:
  - drops a load of its own whose answer's `userId` isn't the store's (no list, no count change);
  - when its own load ends while its list is open, calls `markSeen(latestId)` (the plain GET's
    `latestId`), so rows the person just saw in the list never get a card or a chime later;
  - takes `unread` from the store after each answer (the `hidePending` adjustment as for
    `initialUnread`), so the red dot, the count in the button name and the swing ("a higher count
    while the list is closed swings the bell at once") follow the live check on every bell page.
    `initialUnread` from a fresh server render still takes over, as in 1.10;
  - on `items`, when its list is loaded: adds the rows it doesn't have, `hidePending`, sorts as the
    list does (`createdAt` desc, `id` desc), keeps 20. No toast, no announcement, focus untouched:
    the row that holds keyboard focus stays even past 20 (`mergeLiveItems(..., keepId)`, the id
    from `focusedRowId(button)`), so focus never drops to the page; it goes at the next merge
    without focus on it, or the next load.
    `items` that arrive while its first load is in flight are kept and merged when it ends;
  - on `read`/`read-all`: marks those rows read locally (no request);
  - on `openBell`: opens the list as its button does and focuses the button;
  - registers its button (the stack's anchor) and its `open`, reports `setBellOpen` on open and
    close (the `unregister` returned by `registerBell` also sets `bellOpen` to false, so a bell that
    unmounts while open never keeps cards away), `reportHidden(id, true)` when a delete starts its
    Undo and `false` on Undo, and after each of its own writes `setUnread` from the answer's
    `unreadCount` and `reportRead` / `reportReadAll` (so other tabs and the cards follow);
  - drops its own `daybook:notification` listener; keeps its quiet load on open and on coming back
    after 60 s (it refreshes read states changed on other devices).
- Without the store everything is as in 1.10.
- `bellRing` (`useBellRing`) still only switches the swing.
- `BellIcon` is exported (with a `size` prop, default 20) for the cards' tiles.

### My settings (preferences: A owns the keys, C owns the page)

#### Keys (`src/modules/preferences/schemas.js`, A)

- `BELL_SOUNDS = Object.freeze(['important', 'all', 'off'])` and `BELL_TONES =
Object.freeze(['chime', 'bell', 'ding', 'pop'])` (both exported).
- `PREFERENCE_DEFAULTS` gains `bellSound: 'important'`, `bellTone: 'chime'` and `bellPreview: true`
  (after `bellRing`, in that order).
- `PREFERENCE_FIELDS` gains `bellSound: z.enum(BELL_SOUNDS, { error: 'Sound must be Important only,
All or Off.' })`, `bellTone: z.enum(BELL_TONES, { error: 'The sound must be Chime, Soft bell, Ding
or Pop.' })` and `bellPreview: onOff('Show a preview')` ("Show a preview must be on or off.").
- `preferences/service.js`: the `getFor` JSDoc lists the three. Nothing else: `withDefaults`,
  `update`, the `JSON_MERGE_PATCH` save, the 2,048-character body limit (the keys fit easily) and
  the route's 60 a minute stay. **No migration** (map.md §6: a JSON column; only changed keys are
  stored).
- `src/components/UserPrefs.jsx` (A): `useBellSound()` → `'all'` or `'off'` when the stored value is
  one of those, else `'important'`; `useBellTone()` → `'bell'`, `'ding'` or `'pop'` when the stored
  value is one of those, else `'chime'`; `useBellPreview()` → `bellPreview !== false`. (No import of
  the schemas file: it would bring zod into every page.)
- The provider reads them through these hooks; after My settings saves, `router.refresh()` brings
  the new values to this tab (CONTRACT 21), and the `prefs` channel message to the others.

#### The Notifications section (C: `MySettingsSections.jsx`, `sections.js`, `page.module.css`, **new** `PlaySoundButton.jsx`)

In this order:

1. "Ring the bell for unread notifications" (unchanged).
2. **"Sound"**, a `ChoiceRow` (`name="bellSound"`, `choices={SOUND_CHOICES}`): `Segmented` "Important
   only" · "All" · "Off" (`SOUND_CHOICES` in `sections.js`: `[{ value: 'important', label:
'Important only' }, { value: 'all', label: 'All' }, { value: 'off', label: 'Off' }]`). Help: "A
   short sound for new notifications while Daybook is open. Important ones ask you to act, like a
   reminder to check in or a request to approve." No button in this row.
3. **"Choose a sound"** (owner, 23 Nov 2026), a `ChoiceRow` (`name="bellTone"`,
   `choices={TONE_CHOICES}`): `Segmented` "Chime" · "Soft bell" · "Ding" · "Pop" (`TONE_CHOICES` in
   `sections.js`: `[{ value: 'chime', label: 'Chime' }, { value: 'bell', label: 'Soft bell' }, {
value: 'ding', label: 'Ding' }, { value: 'pop', label: 'Pop' }]`). Help: "Pick one to hear it."
   **Picking a sound plays it at once**: the row's change handler calls `playChimeNow(value)`
   synchronously, before the save starts (so the click unlocks the sound), then saves as every
   choice does. Picking the sound already chosen plays it again and saves nothing (`ChoiceRow`'s
   `onPick(value)` runs on every press; a value is saved only when it changed). Beside the
   `Segmented` (same line, gap 12, centred; it wraps under it, at the left, when the card is too
   narrow for both, as on a phone, where the page's `@container (max-width:
360px)` rule makes the `Segmented` full width): **Play sound** (`Button variant="secondary"
size="compact"`, lucide `Volume2` 16 px, `aria-describedby` the help line; 44 px high at 640 px
   and below). `ChoiceRow` gains `id` (names `${id}-label` and `${id}-help`), `onPick` and
   `children`: when given, the `Segmented` and the children sit together in `.soundControls`;
   without them the row is as today. The button calls
   `playChimeNow(tone)` with the chosen sound synchronously in its click handler, before any
   `await` (so it also unlocks the sound for this page), and plays at once, whatever the Sound
   choice (so it can be tried with Off too). `{ played: false }` (from the button or from picking)
   → toast "Couldn't play the sound", body "Your browser didn't let Daybook play it.", tone error;
   a pick is still saved.
4. **"Show a preview"**, a `ToggleRow` (`name="bellPreview"`). Help: "A small card at the top of the
   screen for each new notification. It hides after a few seconds."
5. The existing `PushSwitch` "Show on this computer" (while push is on for the company and
   supported), then under it, only when that row shows, a muted `.note`: "When this is on and
   Daybook is in the background, Daybook doesn't chime. Your computer's settings decide if the
   desktop notification makes a sound, whatever you chose for Sound."

- Saving is the page's existing flow (one PATCH per change, "Saving…" / "Saved", revert and toast
  on failure). After a successful save of `bellSound`, `bellTone` or `bellPreview`,
  `PreferencesProvider.jsx` calls `postPreferenceChange({ [key]: value })` (B's `liveChannel.js`)
  with the value as stored in the answer, inside try/catch (a failed broadcast never reverts a
  save).
- Layout (`page.module.css`): `.soundControls { display: flex; align-items: center; gap: 12px;
flex-wrap: wrap; margin-top: 12px; } .soundControls > .choice { margin-top: 0; } .pushRow +
.note { margin-top: 13.75px; } @media (max-width: 640px) { .soundControls .playSound { height:
var(--control-height); } }` (two classes, so the rule beats `Button`'s compact height whatever
  order the CSS loads in; the `.choice` margin moves to the wrapper, so the button is centred
  on the `Segmented`, which keeps its width; the note's divider sits a row's padding under the
  desktop switch, whose wrapper ends with only 2 px); desktop,
  below 1024 px and 375 px; dark from the tokens. The `loading.js` skeleton gets three more rows in
  Notifications (`SectionSkeleton` `rows`: `'toggle' | 'choice' | 'tone'`; the tone row's choice
  and button skeleton share `.controls` in `loading.module.css`).

### Modules

- `@/modules/notifications` (A):
  - **new** `listAfter(userId, { after, limit = 20 })` → `{ items: [{ id, type, title, body, link,
readAt, createdAt }], more: boolean }`: rows with `id > after`, newest first by `id`, any read
    state, at most `limit` (1 to 50; the repo reads `limit + 1` to set `more`).
  - **new** `latestId(userId)` → the person's highest notification id, or 0.
  - `markAllRead(userId, { ids } = {})` → how many: every unread one as today, or with `ids` only
    those of the person's that are unread (`whereIn`, at most 50). Someone else's ids are ignored.
  - `notify`: the classification check above. Everything else unchanged.
  - repo: `listAfter(userId, afterId, limit)`, `maxId(userId)`, `markAllRead(userId, readAt, ids?)`.
  - `alerts.js` exports as above; `index.js` re-exports `ALERT_TYPES`, `alertLevel`, `isImportant`.
- `@/modules/push` (A): `buildPayload` (`userId`, `mustShow`), `isApplePush`, per-subscription
  payloads.
- `@/modules/preferences` (A): `BELL_SOUNDS`, `BELL_TONES`, three keys.
- `src/components/live/` (B, all **new**, client or pure; no file over 300 lines):
  - `LiveNotifications.jsx`: provider, the status region, the flush (cards, announcement, chime);
    exports `useLiveNotifications`. Split out of it to keep files short: `useLiveEngine.js`
    (`useLiveEngine({ userId, store, callbacks })`, `pageState()`: the page, service worker and
    `prefs` listeners, the unlock listeners, `window.__daybookLive`), `liveTab.js`
    (`createLiveTab(options)`: one tab's engine without React or the DOM: leadership, loop,
    presence, results, batcher, watchdog, the worker's ask), `liveLoop.js` (`createLoop({ run,
nextDelay, setTimer, clearTimer, now, gapMs })` → `{ trigger({ force }), setPeriodic(on), busy(),
stop() }`), `liveSound.js` (`decideChime(...)`: rules 1 to 7 of "When it chimes"), `useStack.js`
    (`useStack({ now, bellButton, onIdle })`: the stack's entries, timing and focus),
    `previewWait.js` (`modalOpen()`, `blockedNow()`, `createWaitWatch(onChange)`: the one
    `MutationObserver`) and `LiveCards.jsx` (the cards' buttons through `usePreviewActions`,
    inside the provider so they reach the store).
  - `liveStore.js` `createLiveStore({ userId, cursor })`; `liveRules.js` `newItems`,
    `nextCursor`, `gapOf({ checkedAt, lastCheckedAt, mountedAt })`, `pollDelay({ anyVisible,
failures, random })`,
    `cardLimit({ width, height })`, `planCards({ stack, batch, preview, visible, bellOpen, wait,
maxCards, now })` (`wait` = a modal or list is open or the stack is paused), `pickSoundTab({
presences, selfId, selfAudio, frontTabId })`, `shouldChime({ choice, batch, osSound, gapMs,
tabId, soundTabId, frontTabId, push })` (rules 1 to 5; `push` = `{ active, apple }`),
    `announcement(batch)`, `summaryTitle(count, more)`, `summaryMore(count, more)`,
    `seeLabel(count, maxCards, hasBell)`, constants `VISIBLE_MS = 30000`, `HIDDEN_MS = 60000`,
    `MAX_BACKOFF_MS = 300000`, `CHECK_GAP_MS = 5000`, `WATCHDOG_MS = 75000`, `STALE_GAP_MS =
150000`, `MAX_CARDS = 3`, `MAX_CARDS_PHONE = 2`, `MAX_CARDS_SHORT = 1`, `SHORT_WINDOW_PX = 500`,
    `CARD_MS = 6000`, `RESUME_MIN_MS = 2000`, `QUEUE_MAX_AGE_MS = 300000`; also `pickFrontTab({
presences, selfId, selfFront })`, `entriesFor(batch, now)`, `queueBatch(queue, batch, now)`,
    `releaseQueue(queue, now)`, `PHONE_MAX_PX = 640` and `SUMMARY_FROM = 3`.
  - `liveCheck.js` `checkOnce({ fetch, after, signal, timeoutMs = CHECK_TIMEOUT_MS, setTimer,
clearTimer })` → `{ ok: true, answer }` | `{ stop: true }` | `{ retry: true }` (plain `fetch`,
    never `api`; it never touches `window.location`; 20 s at most). `liveRules.js` also exports
    `CHECK_TIMEOUT_MS = 20000`.
  - `livePresence.js` `createPresences({ now, selfId })` → `{ apply(message), all(), fresh(),
anyVisible(), anyAudio(), pick({ self, fallback }) }` (`apply` is true for a `tabId` it didn't
    know; `pick` gives a result's `frontTabId` and `soundTabId`). `liveTab.js`'s engine also has
    `frozen()` (`freeze`: posts `gone`).
  - `liveBatch.js` `createBatcher({ windowMs, onFlush, setTimer, clearTimer, now })`,
    `BATCH_WINDOW_MS`.
  - `liveLeader.js` `startLeadership({ userId, locks, channelFactory, onLead, onFollow, onMessage
})` → `{ isLeader(), isFallback(), post(message), takeLead(), stop() }` (`takeLead` = the
    watchdog's steal; `onFollow` = the lead was stolen; fakes injected in tests).
  - `liveChannel.js` channel names (`liveName(userId)`, `chimeLockName(userId)`, `PREFS_CHANNEL`),
    message builders, `openChannel(name, factory)` (one object per name per tab),
    `postPreferenceChange(values)`, `onPreferenceChange(listener)` → unsubscribe (this tab's own
    saves) and `setPreferenceUser(userId)` (the provider names the person for `prefs` messages).
  - `swAnswer.js` `answerPush({ data, userId, cursor, inFront, running, canSound, preview,
bellOpen, choice, alertedIds, pendingIds })` → `{ shown, alerted, osSound }`.
  - `pushActive.js` `desktopPushActive({ pushConfigured, timeoutMs = 500 })` → `Promise<{ active,
apple }>`, and `isAppleEndpoint(endpoint)` (the host test of `isApplePush`; a client can't
    import the module).
  - `chime.js` `TONES`, `TONE_NAMES`, `CHIME`, `scheduleChime(ctx, t0, tone)` → `{ master,
endsAt }`, `createChimePlayer(win)` (tests), `getChimePlayer()` (`unlock(event)`, `ready()`,
    `play({ ids, tone })`, `playNow(tone)`, `state()`, `onState(listener)`, `listen(on)`: the
    provider turns the unlock listeners on while Sound isn't Off), `playChimeNow(tone)`;
    `chimeGate.js` `readRecord(userId, storage)`, `claimChime({ userId, ids, now, storage,
minGapMs })` → `'play' | 'too_soon' | 'done_elsewhere'` (looks at `chimed` only, writes
    `chimed`), `markAlerted({ userId, ids, now, storage })` (writes `shown`), `alertedIds({ userId,
now, storage })` → `Set` (either list), `isAlerted(...)` (either list), `withChimeLock(locks,
name, fn)` (the `daybook-chime-<userId>` lock, or at once without locks), `CHIME_MIN_GAP_MS =
10000`.
  - `PreviewStack.jsx` (+ `PreviewStack.module.css`; also exports `placement(bell)` and
    `listHandlers(stack)`, the `<ol>`'s pause handlers), `PreviewCard.jsx` (single and summary),
    `usePreviewActions.js` (`open(item, event)`, `markRead(item)`, `markMany(ids)`, `markAll()`:
    a summary's "Mark all as read" past 20; `markMany(null)` = `markAll()`; each save resolves
    true when it worked; also `newestIds(ids)` and `MARK_MANY_MAX = 50`).
- The bell side (B): `NotificationBell.list.js` `itemTime(item, tz, today)` (the bell row and the
  cards), `mergeLiveItems`, `setManyRead`, `sameUser`, `storeUnread`, `createLiveBuffer`,
  `readResponse`, `byNewest`, `BELL_LIMIT = 20`; `NotificationBell.actions.js` `followLink({ item,
event, saving, router, onNavigate })`, `itemPath(id)`, `SAVE_BEFORE_NAVIGATE_MS`,
  `requestBellReload()`, `onBellReload(listener)`, `useUndoFocus`; **new**
  `NotificationBell.live.js` `useBellLive(...)` (the bell's store wiring, split out to keep the
  bell under 300 lines) and `focusedRowId(button, doc)`; `NotificationItem.jsx` uses `itemTime`.
- **Import cycles** (harmless): `NotificationBell.jsx` → `LiveNotifications.jsx` → `LiveCards.jsx`
  → `PreviewStack.jsx` → `PreviewCard.jsx` → `NotificationBell.jsx` (`BellIcon`), and
  `LiveCards.jsx` → `usePreviewActions.js` → `LiveNotifications.jsx`. Every binding in them is used
  at render time only; never use one at module load.

### API (owner: system)

| Route                                              | Permission  | Body / returns                                                                                                                                   | Errors and limits                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| existing `GET /api/notifications`                  | `signed_in` | as today `{ items (newest 20), unreadCount }` plus `latestId` and `userId`                                                                       | unchanged (no rate limit; `?limit` still ignored)                                                                                                                                                                                                                                |
| `GET /api/notifications?after=<id>`                | `signed_in` | `{ userId, items, more, unreadCount, latestId }`: `items` = `listAfter(..., { after, limit: 20 })`; `latestId` = `max(after, items[0]?.id ?? 0)` | `after` a whole number from 0 (`z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)`), else 400 `VALIDATION_FAILED` `fields.after` "Use a notification id." (an empty `after=` reads as 0); 120 a minute per person → 429 `RATE_LIMITED`, counted before `after` is read |
| existing `POST /api/notifications/read-all`        | `signed_in` | `{}` (all, as today) or `{ ids: [1 to 50 positive ids] }` → `{ marked, unreadCount }` (`0` for all; the fresh count with `ids`)                  | `ids` empty, over 50 or not ids (each must be a positive whole JSON number: `'5'`, `0`, `1.5` and `null` are refused) → 400 `fields.ids` "Pick 1 to 50 notifications."; unknown fields still ignored                                                                             |
| existing `PATCH`, `DELETE /api/notifications/[id]` | `signed_in` | unchanged                                                                                                                                        | unchanged                                                                                                                                                                                                                                                                        |

- `GET /api/notifications` (both forms) becomes `withRoute({ permission: 'signed_in', logLevel:
'debug' }, ...)`, like `api/activity/heartbeat/route.js`: successes log at debug (dropped at the
  production `LOG_LEVEL=info`); 4xx, 429 and 5xx still log at info.
- The `after` branch counts ``checkRateLimit({ key: 'notifications-live', limit: 120, windowMs:
60_000 }, ROUTE, `user:${user.id}`)`` first (per person: the office shares one IP), as
  `api/me/preferences/route.js` does. 120 covers a browser in fallback mode with several tabs.
- `latestId` without `after` is `notifications.latestId(user.id)` (one more indexed read); with
  `after` it comes from the items, so the live check is two queries: `listAfter` and `unreadCount`,
  run in parallel. `userId` is the session's.
- Answers are dynamic (they read the session cookie); nothing is cached.
- No new route, so CONTRACT §7 doesn't change.

### Limits

- Live check: 20 items per answer (`more` beyond), every 30 s visible / 60 s hidden ±10%, at most one
  per 5 s, backoff to 5 minutes, 120 a minute per person on the server.
- Batch window 1.5 s. Stack 3 entries (2 on a phone, 1 in a window under 500 px high). Card 6 s, at
  least 2 s after a pause or after a modal closes. Queue (behind a modal, an open list or a paused
  stack) 5 minutes by the tab's clock. Summary from 3 items. Mark these as read at most 50 ids.
- Sounds 0.14 to 1.22 s (Chime about 0.65 s), master gain 0.14 to 0.20, at most one per 10 s per
  browser, never for a batch found
  more than 150 s after the previous check. Service worker waits at most 1 s for windows.
- Alerted record: `chimed` and `shown`, 50 ids each, 10 minutes.

### Hosting and cost

- **Requests.** About 40 people, most with one browser and 1 to 2 Daybook tabs: one leader per
  browser, so about 2 live checks a minute per person during the day and 1 a minute with Daybook in
  the background, plus one per tab switch back to Daybook and one per desktop push. About 80 to 120
  requests a minute for the company, 1.5 to 2 a second at peak; at night, open tabs left hidden make
  about 40 a minute. Each is the session read plus two small indexed queries, answered in
  milliseconds. For scale: the Today and Team pages already `router.refresh()` the whole page every
  60 s while visible (CONTRACT 15, AutoRefresh), which costs far more per request.
- **Logs.** The live check's successes log at debug (API, above), so the production log doesn't
  grow by about 100,000 lines a day; errors still show.
- **cPanel, LiteSpeed.** Short requests only: no Server-Sent Events, no WebSockets and no long
  polling, so no connection holds a Node process (the host's process and thread limits,
  `daybook-hosting`). No new worker job, no new cron line; the push worker is unchanged (every 10 s
  inside the once-a-minute cron run). The rate limit is in memory per web process (as every Daybook
  limit).
- **No new npm dependency, no migration, no new environment variable.** Deploy = `git pull origin
deploy`, then Restart in Setup Node.js App (no migrate line, nothing to install). Browsers fetch the
  new `sw.js` on their next navigation (it already calls `skipWaiting` and `clients.claim`).
- **Order during a deploy.** Pages still on the 1.10 bundle have no live check and don't answer the
  worker, so their desktop notifications show after at most 1 s, as before; they get 1.11 on their
  next full load.

### Files and owners

Three builders and the orchestrator; a file listed for one builder is edited only by that builder.
Where a builder needs another's piece that isn't there yet, it codes against the API in this section
and adds a stub with that signature (the §6 stub rule); the owner replaces it.

| Owner                      | Builder              | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orchestrator               | O                    | `docs/design/bell-preview-prototype.html` (first), `src/config/version.js` ('1.11'), `README.md` (below) and `tests/unit/hostScripts.test.js` (its "1.11 steps" check), `docs/CONTRACT.md` (this section and "Other section edits")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| system, preferences, shell | A (server and push)  | `src/modules/notifications/alerts.js` (new), `src/modules/notifications/{repo,service,schemas,index}.js`; `src/app/api/notifications/route.js`, `src/app/api/notifications/read-all/route.js`; `src/modules/push/{payload,service}.js`; `public/sw.js`; `src/modules/preferences/{schemas,service}.js`; `src/components/UserPrefs.jsx`; `tests/unit/{notificationAlerts,serviceWorker}.test.js` (new), `tests/unit/push.test.js`; `tests/services/notificationsLive.test.js` (new), `tests/services/{notifications,notificationsCenter,push,preferences,preferencesRoute}.test.js`                                                                                                                                                                                                                                                    |
| shell                      | B (live bell)        | `src/components/live/{LiveNotifications,LiveCards,PreviewStack,PreviewCard}.jsx` and `PreviewStack.module.css` (new), `src/components/live/{liveStore,liveRules,liveCheck,liveBatch,liveLeader,liveLoop,livePresence,liveTab,liveSound,liveChannel,swAnswer,pushActive,chime,chimeGate,previewWait,useLiveEngine,useStack,usePreviewActions}.js` (new); `src/components/AppFrame.jsx`; `src/components/NotificationBell.jsx` (also exports `BellIcon`), `NotificationBell.actions.js`, `NotificationBell.list.js` (`itemTime`), `NotificationBell.live.js` (new), `NotificationItem.jsx` (uses `itemTime`); `tests/unit/{liveRules,liveBatch,liveLeader,liveChime,liveRecovery,liveStack,livePlacement,appFrameLive}.test.js` (new), `tests/helpers/liveFakes.js` (new), `tests/unit/notificationCenter.test.js` (merge of new items) |
| preferences, orchestrator  | C (settings and e2e) | `src/app/(app)/my-settings/{MySettingsSections.jsx,sections.js,page.module.css,PreferencesProvider.jsx,loading.js,loading.module.css}`, `PlaySoundButton.jsx` (new); `tests/unit/mySettings.test.js`; `tests/e2e/live-notifications.spec.js` (new), `tests/e2e/my-settings.spec.js`, `tests/e2e/support/live.js` (new), `tests/e2e/support/demoData.js` (`addNotification`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Contracts the others code against: A's `notifications.latestId(userId)` (B's AppFrame), the API above
(B), `useBellSound()` / `useBellTone()` / `useBellPreview()` (B); B's `playChimeNow(tone)` →
`Promise<{ played }>`,
`postPreferenceChange(values)`, `window.__daybookLive.checkNow()` → `Promise<void>`, the
`window.__daybookChime(info)` hook and the region and button names (C); C's `ChoiceRow` `children`
slot is C's own. No file is touched outside this table: `TopBar.jsx` (the stack reads its `<header>`
box only), `ServiceWorker.jsx`, `PushSwitch.jsx`, `NotificationBell.push.js`,
`ToastProvider.jsx`, `Dialog.jsx` and `Drawer.jsx` don't change.

**README** (O). (a) "Deployment notes": "Daybook 1.11 (bell sound and preview): no database update
and nothing new to install. People choose the sound and the preview in My settings; the default is a
chime for important notifications only. Each person can also pick the sound: Chime, Soft bell,
Ding or Pop." (b) "Updating", for 1.11: "1. `git pull origin deploy`. 2. Press Restart. There is no
migrate line this time."

### Tests and version

- **Unit** (node only, no DOM; fakes for every browser API):
  - `tests/unit/notificationAlerts.test.js` (A): `ALERT_TYPES` has exactly the 43 types of the
    table (the list is written out in the test) with their levels, 19 important; every type's prefix
    has a group; `alertLevel`/`alertGroup` for an unknown type; `assertClassified('made.up')` throws
    and names CONTRACT 26. **Source scan**: every `.js`/`.jsx` file under `src/`, `scripts/` and
    `db/demo/` (not tests). On each line that contains `type:` (anywhere on the line, so both sides
    of a ternary count) or `TYPE =`, every quoted string matching `/^[a-z_]+\.[a-z_]+$/` must be in
    `ALERT_TYPES`, and every template literal with a dotted prefix (`` `prefix.${...}` ``) must be
    in the test's `TEMPLATES` table with its file and its expansions, and each expansion must be
    classified. Each `TEMPLATES` entry must also be found in its file (both ways, so the table can't
    go stale). Today there are four: `attendance.remind_${kind}` with `REMIND_KINDS`
    (`attendance/reminderMessages.js:105`, inside a ternary with `'attendance.checkin_reminder'`),
    `attendance_correction.${verdict}` approved and rejected (`attendance/decisions.js`),
    `wfh_request.${verdict}` approved and declined (`attendance/wfhDecisions.js`) and
    `project_request.${...}` approved and declined (`projects/messages.js`). A new type (literal or
    template) fails the test until it is classified. A type passed only through a variable is caught
    by the `notify` guard in that module's service test, not by the scan.
  - `tests/unit/serviceWorker.test.js` (A): loads `public/sw.js` into `node:vm` with a fake `self`,
    `clients`, `registration` and `MessageChannel`, then fires `push`: a focused visible window
    answering `shown` → no `showNotification`, and no message without a port; a focused window
    answering `shown` with `mustShow` (payload, or an Apple subscription) → shown; no answer in 1 s
    (fake timers) → shown without `silent`; a visible unfocused window answering `shown` → shown; an
    answer `alerted` → `silent: true`, but never with `mustShow` (Apple); every window asked with `{ ask, id, userId, mustShow }` and
    told `{ os: true, silent }` after; a payload without `userId` → shown; `tag` and `data.url` as in
    1.10; `notificationclick` unchanged.
  - `tests/unit/push.test.js` (A): `buildPayload` gives `userId`, `mustShow` only when true, the
    clipping as before; `isApplePush` (web.push.apple.com yes, fcm.googleapis.com and
    wns2-*.notify.windows.com no, a bad URL no).
  - `tests/unit/liveRules.test.js` (B): **cursor**: the first answer with a null cursor alerts
    nothing; ids at or below the cursor never; read items never, yet the cursor rises to `latestId`;
    hidden (Undo pending) never; an older item marked unread again never; the cursor never goes
    down. `gapOf`: a follower that handled a result 30 s ago and then becomes leader is not stale on
    its first check; a tab that handled none counts from its mount. `pollDelay`: 30 s visible, 60 s
    hidden, the 0.9 to 1.1 factor (injected `random`), doubling to 300 s. `cardLimit`: 3, 2 at 640 px
    and narrower, 1 under 500 px high. `planCards`: 1 and 2 give cards newest on top, 3 give one
    summary, a fourth entry pushes the oldest out (2 on a phone), preview off and hidden tab give
    none, bell open gives none, `wait` (a modal, an open search list, a paused stack) queues, a
    paused stack queues a new entry and it shows on resume, queued items from several batches are
    released as one batch (3 or more → one summary), the queue drops an item 5 minutes after it was
    queued by the tab's clock (a `createdAt` far in the past or future changes nothing).
    `pickSoundTab`: the front tab with audio; a front tab without audio and a hidden tab with audio
    → the hidden one; no front tab, the checking tab without audio and a hidden follower with audio
    → the follower. `shouldChime`: every reason in order (off, not_important, os, os for an Apple
    subscription, stale, not_sound_tab for a tab that isn't `soundTabId`, no front tab with push
    active; play for the sound tab). `announcement(batch)` for 1, 2, 3 and `more` ("New
    notification: …", "2 new notifications. The newest: …", "More than 20 new notifications. The
    newest: …"), the summary copy ("3 new notifications", "and 2 more", "More than 20 new
    notifications", "and more") and `seeLabel` ("See them" for 3 of 3, "See the newest 3" for 5,
    "See the newest 2" on a phone, none for a limit of 1 without a bell, "See them" with a bell).
  - `tests/unit/liveBatch.test.js` (B, fake timers): items within 1.5 s form one batch; one at
    1.6 s starts the next; read or hidden ones are dropped at flush; a `read-all` drops every item
    learned before it, in the batch and in the queue; an empty batch never flushes.
  - `tests/unit/liveLeader.test.js` (B): a fake `navigator.locks` (FIFO, with `steal`) and an
    in-memory `BroadcastChannel` bus that, like the real one, never echoes to the sender, with
    three tabs: the first leads and is the only one that fetches; with a single tab, the leader's
    own check reaches its store; results reach the others; `check-now` is coalesced to one check per
    5 s; triggers during a check in flight give one more check after it, never two in parallel; the
    leader stops → the next tab leads and checks at once; `checkOnce` with a 401 stops the loop,
    releases the lock and never touches `window.location`; a 400, 404 or network error backs off; a
    result for another `userId` leaves the store, cursor and batcher untouched, posts nothing and
    stops the tab; a frozen leader (a fake that never answers) loses the lock to the visible tab's
    watchdog after 75 s, that tab then checks every 30 s, and the old leader asks again as a
    follower after its `AbortError`; without locks every tab polls and `claimChime` lets only one
    chime; `answerPush` (front and new → shown; already had at load → not shown; an id in the open
    batch or the queue → shown, not `osSound`; another user → not shown; preview off with the list
    closed → not shown and `osSound`; in front, preview off, Sound Off → not shown, `alerted`
    (silent); a follower with no result for 75 s → not shown; `mustShow` → `osSound` unless alerted;
    a hidden tab → no `osSound`); a tab that answered `shown` checks at once even as a follower.
  - `tests/unit/liveChime.test.js` (B): `scheduleChime` against a fake `AudioContext` that records
    calls: four sine oscillators at 659.25, 1318.5, 987.77 and 1975.54 Hz (`hz * ratio`, compared
    to 0.01 Hz), starts at `t0` and `t0 + 0.12`, each envelope `0 → 1` linear in 10 ms and exponential to 0.001 (0.50 s notes, 0.25 s
    overtones), stops at `+0.52`, master 0.16, nothing ramps exponentially to 0; for each of
    `bell`, `ding` and `pop`, the oscillators, gains, decays, stop times and master of the `TONES`
    table (Pop's frequency ramps exponentially from 880 to 440 by `+0.08`); `TONE_NAMES` equals
    `Object.keys(TONES)`; every tone's partial gains × master sum under 0.5 and its `stopAfter` is
    at least its longest decay; an unknown tone plays Chime; `play({ tone: 'ding' })` and
    `playChimeNow('pop')` schedule that sound and pass `tone` to the test hook; the player creates no
    context before a gesture; a touch `pointerdown` without activation creates no context, the
    `pointerup` after it does, and an untrusted click is ignored; `unlock` runs again on a later
    event while the context isn't running; `ready()` with a `resume()` that never settles is false
    after 300 ms (fake timers) and never makes a sound; `onstatechange` to `interrupted` adds the
    unlock listeners back; `playChimeNow()` with a fake context that reports `'suspended'`
    synchronously and turns `'running'` on the next tick resolves `{ played: true }`, and with one
    that never runs resolves `{ played: false }` and disconnects the master gain; the
    `window.__daybookChime` hook gets `{ reason, ids, tone }` and no context is made; `claimChime`:
    `too_soon` within 10 s and `play` at 10 s (fake timers), `done_elsewhere` for an id in `chimed`,
    `play` for ids that a card of the same flush marked `shown`, a storage that throws falls back to
    memory, each list keeps 50 ids and drops ones older than 10 minutes.
  - `tests/unit/notificationCenter.test.js` (B): merging live items into a loaded list (no
    duplicates, pending delete stays hidden, order, 20 kept, the row holding focus kept past 20,
    items that came during the first load merged after it); `focusedRowId`; `itemTime`.
  - `tests/unit/liveRecovery.test.js` (B, the fakes of `tests/helpers/liveFakes.js`, which
    `liveLeader.test.js` shares): a check that never answers gives up after 20 s, aborts the
    request, backs off and lets the triggers behind it run; two visible tabs with failing checks
    take the lead at most once per 75 s; a hidden follower whose audio runs is still the sound tab
    after 2 minutes hidden; a tab opened later learns an older hidden tab's audio at once; a frozen
    tab isn't counted until it resumes; the ask from a tab in front with no audio anywhere isn't
    `shown` (`osSound`), with its own audio, Sound Off or a hidden tab's audio it is.
  - `tests/unit/liveStack.test.js` (B, the real `useStack` and `LiveCards`): See them without a
    bell keeps the pointer's pause and the queue, the limit (3, and 2 on a phone), leaves out items
    read meanwhile and sends keyboard focus back to where it came from (also when the browser fires
    `focusout` as the summary's button goes); focus going back uses `preventScroll`.
  - `tests/unit/livePlacement.test.js` (B): `placement` without a bell at 1440 to 641 px with a
    15 px scrollbar (32 px from 1024, 24 below), on a phone and with a bell; `listHandlers`: no
    pause from `pointerenter`, a pause from `pointermove` or `pointerdown` until `pointerleave`, and
    from focus.
  - `tests/unit/appFrameLive.test.js` (B): AppFrame keys `LiveNotifications` by the person, with
    their own `latestId`.
  - `tests/unit/mySettings.test.js` (C): `SOUND_CHOICES` values equal `BELL_SOUNDS`, labels
    "Important only", "All", "Off"; `TONE_CHOICES` values equal `BELL_TONES` and `TONE_NAMES`,
    labels "Chime", "Soft bell", "Ding", "Pop".
- **Services** (A; `DB_NAME=daybook_test_<n>`, `resetDatabase()`, `createUser`, `setNowForTests`):
  - `tests/services/notificationsLive.test.js` (new): `?after` returns only the person's rows above
    it, newest first by id, read ones included with `readAt`, at most 20 with `more` (25 rows),
    `latestId` and `unreadCount`; `after=0`; `after` above every id → `[]` and `latestId` = `after`;
    `after=-1`, `abc` and `1.5` → 400 with `fields.after`; someone else's rows never; `userId` is the
    session's; signed out → 401; the 121st call in a minute → 429 and another person isn't counted;
    plain GET gains `latestId` and `userId`; `read-all` with `ids` marks only those (and ignores
    someone else's and read ones), answers the fresh count, `[]` and 51 ids → 400 with `fields.ids`,
    `{}` and no body mark all as before; `notify` with an unclassified type throws under Vitest and
    a classified one writes as before; with `VITEST` removed for two calls (try/finally), `notify`
    with type `made.up` writes both rows, returns their count, and calls `logger.warn({ type:
'made.up' }, 'notification type has no alert level')` exactly once; a successful `?after` call
    logs at debug and a 400 at info (a spy on `logger`).
  - `tests/services/notifications.test.js`, `notificationsCenter.test.js`: the `type: 'test'`
    notifications that have recipients become `'system.test'` because of the guard (the calls with
    no recipients return before it; `runOnce.test.js` inserts rows directly and is unaffected).
  - `tests/services/push.test.js`: `sendPending` gives an Apple endpoint `mustShow: true` and others
    none, every payload has `userId`.
  - `tests/services/preferences.test.js`, `preferencesRoute.test.js`: `DEFAULTS` gain `bellSound:
'important'`, `bellTone: 'chime'` and `bellPreview: true`; `bellSound: 'loud'` → "Sound must be
    Important only, All or Off."; `bellTone: 'siren'` → "The sound must be Chime, Soft bell, Ding or
    Pop."; `bellPreview: 'yes'` → "Show a preview must be on or off."; `'all'` and `'off'` are
    stored, `'important'` removes the key; `'ding'` is stored, `'chime'` removes the key; a stored
    stale value reads the default.
- **E2E** (C): `tests/e2e/live-notifications.spec.js`, as Vishal Saini, against the e2e server and
  database only (never localhost:3000 or the "daybook" database). `page.addInitScript` defines
  `window.__daybookChimes = []` and `window.__daybookChime = (info) => window.__daybookChimes.push(info)`;
  `tests/e2e/support/live.js` gives `addNotification(email, { type, title, body?, link? })` (through
  `demoData.js`, a direct insert into the e2e database), `checkNow(page)` (`window.__daybookLive
.checkNow()` then 1.6 s for the batch), `chimes(page)`, `preview(page)` (`getByRole('region', {
name: 'New notifications' })`) and `waitChimeGap(page)` (waits until 10 s after the last recorded
  chime, so a step that expects a chime never meets `CHIME_MIN_GAP_MS`).
  1. **First load**: Today with Vishal's demo notifications unread: after 3 s and a `checkNow`, no
     region and no chime.
  2. **One important**: add `attendance.remind_check_in` "Neha Kapoor reminded you to check in" with
     its body and `/today`; `checkNow`: one card with that title, the body, "Today at …", Open,
     Mark as read and Dismiss; the status region says "New notification: Neha Kapoor reminded you to
     check in"; `chimes` is 1 (`reason: 'batch'`); the bell's name says one more unread.
  3. **Mark as read**: the card goes, the bell count goes down by 1, the API shows it read.
  4. **Normal and Dismiss**: add `leave.marked`: a card, `chimes` still 1 (Important only); Dismiss:
     it goes and stays unread.
  5. **Summary**: add three at once (one important): one card "3 new notifications", "and 2 more",
     `chimes` +1; See them opens the bell list with the three on top and no card left.
  6. **Open**: add one with link `/log`; Open → on `/log`, the item is read. Add another: its card's
     top is 8 px below the top bar's bottom and its right edge is 32 px from the window's right edge
     (My log has no bell).
  7. **Pause**: hover a card for 8 s: still there; move away: gone within 3 s.
  8. **Bell list open**: open the list, add one: no card, the list shows it on top, and the status
     region says "New notification: …".
  9. **Two tabs**: a second page in the same context; add one important: cards in both, the sum of
     both pages' `chimes` grows by exactly 1.
  10. **My settings**: Notifications shows Sound with "Important only" pressed, Choose a sound with
      "Chime" pressed, Play sound (click → `chimes` +1, `reason: 'test'`, `tone: 'chime'`) and Show
      a preview on; pick "Ding": `chimes` +1 with `reason: 'test'` and `tone: 'ding'`, "Ding" stays
      pressed after a reload, and after `waitChimeGap` an important one added and `checkNow`
      chimes with `tone: 'ding'`; add a normal one, then switch "Ring the
      bell" off and on (each save refreshes the page, so AppFrame renders a higher `latestId`), then
      `checkNow`: its card shows. Choose Off, add an important one: a card, no chime; choose All and
      switch Show a preview off: add a normal one: no card, `chimes` +1. Put the defaults back (Chime too).
  11. **Phone** (390 × 844): a card's box is `x = 16`, width 358, near the top; Open, Mark as read and
      Dismiss pass `expectTapSize`; with three added one after another (a `checkNow` each), at most 2
      cards show.
  12. No console or page errors (`problemsOf`) in any step.
  - `tests/e2e/my-settings.spec.js`: the Notifications region lists the new rows (names and help,
    the copy above, the note under the desktop switch where it shows).
  - The e2e server has no VAPID keys, so desktop push is never active there; the worker side is
    covered by the unit and service tests above. Real-browser checks (manual, before the release, on
    the e2e copy or the live site after deploy): browser.md §9 items 1, 3, 4, 6, 7 and 8.
- **Screens** (B and C), never against localhost:3000 or the "daybook" database. The card states
  (Today with one card, the stack of three, the summary, the Report page with a card, the open bell
  list with a new item) are taken on the e2e server (a copy of the project on port 3100 with
  `daybook_e2e`, as every e2e run): a throwaway Playwright script in `scratch/design-1.11/tmp/` uses
  `tests/e2e/support/live.js` (`addNotification`, `checkNow`), holds the stack with the pointer
  over the card's title, and calls `page.screenshot` in light and dark (`page.emulateMedia({
colorScheme })`) at 1440, 1024 and 390 px; then `compare.py` against the prototype's artboards.
  My settings → Notifications uses `shot.mjs --base <that e2e URL>`.
- `APP_VERSION` '1.11' (O).

### Order of work

1. **O first**: the prototype; then version '1.11'.
2. **A**: `alerts.js` and the `notify` guard (with the `'test'` type fixes), `listAfter`,
   `latestId`, the routes, `read-all` ids, the preference keys and hooks, the payload and `sw.js`,
   with their tests.
3. **B and C in parallel**, each in its own files: B against A's API (stubs until it lands), C
   against B's `playChimeNow`, `postPreferenceChange` and the test hooks.
4. **O last**: README, the CONTRACT edits below, review, the e2e run (C's specs) and the build.

### Choices made in this section (for the owner to confirm)

1. **Endpoint**: the existing `GET /api/notifications` with `?after=<id>`, not a new route: same rows,
   same permission, the bell already calls it, and the cursor is the row id (ids only grow, so
   nothing is repeated even when clocks differ; for the rare late commit, see Risks).
2. **One checker per browser**: the leader tab checks and shares; 30 s while any Daybook tab is
   visible, 60 s while all are hidden, at once after a desktop push or when a tab comes back.
3. **Important** = asks the reader to act today; 19 of the 43 types (table). Task notifications
   (`project_task.*`) are not important, so a PM adding many tasks doesn't chime for the whole team.
4. **Own-action notifications** (`report_edit.sent`, `attendance.break_over_allowance`) get a card
   like every other one (the owner's "every new notification") and chime only under All.
5. **Sounds**: four synthesized sounds the person picks (Chime, the default: two soft notes, E5
   then B5 with a quiet octave, about 0.65 s; Soft bell; Ding; Pop); one per batch, at most one
   every 10 s, none for items found after the browser slept more than 150 s.
6. **Desktop push**: no system pop-up while a Daybook window is in front and shows its own card
   (never on Safari); a system notification for something already alerted, or that comes while a
   Daybook window is in front with Sound Off, is silent (not on Apple); when Daybook isn't in front,
   desktop notifications sound as the computer decides, whatever the Sound choice (the note says
   so).
7. **Cards** show only in visible tabs, wait (up to 5 minutes) while a dialog, a drawer or a list of
   suggestions such as the search results is open and while the pointer or focus is on the stack,
   hide if one of those opens over them, and a summary's "See them" opens the bell list, or on a
   page without a bell shows the newest three (two on a phone). Escape anywhere closes them.
8. **Show a preview off** also turns off the screen reader announcement; the bell's count still
   changes.
9. **Play sound** plays even when Sound is Off, so the sound can be heard before choosing; picking
   a sound in "Choose a sound" also plays it.
10. **Per browser**: two browsers or two devices each alert (one tab each).

### Risks to watch

- **Chrome on a Mac** never sets a sound on web notifications (browser.md §4): with desktop push on
  and Daybook in the background, a Mac user hears nothing. A later release could chime from the
  leader tab and show the system notification silent there.
- **iPhone and Android** freeze background pages: no live check, no chime there until the page comes
  back (then cards show, without sound, for items found after a long gap). Desktop push covers them.
- **Edge sleeping tabs and Chrome Memory Saver** can still freeze or discard a hidden leader; the
  watchdog (which takes the lead) and the check after a `shown` answer only help while another tab
  is visible. A person who wants sound with every Daybook tab hidden should turn on "Show on this
  computer". A hidden tab discarded without a `freeze` event stays known as a tab whose audio runs
  (presences are kept until `gone`) until the others reload; a batch it would sound for then gets
  its cards without a chime.
- **A late commit**: `notify` runs inside the caller's transaction, so a row whose transaction
  commits after a newer one (two check-ins at the same moment, for HR's `attendance.unverified_office`)
  can be passed by the cursor and miss its card and chime. It is still in the bell, and the unread
  count includes it. The window is a few milliseconds, so this is rare.
- **Focus detection**: `hasFocus()` is false while DevTools or another app has focus, and a window
  on a second monitor is visible without focus: then the system notification shows and the page
  doesn't chime. Windows Focus Assist mutes system sounds but not Web Audio.
- **Browser settings**: a site set to "Block audio" (Firefox) or a muted tab makes no sound; the card
  still shows.
- **Two sounds in a race**: if focus leaves Daybook between the page's answer and the worker's
  decision, the `os` message usually stops the page's chime within the 1.5 s batch; a page that had
  already chimed makes the system notification silent through the alerted record. Rarely, both may
  sound.
- **The type guard** throws in tests only; a module that creates a new type without a service test
  would log a warning in production instead of failing. The source scan covers literal and template
  types on any line with `type:` or `TYPE =`, ternaries included.
- **Cost** grows with open tabs at night (one check a minute per browser). If it ever matters, a
  later release can slow hidden checks after an hour.
- The rate limit and the leader are per process and per browser: with more than one web process the
  120 a minute is counted per process.

### Other section edits

- **§6, notifications** (replace the `listForUser` bullet):
  "- `listForUser(userId, { limit = 20 })` → `[{ id, type, title, body, link, readAt, createdAt }]`,
  `unreadCount(userId)`, `markAllRead(userId, { ids? })` (only those ids when given, CONTRACT 26),
  `deleteOldRead(before)`; `listAfter(userId, { after, limit = 20 })` → `{ items, more }` and
  `latestId(userId)` for the live check (CONTRACT 26). `notify` needs a type listed in
  `ALERT_TYPES` (`@/modules/notifications/alerts`): unlisted types throw in tests and log a warning
  in production."
- **§7**: no change (no new route; `GET /api/notifications` takes `after`, `read-all` takes `ids`).
- **§8, shell** (TopBar bullet, replace "`bell` renders `NotificationBell` (client: latest 20, "Mark
  all as read", each item links to its screen)" with): "`bell` renders `NotificationBell` (client:
  latest 20, "Mark all as read", each item links to its screen; it follows the live check through
  `useLiveNotifications()`, CONTRACT 26)". **Add** after `ToastProvider`: "- `LiveNotifications`
  (client, mounted once in AppFrame around AppShell) — `{ userId, latestId, tz, push, children }`:
  the live check, the preview cards ("New notifications" region, at most 3, 2 on a phone, z-index 65) and the
  chime (CONTRACT 26); `useLiveNotifications()` returns its store, or null outside it."
- **§9**: add the owner rows of "Files and owners" above with "(CONTRACT 26)".
- **§14** (replace the first sentence): "Every bell notification is also shown on the person's
  computer (Windows notification centre via the browser's Web Push), even when the Daybook window is
  minimised, except while a Daybook window is in front and shows its own preview card (never on
  Safari; CONTRACT 26)." (Replace the "Client:" bullet's start): "- Client: `public/sw.js` handles
  `push`: it asks every Daybook window first (at most 1 s); when a window in front answers that it
  shows the notification, no system notification is shown (not for Apple endpoints, `mustShow`);
  otherwise it shows it (title, body, icon, `tag` per notification, `data.url`), `silent` when this
  browser already alerted the person or a window in front has Sound Off, never for Apple endpoints
  (CONTRACT 26). Payload `{ id, userId, title, body, url,
mustShow? }`. It also handles `notificationclick` (focus a Daybook window and open the link, or
  open a new one); ..." (the rest unchanged).
- **§20, Notification center** (add a bullet at the end): "- Live (CONTRACT 26): while Daybook is
  open the bell learns about new notifications by itself (`GET /api/notifications?after=`), a
  preview card shows each new one (a summary for 3 or more), and a short chime plays for important
  ones by default (My settings → Sound)."
- **§21, preferences table** (add after `bellRing`):
  "| `bellSound` | `'important'` `'all'` `'off'` | `'important'` | when the sound plays (CONTRACT 26) |", "| `bellTone` | `'chime'` `'bell'` `'ding'` `'pop'` | `'chime'` | which sound (CONTRACT 26)
  |" and "| `bellPreview` | boolean | `true` | preview cards (CONTRACT 26) |".
- **§21, "3. Notifications"** (replace the item): "3. **Notifications** (everyone): "Ring the bell
  for unread notifications" (Toggle). Help: "A small swing every few seconds while you have unread
  ones." "Sound" (Segmented: Important only · All · Off). "Choose a sound" (Segmented: Chime · Soft
  bell · Ding · Pop; picking one plays it) with "Play sound" (CONTRACT 26). "Show a preview"
  (Toggle). Then the existing desktop switch (`PushSwitch` "Show on this computer"), only
  while desktop notifications are on for the company, with the note "When this is on and Daybook
  is in the background, Daybook doesn't chime. Your computer's settings decide if the desktop
  notification makes a sound, whatever you chose for Sound." Reminders from HR and from
  Daybook, and for HR the morning summary and the evening wrap-up (CONTRACT 25), come to the bell
  and, where Show on this computer is on, as desktop notifications. There is no per-type mute; the
  Sound choice is the only difference by type (CONTRACT 26). Slack DMs follow the company's
  switches in Settings → Slack."
- **§21, "What the preferences change"** (add after the Bell bullet): "- **Sound**: Important only
  chimes for the types marked important in `ALERT_TYPES`, All for every new notification, Off
  never (CONTRACT 26). - **Choose a sound**: which of the four sounds plays (CONTRACT 26). - **Show
  a preview** off: no preview cards and no announcement; the bell's
  dot and count still change."
- **§20, Version label**: "`APP_VERSION` in `src/config/version.js` (now '1.11'; raised with each
  release)."
