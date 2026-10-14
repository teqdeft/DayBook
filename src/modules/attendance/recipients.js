// Who hears about attendance problems. About an Admin: the other active Admins only (HR and PMs
// never see an Admin's attendance), so nobody when there is no other Admin. About anyone else: HR,
// or every Admin when no HR person is left to tell (the company has no HR yet, or the only HR
// person is the one the message is about). Work-from-home requests go to their approvers
// (pickWfhApprovers).
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
 * Who to tell about `about`'s attendance (see the file comment); never `about` themselves.
 * @param {{ hr: object[], admins: object[] }} pools from loadRecipientPools()
 * @param {{ id: number, role?: string }} about the person the message is about
 * @returns {object[]}
 */
export function pickRecipients({ hr, admins }, about) {
  const others = (list) => list.filter((person) => person.id !== about?.id);
  if (about?.role === 'admin') return others(admins);
  const fromHr = others(hr);
  return fromHr.length > 0 ? fromHr : others(admins);
}

/**
 * Who to tell about `about`'s attendance (PublicUser list), see pickRecipients().
 * @param {{ id: number, role?: string }} about the person the message is about
 * @returns {Promise<object[]>}
 */
export async function recipientsAbout(about) {
  return pickRecipients(await loadRecipientPools(), about);
}

/**
 * Who decides on `about`'s work-from-home request (CONTRACT 17): an Admin's goes to the other
 * Admins (nobody when there is none); an HR person's to the Admins (the other HR people when the
 * company has no Admin); anyone else's to HR, or every Admin when there is no HR person.
 * @param {{ hr: object[], admins: object[] }} pools from loadRecipientPools()
 * @param {{ id: number, role?: string }} about the person who asked
 * @returns {object[]} never `about` themselves
 */
export function pickWfhApprovers({ hr, admins }, about) {
  const others = (list) => list.filter((person) => person.id !== about?.id);
  if (about?.role === 'admin') return others(admins);
  const [fromHr, fromAdmins] = [others(hr), others(admins)];
  if (about?.role === 'hr') return fromAdmins.length > 0 ? fromAdmins : fromHr;
  return fromHr.length > 0 ? fromHr : fromAdmins;
}

/**
 * Who decides on `about`'s work-from-home request (PublicUser list), see pickWfhApprovers().
 * @param {{ id: number, role?: string }} about
 * @returns {Promise<object[]>}
 */
export async function wfhApproversFor(about) {
  return pickWfhApprovers(await loadRecipientPools(), about);
}
