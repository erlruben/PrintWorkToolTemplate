/**
 * Upload files into the shop's Google Drive folder from the browser, filed
 * into a per-job and per-month tree, without a server.
 *
 * Uses Google Identity Services for a short-lived access token and Drive's
 * multipart upload. Files are owned by whichever Google account is signed in
 * on the uploading browser — the shop's browser is meant to stay signed into
 * the company account, so the company's own storage covers everything and the
 * whole tree stays under one owner. Uploads are set to
 * "anyone with the link can view" so an operator can open them.
 *
 * The scope is drive.file — the least Drive grants: the app can only see and
 * touch files and folders it creates here, never the rest of the account's
 * Drive. That also means the folder tree below (Work Orders / <month> / <WO#>,
 * Monthly Report / <month>) must be built by the app itself — a hand-made
 * folder of the same name would not be found and a duplicate would appear.
 *
 * Everything Google-specific (the OAuth client id, the shared root folder)
 * lives in the app_settings table and is edited on the Settings screen, so
 * switching Google accounts or projects never needs a redeploy.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
  callback: (resp: { access_token?: string; error?: string }) => void;
}
// A tiny slice of the Google Picker API — only the fluent calls we use.
interface PickerView {
  setParent(id: string): PickerView;
}
interface PickerObject {
  setVisible(v: boolean): void;
}
interface PickerData {
  action: string;
  docs?: Array<{ id: string; url: string; name: string }>;
}
interface PickerBuilderT {
  setOAuthToken(t: string): PickerBuilderT;
  setDeveloperKey(k: string): PickerBuilderT;
  setAppId(id: string): PickerBuilderT;
  setTitle(t: string): PickerBuilderT;
  addView(v: PickerView): PickerBuilderT;
  enableFeature(f: string): PickerBuilderT;
  setCallback(cb: (data: PickerData) => void): PickerBuilderT;
  build(): PickerObject;
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilderT;
  DocsView: new () => PickerView;
  DocsUploadView: new () => PickerView;
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string };
}
interface GapiGlobal {
  load: (name: string, cfg: { callback: () => void; onerror?: () => void }) => void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        hint?: string;
        callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => TokenClient;
    };
  };
  picker?: PickerNamespace;
}
declare global {
  interface Window { google?: GoogleGlobal; gapi?: GapiGlobal }
}

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gsiPromise = null; reject(new Error('Could not load Google sign-in.')); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/**
 * Load Google sign-in ahead of time so the token popup can open synchronously
 * inside the user's click. Without this, the first upload has to fetch the GSI
 * script mid-click, the gesture lapses, and the popup is blocked — leaving the
 * upload stuck. Call it when a screen that can upload opens; failures are
 * ignored (the real upload reports them).
 */
export function warmUpDrive(): void {
  loadGsi().catch(() => {});
}

/** Pull the folder id out of any Drive folder URL. */
export function driveFolderId(folderUrl: string | null | undefined): string | null {
  if (!folderUrl) return null;
  const m = folderUrl.match(/folders\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

// The Google account the whole app should use — set once by the admin
// ("Connect Google account" in Settings, saved as a shared setting) and applied
// here as the sign-in hint, so every browser targets the company account with no
// account chooser to get wrong.
let accountHint: string | undefined;
export function setDriveAccountHint(email: string | null | undefined) {
  accountHint = email || undefined;
}

// Reuse one access token across operations (~1h) instead of re-asking Google on
// every upload/folder/receipt call. A 60s buffer avoids handing out one that is
// about to expire.
let cachedToken: { value: string; exp: number } | null = null;

/**
 * Start getting a Google token right away. Call it inside the click (before
 * any await) so a sign-in pop-up, if needed, is not blocked — then await it
 * after other work.
 */
export function driveTokenNow(clientId: string, freshFor = 60_000): Promise<string> {
  return getToken(clientId, freshFor);
}

/** An upload batch starts only with a token good for at least this long, so it
 *  does not run out half-way (it would need a sign-in pop-up, which a browser
 *  blocks outside a click) — 2026-10-27, files went missing. */
export const UPLOAD_TOKEN_MS = 20 * 60_000;

/**
 * Move one Drive file to the Drive trash (it can be restored from there for
 * about 30 days). The drive.file scope only reaches files the app uploaded or
 * that were picked through it — anything else answers 403/404 and is left
 * alone. True if it was trashed.
 */
export async function trashDriveFile(token: string, fileId: string): Promise<boolean> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  }).catch(() => null);
  return !!r && r.ok;
}

/** True while this browser holds a Google token good for `freshFor` more, so a Drive call needs no sign-in pop-up. */
export function hasDriveToken(freshFor = 60_000): boolean {
  return !!cachedToken && cachedToken.exp - freshFor > Date.now();
}

async function getToken(clientId: string, freshFor = 60_000): Promise<string> {
  if (cachedToken && cachedToken.exp - freshFor > Date.now()) return cachedToken.value;
  // Only await when the script isn't loaded yet. Once it's warm (warmUpDrive),
  // we must NOT await here: any await hands control back to the event loop, and
  // Google's sign-in popup opened after that is treated as non-user-initiated
  // and blocked. Skipping the await keeps requestAccessToken inside the click.
  if (!window.google?.accounts?.oauth2) await loadGsi();
  const oauth2 = window.google!.accounts.oauth2;
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      hint: accountHint,
      callback: (resp) => {
        if (resp.access_token) {
          cachedToken = { value: resp.access_token, exp: Date.now() + (resp.expires_in ?? 3600) * 1000 };
          resolve(resp.access_token);
        } else reject(new Error(resp.error || 'Google did not grant access.'));
      },
      // Without this, a blocked/closed sign-in popup (or an origin Google hasn't
      // authorised — common on localhost) leaves the promise pending forever and
      // the upload sits at 0%. Surface it as an error instead.
      error_callback: (err) => {
        const msg =
          err?.type === 'popup_failed_to_open'
            ? 'The Google sign-in popup was blocked — allow pop-ups for this site and try again.'
            : err?.type === 'popup_closed'
              ? 'Google sign-in was closed before it finished.'
              : err?.message || 'Google sign-in did not complete.';
        reject(new Error(msg));
      },
    });
    // consent may be needed the first time; Google decides
    client.requestAccessToken({ prompt: '' });
  });
}

/**
 * One-time admin setup: sign in and record which Google account the app should
 * use for everyone. Lets the admin pick the account, then reads its email so it
 * can be saved as a shared setting. Works with the drive.file scope.
 */
export async function connectDriveAccount(clientId: string): Promise<string> {
  await loadGsi();
  const oauth2 = window.google!.accounts.oauth2;
  const token = await new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) =>
        resp.access_token
          ? resolve(resp.access_token)
          : reject(new Error(resp.error || 'Google did not grant access.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(driveError(await r.text(), r.status));
  const email = (await r.json())?.user?.emailAddress;
  if (!email) throw new Error('Signed in, but could not read the account email.');
  return email as string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Make a file openable by anyone with the link, so the operator is not blocked. */
async function shareAnyone(token: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  }).catch(() => {
    // A failed share still leaves a valid link; the ticket's own sharing check
    // flags it if it is not viewable.
  });
}

/** Multipart upload of one blob into a folder under `name`, with progress (0–1). */
function postUpload(
  token: string,
  blob: Blob,
  name: string,
  folderId: string,
  onProgress?: (frac: number) => void,
): Promise<{ id: string; webViewLink: string }> {
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' }),
  );
  form.append('file', blob);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const r = JSON.parse(xhr.responseText);
        resolve({ id: r.id, webViewLink: r.webViewLink });
      } else {
        reject(new Error(driveError(xhr.responseText, xhr.status)));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check the connection.'));
    xhr.send(form);
  });
}

// Drive's name search can lag a few seconds behind a write. An upload, a receipt
// refresh and a close-save often overlap, so each could miss what another one just
// made and create a second "Work Orders" folder or a second receipt. We remember
// what this tab found or made for a minute, and run overlapping calls for the same
// folder or file one after another instead of side by side.
const RECENT_MS = 60_000;
const recentFolders = new Map<string, { id: Promise<string>; at: number }>();
const recentFiles = new Map<string, { id: string; at: number }>();
const fileQueues = new Map<string, Promise<unknown>>();

/**
 * Find a named subfolder under a parent, or create it. With the drive.file
 * scope this only sees folders the app itself created — which is exactly what
 * we want, since the app is the one building this tree in the company Drive.
 */
function ensureFolder(token: string, parentId: string, name: string): Promise<string> {
  const key = `${parentId}/${name}`;
  const hit = recentFolders.get(key);
  if (hit && Date.now() - hit.at < RECENT_MS) return hit.id;
  const id = ensureFolderNow(token, parentId, name);
  recentFolders.set(key, { id, at: Date.now() });
  id.catch(() => recentFolders.delete(key)); // a failure must not stick
  return id;
}

async function ensureFolderNow(token: string, parentId: string, name: string): Promise<string> {
  const q =
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' ` +
    `and '${parentId}' in parents and trashed = false`;
  const found = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (found.ok) {
    const j = await found.json();
    if (j.files?.[0]?.id) return j.files[0].id as string;
  }
  const made = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!made.ok) throw new Error(driveError(await made.text(), made.status));
  return (await made.json()).id as string;
}

/** Ensure a nested folder path (e.g. ["Work Orders", "2026-09", "WO-X"]) exists. */
async function ensurePathFolder(token: string, rootId: string, segments: string[]): Promise<string> {
  let parent = rootId;
  for (const name of segments) parent = await ensureFolder(token, parent, name);
  return parent;
}

/** Find a named subfolder under a parent WITHOUT creating it. null if absent. */
async function findFolder(token: string, parentId: string, name: string): Promise<string | null> {
  const q =
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' ` +
    `and '${parentId}' in parents and trashed = false`;
  const found = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!found.ok) return null;
  const j = await found.json();
  return (j.files?.[0]?.id as string | undefined) ?? null;
}

/**
 * Create a file in a folder, or replace the content of the app's existing one of
 * that name — so a re-generated report or receipt updates in place instead of
 * piling up duplicates. (drive.file only sees files the app made, which is who
 * writes these, so the lookup is exact.) Overlapping calls for the same file run
 * one at a time, and a file made a moment ago is reused even if Drive's search
 * has not caught up with it yet.
 */
function upsertFile(token: string, folderId: string, name: string, blob: Blob): Promise<string> {
  const key = `${folderId}/${name}`;
  const run = (fileQueues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => upsertFileNow(token, folderId, name, blob, key));
  fileQueues.set(key, run);
  const clear = () => { if (fileQueues.get(key) === run) fileQueues.delete(key); };
  run.then(clear, clear);
  return run;
}

async function upsertFileNow(token: string, folderId: string, name: string, blob: Blob, key: string): Promise<string> {
  const recent = recentFiles.get(key);
  let id: string | null = recent && Date.now() - recent.at < RECENT_MS ? recent.id : null;
  if (!id) {
    const q = `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
    const found = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (found.ok) {
      const j = await found.json();
      id = j.files?.[0]?.id ?? null;
    }
  }
  if (id) {
    const patched = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      },
    );
    if (patched.ok) {
      recentFiles.set(key, { id, at: Date.now() });
      return id;
    }
    // Gone since we last saw it (deleted by hand): make a fresh one below.
    if (patched.status !== 404) throw new Error(driveError(await patched.text(), patched.status));
    recentFiles.delete(key);
  }
  const made = (await postUpload(token, blob, name, folderId)).id;
  recentFiles.set(key, { id: made, at: Date.now() });
  return made;
}

async function webLinkOf(token: string, fileId: string): Promise<string> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok ? ((await r.json()).webViewLink as string) : `https://drive.google.com/drive/folders/${fileId}`;
}

export interface JobFolderOpts {
  clientId: string;
  rootFolderId: string; // the shared folder from Settings
  woNumber: string;
  month: string; // YYYY-MM
}

export interface JobFolder {
  id: string;
  webViewLink: string;
}

const jobSegments = (opts: JobFolderOpts) => ['Work Orders', opts.month, opts.woNumber];

/** Ensure the job's own folder exists and return it — for the "open folder" button. */
export async function ensureJobFolder(opts: JobFolderOpts): Promise<JobFolder> {
  const token = await getToken(opts.clientId);
  const id = await ensurePathFolder(token, opts.rootFolderId, jobSegments(opts));
  return { id, webViewLink: await webLinkOf(token, id) };
}

/**
 * Move the job's own Drive folder (Work Orders / <month> / <WO#>) and everything in
 * it to the Trash — used when a work order is deleted, so the shop's Drive doesn't
 * keep folders for jobs that no longer exist. It goes to the Drive Trash (still
 * recoverable there for ~30 days), not a permanent wipe, so an accidental delete can
 * be undone. A no-op if the folder was never created. The drive.file scope means this
 * can only ever touch folders the app itself made. Returns true if a folder was
 * trashed, false if there was nothing to remove.
 */
export async function deleteJobFolder(opts: JobFolderOpts): Promise<boolean> {
  const token = await getToken(opts.clientId);
  let id: string | null = opts.rootFolderId;
  for (const name of jobSegments(opts)) {
    id = await findFolder(token, id, name);
    if (!id) return false; // the folder path never existed — nothing to remove
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok && res.status !== 404) throw new Error(driveError(await res.text(), res.status));
  // Forget what we remembered, so the same job number made again gets a fresh folder.
  recentFolders.clear();
  recentFiles.clear();
  return true;
}

export interface JobUpload {
  id: string;
  webViewLink: string;
  folderLink: string;
}

/**
 * Upload one file straight into the job's own folder (creating the folder tree
 * if needed) and share it by link. Progress is reported via `onProgress` (0–1).
 */
export async function uploadToJobFolder(
  file: File,
  opts: JobFolderOpts & {
    onProgress?: (frac: number) => void;
    /** Put it in this folder inside the job's folder ("400 x 304 with sintra"; nested with " / "). */
    subfolder?: string | null;
  },
): Promise<JobUpload> {
  const token = await getToken(opts.clientId);
  const jobFolderId = await ensurePathFolder(token, opts.rootFolderId, jobSegments(opts));
  const sub = (opts.subfolder ?? '').split(' / ').map((s) => s.trim()).filter(Boolean);
  const folderId = sub.length ? await ensurePathFolder(token, jobFolderId, sub) : jobFolderId;
  const uploaded = await postUpload(token, file, file.name, folderId, opts.onProgress);
  await shareAnyone(token, uploaded.id);
  return { ...uploaded, folderLink: await webLinkOf(token, jobFolderId) };
}

/**
 * Drop (or refresh) the job's receipt PDF in its folder — a frozen copy of the
 * task kept beside the print file. Best-effort: callers ignore failures so a
 * receipt hiccup never blocks the real upload.
 */
export async function saveReceiptToJobFolder(
  receipt: { blob: Blob; name: string },
  opts: JobFolderOpts,
): Promise<void> {
  const token = await getToken(opts.clientId);
  const folderId = await ensurePathFolder(token, opts.rootFolderId, jobSegments(opts));
  const id = await upsertFile(token, folderId, receipt.name, receipt.blob);
  await shareAnyone(token, id);
}

/** Save the monthly report PDF into Monthly Report / <month> (replacing any earlier one). */
export async function uploadReportToDrive(
  blob: Blob,
  name: string,
  opts: { clientId: string; rootFolderId: string; month: string },
): Promise<{ webViewLink: string; folderLink: string }> {
  const token = await getToken(opts.clientId);
  const folderId = await ensurePathFolder(token, opts.rootFolderId, ['Monthly Report', opts.month]);
  const id = await upsertFile(token, folderId, name, blob);
  await shareAnyone(token, id);
  return { webViewLink: await webLinkOf(token, id), folderLink: await webLinkOf(token, folderId) };
}

let pickerPromise: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerPromise) return pickerPromise;
  pickerPromise = new Promise((resolve, reject) => {
    const fail = () => { pickerPromise = null; reject(new Error('Could not load the Google Picker.')); };
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = () => {
      if (!window.gapi) return fail();
      window.gapi.load('picker', { callback: () => resolve(), onerror: fail });
    };
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return pickerPromise;
}

export interface PickedFile {
  id: string;
  url: string;
  name: string;
}

export interface PickOpts {
  clientId: string;
  apiKey: string;
  rootFolderId: string;
  woNumber: string;
  month: string;
}

/**
 * Let the user pick a file from this job's Drive folder (or upload a new one
 * through the Picker's own uploader, which has no browser size ceiling). This
 * is the drive.file way to attach a file the app did not itself create: picking
 * it grants the app access, so we can then link it and share it. Resolves to the
 * chosen file, or null if they close the Picker.
 */
export async function pickFromDrive(opts: PickOpts): Promise<PickedFile | null> {
  return (await openPicker(opts, false))[0] ?? null;
}

/** The same, but several files can be picked (or uploaded) at once. [] if closed. */
export function pickFilesFromDrive(opts: PickOpts): Promise<PickedFile[]> {
  return openPicker(opts, true);
}

async function openPicker(opts: PickOpts, multiple: boolean): Promise<PickedFile[]> {
  const token = await getToken(opts.clientId);
  await loadPicker();
  const picker = window.google!.picker!;
  const folderId = await ensurePathFolder(token, opts.rootFolderId, ['Work Orders', opts.month, opts.woNumber]);
  const appId = opts.clientId.split('-')[0]; // the project number prefixing the client id

  return new Promise<PickedFile[]>((resolve, reject) => {
    try {
      const view = new picker.DocsView().setParent(folderId);
      const upload = new picker.DocsUploadView().setParent(folderId);
      let builder = new picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(opts.apiKey)
        .setAppId(appId)
        .setTitle("This job's Drive folder")
        .addView(view)
        .addView(upload);
      if (multiple) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
      const built = builder
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED && data.docs?.length) {
            const docs = multiple ? data.docs : data.docs.slice(0, 1);
            for (const d of docs) shareAnyone(token, d.id).catch(() => {});
            resolve(docs.map((d) => ({ id: d.id, url: d.url, name: d.name })));
          } else if (data.action === picker.Action.CANCEL) {
            resolve([]);
          }
        })
        .build();
      built.setVisible(true);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Could not open the Google Picker.'));
    }
  });
}

function driveError(body: string, status: number): string {
  try {
    const msg = JSON.parse(body)?.error?.message;
    if (msg) return `Google Drive: ${msg}`;
  } catch { /* not JSON */ }
  if (status === 404) return 'The Drive folder was not found — check the folder link in Settings.';
  if (status === 403) return 'Google Drive refused the upload — the folder may not be shared with you.';
  return `Google Drive upload failed (HTTP ${status}).`;
}
