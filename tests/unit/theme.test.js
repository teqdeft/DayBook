// The theme in the browser (CONTRACT 21): data-theme on <html> and the copy in localStorage that the
// launch script reads, against a fake document and storage. Only 'light' and 'dark' are ever
// applied or stored; blocked or full storage never breaks the page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, THEMES, applyTheme, storedTheme } from '@/lib/theme';

/** A fake page: <html>'s dataset and localStorage (`storage: 'blocked'` throws on access). */
function fakeBrowser({ stored, storage = 'ok' } = {}) {
  const values = new Map(stored === undefined ? [] : [[THEME_STORAGE_KEY, stored]]);
  const html = { dataset: {} };
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      if (storage === 'full') throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
  };
  const window = {};
  Object.defineProperty(window, 'localStorage', {
    get() {
      if (storage === 'blocked') throw new Error('SecurityError');
      return localStorage;
    },
  });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { documentElement: html });
  return { html, values };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('names the storage key and the themes other code uses', () => {
    expect(THEME_STORAGE_KEY).toBe('daybook-theme');
    expect(THEMES).toEqual(['system', 'light', 'dark']);
    expect(Object.isFrozen(THEMES)).toBe(true);
  });

  it('applies and stores light or dark', () => {
    const { html, values } = fakeBrowser();
    applyTheme('dark');
    expect(html.dataset.theme).toBe('dark');
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(storedTheme()).toBe('dark');
    applyTheme('light');
    expect(html.dataset.theme).toBe('light');
    expect(storedTheme()).toBe('light');
  });

  it("removes both for 'system' and for anything else", () => {
    for (const theme of ['system', 'purple', undefined, null, 'Dark']) {
      const { html, values } = fakeBrowser({ stored: 'dark' });
      html.dataset.theme = 'dark';
      applyTheme(theme);
      expect('theme' in html.dataset).toBe(false);
      expect(values.has(THEME_STORAGE_KEY)).toBe(false);
      expect(storedTheme()).toBeNull();
    }
  });

  it('reads only light or dark back', () => {
    for (const [stored, expected] of [
      ['light', 'light'],
      ['dark', 'dark'],
      ['system', null],
      ['DARK', null],
      ['', null],
      ['<script>', null],
      [undefined, null],
    ]) {
      fakeBrowser({ stored });
      expect(storedTheme()).toBe(expected);
    }
  });

  it('still applies the theme when storage is blocked or full', () => {
    const blocked = fakeBrowser({ stored: 'dark', storage: 'blocked' });
    expect(() => applyTheme('light')).not.toThrow();
    expect(blocked.html.dataset.theme).toBe('light');
    expect(storedTheme()).toBeNull();

    const full = fakeBrowser({ storage: 'full' });
    expect(() => applyTheme('dark')).not.toThrow();
    expect(full.html.dataset.theme).toBe('dark');
    expect(storedTheme()).toBeNull();
  });

  it('does nothing on the server', () => {
    expect(typeof window).toBe('undefined');
    expect(() => applyTheme('dark')).not.toThrow();
    expect(storedTheme()).toBeNull();
  });
});
