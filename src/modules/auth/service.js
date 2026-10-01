import crypto from 'node:crypto';
import { WebClient } from '@slack/web-api';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { now } from '@/lib/time';
import { initials } from '@/lib/text';
import { permissionsFor, ROLE_LABELS } from '@/lib/permissions';
import * as repo from './repo';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTEND_WHEN_LEFT_MS = 7 * DAY_MS;
const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

/** HMAC-SHA256 of a session token, keyed with SESSION_SECRET. Only this hash is stored. */
export function hashToken(token) {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

function ttlMs() {
  return env.SESSION_TTL_DAYS * DAY_MS;
}

/** '09:30:00' -> '09:30'; null stays null. */
function clock(value) {
  return value ? String(value).slice(0, 5) : null;
}

/** The user object every page, route and service receives. */
export function toSessionUser(row) {
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    designation: row.designation,
    departmentId: row.departmentId,
    departmentName: row.departmentName ?? null,
    reportsToId: row.reportsToId,
    avatarUrl: row.avatarUrl,
    slackUserId: row.slackUserId,
    tracksAttendance: Boolean(row.tracksAttendance),
    shiftStart: clock(row.shiftStart),
    shiftEnd: clock(row.shiftEnd),
    joinedOn: row.joinedOn,
    status: row.status,
    initials: initials(row.name),
  };
  user.permissions = permissionsFor(user);
  return user;
}

/**
 * Creates a session for a user and returns the raw token for the cookie.
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession({ userId, ip, userAgent }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const current = now().toDate();
  const expiresAt = new Date(current.getTime() + ttlMs());
  await repo.insertSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: ip ?? null,
    userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
    lastSeenAt: current,
  });
  return { token, expiresAt };
}

/**
 * Loads the signed-in user for a token. Extends the session when fewer than 7 days are left and
 * updates last_seen_at at most every 5 minutes.
 * @returns {Promise<(ReturnType<typeof toSessionUser> & { sessionExpiresAt: Date, sessionExtended: boolean }) | null>}
 */
export async function resolveSession(token) {
  if (!token || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = await repo.findSessionWithUser(tokenHash);
  if (!row) return null;
  const current = now().toDate();
  if (new Date(row.sessionExpiresAt) <= current) {
    await repo.deleteSessionByHash(tokenHash);
    return null;
  }
  if (row.status !== 'active') {
    await repo.deleteSessionsForUser(row.id);
    return null;
  }
  const changes = {};
  let expiresAt = new Date(row.sessionExpiresAt);
  let extended = false;
  if (expiresAt.getTime() - current.getTime() < EXTEND_WHEN_LEFT_MS) {
    expiresAt = new Date(current.getTime() + ttlMs());
    changes.expiresAt = expiresAt;
    extended = true;
  }
  if (!row.sessionLastSeenAt || current - new Date(row.sessionLastSeenAt) > LAST_SEEN_EVERY_MS) {
    changes.lastSeenAt = current;
  }
  if (Object.keys(changes).length > 0) await repo.updateSession(row.sessionId, changes);
  return { ...toSessionUser(row), sessionExpiresAt: expiresAt, sessionExtended: extended };
}

/** Ends one session (logout). */
export async function destroySession(token) {
  if (!token) return;
  await repo.deleteSessionByHash(hashToken(token));
}

/** Ends every session of a user, for example when they are deactivated. */
export function destroyUserSessions(userId, trx) {
  return repo.deleteSessionsForUser(userId, trx);
}

/** Deletes expired sessions. Used by the daily cleanup job. */
export function deleteExpiredSessions() {
  return repo.deleteExpiredSessions(now().toDate());
}

// ---------- Sign in with Slack (OpenID Connect) ----------

export function isSlackSignInConfigured() {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

function redirectUri() {
  return `${env.appOrigin}/api/auth/slack/callback`;
}

function sign(value) {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(value).digest('base64url');
}

/**
 * Starts Slack sign-in: random state and nonce, kept in a short signed cookie.
 * @returns {{ url: string, cookieValue: string }}
 */
export function startSlackSignIn() {
  if (!isSlackSignInConfigured()) throw new AppError('SLACK_NOT_CONFIGURED');
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    scope: 'openid email profile',
    client_id: env.SLACK_CLIENT_ID,
    state,
    nonce,
    redirect_uri: redirectUri(),
  });
  if (env.SLACK_TEAM_ID) params.set('team', env.SLACK_TEAM_ID);
  const payload = `${state}.${nonce}`;
  return {
    url: `https://slack.com/openid/connect/authorize?${params.toString()}`,
    cookieValue: `${payload}.${sign(payload)}`,
  };
}

function readStateCookie(cookieValue) {
  const parts = String(cookieValue ?? '').split('.');
  if (parts.length !== 3) return null;
  const [state, nonce, signature] = parts;
  const expected = sign(`${state}.${nonce}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { state, nonce };
}

function decodeJwtPayload(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Finishes Slack sign-in. Checks state and nonce, the workspace, and that the email belongs to an
 * active Daybook user, then records the Slack details.
 * @throws SIGNIN_STATE_MISMATCH, WRONG_WORKSPACE, NOT_IN_DAYBOOK, ACCOUNT_DEACTIVATED, SLACK_ERROR
 * @returns {Promise<{ userId: number }>}
 */
export async function finishSlackSignIn({ code, state, cookieValue, companyName }) {
  if (!isSlackSignInConfigured()) throw new AppError('SLACK_NOT_CONFIGURED');
  const saved = readStateCookie(cookieValue);
  if (!saved || !state || saved.state !== state || !code)
    throw new AppError('SIGNIN_STATE_MISMATCH');

  let identity;
  try {
    const client = new WebClient();
    const tokens = await client.openid.connect.token({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(),
    });
    const claims = decodeJwtPayload(tokens.id_token);
    if (!claims || claims.nonce !== saved.nonce) throw new AppError('SIGNIN_STATE_MISMATCH');
    identity = await new WebClient(tokens.access_token).openid.connect.userInfo();
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn({ err: error }, 'slack sign-in exchange failed');
    throw new AppError('SLACK_ERROR', { cause: error });
  }

  const teamId = identity['https://slack.com/team_id'];
  if (env.SLACK_TEAM_ID && teamId !== env.SLACK_TEAM_ID) {
    logger.warn({ teamId }, 'sign-in from another workspace refused');
    throw new AppError('WRONG_WORKSPACE', {
      message: `Use the ${companyName ?? '[Company name]'} Slack workspace.`,
    });
  }
  const email = String(identity.email ?? '').toLowerCase();
  const user = email ? await repo.findUserByEmail(email) : null;
  if (!user) {
    logger.warn('sign-in refused: email not in Daybook');
    throw new AppError('NOT_IN_DAYBOOK');
  }
  if (user.status !== 'active') {
    logger.warn({ userId: user.id }, 'sign-in refused: deactivated');
    throw new AppError('ACCOUNT_DEACTIVATED');
  }
  await repo.updateUser(user.id, {
    slackUserId: identity['https://slack.com/user_id'] ?? user.slackUserId,
    avatarUrl: identity.picture ?? user.avatarUrl,
    lastLoginAt: now().toDate(),
  });
  return { userId: user.id };
}

/**
 * Development and test sign-in without Slack. Never available in production.
 * @throws NOT_FOUND, ACCOUNT_DEACTIVATED
 */
export async function devSignIn({ email }) {
  if (!env.devLoginEnabled && !env.isTest) throw new AppError('NOT_FOUND');
  const user = await repo.findUserByEmail(email);
  if (!user) throw new AppError('NOT_IN_DAYBOOK');
  if (user.status !== 'active') throw new AppError('ACCOUNT_DEACTIVATED');
  await repo.updateUser(user.id, { lastLoginAt: now().toDate() });
  return { userId: user.id };
}
