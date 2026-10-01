import { db } from '@/lib/db';

/** Every settings row: [{ key, value (JSON string) }]. */
export function listSettings(trx = db) {
  return trx('settings').select('key', 'value');
}

/**
 * Saves one setting (value already JSON-encoded). Updates the row, or inserts it when the key is
 * missing (a key added after the seed ran).
 */
export async function saveSetting({ key, value, updatedBy, updatedAt }, trx = db) {
  const changed = await trx('settings').where({ key }).update({ value, updatedBy, updatedAt });
  if (changed === 0) await trx('settings').insert({ key, value, updatedBy, updatedAt });
}

const NETWORK_COLUMNS = ['id', 'name', 'ipAddress', 'createdBy', 'createdAt'];

export function listOfficeNetworks(trx = db) {
  return trx('office_networks')
    .select(NETWORK_COLUMNS)
    .orderBy([{ column: 'id', order: 'asc' }]);
}

export function findOfficeNetwork(id, trx = db) {
  return trx('office_networks').where({ id }).first(NETWORK_COLUMNS);
}

export function findOfficeNetworkByIp(ipAddress, trx = db) {
  return trx('office_networks').where({ ipAddress }).first(NETWORK_COLUMNS);
}

export async function insertOfficeNetwork(row, trx = db) {
  const [id] = await trx('office_networks').insert(row);
  return id;
}

export function deleteOfficeNetwork(id, trx = db) {
  return trx('office_networks').where({ id }).delete();
}
