/**
 * Uploading folders (2026-10-14). An artist's job is often several folders, one
 * per size or material ("400 x 304 with sintra", "500 x 304 sticker only"),
 * each with its own files. A folder that is chosen or dropped keeps its name on
 * every file inside it, so the task and the Print Queue can show the files
 * under that name and the operator prints the right file on the right material.
 *
 * The folder name travels beside the File (not inside it), so everything that
 * already handles a list of files — the upload, the wait for a Google sign-in —
 * carries it along untouched.
 */

/** A task holds this many files at most (the database's own limit). */
export const MAX_JOB_FILES = 30;
/** A folder name as shown on a task: nested folders are joined with this. */
export const FOLDER_SEP = ' / ';
const MAX_FOLDER_NAME = 120;

const folders = new WeakMap<File, string>();
/** The folder a chosen or dropped file came in, or null for a loose file. */
export const folderOf = (file: File): string | null => folders.get(file) ?? null;

/** Files a computer puts in folders by itself — never part of the job: Windows'
 *  picture caches, Mac folder settings and their "._" copies, and the lock file
 *  Office keeps while a document is open. Any other file, even one whose name
 *  starts with a dot, is uploaded (2026-10-27: files went missing). */
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|ehthumbs\.db|~\$.*|\._.*)$/i;

/** The most a browser tab uploads in one file; bigger ones go through Google Drive for desktop. */
export const MAX_BROWSER_UPLOAD = 0.2 * 1024 * 1024 * 1024;   // 200MB

/** A chosen or dropped list of files, with the names of any that could not be read. */
export type PickedFiles = File[] & { unreadable?: string[] };

const listNames = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', '));

/**
 * Split what was chosen into the files that can go up now and a plain-words
 * warning about the rest (too big for the browser, or unreadable), so no file
 * is ever left behind without the person being told which one.
 */
export function splitUpload(picked: File[]): { ok: File[]; warning: string | null } {
  const tooBig = picked.filter((f) => f.size > MAX_BROWSER_UPLOAD).map((f) => f.name);
  const unreadable = (picked as PickedFiles).unreadable ?? [];
  const parts: string[] = [];
  if (tooBig.length) {
    const one = tooBig.length === 1;
    parts.push(`${listNames(tooBig)} ${one ? 'is' : 'are'} over 200MB, too large to upload here. Put ${one ? 'it' : 'them'} ` +
      'in the job\'s Drive folder with Google Drive for desktop (or drive.google.com), then paste the link.');
  }
  if (unreadable.length) {
    const one = unreadable.length === 1;
    parts.push(`${one ? '1 file' : `${unreadable.length} files`} could not be read and ${one ? 'was' : 'were'} not uploaded: ` +
      `${listNames(unreadable)}. Check ${one ? 'it is' : 'they are'} fully saved on this computer (not online-only), then upload ${one ? 'it' : 'them'} again.`);
  }
  return { ok: picked.filter((f) => f.size <= MAX_BROWSER_UPLOAD), warning: parts.join(' ') || null };
}

/** What to say about the files an upload did not get to. */
export function notUploaded(left: File[]): string {
  return `Not uploaded: ${listNames(left.map((f) => f.name))}. Upload ${left.length === 1 ? 'it' : 'them'} again.`;
}

/** Tidy one folder name for showing and for Drive (null when nothing is left). */
export function cleanFolder(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const parts = name.split(/[\\/]/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const joined = parts.join(FOLDER_SEP).slice(0, MAX_FOLDER_NAME).trim();
  return joined || null;
}

/**
 * Give each file its folder name, from its path inside what was chosen
 * ("Job/400 x 304 with sintra/front.pdf").
 *
 * Choosing ONE folder of files names them after it. Choosing the whole job — a
 * single folder holding two or more folders (one per size or material) — names
 * the files after those inner folders: the outer one is only the wrapper, and
 * its own loose files stay loose. Anything else keeps every folder's name, so a
 * folder with one "proofs" or "Links" folder inside reads "500 x 304 / proofs"
 * and nothing vanishes (2026-10-27).
 */
export function tagFolders(picked: { file: File; path: string }[], unreadable: string[] = []): PickedFiles {
  const list = picked
    .map((p) => ({ file: p.file, dirs: p.path.split(/[\\/]/).filter(Boolean).slice(0, -1) }))
    .filter((p) => !JUNK.test(p.file.name));
  const tops = new Set(list.map((p) => p.dirs[0]).filter(Boolean));
  const inner = new Set(list.filter((p) => p.dirs.length > 1).map((p) => p.dirs[1]));
  const wrapper = tops.size === 1 && inner.size >= 2 ? [...tops][0] : null;
  for (const p of list) {
    const dirs = wrapper && p.dirs[0] === wrapper ? p.dirs.slice(1) : p.dirs;
    const name = cleanFolder(dirs.join('/'));
    if (name) folders.set(p.file, name);
  }
  // In a steady order, whatever order the computer listed them in: folders by
  // name ("400 x 304" before "500 x 304"), their files by name, loose files last.
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const files: PickedFiles = list
    .map((p) => ({ file: p.file, folder: folderOf(p.file) }))
    .sort((a, b) =>
      (a.folder ? 0 : 1) - (b.folder ? 0 : 1) ||
      order.compare(a.folder ?? '', b.folder ?? '') ||
      order.compare(a.file.name, b.file.name))
    .map((p) => p.file);
  if (unreadable.length) files.unreadable = unreadable;
  return files;
}

/** Can this browser choose a whole folder? (Phones mostly cannot.) */
export function canPickFolder(): boolean {
  return typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype;
}

/** The files of a folder chosen with the "Upload folder" button. */
export function filesFromFolderInput(list: FileList | null): PickedFiles {
  return tagFolders(Array.from(list ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })));
}

interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: Entry[]) => void, err: (e: unknown) => void) => void };
}

/** Read one dropped thing; a file or folder the computer will not hand over is
 *  named in `unreadable` (a path too long, a file still being saved, a cloud
 *  file not on this computer) instead of quietly left out. */
async function walk(entry: Entry, out: { file: File; path: string }[], unreadable: string[]): Promise<void> {
  const path = entry.fullPath.replace(/^\//, '');
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((res) => entry.file!(res, () => res(null)));
    if (file) out.push({ file, path });
    else if (!JUNK.test(entry.name)) unreadable.push(path);
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  // A reader hands over a folder's contents in batches; an empty batch is the end.
  for (;;) {
    const batch = await new Promise<Entry[] | null>((res) => reader.readEntries(res, () => res(null)));
    if (batch === null) { unreadable.push(`${path}/ (the rest of this folder)`); break; }
    if (!batch.length) break;
    for (const e of batch) await walk(e, out, unreadable);
  }
}

/**
 * What was dropped: loose files as they are, and every file inside a dropped
 * folder, named after it. The dropped things are read here, inside the drop —
 * the browser forgets them once the drop is over.
 */
export function filesFromDrop(dt: DataTransfer): Promise<PickedFiles> {
  const plain = Array.from(dt.files ?? []);
  const entries: Entry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const get = (item as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry;
    const entry = item.kind === 'file' && get ? get.call(item) : null;
    if (entry) entries.push(entry);
  }
  // No folder among them (or a browser that cannot tell): the files, as before.
  if (!entries.some((e) => e.isDirectory)) return Promise.resolve(plain);
  return (async () => {
    const out: { file: File; path: string }[] = [];
    const unreadable: string[] = [];
    for (const e of entries) await walk(e, out, unreadable);
    return tagFolders(out, unreadable);
  })();
}
