// Who hears about attendance problems: HR, or every Admin when no HR person is left to tell (the
// company has no HR yet, or the only HR person is the one the message is about).
import { users } from '@/modules/users';

/**
 * The active HR people and Admins, loaded once so a job can pick recipients for many rows.
 * @returns {Promise<{ hr: object[], admins: object[] }>} PublicUser lists
 */
export async function loadRecipientPools() {
  const [hr, admins] = await Promise.all([users.listByRole('hr'), users.listByRole('admin')]);
  return { hr, admins };
}

/**
 * HR people other than `exceptId`, or the Admins other than `exceptId` when that leaves nobody.
 * @param {{ hr: object[], admins: object[] }} pools from loadRecipientPools()
 * @param {number} [exceptId] the person the message is about
 * @returns {object[]}
 */
export function pickRecipients({ hr, admins }, exceptId) {
  const fromHr = hr.filter((person) => person.id !== exceptId);
  if (fromHr.length > 0) return fromHr;
  return admins.filter((person) => person.id !== exceptId);
}

/**
 * Active HR people (PublicUser), or active Admins when there is no other HR; never `exceptId`.
 * @param {number} [exceptId] the person the message is about
 * @returns {Promise<object[]>}
 */
export async function hrRecipients(exceptId) {
  return pickRecipients(await loadRecipientPools(), exceptId);
}
