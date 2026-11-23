// AppFrame and the live bell (CONTRACT 26 "Where it runs"): the provider is keyed by the person, so
// when someone else signs in on this browser, a refresh of an open page (Today's auto refresh)
// mounts a fresh provider for them (a new store and cursor: quiet) instead of reusing the last
// person's. The server modules and the shell's components are faked; AppFrame's element tree is read.
import { describe, expect, it, vi } from 'vitest';

const stub = (name) => ({ default: Object.assign(() => null, { displayName: name }) });

vi.mock('@/lib/logger', () => ({ logger: { warn() {} } }));
vi.mock('@/lib/permissions', () => ({ can: () => false }));
vi.mock('@/config/navigation', () => ({ homePathFor: () => '/today', navigationFor: () => [] }));
vi.mock('@/modules/aiAsk', () => ({ aiAsk: { isAvailableFor: async () => false } }));
vi.mock('@/modules/aiSummaries', () => ({ aiSummaries: { countMine: async () => 0 } }));
vi.mock('@/modules/dashboard', () => ({ dashboard: { getNavBadges: async () => ({}) } }));
vi.mock('@/modules/notifications', () => ({
  notifications: { latestId: async (userId) => userId * 10 },
}));
vi.mock('@/modules/preferences', () => ({
  preferences: { PREFERENCE_DEFAULTS: {} },
  preferencesFor: async () => ({ theme: 'system' }),
}));
vi.mock('@/modules/push', () => ({ push: { publicKey: () => null } }));
vi.mock('@/modules/settings', () => ({ settings: { getAll: async () => ({}) } }));
vi.mock('@/modules/timers', () => ({
  timers: { canUse: () => false, getState: async () => null },
}));
vi.mock('@/components/ActivityTracker', () => stub('ActivityTracker'));
vi.mock('@/components/AppShell', () => stub('AppShell'));
vi.mock('@/components/live/LiveNotifications', () => stub('LiveNotifications'));
vi.mock('@/components/PushSwitch', () => ({ PushSync: () => null }));
vi.mock('@/components/Sidebar', () => stub('Sidebar'));
vi.mock('@/components/ThemeSync', () => stub('ThemeSync'));
vi.mock('@/components/TimerChip', () => stub('TimerChip'));
vi.mock('@/components/ToastProvider', () => ({ ToastProvider: () => null }));
vi.mock('@/components/UserPrefs', () => ({ UserPrefsProvider: () => null }));

const { default: AppFrame } = await import('@/components/AppFrame');
const { default: LiveNotifications } = await import('@/components/live/LiveNotifications');

/** The first element of `type` in a tree of React elements. */
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (node.type === type) return node;
  return find(node.props?.children, type);
}

const person = (id) => ({ id, name: `Person ${id}`, email: `p${id}@example.com`, initials: 'P' });

describe('AppFrame’s live bell', () => {
  it('keys the provider by the person, with their own newest id', async () => {
    const first = find(await AppFrame({ user: person(2), children: null }), LiveNotifications);
    const second = find(await AppFrame({ user: person(12), children: null }), LiveNotifications);
    expect(first.props).toMatchObject({ userId: 2, latestId: 20 });
    expect(second.props).toMatchObject({ userId: 12, latestId: 120 });
    expect(first.key).toBe('2');
    expect(second.key).toBe('12');
  });
});
