// File names (CONTRACT 27, Names): the cleaned display name the server keeps, its extension, the
// rename rule, a middle ellipsis for one-line rows and the Content-Disposition value of downloads.
// Pure and browser-safe (no imports), so the browser shows the name the server will keep.

const MAX_CHARS = 200;
const MAX_BYTES = 240;
const ELLIPSIS = '\u2026';
// Control characters, then bidi and invisible ones (a right-to-left override can show
// "report.exe" as a document name).
const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f\u200b-\u200d\ufeff]/g;
const LONE_SURROGATES = /\p{Cs}/gu;
const WINDOWS_REFUSED = /[<>:"/\\|?*]/g;
const EDGES = /^[\s.]+|[\s.]+$/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const EXT = /^[a-z0-9]{1,10}$/i;

const encoder = new TextEncoder();
const bytesOf = (text) => encoder.encode(text).length;
const charsOf = (text) => Array.from(text).length;

/**
 * The extension of a name: after the last dot (not a leading one), lower case, letters and digits
 * only, at most 10 characters; else ''.
 * @param {string} name
 */
export function extOf(name) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = text.slice(dot + 1);
  return EXT.test(ext) ? ext.toLowerCase() : '';
}

/** Splits a name into its base and its kept suffix (".pdf", as written), when it has one. */
function splitName(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || !EXT.test(name.slice(dot + 1))) return { base: name, suffix: '' };
  return { base: name.slice(0, dot), suffix: name.slice(dot) };
}

/**
 * Cuts the middle of `base` (keeping `suffix` whole) until `fits` says yes; the start keeps about
 * 70% of what stays, as a person reads a name from its start ("a-very-long…name.pdf").
 * @param {string} base
 * @param {string} suffix
 * @param {(text: string) => boolean} fits
 */
function cutMiddle(base, suffix, fits) {
  if (fits(base + suffix)) return base + suffix;
  const chars = Array.from(base);
  for (let keep = chars.length - 1; keep > 0; keep -= 1) {
    const head = Math.ceil(keep * 0.7);
    const text =
      chars.slice(0, head).join('') + ELLIPSIS + chars.slice(chars.length - (keep - head)).join('');
    if (fits(text + suffix)) return text + suffix;
  }
  return ELLIPSIS + suffix;
}

const fitsStored = (text) => charsOf(text) <= MAX_CHARS && bytesOf(text) <= MAX_BYTES;

/**
 * The display name Daybook keeps for a file (never used on disk): NFC; the last part after / or \;
 * no control, bidi or invisible characters; `< > : " / \ | ? *` become `_`; no spaces or dots at
 * either end; `_` before a Windows reserved base name; at most 200 characters and 240 UTF-8 bytes,
 * cut in the middle of the base name so the extension stays; empty → `file`.
 * @param {string} raw the name the browser sent
 * @returns {string}
 */
export function cleanFileName(raw) {
  let name = String(raw ?? '')
    .replace(LONE_SURROGATES, '')
    .normalize('NFC');
  name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  name = name.replace(UNSAFE_CHARS, '').replace(WINDOWS_REFUSED, '_').replace(EDGES, '');
  if (!name) return 'file';
  const firstDot = name.indexOf('.');
  if (RESERVED.test(firstDot === -1 ? name : name.slice(0, firstDot))) name = `_${name}`;
  const { base, suffix } = splitName(name);
  return cutMiddle(base || 'file', suffix, fitsStored);
}

/**
 * A rename keeps the stored extension (CONTRACT 27, Names): the new base name plus `.ext`, cleaned,
 * so a rename never changes the type ("b.svg" on a PNG becomes "b.svg.png"). A file stored without
 * one never gains one either: its last dot becomes `_` ("setup.exe" on README becomes "setup_exe"),
 * or the download would carry a type the file never had, without the program file line.
 * @param {string} baseName what the person typed
 * @param {string} ext the stored extension ('' when the file has none)
 */
export function renamedFileName(baseName, ext) {
  if (!ext) {
    const name = cleanFileName(baseName);
    if (!extOf(name)) return name;
    const dot = name.lastIndexOf('.');
    return `${name.slice(0, dot)}_${name.slice(dot + 1)}`;
  }
  const name = cleanFileName(`${baseName}.${ext}`);
  if (extOf(name) !== ext) return cleanFileName(`file.${ext}`);
  return name;
}

/**
 * A name cut in the middle for one line ("checkout-err…steps.pdf"), keeping the extension.
 * @param {string} name
 * @param {number} [max] characters at most
 */
export function middleEllipsis(name, max = 32) {
  const text = String(name ?? '');
  const { base, suffix } = splitName(text);
  if (charsOf(suffix) + 2 > max) return cutMiddle(text, '', (value) => charsOf(value) <= max);
  return cutMiddle(base, suffix, (value) => charsOf(value) <= max);
}

/**
 * The Content-Disposition value of a download or an inline picture: an ASCII `filename` first
 * (NFKD, non-ASCII dropped, `"` `\` `%` made `_`; `download.<ext>` when nothing is left), then
 * `filename*` in UTF-8 (RFC 8187: `'` `(` `)` `*` encoded too).
 * @param {'attachment' | 'inline'} kind
 * @param {string} name the stored name
 */
export function contentDisposition(kind, name) {
  const text = String(name ?? '').replace(LONE_SURROGATES, '');
  const ext = extOf(text);
  let ascii = text
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\%]/g, '_')
    .trim();
  if (!ascii || /^\.*$/.test(ascii) || (ext && ascii.toLowerCase() === `.${ext}`)) {
    ascii = ext ? `download.${ext}` : 'download';
  }
  const encoded = encodeURIComponent(text || ascii).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
