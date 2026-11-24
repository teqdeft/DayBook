// File kinds by extension (CONTRACT 27, Modules, kinds.js): the type tile and label of a file, the
// only extensions ever shown inside Daybook (pictures), program files that get the gentle warning,
// the files read for the AI summary, and sizes in words. Pure and browser-safe (no imports).

const list = (text) => Object.freeze(text.split(' '));

/** The only extensions ever shown inside Daybook (and only when their first bytes agree). */
export const PICTURE_EXTS = list('png jpg jpeg gif webp');

/** ext → the Content-Type of `/view` (any other ext answers 404, whatever `is_picture` says). */
export const PICTURE_TYPES = Object.freeze(
  Object.assign(Object.create(null), {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  }),
);

/** Programs and scripts: they get "Program file. Open it only if you trust where it came from." */
export const PROGRAM_EXTS = list(
  'exe msi msp msix appx bat cmd com cpl pif scr msc ps1 psm1 vbs vbe js jse wsf wsh jar apk sh ' +
    'lnk scf url hta reg inf chm dll xll iso img vhd vhdx dmg pkg app command deb rpm run appimage',
);

/** Project files whose text the PM's browser reads for the AI summary. */
export const READABLE_EXTS = list('pdf docx txt md');

// Checked in this order, so `js` is a program before it could be code.
const KINDS = [
  ['picture', list('png jpg jpeg gif webp svg bmp tif tiff heic heif ico psd ai eps')],
  ['program', PROGRAM_EXTS],
  ['pdf', list('pdf')],
  ['word', list('doc docx docm odt rtf pages')],
  ['excel', list('xls xlsx xlsm ods csv tsv numbers')],
  ['slides', list('ppt pptx pptm odp key')],
  ['text', list('txt md log')],
  ['archive', list('zip rar 7z tar gz tgz bz2 xz')],
  ['video', list('mp4 mov avi mkv webm m4v wmv')],
  ['audio', list('mp3 wav m4a aac ogg flac wma')],
  [
    'code',
    list(
      'html htm xhtml mht mhtml xml json css ts jsx tsx py php java c cpp h cs go rb sql yml yaml',
    ),
  ],
];

const LABELS = Object.freeze({
  picture: 'Picture',
  program: 'Program',
  pdf: 'PDF',
  word: 'Word',
  excel: 'Excel',
  slides: 'PowerPoint',
  text: 'Text',
  archive: 'Zip',
  video: 'Video',
  audio: 'Audio',
});

const clean = (ext) => String(ext ?? '').toLowerCase();

/**
 * The kind of a file by its extension (the type tile; never decides what is shown inline).
 * @param {string} ext
 * @returns {'picture' | 'program' | 'pdf' | 'word' | 'excel' | 'slides' | 'text' | 'archive' |
 *   'video' | 'audio' | 'code' | 'file'}
 */
export function kindOf(ext) {
  const value = clean(ext);
  if (!value) return 'file';
  for (const [kind, exts] of KINDS) {
    if (exts.includes(value)) return kind;
  }
  return 'file';
}

/**
 * The type in words: "PDF", "Word", ...; for code and other files the extension in capitals
 * ("HTML", "DWG"), or "File" without one.
 * @param {string} ext
 */
export function typeLabel(ext) {
  const kind = kindOf(ext);
  if (LABELS[kind]) return LABELS[kind];
  return clean(ext) ? clean(ext).toUpperCase() : 'File';
}

/** @param {string} ext */
export const isProgram = (ext) => PROGRAM_EXTS.includes(clean(ext));

/** @param {string} ext an extension that may be shown inline when its bytes agree */
export const isPictureExt = (ext) => PICTURE_EXTS.includes(clean(ext));

/** @param {string} ext */
export const isReadableExt = (ext) => READABLE_EXTS.includes(clean(ext));

/** @param {string} ext @returns {string | null} the inline Content-Type of a picture */
export const pictureType = (ext) => PICTURE_TYPES[clean(ext)] ?? null;

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

const oneDecimal = (value) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/**
 * A size in words (1 KB = 1,024 bytes): "0 KB" for 0; whole KB under 1 MB, at least "1 KB";
 * one decimal from 1 MB, ".0" dropped ("1.2 MB", "500 MB"); "1.2 GB" from 1 GB.
 * @param {number} bytes
 */
export function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  const kb = Math.max(1, Math.round(value / KB));
  if (kb < 1024) return `${kb.toLocaleString('en-US')} KB`;
  const mb = Math.round((value / MB) * 10) / 10;
  if (mb < 1024) return `${oneDecimal(mb)} MB`;
  return `${oneDecimal(Math.round((value / GB) * 10) / 10)} GB`;
}
