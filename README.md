# Daybook

Phase 1 of Daybook: everyone checks in, logs their day and submits a daily report in one web app.
PMs, HR and the CEO see it live, and reports still post to Slack in the team's usual format.

- Spec: `docs/build-guide.txt` (text of "Daybook Phase 1 Build Guide").
- Design: `docs/design/` — the 13 approved artboards (3x) and `docs/design/1x/` (1x, 1440 px wide).
- Contract used to build it: `docs/CONTRACT.md` (module APIs, component APIs, conventions).

## Stack

Next.js 16 (App Router, plain JavaScript) · MySQL 8.4 through Knex + mysql2 · zod · dayjs ·
@slack/web-api · node-cron · exceljs · pino · lucide-react · CSS Modules with design tokens ·
Vitest and Playwright. Two processes: `web` (pages and `/api`) and `worker` (scheduled jobs and
Slack sending).

## Getting started

Requirements: Node.js 20.9 or newer (24 LTS recommended) and MySQL 8.4 (MariaDB 10.4+ also works for local development).

```bash
npm install
cp .env.example .env.local        # then fill in DB_*, SESSION_SECRET and the Slack values
npm run migrate                   # creates the 19 tables
npm run seed                      # departments, the Internal client, default settings, first Admin
npm run dev                       # http://localhost:3000
npm run worker                    # in a second terminal: reminders, midnight jobs, Slack sending
```

Generate `SESSION_SECRET` with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

### Demo data and signing in locally

`npm run seed:demo` **wipes the database** and fills it with the people, projects, attendance and
reports from the design canvas (`npm run seed:demo -- --midday` gives the midday state of the
Today and Daily report artboards). It refuses to run in production.

Without Slack credentials, set `DEV_LOGIN_ENABLED=true` in `.env.local`: the sign-in page then shows
a "Development sign-in" list. It never exists when `NODE_ENV=production`. Demo accounts:
`vishal@company.com` (employee), `pm@company.com` (PM), `neha@company.com` (HR),
`ceo@company.com` (Admin).

## Scripts

| Script                            | Does                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `dev`                             | Next.js in development mode                          |
| `build`, `start`                  | Production build (`output: 'standalone'`) and server |
| `worker`                          | Starts the worker process (cron jobs, Slack outbox)  |
| `migrate`, `migrate:make`, `seed` | Knex migrations and seeds                            |
| `seed:demo`                       | Demo data from the design canvas (development only)  |
| `lint`, `test`, `test:e2e`        | ESLint, Vitest, Playwright                           |

Tests use the database named in `.env.test.local` (for example `daybook_test`); each service test
file migrates it fresh.

### End-to-end tests (`npm run test:e2e`)

Playwright drives the real screens in the installed Google Chrome (no browser download): check in,
write and submit a report and the PM sees it; a report edit request approved; an HR attendance
correction; and every main screen per role with no console errors. The specs are in `tests/e2e/`.

```bash
# Local: reuse the dev server that is already running (no second `next dev` is started)
E2E_BASE_URL=http://localhost:3000 npm run test:e2e

# CI: starts `next dev -p 3100` on its own database, daybook_e2e (created if missing)
npm run test:e2e
```

- The global setup migrates the server's database and runs `npm run seed:demo`; the global
  teardown runs it again, so the database ends in the normal demo state. **Both wipe that
  database.** Locally it is `DB_NAME` from `.env.local` (`daybook`), the one the dev server uses.
- The tests sign in through the development sign-in, so the server needs `DEV_LOGIN_ENABLED=true`
  (the CI mode sets it). That is also why CI runs `next dev` and not `next start`: the sign-in
  shortcut never exists in a production build.
- Next.js allows one `next dev` per project directory, so the CI mode runs on a clean checkout
  with no dev server running. CI needs `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and
  `SESSION_SECRET` in the environment (no `.env.local` there).
- Tests run one at a time (`workers: 1`) because they share the demo data.
  `npx playwright show-trace test-results/<test>/trace.zip` opens the trace of a failed test.

## Changes from the build guide

- **Project managers don't check in, check out or write daily reports** (company decision). The
  PM role has no `attendance.self` or `report.self`, PMs are never tracked
  (`users.tracks_attendance = 0`, kept by the users service and migration 006), so they don't
  appear in attendance or report counts. Their sidebar is Projects, Team, Attendance, Requests and
  they start on the Team dashboard. They still approve report edits, manage their projects and
  handle project requests.

## Slack setup (one Slack app per environment)

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**. Name it `Daybook`
   and pick your company workspace.
2. **OAuth & Permissions**
   - **Redirect URLs** → add `APP_URL/api/auth/slack/callback`, for example
     `https://daybook.yourcompany.com/api/auth/slack/callback`. Slack only accepts HTTPS here; to
     test sign-in on your own computer, expose it through an HTTPS tunnel (for example Cloudflare
     Tunnel or ngrok), use that address as `APP_URL`, and open Daybook through it.
   - **Bot Token Scopes** → `chat:write`, `chat:write.customize`, `im:write`, `users:read`,
     `users:read.email`, `channels:read`.
   - **User Token Scopes** → `openid`, `email`, `profile` (Sign in with Slack).
3. **App Home** → set the bot's display name to `Daybook`.
4. **Install to Workspace** (OAuth & Permissions page) and approve. Copy the **Bot User OAuth
   Token** (`xoxb-...`).
5. **Basic Information → App Credentials** → copy the **Client ID**, **Client Secret** and
   **Signing Secret**.
6. Find the **workspace (team) ID**: it starts with `T`, for example in the browser address when
   Slack is open on the web (`app.slack.com/client/T0123ABCD/...`).
7. Put the values in `.env.local` (never commit them):

   ```bash
   APP_URL=https://daybook.yourcompany.com
   SLACK_CLIENT_ID=...
   SLACK_CLIENT_SECRET=...
   SLACK_TEAM_ID=T...
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   ```

8. Restart `npm run dev` (or the web server) and `npm run worker` — the worker sends every Slack
   message from the outbox.
9. In Slack, invite the bot to the report channel: `/invite @Daybook` in `#daily-reports`.
10. In Daybook as Admin: **Settings → Slack** shows **Connected**; pick the channel under **Post
    reports to**, check the switches, and **Save changes**.
11. Make sure everyone's Daybook email is their Slack email. Their Slack ID is saved at first
    sign-in, and the worker's hourly `slack-user-sync` job looks up anyone still missing.
12. Test: submit a daily report — it appears in the channel within about 10 seconds, under the
    person's name and photo. Submitting again updates the same message.

## Desktop notifications

Every bell notification can also pop up on the person's computer (the Windows notification
centre), even when Daybook is minimised. The browser's Web Push does the delivery; the worker's
`push-notifications` job sends new notifications every 10 seconds, and one that couldn't be
delivered within an hour is dropped rather than shown late.

1. Generate the VAPID keys once per environment and put them in `.env.local` (never commit them):

   ```bash
   npx web-push generate-vapid-keys
   ```

   ```bash
   VAPID_PUBLIC_KEY=B...            # "Public Key" from the command
   VAPID_PRIVATE_KEY=...            # "Private Key"; stays on the server
   VAPID_SUBJECT=mailto:it@yourcompany.com
   ```

   Restart `web` and `worker`. Keep the keys: new keys cut off every browser until each person
   opens Daybook again (it then renews the subscription by itself). Without keys nothing is sent.

2. Admin: **Settings → Notifications → Show Daybook notifications on people's computers** (on by
   default) is the switch for everyone. **Save changes**.
3. Each person, once in each browser: open the bell, turn on **Show on this computer**, then click
   **Allow** when the browser asks. "Blocked" means they said no earlier: allow notifications for
   the Daybook site in the browser's site settings (the lock icon in the address bar). Signing out
   turns it off for that browser; it comes back on by itself when the same person signs in there
   again, never for someone else. While Daybook is open, a new notification also lights the bell.
4. To get notifications while every Daybook window is closed, Chrome or Edge must keep running in
   the background: Chrome → **Settings → System → Continue running background apps when Google
   Chrome is closed**; Edge → **Settings → System and performance → Continue running background
   extensions and apps when Microsoft Edge is closed**. Windows must also allow notifications from
   the browser (**Settings → System → Notifications**), and Do not disturb hides them.

Push needs HTTPS (or `localhost` in development). The worker needs outbound HTTPS to the browsers'
push services (`fcm.googleapis.com` for Chrome, `*.notify.windows.com` for Edge).

## Deployment notes

- Run behind Caddy or Nginx with HTTPS and `TRUST_PROXY=true`, so the client IP (used for Office
  check-in) comes from `X-Forwarded-For`. Save the office's static public IP in Settings.
- Set `WORKER_CRON_ENABLED=false` on any extra web servers so jobs run once.
- Deploy after 7 PM: `npm run migrate`, then restart `web` and `worker`. `/api/health` checks the
  database for uptime monitoring.

## Deploying on cPanel (Setup Node.js App)

Needs: cPanel with **Setup Node.js App**, Node.js **20.9 or newer** (24 recommended), MySQL 8 or MariaDB
10.4+, **Terminal** (or SSH), **Cron Jobs** and AutoSSL. Replace `cpuser` with your cPanel username
and `daybook.yourcompany.com` with your address.

1. **Domain and HTTPS** — Domains → create `daybook.yourcompany.com`, then SSL/TLS Status → Run
   AutoSSL.
2. **Database** — MySQL Databases → create a database and a user, add the user to the database
   with ALL PRIVILEGES.
3. **Code** — GitHub builds Daybook for you: `.github/workflows/build-for-cpanel.yml` runs on every
   push to `main` (Linux, Node 20) and publishes the finished app to the **`deploy`** branch
   (shared hosting can't run `next build`: it runs out of memory). Check GitHub → Actions shows a
   green "Build for cPanel" run. Then Git Version Control → Create → clone your repository into
   `/home/cpuser/daybook` (not inside `public_html`) and switch it to `deploy` in Terminal:
   `cd ~/daybook && rm -rf .next && git fetch origin && git checkout -B deploy origin/deploy`.
   A private repo needs a deploy key (cPanel → SSH Access → add the public key to your Git host).
4. **Settings file** — in File Manager create `/home/cpuser/daybook/.env.local` (never commit it)
   from `.env.example` with your live values: `APP_URL=https://daybook.yourcompany.com`,
   `DB_HOST=localhost`, `DB_NAME`/`DB_USER`/`DB_PASSWORD` from step 2, a new `SESSION_SECRET`,
   `SEED_ADMIN_EMAIL` = the CEO's Slack email, the production Slack values, new VAPID keys,
   `DEV_LOGIN_ENABLED=false`, `TRUST_PROXY=false` (checked in step 9).
5. **Node.js app** — Setup Node.js App → Create Application: Node.js version 20 or newer, Application mode
   **Production**, Application root `daybook`, Application URL `daybook.yourcompany.com` (the main address, not a path like `/api`),
   Application startup file **`server.cjs`** → Create. Copy the "Enter to the virtual environment"
   command shown at the top of the page.
6. **Install and database** — in Terminal (use your Node version folder, e.g. `20`):

   ```bash
   source /home/cpuser/nodevenv/daybook/20/bin/activate && cd /home/cpuser/daybook
   npm ci --omit=dev
   NODE_ENV=production npm run migrate
   NODE_ENV=production npm run seed
   ```

   Don't run `npm run build` on the server; the `deploy` branch already contains the build. Never
   run `npm run seed:demo` on the live database.

7. **Start** — back in Setup Node.js App press **Restart**, then open
   `https://daybook.yourcompany.com`: the sign-in page appears; `/api/health` answers
   `{"ok":true}`.
8. **Worker** — Cron Jobs → add a job running **every minute** (`* * * * *`):

   ```bash
   /bin/bash -lc 'source /home/cpuser/nodevenv/daybook/20/bin/activate && cd /home/cpuser/daybook && NODE_ENV=production npm run worker:cron --silent' >/dev/null 2>&1
   ```

   It sends Slack messages and desktop notifications and runs the reminders and midnight jobs
   (`src/worker/cron.js`). On a VPS you can instead keep `npm run worker` running (PM2/systemd).

9. **Office network** — sign in as Admin → Settings → Check-in → Add network. The IP filled in is
   the address Daybook sees for you. From the office it must be the office's public IP. If it
   shows `127.0.0.1` or the server's own address, set `TRUST_PROXY=true` in `.env.local`, press
   Restart and check again.
10. **Slack** — set the Slack app's redirect URL to
    `https://daybook.yourcompany.com/api/auth/slack/callback`, invite the bot to the report
    channel and pick it in Settings → Slack.
11. **People** — the CEO signs in with Slack; HR adds everyone else in People with their Slack
    emails.

**Updating** (after 7 PM): push to `main` and wait for the green "Build for cPanel" run on GitHub;
then in Terminal (after the `source` command): `cd ~/daybook && git pull`, `npm ci --omit=dev`,
`NODE_ENV=production npm run migrate`, and press Restart in Setup Node.js App.

**Checking** — `NODE_ENV=production npm run doctor` (after the `source` command, in `~/daybook`)
shows whether the worker cron is running, whether Slack works and who gets desktop notifications;
it prints no secrets. Adding `-- --notify=person@company.com` also sends that person a test
notification.

**Backups**: enable cPanel backups, or add a nightly cron with `mysqldump`, and test a restore once
a month.
