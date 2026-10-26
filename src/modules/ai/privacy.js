// What may leave Daybook for Gemini (CONTRACT 20 privacy). The PM summary and HR notes send
// people as tokens and put the names back into the answer; every text sent is also scrubbed of
// emails, phone numbers, IP addresses and Slack ids, in case a task line contains one.
//
// Tokens read "Person 1", "Person 2", … rather than "P1": P1–P3 are priority labels (CONTRACT 13)
// that summaries mention, and those must not turn into names.

const TOKEN_PREFIX = 'Person ';
const TOKEN_PATTERN = /\bPerson (\d{1,4})\b/g;

/** Add to a system prompt that receives tokens, so the model writes them back as they are. */
export const PEOPLE_TOKEN_NOTE =
  'People appear as "Person 1", "Person 2" and so on. Write each one exactly like that, ' +
  'one at a time (never "Persons 1 and 2"), and never guess their real names or genders.';

/**
 * Gives each person a token for a prompt, in the order given (a repeated id keeps its token).
 * @param {Array<{ id: number | string, name: string }>} people
 * @returns {{ tokenFor: (id: number | string) => string, names: Record<string, string> }}
 *   tokenFor(id) → 'Person 1' (throws for someone who wasn't passed in, so a name can't slip
 *   through); names maps each token to the name, for restoreNames()
 */
export function pseudonymize(people) {
  const tokens = new Map();
  const names = {};
  for (const person of people ?? []) {
    const key = String(person.id);
    if (tokens.has(key)) continue;
    const token = `${TOKEN_PREFIX}${tokens.size + 1}`;
    tokens.set(key, token);
    names[token] = String(person.name ?? '');
  }
  return {
    names,
    tokenFor(id) {
      const token = tokens.get(String(id));
      if (!token) throw new Error(`pseudonymize: person ${id} has no token`);
      return token;
    },
  };
}

/** Applies `fn` to every string in a JSON value (arrays and objects at any depth). */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]),
    );
  }
  return value;
}

/**
 * Puts the names back: every known token in a string (or in the strings of an array or object,
 * at any depth) becomes the person's name. Unknown tokens stay as they are.
 * @template T
 * @param {T} value text, or a JSON value such as `{ title, body }`
 * @param {Record<string, string>} names from pseudonymize()
 * @returns {T}
 */
export function restoreNames(value, names) {
  return mapStrings(value, (text) =>
    text.replace(TOKEN_PATTERN, (token) =>
      Object.hasOwn(names ?? {}, token) ? names[token] : token,
    ),
  );
}

// ---------- contact details ----------

// Letters, marks and digits of any script, so "rené@exemple.fr" is an email too.
const EMAIL = /[\p{L}\p{M}\p{N}_.%+-]+@[\p{L}\p{M}\p{N}-]+(?:\.[\p{L}\p{M}\p{N}-]+)+/gu;
const IPV4 =
  /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
// Candidates only; isIpv6() keeps clock times like 10:30:00 out.
const IPV6_CANDIDATE = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
// Candidates only; isPhone() keeps dates and lists of numbers out.
const PHONE_CANDIDATE = /(?<![\w+])\+?\(?\d[\d\s().-]{7,20}\d(?!\w)/g;
// Slack user ids (U…/W…, with at least one digit) and <@U…> mentions.
const SLACK_ID = /<@[UW][A-Z0-9]{6,12}>|\b[UW](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/g;
const PLACEHOLDER = /\[(?:email|phone|ip|slack id) \d{1,4}\]/g;

function isIpv6(text) {
  const colons = text.split(':').length - 1;
  return /[0-9a-f]/i.test(text) && (text.includes('::') || colons >= 5);
}

function isPhone(text) {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  if (text.startsWith('+')) return true;
  const groups = text.split(/[\s().-]+/).filter(Boolean);
  // "98765 43210", "(555) 123-4567" — never "2026-10-26" or "120 45 300 60".
  if (groups.every((group) => group.length >= 3)) return true;
  // A country or trunk code written without "+": "91 98765 43210", "1-800-555-0199",
  // "0 98765 43210" — 1-3 digits, then at least 10 digits in groups of 3 or more.
  const [code, ...number] = groups;
  return (
    code.length <= 3 &&
    number.length > 0 &&
    number.every((group) => group.length >= 3) &&
    number.join('').length >= 10
  );
}

/** Runs the contact patterns over a text; `hide(kind)` returns the replacer for one kind. */
function scrub(text, hide) {
  if (typeof text !== 'string' || text === '') return text;
  const ip = hide('ip');
  const phone = hide('phone');
  return text
    .replace(EMAIL, hide('email'))
    .replace(SLACK_ID, hide('slack id'))
    .replace(IPV4, ip)
    .replace(IPV6_CANDIDATE, (match) => (isIpv6(match) ? ip(match) : match))
    .replace(PHONE_CANDIDATE, (match) => (isPhone(match) ? phone(match) : match));
}

/**
 * Replaces emails, phone numbers, IP addresses and Slack ids in a text with "[email]", "[phone]",
 * "[ip]" and "[slack id]". Gemini never needs them (CONTRACT 20).
 * @param {string} text
 * @returns {string}
 */
export function redactContacts(text) {
  return scrub(text, (kind) => () => `[${kind}]`);
}

/**
 * A redactor for one conversation: contact details become numbered placeholders ("[email 1]";
 * the same detail keeps its number) and restore() puts them back into the answer, so a polished
 * task line keeps the email it had. Only the placeholders reach Gemini.
 * @returns {{ redact: (text: string) => string, redactDeep: <T>(value: T) => T,
 *   restore: <T>(value: T) => T }}
 */
export function createRedactor() {
  const placeholders = new Map(); // detail -> placeholder
  const details = new Map(); // placeholder -> detail
  const counts = {};
  const hide = (kind) => (match) => {
    if (!placeholders.has(match)) {
      counts[kind] = (counts[kind] ?? 0) + 1;
      const placeholder = `[${kind} ${counts[kind]}]`;
      placeholders.set(match, placeholder);
      details.set(placeholder, match);
    }
    return placeholders.get(match);
  };
  const redact = (text) => scrub(text, hide);
  return {
    redact,
    redactDeep: (value) => mapStrings(value, redact),
    restore: (value) =>
      mapStrings(value, (text) =>
        text.replace(PLACEHOLDER, (placeholder) => details.get(placeholder) ?? placeholder),
      ),
  };
}
