// The npm scripts the cPanel host runs (README "Deploying on cPanel"). Shared hosting caps processes
// and threads and refuses Node's WebAssembly memory reservation, so each one starts Node itself with
// the trap handler off and a small V8 pool. A bare `knex migrate:latest` printed only "Aborted" on
// the live server. The README's cPanel steps run migrations and seeds the same way, without npm.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const { scripts } = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const readme = readFileSync(new URL('README.md', ROOT), 'utf8');
const LEAN = 'node --disable-wasm-trap-handler --v8-pool-size=2 ';
const KNEX = 'node_modules/knex/bin/cli.js';

/** The README's cPanel part: from its heading to the next "##" heading. */
const cpanel = readme.slice(readme.indexOf('## Deploying on cPanel')).split(/\n## /)[0];

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
    const lean = (command) => `NODE_ENV=production UV_THREADPOOL_SIZE=2 ${LEAN}${KNEX} ${command}`;
    expect(cpanel).toContain(lean('migrate:latest'));
    expect(cpanel).toContain(lean('seed:run'));
    const commands = [...cpanel.matchAll(/```bash\n([\s\S]*?)```/g)].map(([, block]) => block);
    expect(commands.length).toBeGreaterThan(0);
    for (const block of commands) expect(block).not.toMatch(/npm run (migrate|seed)\b/);
  });
});
