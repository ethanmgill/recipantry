/**
 * Pantry Snap: in-browser image processing.
 * Photos are resized and re-encoded as JPEG with a canvas before upload,
 * which keeps API calls small and strips metadata such as GPS location.
 */
import { CONFIG } from './config.js';

/** Decode a File into something drawable, honouring EXIF rotation. */
async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpegDataUrl(canvas, quality) {
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Prepare a photo for Claude and for storage.
 * @returns {{ dataUrl: string, base64: string, thumb: string }}
 *   dataUrl/base64: JPEG, long edge ≤ IMAGE_MAX_EDGE; thumb: small square JPEG data URL.
 */
export async function preparePhoto(file) {
  let bmp;
  try {
    bmp = await decode(file);
  } catch {
    throw new Error("This image couldn't be opened. Try a JPEG or PNG photo.");
  }
  const w = bmp.width, h = bmp.height;

  // Main image: scale so the long edge is at most IMAGE_MAX_EDGE.
  const scale = Math.min(1, CONFIG.IMAGE_MAX_EDGE / Math.max(w, h));
  const main = document.createElement('canvas');
  main.width = Math.round(w * scale);
  main.height = Math.round(h * scale);
  const mctx = main.getContext('2d');
  mctx.fillStyle = '#fff'; // transparent PNGs become white, not black
  mctx.fillRect(0, 0, main.width, main.height);
  mctx.drawImage(bmp, 0, 0, main.width, main.height);
  const dataUrl = toJpegDataUrl(main, CONFIG.IMAGE_QUALITY);

  // Thumbnail: centre-cropped square.
  const side = Math.min(w, h);
  const t = document.createElement('canvas');
  t.width = t.height = CONFIG.THUMB_SIZE;
  const tctx = t.getContext('2d');
  tctx.fillStyle = '#fff';
  tctx.fillRect(0, 0, t.width, t.height);
  tctx.drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, t.width, t.height);
  const thumb = toJpegDataUrl(t, CONFIG.THUMB_QUALITY);

  bmp.close?.();
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), thumb };
}
