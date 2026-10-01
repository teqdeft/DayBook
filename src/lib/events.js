// A small in-process event bus. Services emit after their transaction commits; listeners must not
// throw into the caller, so errors are logged and swallowed.
import { logger } from './logger.js';

const globalForEvents = globalThis;
const listeners = globalForEvents.__daybookEvents ?? new Map();
globalForEvents.__daybookEvents = listeners;

/**
 * @param {string} name for example 'attendance.checked_in'
 * @param {(payload: any) => void | Promise<void>} handler
 * @returns {() => void} unsubscribe
 */
export function on(name, handler) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(handler);
  return () => listeners.get(name)?.delete(handler);
}

/** Calls every listener for `name`. Never throws. */
export async function emit(name, payload) {
  const handlers = [...(listeners.get(name) ?? [])];
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(payload);
      } catch (error) {
        logger.error({ err: error, event: name }, 'event listener failed');
      }
    }),
  );
}
