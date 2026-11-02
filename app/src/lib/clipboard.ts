/**
 * "Paste Copied Image" (2026-10-12): take the picture that is on the clipboard
 * — a screenshot, a snip, an image copied from a chat or a web page — as a
 * file, ready to attach to a task.
 */
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

/** "pasted-2026-10-12-143005.png" — the time it was pasted, so two pastes never share a name. */
export function pastedName(type: string, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `pasted-${stamp}.${EXT[type] ?? 'png'}`;
}

export type CopiedImages =
  | { ok: true; files: File[] }
  | { ok: false; why: 'none' | 'blocked' | 'unsupported' };

/** What to tell the person when nothing could be pasted. */
export const COPIED_IMAGE_HELP: Record<'none' | 'blocked' | 'unsupported', string> = {
  none: 'There is no copied image to paste. Take a screenshot or snip first (or copy an image), then press Paste Copied Image.',
  blocked: 'The browser did not allow reading the copied image. Allow clipboard access for this site when it asks, then press Paste Copied Image again.',
  unsupported: 'This browser cannot paste a copied image with a button. Save the picture and use Upload files instead.',
};

/** The image(s) on the clipboard, as files. Must be called from a click (the browser asks for permission). */
export async function readCopiedImages(): Promise<CopiedImages> {
  if (!navigator.clipboard?.read) return { ok: false, why: 'unsupported' };
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch (e) {
    // Nothing readable on the clipboard looks like an error in some browsers; a refusal is NotAllowedError.
    return { ok: false, why: e instanceof DOMException && e.name === 'NotAllowedError' ? 'blocked' : 'none' };
  }
  const files: File[] = [];
  const at = new Date();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    try {
      const blob = await item.getType(type);
      // A second image in the same paste gets the next second, so names differ.
      files.push(new File([blob], pastedName(type, new Date(at.getTime() + files.length * 1000)), { type }));
    } catch { /* that item could not be read; try the next */ }
  }
  return files.length ? { ok: true, files } : { ok: false, why: 'none' };
}
