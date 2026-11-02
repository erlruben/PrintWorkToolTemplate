/**
 * Proof images.
 *
 * The master print file lives in the artist's Google Drive — it is far too
 * large for the tracker (see README). What the tracker keeps is a *proof*:
 * the artwork at enough resolution to check spelling, crop, colour and layout
 * by zooming in, but small enough that hundreds of jobs fit inside Supabase's
 * free 1GB.
 *
 * The resizing happens here, in the browser, before anything is uploaded. A
 * 20MB export off the artist's machine never crosses the network — only the
 * ~400KB result does. That matters on a Davao office connection.
 */

/** Long edge, in pixels. 2000px lets you read small print when zoomed. */
export const PROOF_MAX_EDGE = 2000;
/** JPEG quality. 0.82 is where artefacts stop being visible on flat artwork. */
export const PROOF_QUALITY = 0.82;
/** Refuse absurd inputs early rather than hanging the tab decoding them. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export interface Proof {
  blob: Blob;
  width: number;
  height: number;
  sourceBytes: number;
  bytes: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          'That image could not be read. Browsers cannot open TIFF or PSD files — ' +
          'export a JPEG or PNG of the artwork from your design program instead.',
        ),
      );
    };
    img.src = url;
  });
}

/**
 * Downscale to PROOF_MAX_EDGE on the long side and encode as JPEG.
 * Images already smaller than that are still re-encoded, so a 12MB PNG export
 * does not get stored at 12MB.
 */
export async function makeProof(file: File): Promise<Proof> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)}MB. Export a smaller JPEG of the ` +
      'artwork — the full-size print file belongs in Drive, not here.',
    );
  }

  const img = await loadImage(file);
  const { naturalWidth: w, naturalHeight: h } = img;

  if (!w || !h) throw new Error('That image appears to be empty.');

  const scale = Math.min(1, PROOF_MAX_EDGE / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image in this browser.');

  // Matters when shrinking a large export: the default is noticeably softer.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Artwork is often exported with transparency; flatten onto white so the
  // proof matches what comes off the printer rather than going black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/jpeg', PROOF_QUALITY),
  );
  if (!blob) throw new Error('Could not compress the image.');

  return { blob, width: outW, height: outH, sourceBytes: file.size, bytes: blob.size };
}

export const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

/** Tells the artist what was actually stored, so the shrink is not a surprise. */
export function fmtProofNote(p: Proof) {
  return (
    `Proof saved at ${p.width}×${p.height}px, ${fmtBytes(p.bytes)} ` +
    `(from ${fmtBytes(p.sourceBytes)}). The print-ready file stays in Drive.`
  );
}
