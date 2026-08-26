// Image preparation for upload — the web half of #243, matching the rule
// `apps/macos/Sources/Flow/Support/ImagePrep.swift` applies on the two native
// clients (#84): cap the longest edge at 1024px, never enlarge, re-encode
// formats the server can't thumbnail, and leave everything else exactly as it
// is. Fixing it at the client rather than the server also saves the full-size
// upload, which is most of the win on a slow link.

/** Longest-edge cap. Width-only would leave a portrait shot at 1024x4000 —
 *  same file-size problem, different axis. */
export const MAX_EDGE_PX = 1024;

/** JPEG quality for re-encodes. Same 0.85 the native clients use. */
export const JPEG_QUALITY = 0.85;

/** Formats the server thumbnails natively (`IMAGE_MIMES` in
 *  services/files.ts) — these only need re-encoding if they're oversized. */
const PASSTHROUGH_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Never re-encoded, whatever their size.
 *  - GIF: a canvas pass keeps frame one and silently drops the animation.
 *    ImageIO refuses multi-frame sources for the same reason; the browser
 *    gives us no cheap frame count, so all GIFs pass through.
 *  - SVG: rasterising a vector to 1024px throws away the thing that makes it
 *    an SVG, and the server doesn't thumbnail it either way. */
const NEVER_TOUCH_MIMES = new Set(['image/gif', 'image/svg+xml']);

/** Whether this file is worth touching at all, decided from the mime type
 *  alone — the cheap half of the rule, before we pay to decode anything. */
export function shouldInspect(mimeType: string): boolean {
  return mimeType.startsWith('image/') && !NEVER_TOUCH_MIMES.has(mimeType);
}

/**
 * The resize/convert rule, as pure arithmetic over what the decoder found.
 * Returns the longest-edge target, or `null` when the file should be uploaded
 * exactly as it is.
 *
 * `null` is the common case and deliberately so: a 900px JPEG needs neither
 * pass, and re-encoding it would cost quality for nothing.
 */
export function planImagePrep(
  mimeType: string,
  width: number,
  height: number,
): { targetEdge: number } | null {
  if (!shouldInspect(mimeType)) return null;
  if (!(width > 0) || !(height > 0)) return null;

  const longestEdge = Math.max(width, height);
  const needsResize = longestEdge > MAX_EDGE_PX;
  const needsConvert = !PASSTHROUGH_MIMES.has(mimeType);
  if (!needsResize && !needsConvert) return null;

  // Cap, never enlarge: a 600px HEIC converts at 600px, not 1024.
  return { targetEdge: Math.min(MAX_EDGE_PX, longestEdge) };
}

/** Scaled output size for a longest-edge target, aspect kept, rounded to whole
 *  pixels and never below 1. */
export function scaledSize(
  width: number,
  height: number,
  targetEdge: number,
): { width: number; height: number } {
  const scale = targetEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Swaps the extension for the one the output format wants, keeping the base
 *  name — `IMG_4821.heic` uploads as `IMG_4821.jpeg`, not `IMG_4821.heic.jpeg`.
 *  `jpeg` rather than the more web-ish `jpg` so the name in the attachment
 *  chip reads the same as the one the native clients produce (ImageIO's
 *  `preferredFilenameExtension`). */
export function renameFor(filename: string, outputMime: string): string {
  const ext = outputMime === 'image/png' ? 'png' : 'jpeg';
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${ext}`;
}

/**
 * True when any pixel is not fully opaque.
 *
 * JPEG can't carry alpha, and a canvas composites transparency onto
 * transparent black — so a logo with a cut-out background would come back with
 * the cut-out filled in black. Those go out as PNG instead.
 *
 * This reads the *drawn pixels*, where the native clients ask the container
 * (`kCGImagePropertyHasAlpha`). The one case the two disagree on is a PNG
 * carrying an all-opaque alpha channel: the native clients keep it PNG, this
 * makes it a smaller JPEG. Neither produces a wrong image.
 */
export function hasAlphaPixels(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/**
 * Downscales and/or converts an image chosen for upload, returning a new
 * `File` — or the original when there's nothing worth doing.
 *
 * Never throws: anything the browser can't decode (HEIC outside Safari, a
 * corrupt file, a mislabelled non-image) falls back to uploading the bytes as
 * they came in, which is exactly the behaviour this replaces.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!shouldInspect(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image` bakes EXIF orientation into the pixels, and reports the
    // dimensions as displayed. Without it a photo shot in portrait re-encodes
    // sideways, because the orientation tag doesn't survive to the output.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  try {
    const plan = planImagePrep(file.type, bitmap.width, bitmap.height);
    if (!plan) return file;

    const size = scaledSize(bitmap.width, bitmap.height, plan.targetEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    const pixels = ctx.getImageData(0, 0, size.width, size.height).data;
    const outputMime = hasAlphaPixels(pixels) ? 'image/png' : 'image/jpeg';

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputMime, outputMime === 'image/jpeg' ? JPEG_QUALITY : undefined);
    });
    if (!blob) return file;

    return new File([blob], renameFor(file.name, outputMime), { type: outputMime });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
