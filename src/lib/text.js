// Small text helpers shared by server and client code. No Node or browser APIs here.

/**
 * Two-letter initials: 'Vishal Saini' -> 'VS'. Placeholder names like '[PM name]' use the first
 * word when it is an acronym: '[PM name]' -> 'PM', '[CEO name]' -> 'CE'.
 */
export function initials(name) {
  const words = String(name ?? '')
    .replace(/[[\]()]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0];
  if (words.length === 1 || /^[A-Z]{2,}$/.test(first)) return first.slice(0, 2).toUpperCase();
  return (first[0] + words[1][0]).toUpperCase();
}

// Order chosen so the hash below gives each person the same tint on every screen.
const PERSON_TONES = ['orange', 'pink', 'violet', 'red', 'green', 'blue', 'teal'];

function hashName(value) {
  let hash = (5493 ^ 0x811c9dc5) >>> 0;
  for (const char of String(value).toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * Avatar tint for a person: PMs are navy, Admins are ink, deactivated people are grey,
 * everyone else gets a stable tint from their name.
 * @param {{ name: string, role?: string, status?: string }} user
 */
export function avatarTone(user) {
  if (!user) return 'grey';
  if (user.status === 'deactivated') return 'grey';
  if (user.role === 'admin') return 'ink';
  if (user.role === 'pm') return 'navy';
  return PERSON_TONES[hashName(user.name) % PERSON_TONES.length];
}

/** Lowercase, no spaces, dashes or underscores: 'I will till-im well' -> 'iwilltillimwell'. */
export function compactName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** 'report' / 'reports' */
export function plural(count, one, many = `${one}s`) {
  return count === 1 ? one : many;
}
