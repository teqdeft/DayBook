// Pieces of an upload (CONTRACT 27, Uploads): how many, the exact size of the piece at an offset
// (first, middle, the shorter last one, off a boundary, at the end), and the last whole piece.
import { describe, expect, it } from 'vitest';
import {
  expectedPieceBytes,
  isPieceOffset,
  pieceCount,
  wholePiecesOffset,
} from '@/modules/projectFiles/pieces';

const PIECE = 4_194_304;
const SIZE = PIECE * 2 + 1000; // two whole pieces and a short last one

describe('pieceCount', () => {
  it('counts whole pieces and the shorter last one', () => {
    expect(pieceCount(SIZE, PIECE)).toBe(3);
    expect(pieceCount(PIECE * 2, PIECE)).toBe(2);
    expect(pieceCount(1, PIECE)).toBe(1);
    expect(pieceCount(PIECE, PIECE)).toBe(1);
    expect(pieceCount(524_288_000, PIECE)).toBe(125);
    expect(pieceCount(0, PIECE)).toBe(0);
    expect(pieceCount(100, 0)).toBe(0);
  });
});

describe('expectedPieceBytes', () => {
  it('is the piece size for the first and middle pieces', () => {
    expect(expectedPieceBytes(SIZE, PIECE, 0)).toBe(PIECE);
    expect(expectedPieceBytes(SIZE, PIECE, PIECE)).toBe(PIECE);
  });

  it('is what is left for the last piece', () => {
    expect(expectedPieceBytes(SIZE, PIECE, PIECE * 2)).toBe(1000);
    expect(expectedPieceBytes(10, PIECE, 0)).toBe(10);
  });

  it('is null off a piece boundary, at the end or past it', () => {
    expect(expectedPieceBytes(SIZE, PIECE, 1)).toBeNull();
    expect(expectedPieceBytes(SIZE, PIECE, PIECE + 512)).toBeNull();
    expect(expectedPieceBytes(SIZE, PIECE, SIZE)).toBeNull();
    expect(expectedPieceBytes(PIECE * 2, PIECE, PIECE * 2)).toBeNull();
    expect(expectedPieceBytes(SIZE, PIECE, PIECE * 3)).toBeNull();
    expect(expectedPieceBytes(SIZE, PIECE, -PIECE)).toBeNull();
    expect(expectedPieceBytes(SIZE, PIECE, Number.NaN)).toBeNull();
    expect(expectedPieceBytes(SIZE, PIECE, 0.5)).toBeNull();
  });
});

describe('isPieceOffset', () => {
  it('is a whole multiple of the piece size below the size', () => {
    expect(isPieceOffset(0, SIZE, PIECE)).toBe(true);
    expect(isPieceOffset(PIECE * 2, SIZE, PIECE)).toBe(true);
    expect(isPieceOffset(PIECE * 3, SIZE, PIECE)).toBe(false);
    expect(isPieceOffset(100, SIZE, PIECE)).toBe(false);
    expect(isPieceOffset(0, 0, PIECE)).toBe(false);
  });
});

describe('wholePiecesOffset', () => {
  it('rounds a .part that lost data down to its last whole piece', () => {
    expect(wholePiecesOffset(PIECE + 10, PIECE)).toBe(PIECE);
    expect(wholePiecesOffset(PIECE * 2, PIECE)).toBe(PIECE * 2);
    expect(wholePiecesOffset(PIECE - 1, PIECE)).toBe(0);
    expect(wholePiecesOffset(0, PIECE)).toBe(0);
  });
});
