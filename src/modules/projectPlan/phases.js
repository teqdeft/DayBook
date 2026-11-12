// The fixed list of project phases (CONTRACT 22), in order. Phase is separate from status: it blocks
// nothing, and neither changes the other. Pure and safe in the browser.

export const PROJECT_PHASES = [
  { key: 'requirement_gathering', label: 'Requirement gathering' },
  { key: 'design', label: 'Design' },
  { key: 'development', label: 'Development' },
  { key: 'testing', label: 'Testing' },
  { key: 'launch', label: 'Launch' },
  { key: 'support', label: 'Support' },
];

export const PHASE_KEYS = PROJECT_PHASES.map((phase) => phase.key);

/** What a project with no phase yet shows. */
export const PHASE_NOT_SET = 'Not set';

/** True for a key on the list. */
export function isPhase(key) {
  return PHASE_KEYS.includes(key);
}

/**
 * The phase's name.
 * @param {string | null | undefined} key
 * @returns {string} 'Not set' for null and for anything not on the list
 */
export function phaseLabel(key) {
  return PROJECT_PHASES.find((phase) => phase.key === key)?.label ?? PHASE_NOT_SET;
}

/**
 * The phase's place on the list.
 * @param {string | null | undefined} key
 * @returns {number} 0 to 5, or -1 for null and for anything not on the list (before the first)
 */
export function phaseIndex(key) {
  return PHASE_KEYS.indexOf(key);
}

/**
 * The phase after this one.
 * @param {string | null | undefined} key
 * @returns {string | null} from null the first phase's key; null after the last and for anything
 *   not on the list
 */
export function nextPhase(key) {
  if (key === null || key === undefined) return PHASE_KEYS[0];
  const index = phaseIndex(key);
  return index === -1 ? null : (PHASE_KEYS[index + 1] ?? null);
}
