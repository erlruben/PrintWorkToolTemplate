import { useState } from 'react';
import { driveImageUrl, fileGroups, hasFolders, isDocument, type JobFile } from '../lib/links';
import { markFileOpened, markFilePrinted, type FileMark } from '../lib/data';

/** A Drive file's direct download address (the files are shared "anyone with the link"). */
function downloadUrl(f: JobFile): string | null {
  if (f.link.kind === 'drive-file' && f.link.id) return `https://drive.google.com/uc?export=download&id=${f.link.id}`;
  return null;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

/**
 * The files on a job in the Print Queue (049): a preview of each, an Open in
 * Drive button, and one button that downloads them — "Download File", or
 * "Download All Files" one after another (not zipped). The browser may ask once
 * to allow several downloads.
 *
 * Files that were uploaded in folders are listed under each folder's name
 * (2026-10-14), so the right file goes on the right material.
 *
 * Each file shows whether it was already opened and whether it is printed
 * (2026-10-09), for everyone at the queue: opening or downloading marks it
 * Opened; "Mark printed" ticks it off one file at a time.
 */
export default function QueueFiles({ files, wo, orderId, marks = {}, canMark = false, nameOf, onMarked }: {
  files: JobFile[];
  wo: string;
  orderId?: string;
  /** This job's marks, by file link. */
  marks?: Record<string, FileMark>;
  /** Operators, reception and admins mark files; everyone else only sees. */
  canMark?: boolean;
  nameOf?: (id: string | null) => string;
  onMarked?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const downloadable = files.filter((f) => downloadUrl(f));
  const marking = canMark && !!orderId;

  const opened = (f: JobFile) => {
    if (!marking || marks[f.url]?.opened_at) return;
    void markFileOpened(orderId!, f.url).then(() => onMarked?.());
  };
  async function togglePrinted(f: JobFile) {
    if (!marking) return;
    setSaving(f.url);
    await markFilePrinted(orderId!, f.url, !marks[f.url]?.printed_at);
    setSaving(null);
    onMarked?.();
  }

  async function downloadAll() {
    const list = downloadable;
    for (let i = 0; i < list.length; i++) {
      setBusy(`Downloading ${i + 1} of ${list.length}…`);
      // A hidden frame per file: the browser saves it and the page stays put.
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = downloadUrl(list[i])!;
      frame.dataset.download = wo;
      document.body.appendChild(frame);
      window.setTimeout(() => frame.remove(), 120_000);
      opened(list[i]);
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, 900));
    }
    setBusy(null);
  }

  if (!files.length) return null;   // the card's note strip already says there is no file
  const printedCount = files.filter((f) => marks[f.url]?.printed_at).length;
  const who = (id: string | null) => (nameOf && id ? nameOf(id).split(/\s+/)[0] : '');
  // Files uploaded in folders (one per size or material) are shown under the folder's name.
  const foldered = hasFolders(files);
  return (
    <div className="pq-filebox">
      <div className="pq-filebox-head">
        <span className="pq-section-label" style={{ margin: 0 }}>
          {files.length === 1 ? 'File' : `${files.length} files`}
          {printedCount > 0 && <span className="pq-file-count"> · {printedCount} of {files.length} printed</span>}
        </span>
        {downloadable.length > 0 && (
          <button className="pq-btn pq-download" onClick={downloadAll} disabled={!!busy}>
            {busy ?? (downloadable.length === 1 ? '⤓ Download File' : `⤓ Download All Files (${downloadable.length})`)}
          </button>
        )}
      </div>
      {marking && printedCount === files.length && (
        <p className="pq-file-alldone">All files printed — tap <strong>✓ Finish</strong> when the job is done.</p>
      )}
      {fileGroups(files).map((g) => {
        const done = g.files.filter((f) => marks[f.url]?.printed_at).length;
        return (
          <div className={foldered ? 'pq-folder' : undefined} key={g.folder ?? ''}>
            {foldered && (
              <div className={`pq-folder-head${marking && done === g.files.length ? ' done' : ''}`}>
                <span className="pq-folder-name">
                  {g.folder ? <><svg className="folder-ico" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" /></svg>{g.folder}</> : 'Other files'}
                </span>
                <span className="pq-folder-count">
                  {g.files.length === 1 ? '1 file' : `${g.files.length} files`}
                  {marking && done > 0 && ` · ${done === g.files.length ? 'all printed' : `${done} printed`}`}
                </span>
              </div>
            )}
            <div className="pq-filegrid">
        {g.files.map((f) => {
          const i = files.indexOf(f);
          const img = !isDocument(f) ? driveImageUrl(f.link, 320) : null;
          const m = marks[f.url];
          const state = m?.printed_at ? 'printed' : m?.opened_at ? 'opened' : '';
          return (
            <div className={`pq-file${state ? ` ${state}` : ''}`} key={f.url}>
              <div className="pq-file-thumb">
                <a className="pq-file-shot" href={f.url} target="_blank" rel="noreferrer" title={f.name ?? undefined} onClick={() => opened(f)}>
                  {img ? <img src={img} alt={f.name ?? `File ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" /> : <span className="pq-file-doc">{(f.name?.split('.').pop() ?? 'file').slice(0, 4).toUpperCase()}</span>}
                  {state && <span className={`pq-file-badge ${state}`}>{state === 'printed' ? '✓ Printed' : 'Opened'}</span>}
                  {/* Approved is a notice for operators only — it never gates Done or Send to print. */}
                  {m?.approved_at && <span className="pq-file-approved-badge">✓ Approved</span>}
                </a>
                {marking && (
                  <label className={`pq-file-done${m?.printed_at ? ' on' : ''}`} title="Tick off once this file is printed">
                    Done
                    <input
                      type="checkbox"
                      checked={!!m?.printed_at}
                      disabled={saving === f.url}
                      onChange={() => togglePrinted(f)}
                    />
                  </label>
                )}
              </div>
              <span className="pq-file-name" title={f.name ?? undefined}>{f.main ? '★ ' : ''}{f.name || `File ${i + 1}`}</span>
              {state && (
                <span className="pq-file-mark">
                  {m?.printed_at
                    ? `Printed${who(m.printed_by) ? ` by ${who(m.printed_by)}` : ''} · ${timeOf(m.printed_at)}`
                    : `Opened${who(m!.opened_by) ? ` by ${who(m!.opened_by)}` : ''} · ${timeOf(m!.opened_at!)}`}
                </span>
              )}
              <a className="pq-btn pq-file-open" href={f.url} target="_blank" rel="noreferrer" onClick={() => opened(f)}>Open in Drive ↗</a>
            </div>
          );
        })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
