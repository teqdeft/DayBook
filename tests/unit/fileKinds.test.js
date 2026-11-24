// File kinds, sizes and picture headers (CONTRACT 27, Modules kinds.js and Finish step 3): every
// extension list in its order, the type labels, program files, sizes in words, and readPicture on
// header bytes built here (no fixture files).
import { describe, expect, it } from 'vitest';
import {
  PICTURE_EXTS,
  PICTURE_TYPES,
  PROGRAM_EXTS,
  READABLE_EXTS,
  formatSize,
  isPictureExt,
  isProgram,
  isReadableExt,
  kindOf,
  pictureType,
  typeLabel,
} from '@/modules/projectFiles/kinds';
import {
  MAX_PICTURE_PIXELS,
  readPicture,
  readPictureFromBytes,
} from '@/modules/projectFiles/pictures';

const LISTS = {
  picture: 'png jpg jpeg gif webp svg bmp tif tiff heic heif ico psd ai eps',
  pdf: 'pdf',
  word: 'doc docx docm odt rtf pages',
  excel: 'xls xlsx xlsm ods csv tsv numbers',
  slides: 'ppt pptx pptm odp key',
  text: 'txt md log',
  archive: 'zip rar 7z tar gz tgz bz2 xz',
  video: 'mp4 mov avi mkv webm m4v wmv',
  audio: 'mp3 wav m4a aac ogg flac wma',
  code: 'html htm xhtml mht mhtml xml json css ts jsx tsx py php java c cpp h cs go rb sql yml yaml',
};
const PROGRAMS =
  'exe msi msp msix appx bat cmd com cpl pif scr msc ps1 psm1 vbs vbe js jse wsf wsh jar apk sh ' +
  'lnk scf url hta reg inf chm dll xll iso img vhd vhdx dmg pkg app command deb rpm run appimage';

describe('kindOf', () => {
  for (const [kind, exts] of Object.entries(LISTS)) {
    it(`${kind}: ${exts}`, () => {
      for (const ext of exts.split(' ')) expect([ext, kindOf(ext)]).toEqual([ext, kind]);
    });
  }

  it('programs come before code: js is a program, ts is code', () => {
    for (const ext of PROGRAMS.split(' ')) expect([ext, kindOf(ext)]).toEqual([ext, 'program']);
    expect(kindOf('js')).toBe('program');
    expect(kindOf('ts')).toBe('code');
  });

  it('anything else, an empty or an upper case extension', () => {
    expect(kindOf('dwg')).toBe('file');
    expect(kindOf('')).toBe('file');
    expect(kindOf(undefined)).toBe('file');
    expect(kindOf('PDF')).toBe('pdf');
    expect(kindOf('constructor')).toBe('file');
  });
});

describe('typeLabel', () => {
  it('names each kind', () => {
    const labels = ['png', 'exe', 'pdf', 'docx', 'xlsx', 'pptx', 'md', 'zip', 'mov', 'mp3'].map(
      typeLabel,
    );
    expect(labels).toEqual([
      'Picture',
      'Program',
      'PDF',
      'Word',
      'Excel',
      'PowerPoint',
      'Text',
      'Zip',
      'Video',
      'Audio',
    ]);
  });

  it('writes the extension in capitals for code and other files, or File', () => {
    expect(typeLabel('html')).toBe('HTML');
    expect(typeLabel('dwg')).toBe('DWG');
    expect(typeLabel('')).toBe('File');
  });
});

describe('the lists', () => {
  it('pictures shown inline are only PNG, JPG, GIF and WebP', () => {
    expect([...PICTURE_EXTS]).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp']);
    expect({ ...PICTURE_TYPES }).toEqual({
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    });
    expect(pictureType('svg')).toBeNull();
    expect(pictureType('constructor')).toBeNull();
    expect(pictureType('JPG')).toBe('image/jpeg');
    expect(isPictureExt('svg')).toBe(false);
    expect(isPictureExt('webp')).toBe(true);
  });

  it('isProgram, pif and vbe too', () => {
    expect([...PROGRAM_EXTS]).toEqual(PROGRAMS.split(' '));
    expect(isProgram('pif')).toBe(true);
    expect(isProgram('vbe')).toBe(true);
    expect(isProgram('EXE')).toBe(true);
    expect(isProgram('pdf')).toBe(false);
  });

  it('the files read for the AI', () => {
    expect([...READABLE_EXTS]).toEqual(['pdf', 'docx', 'txt', 'md']);
    expect(isReadableExt('doc')).toBe(false);
  });
});

describe('formatSize', () => {
  it.each([
    [0, '0 KB'],
    [1, '1 KB'],
    [1_023, '1 KB'],
    [348_160, '340 KB'],
    [1_048_575, '1 MB'],
    [1_048_576, '1 MB'],
    [1_258_291, '1.2 MB'],
    [25_794_970, '24.6 MB'],
    [322_122_547, '307.2 MB'],
    [524_288_000, '500 MB'],
    [1_288_490_189, '1.2 GB'],
    [10_737_418_240, '10 GB'],
    [1_073_741_824_000, '1,000 GB'],
  ])('%d bytes is %s', (bytes, words) => {
    expect(formatSize(bytes)).toBe(words);
  });

  it('nothing or nonsense is 0 KB', () => {
    expect(formatSize(-5)).toBe('0 KB');
    expect(formatSize(undefined)).toBe('0 KB');
    expect(formatSize(Number.NaN)).toBe('0 KB');
  });
});

// ---------- picture headers ----------

const bytesOf = (...parts) => Uint8Array.from(parts.flat());
const text = (value) => Array.from(value, (char) => char.charCodeAt(0));
const be16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n) => [...le16(n & 0xffff), ...le16(n >>> 16)];
const zeros = (count) => new Array(count).fill(0);

const png = (width, height) =>
  bytesOf(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    text('IHDR'),
    be32(width),
    be32(height),
    zeros(5),
  );
const segment = (marker, dataLength) => [
  0xff,
  marker,
  ...be16(dataLength + 2),
  ...zeros(dataLength),
];
const sof = (width, height) => [
  0xff,
  0xc0,
  ...be16(17),
  8,
  ...be16(height),
  ...be16(width),
  ...zeros(12),
];
const jpeg = (width, height, ...before) =>
  bytesOf([0xff, 0xd8], ...before, sof(width, height), [0xff, 0xd9]);
const gif = (width, height) => bytesOf(text('GIF89a'), le16(width), le16(height), zeros(6));
const riff = (chunk, body) =>
  bytesOf(
    text('RIFF'),
    le32(4 + 8 + body.length),
    text('WEBP'),
    text(chunk),
    le32(body.length),
    body,
  );
const vp8 = (width, height) =>
  riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), ...zeros(4)]);
const vp8l = (width, height) =>
  riff('VP8L', [0x2f, ...le32((width - 1) | ((height - 1) << 14)), ...zeros(4)]);
const vp8x = (width, height) =>
  riff('VP8X', [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1), ...zeros(2)]);

describe('readPicture', () => {
  it('reads a PNG', async () => {
    expect(await readPictureFromBytes(png(640, 480), 'png')).toEqual({
      isPicture: true,
      width: 640,
      height: 480,
    });
  });

  it('reads a JPEG with an EXIF block before its SOF', async () => {
    const exif = segment(0xe1, 1200);
    expect(await readPictureFromBytes(jpeg(4032, 3024, exif), 'jpg')).toEqual({
      isPicture: true,
      width: 4032,
      height: 3024,
    });
  });

  it('reads a JPEG with 70 KB of APP segments before its SOF (an APP1 at its 64 KB most)', async () => {
    const bytes = jpeg(1200, 800, segment(0xe1, 65_533), segment(0xe2, 6_000), segment(0xdb, 67));
    expect(bytes.length).toBeGreaterThan(70_000);
    expect(await readPictureFromBytes(bytes, 'jpeg')).toEqual({
      isPicture: true,
      width: 1200,
      height: 800,
    });
  });

  it('walks the JPEG with small positional reads', async () => {
    const bytes = jpeg(300, 200, segment(0xe1, 65_533), segment(0xe2, 6_000));
    const reads = [];
    const read = async (position, length) => {
      reads.push(length);
      return bytes.subarray(position, position + length);
    };
    expect(await readPicture(read, 'jpg')).toMatchObject({ isPicture: true });
    expect(Math.max(...reads)).toBeLessThanOrEqual(5);
  });

  it('reads a GIF', async () => {
    expect(await readPictureFromBytes(gif(320, 200), 'gif')).toEqual({
      isPicture: true,
      width: 320,
      height: 200,
    });
  });

  it('reads WebP VP8, VP8L and VP8X', async () => {
    expect(await readPictureFromBytes(vp8(800, 600), 'webp')).toEqual({
      isPicture: true,
      width: 800,
      height: 600,
    });
    expect(await readPictureFromBytes(vp8l(1024, 768), 'webp')).toEqual({
      isPicture: true,
      width: 1024,
      height: 768,
    });
    expect(await readPictureFromBytes(vp8x(5000, 4000), 'webp')).toEqual({
      isPicture: true,
      width: 5000,
      height: 4000,
    });
  });

  it('a PNG named .jpg is not a picture', async () => {
    expect(await readPictureFromBytes(png(10, 10), 'jpg')).toEqual({
      isPicture: false,
      width: null,
      height: null,
    });
  });

  it('a text file named .png is not a picture', async () => {
    const bytes = bytesOf(text('just some notes, not a picture at all\n'));
    expect((await readPictureFromBytes(bytes, 'png')).isPicture).toBe(false);
  });

  it('a PNG of 50,000 x 1,000 is over 40 megapixels', async () => {
    expect(50_000 * 1_000).toBeGreaterThan(MAX_PICTURE_PIXELS);
    expect((await readPictureFromBytes(png(50_000, 1_000), 'png')).isPicture).toBe(false);
    expect((await readPictureFromBytes(png(8_000, 5_000), 'png')).isPicture).toBe(true);
  });

  it('an SVG or any other extension is never a picture', async () => {
    expect((await readPictureFromBytes(png(10, 10), 'svg')).isPicture).toBe(false);
    expect((await readPictureFromBytes(png(10, 10), '')).isPicture).toBe(false);
  });

  it('a zero size, a cut header or a JPEG without its SOF is not a picture', async () => {
    expect((await readPictureFromBytes(png(0, 10), 'png')).isPicture).toBe(false);
    expect((await readPictureFromBytes(png(10, 10).subarray(0, 20), 'png')).isPicture).toBe(false);
    expect(
      (await readPictureFromBytes(bytesOf([0xff, 0xd8], segment(0xe1, 10), [0xff, 0xda]), 'jpg'))
        .isPicture,
    ).toBe(false);
    expect((await readPictureFromBytes(bytesOf([0xff, 0xd8, 0xff]), 'jpg')).isPicture).toBe(false);
  });
});
