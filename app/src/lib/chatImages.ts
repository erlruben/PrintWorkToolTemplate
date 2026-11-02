/**
 * Pictures in chat (2026-10-12). A picture is shrunk in the browser, stored in
 * the private `chat-images` bucket under its conversation's folder
 * (`<conversation id>/<random name>.jpg`), and the chat message carries that
 * path in `image_path`. Only members of the conversation can read or add
 * files in its folder (storage policies), and they are shown through
 * short-lived signed links.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const CHAT_IMAGE_BUCKET = 'chat-images';
/** Long edge in pixels: plenty for reading a screenshot, small for a phone on data. */
const MAX_EDGE = 1600;
const QUALITY = 0.85;
/** Refuse absurd inputs early rather than hanging the tab decoding them. */
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
/** What the bucket accepts after shrinking. */
const MAX_STORED_BYTES = 6 * 1024 * 1024;
/** The message text that goes with a picture (what previews and notifications show). */
export const PHOTO_TEXT = 'Photo';

export const isImageFile = (f: File) => f.type.startsWith('image/');

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture could not be read. Send a JPG or PNG.')); };
    img.src = url;
  });
}

/** The picture ready to store: a JPEG no larger than 1600px on its long side (a GIF is kept as it is, so it still moves). */
export async function shrinkForChat(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  if (!isImageFile(file)) throw new Error('Only pictures can be sent here.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`That picture is ${(file.size / 1024 / 1024).toFixed(0)}MB — too large to send in chat.`);
  if (file.type === 'image/gif') {
    if (file.size > MAX_STORED_BYTES) throw new Error('That GIF is too large to send in chat (over 6MB).');
    return { blob: file, ext: 'gif', type: 'image/gif' };
  }
  const img = await load(file);
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) throw new Error('That picture appears to be empty.');
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the picture in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';                    // a see-through PNG goes onto white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Could not prepare the picture.');
  return { blob, ext: 'jpg', type: 'image/jpeg' };
}

/** Store a picture for a conversation. Returns its path, or throws with a sentence for the person. */
export async function uploadChatImage(conversationId: string, file: File): Promise<string> {
  const { blob, ext, type } = await shrinkForChat(file);
  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(CHAT_IMAGE_BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Sending pictures is not switched on yet.' : `The picture could not be sent: ${error.message}`);
  return path;
}

// Signed links, remembered until shortly before they run out.
const SIGN_SECONDS = 60 * 60;
const cache = new Map<string, { url: string; until: number }>();
const fresh = (path: string) => { const c = cache.get(path); return c && c.until > Date.now() ? c.url : null; };

/** Signed links for the pictures on screen: { path: url }. Asks only for the ones it does not have yet. */
export function useChatImageUrls(paths: string[]): Record<string, string> {
  const key = [...new Set(paths)].sort().join('|');
  const [, setTick] = useState(0);
  useEffect(() => {
    const need = key ? key.split('|').filter((p) => !fresh(p)) : [];
    if (!need.length) return;
    let off = false;
    void supabase.storage.from(CHAT_IMAGE_BUCKET).createSignedUrls(need, SIGN_SECONDS).then(({ data }) => {
      for (const row of data ?? []) if (row.path && row.signedUrl) cache.set(row.path, { url: row.signedUrl, until: Date.now() + (SIGN_SECONDS - 300) * 1000 });
      if (!off) setTick((n) => n + 1);
    });
    return () => { off = true; };
  }, [key]);
  const out: Record<string, string> = {};
  for (const p of key ? key.split('|') : []) { const u = fresh(p); if (u) out[p] = u; }
  return out;
}
