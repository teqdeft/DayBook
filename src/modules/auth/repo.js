import { db } from '@/lib/db';

export function insertSession(row, trx = db) {
  return trx('sessions').insert(row);
}

/** The session and its user (with department name), by token hash. */
export function findSessionWithUser(tokenHash, trx = db) {
  return trx('sessions as s')
    .join('users as u', 'u.id', 's.userId')
    .leftJoin('departments as d', 'd.id', 'u.departmentId')
    .where('s.tokenHash', tokenHash)
    .first(
      's.id as sessionId',
      's.expiresAt as sessionExpiresAt',
      's.lastSeenAt as sessionLastSeenAt',
      'u.*',
      'd.name as departmentName',
    );
}

export function updateSession(id, changes, trx = db) {
  return trx('sessions').where({ id }).update(changes);
}

export function deleteSessionByHash(tokenHash, trx = db) {
  return trx('sessions').where({ tokenHash }).delete();
}

export function deleteSessionsForUser(userId, trx = db) {
  return trx('sessions').where({ userId }).delete();
}

export function deleteExpiredSessions(before, trx = db) {
  return trx('sessions').where('expiresAt', '<', before).delete();
}

export function findUserByEmail(email, trx = db) {
  return trx('users').where({ email: email.toLowerCase() }).first();
}

export function updateUser(id, changes, trx = db) {
  return trx('users').where({ id }).update(changes);
}
