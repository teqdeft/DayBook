// The thumbnail the uploader's browser makes (CONTRACT 27, Uploads, Browser side; research.md 3.7):
// for a PNG, JPEG, GIF or WebP up to 50 MB, a 400 px wide JPEG drawn on white, at most 512 KB. It
// goes with Finish as the `thumb` part, so the server never decodes a picture and a list of phone
// photos reads a few KB each. Never for SVG or any other type. Any failure means no thumbnail,
// never an error.
import { PICTURE_EXTS } from '@/modules/projectFiles/kinds';
import { extOf } from '@/modules/projectFiles/names';

export const THUMB_WIDTH = 400;
export const THUMB_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
export const THUMB_MAX_BYTES = 512 * 1024;
/** The only types a picture file may say it is (an SVG named .png never gets one). */
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// JPEG has no transparency, so the canvas is filled first (a fixed colour, not a theme token).
const BACKGROUND = '#ffffff';

/**
 * Whether a thumbnail is made for this file before Finish.
 * @param {{ name: string, size: number, type?: string }} file
 */
export function wantsThumb(file) {
  if (!file || file.size <= 0 || file.size > THUMB_SOURCE_MAX_BYTES) return false;
  if (file.type && !RASTER_TYPES.has(file.type)) return false;
  return PICTURE_EXTS.includes(extOf(file.name));
}

/**
 * @param {File} file
 * @param {{ createImageBitmap?: Function, createCanvas?: () => HTMLCanvasElement }} [env] the
 *   browser's, or fakes in tests
 * @returns {Promise<Blob | null>}
 */
export async function makeThumb(file, env = {}) {
  const createBitmap = env.createImageBitmap ?? globalThis.createImageBitmap;
  const createCanvas = env.createCanvas ?? (() => document.createElement('canvas'));
  if (!wantsThumb(file) || typeof createBitmap !== 'function') return null;
  let bitmap = null;
  try {
    bitmap = await createBitmap(file, { resizeWidth: THUMB_WIDTH, resizeQuality: 'high' });
    const canvas = createCanvas();
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob && blob.size > 0 && blob.size <= THUMB_MAX_BYTES ? blob : null;
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}
