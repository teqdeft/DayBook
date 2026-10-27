// Sign out (UserMenu, CONTRACT 21): once the session has ended, the person's theme is dropped from
// <html> and from localStorage, so the sign-in page and the next person on a shared computer
// follow the computer again. A sign-out that fails keeps it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';

const calls = [];
let menuProps = null;
let logout = async () => ({ data: null });

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (path) => calls.push(`replace ${path}`),
    refresh: () => calls.push('refresh'),
  }),
}));
vi.mock('@/lib/apiClient', () => ({
  api: {
    post: async (path) => {
      calls.push(`post ${path}`);
      return logout();
    },
  },
}));
vi.mock('@/components/Menu', () => ({
  default: (props) => {
    menuProps = props;
    return null;
  },
}));
vi.mock('@/components/NotificationBell.push', () => ({ removeOnSignOut: async () => {} }));
vi.mock('@/components/AppShell', () => ({ useAppShell: () => null }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => (toast) => calls.push(`toast ${toast.title}`),
}));

const { default: UserMenu } = await import('@/components/UserMenu.jsx');

/** <html> in the dark theme, with the copy the launch script reads. */
function darkPage() {
  const html = { dataset: { theme: 'dark' } };
  const values = new Map([[THEME_STORAGE_KEY, 'dark']]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  vi.stubGlobal('document', { documentElement: html });
  vi.stubGlobal('window', { localStorage });
  return { html, values };
}

/** Renders the top bar's menu and presses its Sign out. */
async function signOut() {
  renderToStaticMarkup(
    createElement(UserMenu, { user: { name: 'Vishal Rao', initials: 'VR' }, variant: 'avatar' }),
  );
  const item = menuProps.items.find((entry) => entry.label === 'Sign out');
  await item.onSelect();
}

beforeEach(() => {
  calls.length = 0;
  menuProps = null;
  logout = async () => ({ data: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sign out', () => {
  it("drops the person's theme once the session has ended", async () => {
    const { html, values } = darkPage();
    logout = async () => {
      // Still the person's theme while the sign-out runs.
      calls.push(`theme ${html.dataset.theme}`);
      return { data: null };
    };
    await signOut();
    expect(calls).toEqual(['post /api/auth/logout', 'theme dark', 'replace /login', 'refresh']);
    expect(html.dataset.theme).toBeUndefined();
    expect(values.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('keeps it when the sign-out fails', async () => {
    const { html, values } = darkPage();
    logout = async () => {
      throw new Error('Offline');
    };
    await signOut();
    expect(calls).toEqual(['post /api/auth/logout', "toast Couldn't sign out"]);
    expect(html.dataset.theme).toBe('dark');
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
  });
});
