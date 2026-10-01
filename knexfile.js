// Knex configuration, shared by the Knex CLI (migrations and seeds) and src/lib/db.js.
import { env } from './src/lib/env.js';

/** userId -> user_id */
export function toSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** user_id -> userId */
export function toCamel(value) {
  return value.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

function camelizeKeys(value) {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (
    value === null ||
    typeof value !== 'object' ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }
  const out = {};
  for (const [key, inner] of Object.entries(value)) out[toCamel(key)] = inner;
  return out;
}

/**
 * Builds the Knex config. `admin` uses the migration user when one is set.
 * @param {{ admin?: boolean }} [options]
 */
export function buildKnexConfig({ admin = false } = {}) {
  const user = admin && env.DB_MIGRATE_USER ? env.DB_MIGRATE_USER : env.DB_USER;
  const password = admin && env.DB_MIGRATE_USER ? env.DB_MIGRATE_PASSWORD : env.DB_PASSWORD;
  return {
    client: 'mysql2',
    // Query errors keep the SQL with '?' placeholders, not the bound values: those can be report
    // text, which must never reach the logs (guide 14). Knex's default fills the values in.
    compileSqlOnError: false,
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user,
      password,
      database: env.DB_NAME,
      charset: 'utf8mb4',
      // All DATETIME values are UTC. DATE values ("which working day") stay 'YYYY-MM-DD' strings.
      timezone: 'Z',
      dateStrings: ['DATE'],
      supportBigNumbers: true,
      decimalNumbers: true,
      // JSON always arrives as a string (MySQL and MariaDB alike); repos parse it with parseJson().
      jsonStrings: true,
      typeCast(field, next) {
        // TINYINT(1) columns are booleans.
        if (field.type === 'TINY' && field.length === 1) {
          const value = field.string();
          return value === null ? null : value === '1';
        }
        return next();
      },
    },
    pool: {
      min: env.DB_POOL_MIN,
      max: env.DB_POOL_MAX,
      afterCreate(connection, done) {
        // CURRENT_TIMESTAMP defaults must be UTC too.
        connection.query("SET time_zone = '+00:00'", (error) => done(error, connection));
      },
    },
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations',
      loadExtensions: ['.js'],
    },
    seeds: { directory: './db/seeds', loadExtensions: ['.js'] },
    wrapIdentifier: (value, origImpl) => origImpl(value === '*' ? value : toSnake(value)),
    postProcessResponse: (result) => camelizeKeys(result),
  };
}

export default buildKnexConfig({ admin: true });
