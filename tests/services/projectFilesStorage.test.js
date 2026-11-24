// The storage check (CONTRACT 27, Storage "The check") with its own inputs, in folders made here
// under the system temp folder: not set, not absolute, inside the app (also through a linked
// parent and from any working folder), under public_html, a folder in use, a new empty folder
// (the marker and the .htaccess), a marked folder again. Then the env check the app uses.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { projectFiles } from '@/modules/projectFiles';
import { resetDatabase } from '../helpers/db.js';
import { emptyFilesDir } from './projectFilesKit.js';

const BASE = path.join(os.tmpdir(), 'daybook-test-files', `${env.DB_NAME}-storage-check`);
const check = (dir, isProduction = true) => projectFiles.checkStorage({ dir, isProduction });

/** A fresh folder under BASE. */
async function folder(...parts) {
  const dir = path.join(BASE, ...parts);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** A pretend Daybook app folder (server.cjs and package.json). */
async function appFolder(name) {
  const dir = await folder(name);
  await fsp.writeFile(path.join(dir, 'server.cjs'), '// test');
  await fsp.writeFile(path.join(dir, 'package.json'), '{}');
  return dir;
}

beforeAll(async () => {
  await resetDatabase();
  await fsp.rm(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  projectFiles.resetStorageForTests();
});

afterAll(async () => {
  await fsp.rm(BASE, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('checkStorage', () => {
  it('needs a value that is a full path (~ is never expanded)', async () => {
    expect(await check('')).toEqual({ ready: false, problem: 'not_set' });
    expect(await check('daybook-files')).toEqual({ ready: false, problem: 'not_absolute' });
    expect(await check('~/daybook-files')).toEqual({ ready: false, problem: 'not_absolute' });
    expect(await check('./files')).toEqual({ ready: false, problem: 'not_absolute' });
  });

  it('refuses a folder inside the app in production, also through a linked parent and from any working folder', async () => {
    const app = await appFolder('app');
    expect(await check(path.join(app, 'files'))).toEqual({ ready: false, problem: 'inside_app' });
    expect(await check(path.join(app, 'a', 'b'))).toEqual({ ready: false, problem: 'inside_app' });
    // The app folder itself.
    expect(await check(app)).toEqual({ ready: false, problem: 'inside_app' });

    // A link to the app folder hides nothing: the real path is checked.
    const link = path.join(BASE, 'link-to-app');
    await fsp.symlink(app, link, 'junction');
    expect(await check(path.join(link, 'store'))).toEqual({ ready: false, problem: 'inside_app' });

    const before = process.cwd();
    try {
      process.chdir(await folder('somewhere-else'));
      expect(await check(path.join(app, 'files'))).toEqual({
        ready: false,
        problem: 'inside_app',
      });
    } finally {
      process.chdir(before);
    }
    // Outside production the app check isn't made (development keeps .daybook-files inside).
    expect(await check(path.join(app, 'dev-files'), false)).toEqual({ ready: true, problem: null });
  });

  it('refuses a folder under public_html in production', async () => {
    const web = await folder('home', 'public_html');
    expect(await check(path.join(web, 'daybook-files'))).toEqual({
      ready: false,
      problem: 'public',
    });
  });

  it('never takes over a folder in use (not empty, no marker)', async () => {
    const home = await folder('home-in-use');
    await fsp.writeFile(path.join(home, '.bashrc'), '# mine');
    expect(await check(home)).toEqual({ ready: false, problem: 'not_empty' });
    expect(await fsp.readdir(home)).toEqual(['.bashrc']);
  });

  it('marks a new empty folder (marker, .htaccess, tmp and files) and passes it again', async () => {
    const dir = path.join(BASE, 'fresh', 'daybook-files');
    expect(await check(dir)).toEqual({ ready: true, problem: null });
    expect((await fsp.readdir(dir)).sort()).toEqual([
      '.daybook-files',
      '.htaccess',
      'files',
      'tmp',
    ]);
    expect(await fsp.readFile(path.join(dir, '.daybook-files'), 'utf8')).toBe(
      "Daybook keeps project files here. Don't add or remove files by hand.\n",
    );
    expect(await fsp.readFile(path.join(dir, '.htaccess'), 'utf8')).toBe(
      'Require all denied\nOptions -Indexes\n',
    );
    if (process.platform !== 'win32') {
      expect((await fsp.stat(dir)).mode & 0o777).toBe(0o700);
    }
    // Files added since don't matter once the marker is there.
    await fsp.writeFile(path.join(dir, 'tmp', '0'.repeat(32) + '.part'), '');
    expect(await check(dir)).toEqual({ ready: true, problem: null });
  });

  it('passes a new folder whose marker another check wrote between its two looks', async () => {
    // Two processes checking a new folder at the same moment (two app processes, the app and
    // doctor, the worker): the other one writes the marker just after this one looked for it.
    const dir = await folder('race', 'daybook-files');
    const marker = path.join(await fsp.realpath(dir), '.daybook-files');
    const realStat = fsp.stat.bind(fsp);
    let raced = false;
    const stat = vi.spyOn(fsp, 'stat').mockImplementation(async (target, ...rest) => {
      if (!raced && target === marker) {
        raced = true;
        await fsp.writeFile(marker, 'the other check\n', { flag: 'wx' });
        throw Object.assign(new Error('no marker yet'), { code: 'ENOENT' });
      }
      return realStat(target, ...rest);
    });
    try {
      expect(await check(dir)).toEqual({ ready: true, problem: null });
    } finally {
      stat.mockRestore();
    }
    expect(raced).toBe(true);
    expect(await fsp.readFile(marker, 'utf8')).toBe('the other check\n');
    expect((await fsp.readdir(dir)).sort()).toEqual([
      '.daybook-files',
      '.htaccess',
      'files',
      'tmp',
    ]);
  });

  it("answers not_writable when the folder can't be made", async () => {
    const file = path.join(await folder('blocked'), 'a-file');
    await fsp.writeFile(file, 'x');
    expect(await check(path.join(file, 'daybook-files'))).toEqual({
      ready: false,
      problem: 'not_writable',
    });
  });
});

describe('the env check', () => {
  it('uses the test folder under the system temp folder, cached until reset', async () => {
    await emptyFilesDir();
    expect(env.filesDir).toBe(path.join(os.tmpdir(), 'daybook-test-files', env.DB_NAME));
    expect(await projectFiles.storageStatus()).toEqual({ ready: true, problem: null });
    expect((await fsp.readdir(env.filesDir)).sort()).toEqual([
      '.daybook-files',
      '.htaccess',
      'files',
      'tmp',
    ]);
    // Cached: a folder emptied behind its back still reads ready until the cache is cleared.
    await fsp.rm(env.filesDir, { recursive: true, force: true });
    expect((await projectFiles.storageStatus()).ready).toBe(true);
    projectFiles.resetStorageForTests();
    await fsp.mkdir(env.filesDir, { recursive: true });
    await fsp.writeFile(path.join(env.filesDir, 'stranger.txt'), 'x');
    expect(await projectFiles.storageStatus()).toEqual({ ready: false, problem: 'not_empty' });
    const usage = await projectFiles.spaceUsage();
    expect(usage.storage).toEqual({ ready: false, problem: 'not_empty' });
    await emptyFilesDir();
  });
});
