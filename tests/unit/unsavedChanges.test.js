import { describe, expect, it } from 'vitest';
import { isInAppNavigation } from '@/components/useUnsavedChangesWarning';

const HERE = 'http://localhost:3000/settings';
const click = { button: 0 };

describe('isInAppNavigation (unsaved changes on Settings and Roles)', () => {
  it('catches sidebar and menu links to another screen', () => {
    expect(isInAppNavigation({ href: 'http://localhost:3000/overview' }, click, HERE)).toBe(true);
    expect(isInAppNavigation({ href: '/settings/roles' }, click, HERE)).toBe(true);
    expect(isInAppNavigation({ href: '/settings?tab=slack' }, click, HERE)).toBe(true);
  });

  it('leaves same-page anchors, new tabs, downloads and other sites alone', () => {
    expect(isInAppNavigation({ href: '/settings#company' }, click, HERE)).toBe(false);
    expect(isInAppNavigation({ href: '/overview', target: '_blank' }, click, HERE)).toBe(false);
    expect(isInAppNavigation({ href: '/overview' }, { button: 0, metaKey: true }, HERE)).toBe(
      false,
    );
    expect(isInAppNavigation({ href: '/overview' }, { button: 1 }, HERE)).toBe(false);
    expect(isInAppNavigation({ href: '/api/exports/hours', download: true }, click, HERE)).toBe(
      false,
    );
    // Leaving the site is beforeunload's job.
    expect(isInAppNavigation({ href: 'https://slack.com/' }, click, HERE)).toBe(false);
  });
});
