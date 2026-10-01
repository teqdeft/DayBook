import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/safeRedirect';

describe('safeNextPath (the ?next= path after sign-in)', () => {
  it('keeps same-site paths with their query and hash', () => {
    expect(safeNextPath('/team')).toBe('/team');
    expect(safeNextPath('/team/2?from=2026-09-01#history')).toBe('/team/2?from=2026-09-01#history');
    expect(safeNextPath(['/log', '/today'])).toBe('/log');
  });

  it('refuses paths a browser would turn into another host', () => {
    // Browsers drop tab, CR and LF: '/\t/evil.com' becomes '//evil.com'.
    expect(safeNextPath('/\t/evil.com')).toBeNull();
    expect(safeNextPath('/\n/evil.com')).toBeNull();
    expect(safeNextPath('/\r/evil.com')).toBeNull();
    expect(safeNextPath('/\u0000/evil.com')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('evil.com')).toBeNull();
  });

  it('refuses sign-in and API paths, also after dot segments', () => {
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/login?next=/x')).toBeNull();
    expect(safeNextPath('/api/me')).toBeNull();
    expect(safeNextPath('/today/../api/me')).toBeNull();
  });

  it('refuses empty, missing and oversized values', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBeNull();
  });
});
