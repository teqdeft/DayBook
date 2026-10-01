import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

const BASE = {
  NODE_ENV: 'production',
  DB_HOST: '127.0.0.1',
  DB_USER: 'daybook',
  DB_NAME: 'daybook',
  SESSION_SECRET: 'x'.repeat(64),
};

describe('environment', () => {
  it('starts without Slack sign-in configured', () => {
    expect(parseEnv(BASE).SLACK_TEAM_ID).toBe('');
  });

  it('refuses to start with Slack sign-in but no workspace (guide 15.1)', () => {
    const slack = { ...BASE, SLACK_CLIENT_ID: '123.456', SLACK_CLIENT_SECRET: 'secret' };
    expect(() => parseEnv(slack)).toThrow(/SLACK_TEAM_ID: required/);
    expect(() => parseEnv({ ...slack, SLACK_TEAM_ID: '  ' })).toThrow(/SLACK_TEAM_ID/);
    expect(parseEnv({ ...slack, SLACK_TEAM_ID: 'T0123ABCD' }).SLACK_TEAM_ID).toBe('T0123ABCD');
  });

  it('lists every variable that failed', () => {
    expect(() => parseEnv({ ...BASE, SESSION_SECRET: 'short', DB_HOST: '' })).toThrow(
      /DB_HOST[\s\S]*SESSION_SECRET|SESSION_SECRET[\s\S]*DB_HOST/,
    );
  });
});
