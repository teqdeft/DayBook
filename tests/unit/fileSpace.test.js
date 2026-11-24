// The size rules of uploads (CONTRACT 27, Storage limit check and Settings): what counts as Space
// used (active files, running and held uploads not expired; never deleted files or attached
// uploads), the two "space full" sentences by viewer (neither names the file), the largest-file
// sentence, and the piece size range the env check allows.
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';
import {
  countsTowardSpace,
  fileTooBigMessage,
  isOverLimit,
  limitBytesOf,
  maxFileBytesOf,
  spaceFullMessage,
  usedBytesOf,
} from '@/modules/projectFiles/spaceRules';

const MIB = 1_048_576;
const GIB = 1024 * MIB;
const AT = new Date('2026-11-23T06:00:00Z');
const LATER = new Date('2026-11-23T08:00:00Z');
const EARLIER = new Date('2026-11-23T05:59:59Z');

const file = (status, sizeBytes) => ({ kind: 'file', status, sizeBytes });
const upload = (status, sizeBytes, expiresAt = LATER) => ({
  kind: 'upload',
  status,
  sizeBytes,
  expiresAt,
});

describe('Space used', () => {
  it('counts active files and running or held uploads that have not expired', () => {
    const rows = [
      file('active', 100),
      file('deleted', 1000),
      upload('receiving', 10),
      upload('ready', 20),
      upload('receiving', 3000, EARLIER),
      upload('ready', 4000, AT),
      upload('attached', 50_000),
      upload('cancelled', 60_000),
      upload('expired', 70_000),
    ];
    expect(usedBytesOf(rows, AT)).toBe(130);
    expect(countsTowardSpace(file('deleted', 1), AT)).toBe(false);
    expect(countsTowardSpace(upload('attached', 1), AT)).toBe(false);
    expect(countsTowardSpace(upload('ready', 1, AT), AT)).toBe(false);
  });

  it('refuses only past the limit', () => {
    expect(isOverLimit({ usedBytes: 9 * GIB, sizeBytes: GIB, limitBytes: 10 * GIB })).toBe(false);
    expect(isOverLimit({ usedBytes: 9 * GIB, sizeBytes: GIB + 1, limitBytes: 10 * GIB })).toBe(
      true,
    );
  });

  it('reads the two settings in bytes, with the defaults for a missing row', () => {
    expect(maxFileBytesOf({ fileMaxMb: 500 })).toBe(524_288_000);
    expect(maxFileBytesOf({})).toBe(524_288_000);
    expect(maxFileBytesOf({ fileMaxMb: 2048 })).toBe(2 * GIB);
    expect(limitBytesOf({ fileStorageLimitGb: 10 })).toBe(10_737_418_240);
    expect(limitBytesOf({})).toBe(10 * GIB);
  });
});

describe('the sentences', () => {
  it('tells an Admin the numbers and anyone else to ask an Admin, never naming the file', () => {
    const numbers = { usedBytes: Math.round(9.8 * GIB), limitBytes: 10 * GIB };
    expect(spaceFullMessage({ admin: true, ...numbers })).toBe(
      "Daybook's file space is full (9.8 GB of 10 GB). Delete old files or raise the limit in Settings.",
    );
    expect(spaceFullMessage({ admin: false, ...numbers })).toBe(
      "There isn't enough space for this file. Ask an Admin to make room.",
    );
  });

  it('says how big the file is and the largest file allowed', () => {
    expect(fileTooBigMessage({ sizeBytes: Math.round(1.2 * GIB), maxBytes: 500 * MIB })).toBe(
      'This file is 1.2 GB. Each file can be up to 500 MB.',
    );
    expect(fileTooBigMessage({ sizeBytes: 3 * MIB, maxBytes: 2 * MIB })).toBe(
      'This file is 3 MB. Each file can be up to 2 MB.',
    );
  });
});

describe('the piece size range (FILES_PIECE_BYTES)', () => {
  const base = { APP_URL: 'http://localhost:3000', SESSION_SECRET: 'x'.repeat(40) };
  const parse = (NODE_ENV, FILES_PIECE_BYTES) =>
    parseEnv({ ...process.env, ...base, NODE_ENV, FILES_PIECE_BYTES });

  it('defaults to 4 MiB', () => {
    expect(parseEnv({ ...process.env, ...base, FILES_PIECE_BYTES: '' }).filesPieceBytes).toBe(
      4_194_304,
    );
  });

  it('allows 64 KiB to 4 MiB outside production and 1 to 8 MiB in production', () => {
    expect(parse('test', '65536').filesPieceBytes).toBe(65_536);
    expect(parse('development', '4194304').filesPieceBytes).toBe(4_194_304);
    expect(() => parse('development', '65535')).toThrow('FILES_PIECE_BYTES: must be from 65536');
    expect(() => parse('test', '4194305')).toThrow('FILES_PIECE_BYTES');
    expect(() => parse('production', '65536')).toThrow(
      'FILES_PIECE_BYTES: must be from 1048576 to 8388608 bytes',
    );
  });
});
