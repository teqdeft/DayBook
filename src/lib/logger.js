// pino JSON logs. Never log tokens, cookies or report text.
import pino from 'pino';
import { env } from './env.js';

const globalForLogger = globalThis;

const isErrorObject = (value) =>
  value !== null && typeof value === 'object' && 'message' in value && 'stack' in value;

/**
 * Removes `sql` from a serialized error and the errors nested in it. mysql2 puts the whole
 * statement there with the values already filled in (task titles, edit-request reasons, Slack
 * text), which must never reach the logs. Knex keeps them out of the message (compileSqlOnError).
 */
function withoutSql(serialized) {
  if (!isErrorObject(serialized)) return serialized;
  delete serialized.sql;
  for (const value of Object.values(serialized)) {
    if (Array.isArray(value)) value.forEach(withoutSql);
    else withoutSql(value);
  }
  return serialized;
}

/** pino's error serializer, minus SQL text. Exported for tests. */
export function serializeError(error) {
  return withoutSql(pino.stdSerializers.err(error));
}

export const logger =
  globalForLogger.__daybookLogger ??
  pino({
    level: env.LOG_LEVEL,
    base: { app: 'daybook' },
    serializers: { err: serializeError },
    redact: {
      paths: [
        'token',
        'cookie',
        'headers.cookie',
        'authorization',
        'headers.authorization',
        'code',
      ],
      censor: '[redacted]',
    },
  });

if (!env.isProduction) globalForLogger.__daybookLogger = logger;
