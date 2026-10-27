// The scripts that run before the first paint (CONTRACT 21): the launch script applies the theme
// kept in localStorage, and the signed-in layout's theme script applies the person's saved theme
// and keeps that copy in step. Run as the browser would, against a fake <html> and storage.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LAUNCH_KEY, LAUNCH_SCRIPT, themeScript } from '@/components/launchScript';
import { THEME_STORAGE_KEY } from '@/lib/theme';

/** A fake Storage; `mode` 'blocked' throws on every call, 'full' only on setItem. */
function fakeStorage(entries = {}, mode = 'ok') {
  const values = new Map(Object.entries(entries));
  const guard = () => {
    if (mode === 'blocked') throw new Error('SecurityError');
  };
  return {
    values,
    getItem: (key) => (guard(), values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      guard();
      if (mode === 'full') throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem: (key) => (guard(), values.delete(key)),
  };
}

/** Runs a script against a fake page; returns <html>'s attributes and both storages. */
function run(source, { local = fakeStorage(), session = fakeStorage(), html = {} } = {}) {
  const attributes = new Map(Object.entries(html));
  const documentElement = {
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
  };
  const window = { matchMedia: () => ({ matches: false }) };
  const context = {
    window,
    document: { documentElement },
    navigator: { webdriver: false },
    localStorage: local,
    sessionStorage: session,
  };
  vm.runInNewContext(source, context);
  return { attributes, local, session };
}

describe('launch script: the kept theme', () => {
  it('puts a kept light or dark theme on <html> before the page paints', () => {
    for (const theme of ['light', 'dark']) {
      const { attributes } = run(LAUNCH_SCRIPT, {
        local: fakeStorage({ [THEME_STORAGE_KEY]: theme }),
      });
      expect(attributes.get('data-theme')).toBe(theme);
    }
  });

  it('follows the computer when nothing usable is kept', () => {
    for (const kept of [undefined, 'system', 'Dark', 'purple', '"><script>']) {
      const local = fakeStorage(kept === undefined ? {} : { [THEME_STORAGE_KEY]: kept });
      expect(run(LAUNCH_SCRIPT, { local }).attributes.has('data-theme')).toBe(false);
    }
  });

  it('still runs the launch check when storage is blocked', () => {
    const { attributes } = run(LAUNCH_SCRIPT, {
      local: fakeStorage({}, 'blocked'),
      session: fakeStorage(),
    });
    expect(attributes.has('data-theme')).toBe(false);
    expect(attributes.has('data-launch')).toBe(false); // first page of the window: splash plays
  });

  it('keeps its launch check: a reload skips the splash', () => {
    const session = fakeStorage();
    expect(run(LAUNCH_SCRIPT, { session }).attributes.has('data-launch')).toBe(false);
    expect(session.values.get(LAUNCH_KEY)).toBe('1');
    expect(run(LAUNCH_SCRIPT, { session }).attributes.get('data-launch')).toBe('skip');
  });
});

describe('theme script: the person saved theme', () => {
  it('sets light or dark on <html> and keeps the copy', () => {
    for (const theme of ['light', 'dark']) {
      const { attributes, local } = run(themeScript(theme), { html: { 'data-theme': 'x' } });
      expect(attributes.get('data-theme')).toBe(theme);
      expect(local.values.get(THEME_STORAGE_KEY)).toBe(theme);
    }
  });

  it("removes both for 'system' and for anything else", () => {
    for (const theme of ['system', undefined, null, 'Dark', 'purple']) {
      const local = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' });
      const { attributes } = run(themeScript(theme), { local, html: { 'data-theme': 'dark' } });
      expect(attributes.has('data-theme')).toBe(false);
      expect(local.values.has(THEME_STORAGE_KEY)).toBe(false);
    }
  });

  it('never writes the value it was given into the script', () => {
    const hostile = "dark'; alert(1); '";
    const source = themeScript(hostile);
    expect(source).not.toContain('alert');
    expect(source).toContain('var theme = null;');
    expect(themeScript('dark')).toContain("var theme = 'dark';");
  });

  it('runs before the launch script, which then agrees with it', () => {
    // A stale copy from an earlier choice: the saved theme wins on this page and the next launch.
    const local = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' });
    const first = run(themeScript('system'), { local });
    const html = Object.fromEntries(first.attributes);
    const { attributes } = run(LAUNCH_SCRIPT, { local, html });
    expect(attributes.has('data-theme')).toBe(false);
  });

  it('removes a copy it cannot replace, so the launch script cannot override it', () => {
    const local = fakeStorage({ [THEME_STORAGE_KEY]: 'light' }, 'full');
    const first = run(themeScript('dark'), { local });
    expect(first.attributes.get('data-theme')).toBe('dark');
    expect(local.values.has(THEME_STORAGE_KEY)).toBe(false);
    const html = Object.fromEntries(first.attributes);
    expect(run(LAUNCH_SCRIPT, { local, html }).attributes.get('data-theme')).toBe('dark');
  });

  it('still sets the theme when storage is blocked', () => {
    const { attributes } = run(themeScript('light'), { local: fakeStorage({}, 'blocked') });
    expect(attributes.get('data-theme')).toBe('light');
  });
});
