import { cache } from 'react';
import * as service from './service';

export const preferences = service;

// React's cache lasts one server request. Outside one (the worker, tests) it reads every time.
// Frozen: the layout and the page share the same object.
const readOnce = cache(async (userId) => Object.freeze(await service.getFor(userId)));

/**
 * preferences.getFor for the signed-in person, read once per server request: the layout (theme,
 * bell) and the page (report, My settings) share one query. Rejects like getFor (only on a
 * database error other than a missing table); callers that must still render fall back to
 * preferences.PREFERENCE_DEFAULTS.
 * @param {{ id: number }} user the session user
 * @returns {Promise<Readonly<object>>} every preference (see preferences.getFor), frozen
 */
export function preferencesFor(user) {
  return readOnce(Number(user.id));
}
