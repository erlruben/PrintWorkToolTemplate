/**
 * Print-ready files live in Google Drive, not in the tracker (PRD section 7,
 * and see README on why: a print-size TIFF is hundreds of megabytes and the
 * free storage tier is 1GB total).
 *
 * That makes the link the critical piece of the job, so it gets parsed rather
 * than stored as an opaque string — the operator has to be able to open it
 * without ringing the artist, which is the whole point of section 2.
 */

export type LinkKind = 'drive-file' | 'drive-folder' | 'docs' | 'dropbox' | 'onedrive' | 'other';

export interface ParsedLink {
  kind: LinkKind;
  /** Google Drive file/folder id, when we can find one. */
  id: string | null;
  url: string;
  label: string;
  /** Drive renders a thumbnail only for files anyone-with-the-link can view. */
  thumbnail: string | null;
  /** True for the cloud stores this shop actually uses. */
  recognised: boolean;
}

const DRIVE_FILE = [
  /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/,
  /drive\.google\.com\/open\?[^#]*\bid=([a-zA-Z0-9_-]{10,})/,
  /drive\.google\.com\/uc\?[^#]*\bid=([a-zA-Z0-9_-]{10,})/,
  /drive\.usercontent\.google\.com\/download\?[^#]*\bid=([a-zA-Z0-9_-]{10,})/,
];

const DRIVE_FOLDER = /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{10,})/;
const DOCS = /docs\.google\.com\/\w+\/d\/([a-zA-Z0-9_-]{10,})/;

/**
 * Every http(s) link in a piece of pasted text, in order, without repeats —
 * one per line, separated by spaces or commas, or mixed in with a chat
 * message. Trailing punctuation from a sentence ("…/view)." ) is dropped.
 */
export function extractLinks(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/https?:\/\/[^\s,;<>"'`]+/gi)) {
    const url = m[0].replace(/[).\]]+$/, '');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

export function parseLink(raw: string | null | undefined): ParsedLink | null {
  const url = (raw ?? '').trim();
  if (!url) return null;

  for (const re of DRIVE_FILE) {
    const m = url.match(re);
    if (m) {
      return {
        kind: 'drive-file',
        id: m[1],
        url,
        label: 'Google Drive file',
        thumbnail: `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600`,
        recognised: true,
      };
    }
  }

  const folder = url.match(DRIVE_FOLDER);
  if (folder) {
    return {
      kind: 'drive-folder',
      id: folder[1],
      url,
      label: 'Google Drive folder',
      thumbnail: null,
      recognised: true,
    };
  }

  const doc = url.match(DOCS);
  if (doc) {
    return { kind: 'docs', id: doc[1], url, label: 'Google Docs file', thumbnail: null, recognised: true };
  }

  if (/dropbox\.com/.test(url)) {
    return { kind: 'dropbox', id: null, url, label: 'Dropbox', thumbnail: null, recognised: true };
  }

  if (/(1drv\.ms|onedrive\.live\.com|sharepoint\.com)/.test(url)) {
    return { kind: 'onedrive', id: null, url, label: 'OneDrive', thumbnail: null, recognised: true };
  }

  return { kind: 'other', id: null, url, label: 'Link', thumbnail: null, recognised: false };
}

/** Short human label for the File column in the glance table. */
export function linkBadge(raw: string | null | undefined): string | null {
  const p = parseLink(raw);
  if (!p) return null;
  switch (p.kind) {
    case 'drive-file':
    case 'docs': return 'Drive';
    case 'drive-folder': return 'Drive ▸';
    case 'dropbox': return 'Dropbox';
    case 'onedrive': return 'OneDrive';
    default: return 'link';
  }
}

export interface JobFile {
  url: string;
  name: string | null;
  link: ParsedLink;
  /** The main print file (file_link) — the one the operator opens first. */
  main: boolean;
  /** The folder it was uploaded in (2026-10-14), or null for a loose file. */
  folder: string | null;
}

/**
 * Every file on a job, the main print file first, with no repeats. Jobs from
 * before migration 042 only have file_link, so it is always included. Files
 * uploaded in a folder stay together: the main file's folder first, then the
 * others in the order they were added.
 */
export function jobFiles(o: {
  file_link: string | null;
  attachments?: { url: string; name?: string | null; folder?: string | null }[] | null;
}): JobFile[] {
  const out: JobFile[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, name: unknown, folder: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    const link = parseLink(url);
    if (!link) return;
    seen.add(url);
    out.push({
      url, link, main: url === o.file_link,
      name: typeof name === 'string' && name ? name : null,
      folder: typeof folder === 'string' && folder.trim() ? folder.trim() : null,
    });
  };
  const list = Array.isArray(o.attachments) ? o.attachments : [];
  const first = list.find((a) => a?.url === o.file_link);
  add(o.file_link, first?.name, first?.folder);
  for (const a of list) add(a?.url, a?.name, a?.folder);
  return fileGroups(out).flatMap((g) => g.files);
}

export interface FileGroup {
  /** The folder's name, or null for the files that are in no folder. */
  folder: string | null;
  files: JobFile[];
}
/** A job's files by folder, in the order each folder first appears. */
export function fileGroups(files: JobFile[]): FileGroup[] {
  const groups: FileGroup[] = [];
  for (const f of files) {
    const g = groups.find((x) => x.folder === f.folder);
    if (g) g.files.push(f);
    else groups.push({ folder: f.folder, files: [f] });
  }
  return groups;
}
/** Does this job have files in folders at all? */
export const hasFolders = (files: JobFile[]) => files.some((f) => f.folder);
/** A file as it is saved on the job. */
export const toAttachment = (f: { url: string; name: string | null; folder?: string | null }) =>
  ({ url: f.url, name: f.name, ...(f.folder ? { folder: f.folder } : {}) });

/**
 * A Drive image of a file at a given width, or null when there is none. Drive
 * draws one for pictures and for the first page of PDFs and Word / Excel /
 * PowerPoint files too — once the file is shared "anyone with the link".
 */
export function driveImageUrl(link: ParsedLink, width: number): string | null {
  if ((link.kind !== 'drive-file' && link.kind !== 'docs') || !link.id) return null;
  return `https://drive.google.com/thumbnail?id=${link.id}&sz=w${width}`;
}

/** Drive's own viewer for a file: every page of a PDF or Office file, scrollable. */
export function drivePreviewUrl(link: ParsedLink): string | null {
  if ((link.kind !== 'drive-file' && link.kind !== 'docs') || !link.id) return null;
  return `https://drive.google.com/file/d/${link.id}/preview`;
}

const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv)$/i;

/** A document (pages to read) rather than a picture. */
export function isDocument(f: { name: string | null; link: ParsedLink }): boolean {
  return f.link.kind === 'docs' || DOC_EXT.test(f.name ?? '');
}

/** A short type tag for a file (PDF, DOCX, TIFF…), from its name or its Google link. */
export function fileTag(name: string | null, url?: string): string {
  const ext = name?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (ext) return ext.toUpperCase();
  const g = url?.match(/docs\.google\.com\/(document|spreadsheets|presentation)\//)?.[1];
  return g === 'document' ? 'DOC' : g === 'spreadsheets' ? 'SHEET' : g === 'presentation' ? 'SLIDES' : 'FILE';
}
