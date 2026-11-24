// Pieces of an upload (CONTRACT 27, Uploads): a file goes up in pieces of the size Start gave
// (4 MiB, the last one shorter); the offset is how many bytes the server has. Pure and safe in the
// browser.

/**
 * How many pieces a file of `size` bytes takes.
 * @param {number} size bytes (0 for an empty file)
 * @param {number} pieceBytes the piece size Start gave
 * @returns {number}
 */
export function pieceCount(size, pieceBytes) {
  if (!(size > 0) || !(pieceBytes > 0)) return 0;
  return Math.ceil(size / pieceBytes);
}

/**
 * True when `offset` starts a piece of the file: a whole multiple of the piece size below `size`.
 * @param {number} offset
 * @param {number} size
 * @param {number} pieceBytes
 * @returns {boolean}
 */
export function isPieceOffset(offset, size, pieceBytes) {
  return (
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset < size &&
    pieceBytes > 0 &&
    offset % pieceBytes === 0
  );
}

/**
 * The exact size of the piece that starts at `offset`: the piece size, or what is left for the last
 * one. Null when the offset isn't a piece boundary below `size` (at the end, or off a boundary).
 * @param {number} size
 * @param {number} pieceBytes
 * @param {number} offset
 * @returns {number | null}
 */
export function expectedPieceBytes(size, pieceBytes, offset) {
  if (!isPieceOffset(offset, size, pieceBytes)) return null;
  return Math.min(pieceBytes, size - offset);
}

/**
 * The last whole piece boundary at or below `bytes` (a `.part` cut short on disk keeps only the
 * whole pieces it still holds).
 * @param {number} bytes
 * @param {number} pieceBytes
 * @returns {number}
 */
export function wholePiecesOffset(bytes, pieceBytes) {
  if (!(bytes > 0) || !(pieceBytes > 0)) return 0;
  return Math.floor(bytes / pieceBytes) * pieceBytes;
}
