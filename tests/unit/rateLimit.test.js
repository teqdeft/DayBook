import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, resetRateLimitsForTests, withRoute } from '@/lib/route';
import { setNowForTests } from '@/lib/time';

const SIGNIN = { key: 'signin', limit: 10, windowMs: 60_000 };
const START = '/api/auth/slack/start';
const CALLBACK = '/api/auth/slack/callback';

beforeEach(() => {
  resetRateLimitsForTests();
  setNowForTests('2026-10-01T04:00:00Z');
});

afterEach(() => setNowForTests(null));

describe('sign-in rate limit (guide 15.1: 10 attempts per minute per IP)', () => {
  it('allows 10 requests a minute per route and IP, then refuses', () => {
    for (let i = 0; i < 10; i += 1) checkRateLimit(SIGNIN, START, '203.0.113.24');
    expect(() => checkRateLimit(SIGNIN, START, '203.0.113.24')).toThrow(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
    // Another IP has its own bucket.
    expect(() => checkRateLimit(SIGNIN, START, '203.0.113.25')).not.toThrow();
  });

  it('counts the start and callback steps separately, so one sign-in is one attempt', () => {
    for (let i = 0; i < 10; i += 1) {
      checkRateLimit(SIGNIN, START, '203.0.113.24');
      checkRateLimit(SIGNIN, CALLBACK, '203.0.113.24');
    }
    expect(() => checkRateLimit(SIGNIN, CALLBACK, '203.0.113.24')).toThrow();
  });

  it('starts a fresh window after a minute', () => {
    for (let i = 0; i < 11; i += 1) {
      try {
        checkRateLimit(SIGNIN, START, '203.0.113.24');
      } catch {
        // the 11th is refused
      }
    }
    setNowForTests('2026-10-01T04:01:01Z');
    expect(() => checkRateLimit(SIGNIN, START, '203.0.113.24')).not.toThrow();
  });

  it('keeps the bucket map bounded', () => {
    for (let i = 0; i < 10_050; i += 1) checkRateLimit(SIGNIN, START, `ip-${i}`);
    expect(globalThis.__daybookRateBuckets.size).toBeLessThanOrEqual(10_000);
  });

  it('a forged X-Forwarded-For list does not open a fresh bucket', async () => {
    const route = withRoute({ permission: 'public', rateLimit: SIGNIN }, async () => ({}));
    const call = (forwarded) =>
      route(
        new Request(`http://localhost:3000${START}`, {
          headers: { 'x-forwarded-for': forwarded },
        }),
      );
    // Without a trusted proxy a list can't be ours, so every one counts as the same unknown IP.
    for (let i = 0; i < 10; i += 1) expect((await call(`198.51.100.${i}, ::1`)).status).toBe(200);
    expect((await call('198.51.100.99, ::1')).status).toBe(429);
  });
});
