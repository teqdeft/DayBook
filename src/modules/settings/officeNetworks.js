// Office networks (Settings, Check-in): the office's public IPs, which make an office check-in
// verified. Re-exported from service.js.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { parseInput } from './parse';
import * as repo from './repo';
import { normalizeIp, officeNetworkSchema } from './schemas';

function duplicateNetwork() {
  return new AppError('DUPLICATE_NETWORK', {
    fields: { ipAddress: 'That IP address is already saved.' },
  });
}

/**
 * Saved office networks, oldest first.
 * @returns {Promise<Array<{ id: number, name: string, ipAddress: string, createdBy: number | null,
 *   createdAt: Date }>>}
 */
export function listOfficeNetworks() {
  return repo.listOfficeNetworks();
}

/**
 * Adds an office network (the office's public IP). Audited as 'office_network.add'.
 * @param {{ user: { id: number }, name: string, ipAddress: string, ip?: string | null }} input
 * @returns {Promise<{ id: number, name: string, ipAddress: string, createdBy: number | null,
 *   createdAt: Date }>}
 * @throws VALIDATION_FAILED (name 1-80 characters, a valid IPv4 or IPv6 address),
 *   DUPLICATE_NETWORK when the IP address is already saved
 */
export async function addOfficeNetwork({ user, name, ipAddress, ip }) {
  const input = parseInput(officeNetworkSchema, { name, ipAddress });
  if (await repo.findOfficeNetworkByIp(input.ipAddress)) throw duplicateNetwork();
  try {
    return await db.transaction(async (trx) => {
      const at = nowDate();
      const id = await repo.insertOfficeNetwork(
        { ...input, createdBy: user?.id ?? null, createdAt: at, updatedAt: at },
        trx,
      );
      await audit.log(
        {
          actorId: user?.id ?? null,
          action: 'office_network.add',
          entityType: 'office_network',
          entityId: id,
          after: input,
          ip,
        },
        trx,
      );
      return repo.findOfficeNetwork(id, trx);
    });
  } catch (error) {
    // Two admins adding the same IP at once: the unique key catches the second one.
    if (error?.errno === 1062) throw duplicateNetwork();
    throw error;
  }
}

/**
 * Removes an office network. Audited as 'office_network.remove'.
 * @param {{ user: { id: number }, id: number | string, ip?: string | null }} input
 * @returns {Promise<{ id: number }>}
 * @throws NOT_FOUND when the network doesn't exist (or was already removed)
 */
export async function removeOfficeNetwork({ user, id, ip }) {
  const networkId = Number(id);
  if (!Number.isInteger(networkId) || networkId <= 0) throw new AppError('NOT_FOUND');
  return db.transaction(async (trx) => {
    const network = await repo.findOfficeNetwork(networkId, trx);
    if (!network) throw new AppError('NOT_FOUND', { message: 'That network was already removed.' });
    await repo.deleteOfficeNetwork(networkId, trx);
    await audit.log(
      {
        actorId: user?.id ?? null,
        action: 'office_network.remove',
        entityType: 'office_network',
        entityId: networkId,
        before: { name: network.name, ipAddress: network.ipAddress },
        ip,
      },
      trx,
    );
    return { id: networkId };
  });
}

/**
 * True when the IP is one of the saved office networks (exact match; '::ffff:' IPv4-mapped
 * addresses are compared as plain IPv4).
 * @param {string | null | undefined} ip
 * @returns {Promise<boolean>}
 */
export async function isOfficeIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return false;
  return Boolean(await repo.findOfficeNetworkByIp(value));
}
