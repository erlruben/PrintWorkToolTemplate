import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { driveImageUrl, drivePreviewUrl, extractLinks, fileGroups, fileTag, hasFolders, isDocument, type JobFile } from '../lib/links';
import { filesFromDrop } from '../lib/folders';
import { IconSide } from './Icons';

// Files Drive can show as an image once they are shared by link.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|psd|ai|heic|svg)$/i;

interface Props {
  files: JobFile[];
  woNumber: string;
  /** Buttons for adding more files, shown in the panel's top row. */
  actions?: ReactNode;
  /** Remove the file on show (editors only). Omit to hide Remove. */
  onRemove?: (f: JobFile) => void;
  /** Add pasted links, one or more (editors only). Resolves true once saved. */
  onAddLink?: (urls: string[]) => Promise<boolean>;
  /** Upload files dropped onto the panel (editors only). */
  onDropFiles?: (files: File[]) => void;
  busy?: boolean;
  /** Approved-to-print mark per file link, keyed by file url — a notice only,
   * it never blocks Send to print or Mark printed/Done (2026-10-21). */
  approved?: Record<string, boolean>;
  /** Artist, reception or admin tick a file "Approved". Omit to hide the control. */
  onApprove?: (f: JobFile, approved: boolean) => void;
}

const FolderIcon = () => (
  <svg className="folder-ico" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" /></svg>
);

/** Copy text, falling back to a hidden text box where the Clipboard API is missing. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* not supported */ }
    t.remove();
    return ok;
  }
}

/**
 * Every file on a job — pictures and documents alike (PDF, Word, Excel…) — one
 * at a time: a large preview with ‹ › to step through them (arrow keys and swipe
 * work too), a row of thumbnails to jump straight to one, and a full-screen view
 * with the same controls, where a document opens in Drive's own viewer so every
 * page can be read. Drive only serves previews for files shared "anyone with the
 * link"; anything else shows its type and a link to open it in Drive.
 */
export default function JobFiles({ files, woNumber, actions, onRemove, onAddLink, onDropFiles, busy, approved, onApprove }: Props) {
  const n = files.length;
  const [at, setAt] = useState(0);
  const [full, setFull] = useState(false);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [dropOver, setDropOver] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  // When files are added, show the first new one; when one is removed, stay in range.
  const [seenN, setSeenN] = useState(n);
  if (n !== seenN) {
    setSeenN(n);
    if (n > seenN) setAt(seenN);
  }
  const i = Math.max(0, Math.min(at, n - 1));
  const cur = files[i];

  // The link box shows the link of the file on show (so a fresh upload's link
  // appears there by itself) with Copy link. Pasting a different link into it
  // turns the button into Add. Several links pasted at once are all added.
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);
  // The "All links" dropdown: which link was just copied ('all' = every one).
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const pasted = typed.trim();
  const has = (url: string) => files.some((f) => f.url === url);
  // The links typed that the job does not have yet; text with no link at all is
  // passed on as-is so the editor can say what is wrong with it.
  const typedLinks = extractLinks(pasted);
  const toAdd = typedLinks.length ? typedLinks.filter((u) => !has(u)) : [pasted];
  const isNew = !!onAddLink && pasted !== '' && toAdd.length > 0 && !has(pasted);

  const go = (d: number) => setAt((a) => ((Math.max(0, Math.min(a, n - 1)) + d) % n + n) % n);
  const markBroken = (url: string) => setBroken((s) => new Set(s).add(url));

  // Full screen: arrows step, Escape closes; focus moves into the viewer.
  useEffect(() => {
    if (!full) return;
    viewerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setFull(false); }
      else if (e.key === 'ArrowLeft' && n > 1) setAt((a) => ((Math.min(a, n - 1) - 1) % n + n) % n);
      else if (e.key === 'ArrowRight' && n > 1) setAt((a) => (Math.min(a, n - 1) + 1) % n);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full, n]);

  // Warm the neighbours so ‹ › feels instant.
  useEffect(() => {
    if (n < 2) return;
    const w = full ? 2000 : 1000;
    for (const k of [i - 1, i + 1]) {
      const f = files[(k + n) % n];
      const src = f && driveImageUrl(f.link, w);
      if (src && !broken.has(f.url)) new Image().src = src;
    }
  }, [i, n, full, files, broken]);

  if (!cur) return null;

  const copy = async () => {
    if (await copyText(cur.url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };
  const copyFrom = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopiedFrom(key);
      window.setTimeout(() => setCopiedFrom((k) => (k === key ? null : k)), 1800);
    }
  };
  const add = async () => {
    if (isNew && onAddLink && (await onAddLink(toAdd))) setTyped('');
  };
  // A one-line box drops line breaks, which would glue a pasted list of links
  // into one broken link, so a paste of several links is added straight away.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!onAddLink) return;
    const links = extractLinks(e.clipboardData.getData('text'));
    if (links.length < 2) return;
    e.preventDefault();
    const fresh = links.filter((u) => !has(u));
    if (fresh.length) void onAddLink(fresh).then((ok) => { if (ok) setTyped(''); });
  };

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!s || !t || n < 2) return;
    const dx = t.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(t.clientY - s.y)) go(dx < 0 ? 1 : -1);
  };

  const nameOf = (f: JobFile, k: number) => f.name ?? (n > 1 ? `File ${k + 1}` : f.link.label);
  // No picture of the file: its type and name. A document can still be read in
  // the full-screen viewer, so it opens that; anything else opens in Drive.
  const noPreview = (f: JobFile, big: boolean, read?: () => void) => {
    const body = (
      <>
        <span className="files-tag">{fileTag(f.name, f.url)}</span>
        <span className="files-noimg-name">{nameOf(f, i)}</span>
        <span className="muted">
          {read
            ? 'Tap to read it here'
            : f.link.kind === 'drive-file' || f.link.kind === 'docs'
              ? 'No preview — open it in Drive' +
                (big && IMAGE_EXT.test(f.name ?? '') ? ' (to see it here, share it as “Anyone with the link”)' : '')
              : 'Open the file'}
        </span>
      </>
    );
    return read
      ? <button type="button" className="files-noimg" onClick={read}>{body}</button>
      : <a className="files-noimg" href={f.url} target="_blank" rel="noreferrer">{body}</a>;
  };
  const nav = n > 1 && (
    <>
      <button type="button" className="files-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous file">
        <IconSide dir="left" />
      </button>
      <button type="button" className="files-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next file">
        <IconSide dir="right" />
      </button>
    </>
  );

  const foldered = hasFolders(files);
  const folderCount = fileGroups(files).filter((g) => g.folder).length;
  const shot = driveImageUrl(cur.link, 1000);
  const big = driveImageUrl(cur.link, 2000);
  const doc = isDocument(cur);
  const reader = doc ? drivePreviewUrl(cur.link) : null; // Drive's page viewer
  const hasShot = !!shot && !broken.has(cur.url);
  const canFull = hasShot || !!reader;

  // Drag files from the computer onto the panel to add them.
  const dropProps = onDropFiles ? {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setDropOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropOver(false);
      // Read inside the drop: a dropped folder gives up its files only now.
      void filesFromDrop(e.dataTransfer).then((dropped) => { if (dropped.length) onDropFiles(dropped); });
    },
  } : {};

  return (
    <div className={`drive-box files-panel ${dropOver ? 'drop-over' : ''}`} {...dropProps}>
      {dropOver && <div className="files-drop-hint">Drop the files or folders to add them</div>}
      <div className="files-head">
        <span className="files-title">
          {n === 1 ? '1 file' : `${n} files`}
          {folderCount > 0 && ` · ${folderCount === 1 ? '1 folder' : `${folderCount} folders`}`}
        </span>
        {actions && <div className="files-actions">{actions}</div>}
      </div>

      <div
        className="files-stage"
        tabIndex={n > 1 ? 0 : -1}
        aria-roledescription="carousel"
        aria-label={`Files for ${woNumber}`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' && n > 1) { e.preventDefault(); go(-1); }
          if (e.key === 'ArrowRight' && n > 1) { e.preventDefault(); go(1); }
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {hasShot ? (
          <button type="button" className="files-shot" onClick={() => setFull(true)} aria-label={`View ${nameOf(cur, i)} full screen`}>
            <img key={cur.url} src={shot} alt={nameOf(cur, i)} onError={() => markBroken(cur.url)} />
          </button>
        ) : (
          noPreview(cur, true, reader ? () => setFull(true) : undefined)
        )}
        {doc && hasShot && <span className="files-doctag">{fileTag(cur.name, cur.url)}</span>}
        {nav}
        {n > 1 && <span className="files-count" aria-live="polite">{i + 1} / {n}</span>}
      </div>

      <div className="files-caption">
        {cur.folder && <span className="files-folder" title={`In the folder ${cur.folder}`}><FolderIcon />{cur.folder}</span>}
        <span className="files-name" title={nameOf(cur, i)}>{nameOf(cur, i)}</span>
        <a className="linkbtn" href={cur.url} target="_blank" rel="noreferrer">Open in Drive</a>
        {canFull && (
          <button type="button" className="linkbtn" onClick={() => setFull(true)}>{reader ? 'Read' : 'Full screen'}</button>
        )}
        {onRemove && (
          <button type="button" className="linkbtn files-remove" onClick={() => onRemove(cur)} disabled={busy}>Remove</button>
        )}
        {onApprove && (
          <label className={`files-approve${approved?.[cur.url] ? ' on' : ''}`} title="Tells operators this file is cleared to print — it never blocks Send to print">
            Approved
            <input
              type="checkbox"
              checked={!!approved?.[cur.url]}
              onChange={(e) => onApprove(cur, e.target.checked)}
            />
          </label>
        )}
      </div>

      {n > 1 && (
        <div className="files-strip">
          {files.map((f, k) => {
            const t = driveImageUrl(f.link, 200);
            // A folder's files sit together; its name leads them.
            const opens = foldered && (k === 0 || files[k - 1].folder !== f.folder);
            return (
              <Fragment key={f.url}>
                {opens && (
                  <span className={`files-strip-folder${f.folder ? '' : ' loose'}`} title={f.folder ?? 'Files in no folder'}>
                    {f.folder ? <><FolderIcon />{f.folder}</> : 'Other files'}
                  </span>
                )}
                <button
                  type="button"
                  className={`files-thumb ${k === i ? 'on' : ''}`}
                  onClick={() => setAt(k)}
                  aria-label={`Show ${nameOf(f, k)}${f.folder ? `, in ${f.folder}` : ''}`}
                  aria-current={k === i ? 'true' : undefined}
                  title={f.folder ? `${f.folder} / ${nameOf(f, k)}` : nameOf(f, k)}
                >
                  {t && !broken.has(f.url)
                    ? <img src={t} alt="" loading="lazy" onError={() => markBroken(f.url)} />
                    : <span className="files-tag">{fileTag(f.name, f.url)}</span>}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}

      <div className="files-link">
        <input
          type="url"
          value={isNew ? typed : cur.url}
          readOnly={!onAddLink}
          aria-label={onAddLink ? 'File link — paste one or more Drive links here to add them' : 'File link'}
          title={onAddLink ? 'Paste one or more Drive links here to add them' : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTyped(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // Never let Enter submit a surrounding form (the New work order form).
            if (e.key === 'Enter') { e.preventDefault(); if (isNew) add(); }
            if (e.key === 'Escape' && isNew) { e.stopPropagation(); setTyped(''); }
          }}
        />
        {isNew ? (
          <button type="button" className="btn sm" onClick={add} disabled={busy}>
            {toAdd.length > 1 ? `Add ${toAdd.length} links` : 'Add'}
          </button>
        ) : (
          <button type="button" className="btn ghost sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        )}
      </div>

      {/* Every link on the task in one dropdown — to check, copy or open them all. */}
      {n > 1 && (
        <details className="links-list">
          <summary>All links ({n})</summary>
          <ol>
            {files.map((f, k) => (
              <li key={f.url} className={k === i ? 'on' : undefined}>
                <button type="button" className="links-list-name" title="Show this file" onClick={() => setAt(k)}>
                  {k + 1}. {f.folder && <span className="links-list-folder">{f.folder} / </span>}{nameOf(f, k)}
                </button>
                <span className="links-list-url" title={f.url}>{f.url}</span>
                <span className="links-list-acts">
                  <button type="button" className="linkbtn" onClick={() => copyFrom(f.url, f.url)}>
                    {copiedFrom === f.url ? 'Copied' : 'Copy'}
                  </button>
                  <a className="linkbtn" href={f.url} target="_blank" rel="noreferrer">Open</a>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn ghost sm" onClick={() => copyFrom('all', files.map((f) => f.url).join('\n'))}>
            {copiedFrom === 'all' ? 'Copied all links' : `Copy all ${n} links`}
          </button>
        </details>
      )}

      {!cur.link.recognised && (
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          This is not a Google Drive link. It will still open, but the operators expect files in Drive.
        </p>
      )}

      {/* On document.body, so no ancestor (the ticket sheet) can clip or offset it. */}
      {full && createPortal(
        <div
          className="overlay files-viewer-over"
          role="dialog"
          aria-modal="true"
          aria-label={`${woNumber} files`}
          ref={viewerRef}
          tabIndex={-1}
        >
          <div className="files-viewer-bar">
            <span className="files-viewer-title">
              {n > 1 && <strong>{i + 1} / {n}</strong>} {cur.folder && <span className="files-viewer-folder">{cur.folder} / </span>}{nameOf(cur, i)}
            </span>
            <a href={cur.url} target="_blank" rel="noreferrer">Open in Drive</a>
            <button type="button" className="files-viewer-x" onClick={() => setFull(false)} aria-label="Close">×</button>
          </div>
          <div
            className="files-viewer-stage"
            onClick={(e) => e.target === e.currentTarget && setFull(false)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {reader
              // Drive's viewer: every page, scrollable, with its own zoom.
              ? <iframe key={cur.url} className="files-doc" src={reader} title={nameOf(cur, i)} allow="autoplay" />
              : big && !broken.has(cur.url)
                ? <img key={cur.url} src={big} alt={nameOf(cur, i)} onError={() => markBroken(cur.url)} />
                : noPreview(cur, true)}
            {nav}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
