// The only file that reads process.env. Everything else imports the parsed `env` object.
import os from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import { z } from 'zod';

// Next.js loads .env files itself. The worker, Knex CLI and Vitest run outside Next,
// so they load the same files here, in the same order Next uses.
if (!process.env.__NEXT_PROCESSED_ENV) {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
    info() {},
    error: console.error,
  });
}

const bool = (fallback) => z.stringbool().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRUST_PROXY: bool(false),
  DEFAULT_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DB_MIGRATE_USER: z.string().default(''),
  DB_MIGRATE_PASSWORD: z.string().default(''),

  SESSION_SECRET: z.string().min(32, 'must be at least 32 random characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_COOKIE_NAME: z.string().min(1).default('daybook_session'),

  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_TEAM_ID: z.string().trim().default(''),
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_SIGNING_SECRET: z.string().default(''),

  SEED_ADMIN_EMAIL: z.string().default(''),
  SEED_ADMIN_NAME: z.string().default(''),

  // Desktop notifications (Web Push). Without both keys, pushes are skipped and the bell still works.
  VAPID_PUBLIC_KEY: z.string().trim().default(''),
  VAPID_PRIVATE_KEY: z.string().trim().default(''),
  VAPID_SUBJECT: z.string().trim().default('mailto:admin@example.com'),

  // Gemini (CONTRACT 20). Without a key every AI feature is off; Admin also switches AI on in
  // Settings. The models can change when Google renames them.
  GEMINI_API_KEY: z.string().trim().default(''),
  GEMINI_MODEL: z.string().trim().default('gemini-3.5-flash-lite'),
  GEMINI_SMART_MODEL: z.string().trim().default('gemini-3.5-flash'),

  // Files (CONTRACT 27): the private folder for project and task files, and the piece size of
  // uploads. Production has no folder by default: without one Daybook runs with files off.
  FILES_DIR: z.string().trim().default(''),
  FILES_PIECE_BYTES: z.coerce.number().int().default(4_194_304),

  WORKER_CRON_ENABLED: bool(true),
  DEV_LOGIN_ENABLED: bool(false),
});

// The piece size Start hands out: production 1 to 8 MiB (lower it for a stricter host), elsewhere
// 64 KiB (e2e) to 4 MiB.
const PIECE_RANGES = {
  production: [1_048_576, 8_388_608],
  other: [65_536, 4_194_304],
};

/** [min, max] piece bytes for the mode. */
const pieceRange = (nodeEnv) => PIECE_RANGES[nodeEnv === 'production' ? 'production' : 'other'];

/**
 * The files folder and whether it came from the default (CONTRACT 27, Storage). Tests always use
 * their own folder under the system temp folder, one per test database, and ignore FILES_DIR, so a
 * value in a .env file is never used, or emptied, by tests. Development defaults to .daybook-files
 * in the project folder (git-ignored): `next dev`, the worker and the Knex CLI all run from there,
 * the folder the .env files above are read from. Production has no default (''): the storage
 * check reports it as not set. The value is kept as written (only trimmed): a relative path or
 * `~` is reported by the storage check, never resolved here.
 */
function filesFolder(parsed) {
  if (parsed.NODE_ENV === 'test') {
    const database = parsed.DB_NAME.replace(/[^\w-]/g, '_');
    return { filesDir: path.join(os.tmpdir(), 'daybook-test-files', database), isDefault: true };
  }
  if (parsed.FILES_DIR) return { filesDir: parsed.FILES_DIR, isDefault: false };
  if (parsed.NODE_ENV === 'production') return { filesDir: '', isDefault: false };
  return { filesDir: path.join(process.cwd(), '.daybook-files'), isDefault: true };
}

/** Rules that involve more than one variable. Returns `  NAME: message` lines. */
function crossFieldProblems(parsed) {
  const problems = [];
  // Guide 10 and 15.1: sign-in is limited to one Slack workspace. Without a team ID the check
  // would be skipped and any workspace with a matching email could sign in.
  if (parsed.SLACK_CLIENT_ID && parsed.SLACK_CLIENT_SECRET && !parsed.SLACK_TEAM_ID) {
    problems.push(
      '  SLACK_TEAM_ID: required when Sign in with Slack is set up (SLACK_CLIENT_ID and ' +
        'SLACK_CLIENT_SECRET); only this workspace may sign in',
    );
  }
  const [min, max] = pieceRange(parsed.NODE_ENV);
  if (parsed.FILES_PIECE_BYTES < min || parsed.FILES_PIECE_BYTES > max) {
    problems.push(`  FILES_PIECE_BYTES: must be from ${min} to ${max} bytes`);
  }
  return problems;
}

/**
 * Parses and checks environment variables. Throws with every variable that failed.
 * @param {Record<string, string | undefined>} [source] defaults to process.env
 */
export function parseEnv(source = process.env) {
  // Empty strings count as "not set" for values that have defaults (for example PORT=).
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((key) => [key, source[key] === '' ? undefined : source[key]]),
  );
  const result = schema.safeParse(raw);
  const problems = result.success
    ? crossFieldProblems(result.data)
    : result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  if (problems.length > 0) {
    throw new Error(
      `Daybook can't start. Fix these environment variables:\n${problems.join('\n')}`,
    );
  }
  const parsed = result.data;
  // A Slack bot token placeholder from .env.example counts as "not configured".
  if (parsed.SLACK_BOT_TOKEN === 'xoxb-...') parsed.SLACK_BOT_TOKEN = '';
  const { filesDir, isDefault } = filesFolder(parsed);
  // Ignored in tests: blank, so nothing can reach the folder a .env file names.
  if (parsed.NODE_ENV === 'test') parsed.FILES_DIR = '';
  return Object.freeze({
    ...parsed,
    isProduction: parsed.NODE_ENV === 'production',
    isTest: parsed.NODE_ENV === 'test',
    // The dev "Sign in as" shortcut never exists in production, whatever the flag says.
    devLoginEnabled: parsed.NODE_ENV !== 'production' && parsed.DEV_LOGIN_ENABLED,
    appOrigin: new URL(parsed.APP_URL).origin,
    filesDir,
    filesDirIsDefault: isDefault,
    filesPieceBytes: parsed.FILES_PIECE_BYTES,
  });
}

export const env = parseEnv();
