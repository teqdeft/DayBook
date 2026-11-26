// The npm scripts the cPanel host runs (README "Deploying on cPanel"). Shared hosting caps processes
// and threads and refuses Node's WebAssembly memory reservation, so each one starts Node itself with
// the trap handler off and a small V8 pool. A bare `knex migrate:latest` printed only "Aborted" on
// the live server. The README's cPanel steps run migrations, seeds, doctor and reset the same way,
// without npm, one command per code block (CONTRACT 28, README).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const { scripts } = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const readme = readFileSync(new URL('README.md', ROOT), 'utf8');
const LEAN = 'node --disable-wasm-trap-handler --v8-pool-size=2 ';
const KNEX = 'node_modules/knex/bin/cli.js';
const lean = (command) => `NODE_ENV=production UV_THREADPOOL_SIZE=2 ${LEAN}${KNEX} ${command}`;
/** A file of scripts/ as the host runs it: through the worker's alias loader, no npm. */
const leanScript = (file) =>
  `NODE_ENV=production UV_THREADPOOL_SIZE=2 ${LEAN}--import ./src/worker/alias.js scripts/${file}`;
const DOCTOR = leanScript('doctor.js');

/** The README's cPanel part: from its heading to the next "##" heading. */
const cpanel = readme.slice(readme.indexOf('## Deploying on cPanel')).split(/\n## /)[0];

/**
 * One release's steps in the cPanel part: from its "For 1.xx (…)" line to the first of the next
 * release's, a "To go back to" paragraph or **Checking** (the last release has no next one).
 */
const stepsFor = (version) =>
  cpanel
    .slice(cpanel.indexOf(`For ${version} (`))
    .split(/\n(?:For 1\.|To go back to|\*\*Checking\*\*)/)[0];

/** The cPanel text from `start` to the next "**Checking**" paragraph. */
const sliceToChecking = (start) => {
  const from = cpanel.indexOf(start);
  return cpanel.slice(from, cpanel.indexOf('\n**Checking**', from));
};

/** The commands of each ```bash block in `text`, in order. */
const blocksOf = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map(([, block]) => block);

describe('the scripts the host runs', () => {
  it('start one lean Node process each', () => {
    for (const name of ['migrate', 'seed', 'worker:cron', 'doctor', 'reset']) {
      expect(scripts[name], name).toMatch(new RegExp(`^${LEAN}`));
    }
  });

  it('run migrations and seeds through the Knex CLI file, not its npm shim', () => {
    expect(existsSync(new URL(KNEX, ROOT))).toBe(true);
    expect(scripts.migrate).toBe(`${LEAN}${KNEX} migrate:latest`);
    expect(scripts.seed).toBe(`${LEAN}${KNEX} seed:run`);
  });

  it('are what the cPanel steps run, with small thread pools and no npm', () => {
    expect(cpanel).toContain(lean('migrate:latest'));
    expect(cpanel).toContain(lean('seed:run'));
    const commands = blocksOf(cpanel);
    expect(commands.length).toBeGreaterThan(0);
    for (const block of commands) expect(block).not.toMatch(/npm run (migrate|seed)\b/);
  });

  it('give the 1.10 steps the unlock line, then the migrate line again, after an Aborted run', () => {
    // A stopped run leaves the migration table locked: the same line alone does nothing.
    expect(cpanel).toContain('For 1.10 (HR tools), step by step:');
    expect(blocksOf(stepsFor('1.10')).map((block) => block.trim())).toEqual([
      'cd ~/daybook && git pull',
      'npm ci --omit=dev',
      lean('migrate:latest'),
      lean('migrate:unlock'),
      lean('migrate:latest'),
    ]);
  });

  it('give the 1.11 steps only the pull of the deploy branch: no migrate line, nothing to install', () => {
    // CONTRACT 26: no migration and no new npm dependency, so the update is a pull and a Restart.
    expect(cpanel).toContain('For 1.11 (bell sound and preview), step by step:');
    expect(blocksOf(stepsFor('1.11')).map((block) => block.trim())).toEqual([
      'git pull origin deploy',
    ]);
  });

  it('give the 1.12 steps the files folder, then the pull, the migrate line and doctor', () => {
    // CONTRACT 27: one migration (019), no new npm dependency, and FILES_DIR in .env.local (the
    // worker cron reads that file, not Setup Node.js App's variables).
    expect(cpanel).toContain('For 1.12 (project board and files), step by step:');
    const steps = stepsFor('1.12');
    expect(blocksOf(steps).map((block) => block.trim())).toEqual([
      'git pull origin deploy',
      lean('migrate:latest'),
      lean('migrate:unlock'),
      lean('migrate:latest'),
      DOCTOR,
    ]);
    expect(steps).toContain('FILES_DIR=');
    expect(steps).toContain('.env.local');
    expect(steps).toContain('a new, empty folder');
  });

  it('keep the 1.12 database update file when going back to 1.11', () => {
    // Knex refuses a migrations folder without a migration the database has run, so after a
    // plain revert doctor and the migrate line would stop with "The migration directory is
    // corrupt".
    const back = cpanel.slice(cpanel.indexOf('To go back to 1.11:')).split('\n\n')[0];
    expect(back).toContain('git revert --no-commit <the 1.12 commit>');
    expect(back).toContain('git checkout <the 1.12 commit> -- db/migrations/019_project_files.js');
    expect(back.indexOf('019_project_files.js')).toBeLessThan(back.indexOf('push'));
    expect(existsSync(new URL('db/migrations/019_project_files.js', ROOT))).toBe(true);
  });

  it('give the 1.13 steps the pull, the migrate line, the unlock line and the doctor line', () => {
    // CONTRACT 28: one migration (020), no new npm dependency and no new setting.
    expect(cpanel).toContain('For 1.13 (task board and My tasks), step by step:');
    const steps = stepsFor('1.13');
    expect(blocksOf(steps).map((block) => block.trim())).toEqual([
      'git pull origin deploy',
      lean('migrate:latest'),
      lean('migrate:unlock'),
      lean('migrate:latest'),
      DOCTOR,
    ]);
    expect(steps).toContain('Lock wait timeout exceeded');
    expect(steps).toContain('020_task_file_links.js');
  });

  it('keep the 1.13 database update file when going back to 1.12, before the push', () => {
    // 1.12 never reads task_file_links, but Knex refuses a folder without a migration it has run.
    const back = sliceToChecking('To go back to 1.12, step by step:');
    expect(blocksOf(back).map((block) => block.trim())).toEqual([
      'git revert --no-commit <the 1.13 commit>',
      'git checkout <the 1.13 commit> -- db/migrations/020_task_file_links.js',
      'git commit -m "Back to 1.12"',
      'git push',
      'git pull origin deploy',
    ]);
    expect(back.indexOf('020_task_file_links.js')).toBeLessThan(back.indexOf('git push'));
    expect(existsSync(new URL('db/migrations/020_task_file_links.js', ROOT))).toBe(true);
  });

  it('run no host command through npm run, and npm ci only to install', () => {
    // npm commands abort on the host. Local development (Getting started, Scripts) keeps npm run.
    const commands = blocksOf(cpanel);
    for (const block of commands) expect(block).not.toContain('npm run');
    const installs = commands.filter((block) => block.includes('npm ci'));
    expect(installs).toHaveLength(3);
    for (const block of installs) {
      const lines = block.split('\n').filter((line) => line.includes('npm ci'));
      expect(lines.map((line) => line.trim())).toEqual(['npm ci --omit=dev']);
    }
    // Step 6 (install and database), the Updating paragraph and the 1.10 steps, as they were.
    expect(installs[0]).toContain('source /home/cpuser/nodevenv/daybook/20/bin/activate');
    expect(installs[1].trim().split('\n')[0]).toBe('cd ~/daybook && git pull');
    expect(blocksOf(stepsFor('1.10'))).toContain(installs[2]);
  });

  it('give Checking and Fresh start the lean lines, each in its own block', () => {
    const checking = cpanel.slice(cpanel.indexOf('**Checking**'), cpanel.indexOf('**Backups**'));
    expect(blocksOf(checking).map((block) => block.trim())).toEqual([
      DOCTOR,
      `${DOCTOR} --notify=person@company.com`,
      leanScript('reset.js'),
      `${leanScript('reset.js')} --confirm=<DB_NAME>`,
    ]);
    const notes = readme.slice(readme.indexOf('## Deployment notes'), readme.indexOf(cpanel));
    expect(notes).toContain('- Deploy after 7 PM: the migrate line (Updating), then restart');
    expect(notes).not.toContain('npm run');
    expect(notes).toContain(
      'one database update (migration 020 adds one table, `task_file_links`)',
    );
  });
});
