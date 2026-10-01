# Daybook

Daybook Phase 1: one Next.js 16 app (plain JavaScript, App Router) + MySQL through Knex, run as two
processes: `web` (pages and `/api`) and `worker` (cron jobs and Slack sending). Everyone checks in,
logs their day and submits a daily report; PMs, HR and the CEO see it live.

- **Spec:** `docs/build-guide.txt` (text of the build guide PDF). **Contract:** `docs/CONTRACT.md` —
  read it before writing code; it fixes module APIs, component APIs, file ownership and the design
  workflow. **Design:** `docs/design/*.png` (3x) and `docs/design/1x/*.png` (1x); the UI must match
  them exactly.
- This is **Next.js 16**: read `node_modules/next/dist/docs/` before using an API you're unsure of.
  `proxy.js` replaces middleware; `params`, `searchParams`, `cookies()`, `headers()` are async; no
  `next lint`.
- Local DB is MariaDB 10.4 (XAMPP, root, no password) standing in for MySQL 8.4: keep SQL portable.
- Commands: `npm run migrate`, `npm run seed`, `npm run seed:demo`, `npm run worker`,
  `npx eslint <files>`, `npx vitest run <files>`. A dev server is already running on port 3000 —
  never start another `next dev` and never run `next build` unless you are the orchestrator.
- Screenshots: `node tests/visual/shot.mjs --as <email> --path <route> --out scratch/shots/x.png --full`
  then `python tests/visual/compare.py docs/design/1x/<artboard>.png scratch/shots/x.png scratch/shots/x-cmp.png`.
- Put throwaway files in `scratch/` (git-ignored), never elsewhere in the repo.
- Stay inside the files your task owns (CONTRACT.md sections 7 and 9). If you need a change in a
  file you don't own, code against the contract and report the needed change in your final answer.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
