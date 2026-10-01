import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { cleanIp, clientIpFrom, headersWithoutClientForwardedFor } from '@/lib/clientIp';
import { clientIp } from '@/lib/route';
import { config, proxy } from '@/proxy';

const headers = (value) => new Headers(value === undefined ? {} : { 'x-forwarded-for': value });

describe('client IP (guide 15.1: X-Forwarded-For only when TRUST_PROXY=true)', () => {
  it('normalises IPv4-mapped addresses and refuses anything that is not an IP', () => {
    expect(cleanIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(cleanIp(' ::1 ')).toBe('::1');
    expect(cleanIp('203.0.113.24')).toBe('203.0.113.24');
    expect(cleanIp('not-an-ip')).toBeNull();
    expect(cleanIp('x'.repeat(300))).toBeNull();
    expect(cleanIp('')).toBeNull();
  });

  it('without a trusted proxy, accepts only the single socket address Next.js fills in', () => {
    const trustProxy = false;
    expect(clientIpFrom(headers('::1'), { trustProxy })).toBe('::1');
    expect(clientIpFrom(headers('::ffff:192.168.1.20'), { trustProxy })).toBe('192.168.1.20');
    // A list can only have come from the client.
    expect(clientIpFrom(headers('203.0.113.24, 10.0.0.9'), { trustProxy })).toBeNull();
    expect(clientIpFrom(headers(undefined), { trustProxy })).toBeNull();
  });

  it('behind a trusted proxy, takes the right-most entry (the one our proxy added)', () => {
    const trustProxy = true;
    expect(clientIpFrom(headers('203.0.113.24, 49.36.112.10'), { trustProxy })).toBe(
      '49.36.112.10',
    );
    expect(clientIpFrom(headers('49.36.112.10'), { trustProxy })).toBe('49.36.112.10');
    expect(clientIpFrom(headers('203.0.113.24, junk'), { trustProxy })).toBeNull();
  });

  it('drops a client-sent X-Forwarded-For only when no proxy is trusted', () => {
    const sent = headers('203.0.113.24');
    const stripped = headersWithoutClientForwardedFor(sent, { trustProxy: false });
    expect(stripped.has('x-forwarded-for')).toBe(false);
    expect(headersWithoutClientForwardedFor(sent, { trustProxy: true })).toBeNull();
    expect(headersWithoutClientForwardedFor(headers(undefined), { trustProxy: false })).toBeNull();
  });

  it('the proxy strips a forged header on API routes and pages (TRUST_PROXY=false in tests)', () => {
    for (const path of ['/api/attendance/check-in', '/login']) {
      const request = new NextRequest(`http://localhost:3000${path}`, {
        headers: { 'x-forwarded-for': '203.0.113.24', 'user-agent': 'test' },
      });
      const response = proxy(request);
      expect(response.headers.get('location')).toBeNull();
      const kept = response.headers.get('x-middleware-override-headers').split(',');
      expect(kept).toContain('user-agent');
      expect(kept).not.toContain('x-forwarded-for');
    }
  });

  it('the proxy never redirects API routes and runs for them', () => {
    const request = new NextRequest('http://localhost:3000/api/me');
    expect(proxy(request).headers.get('location')).toBeNull();
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test('/api/attendance/check-in')).toBe(true);
    expect(matcher.test('/today')).toBe(true);
    expect(matcher.test('/_next/static/chunk.js')).toBe(false);
  });

  it('clientIp() reads Server Component headers the same way', () => {
    expect(clientIp({ headers: headers('::1') })).toBe('::1');
    expect(clientIp({ headers: headers('203.0.113.24, ::1') })).toBeNull();
  });
});
