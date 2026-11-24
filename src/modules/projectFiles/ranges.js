// HTTP Range for file downloads (CONTRACT 27, Downloads): one range only (`bytes=a-b`, `a-`, `-n`).
// Several ranges, a bad header or an invalid range (`5-1`) mean the whole file (a server may always
// ignore Range, RFC 9110 14.2); a valid range outside the file is unsatisfiable (416). Pure.

const SPEC = /^(\d*)-(\d*)$/;

/**
 * @param {string | null | undefined} header the request's Range header
 * @param {number} size the file's size in bytes
 * @returns {{ start: number, end: number } | 'all' | 'unsatisfiable'} start and end inclusive
 */
export function parseRange(header, size) {
  const text = String(header ?? '').trim();
  const unit = /^bytes\s*=\s*(.*)$/i.exec(text);
  if (!unit) return 'all';
  const set = unit[1].trim();
  if (!set || set.includes(',')) return 'all';
  const match = SPEC.exec(set);
  if (!match || (match[1] === '' && match[2] === '')) return 'all';
  const first = match[1] === '' ? null : Number(match[1]);
  const last = match[2] === '' ? null : Number(match[2]);
  if (![first, last].every((value) => value === null || Number.isSafeInteger(value))) return 'all';
  if (first === null) {
    // a suffix: the last n bytes
    if (last === 0 || size <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (last !== null && last < first) return 'all';
  if (first >= size) return 'unsatisfiable';
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) };
}

/** The Content-Range of a 206: "bytes 0-99/1000". */
export const contentRange = (start, end, size) => `bytes ${start}-${end}/${size}`;

/** The Content-Range of a 416: "bytes *\/1000". */
export const unsatisfiedRange = (size) => `bytes */${size}`;
