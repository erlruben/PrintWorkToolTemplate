import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/sessionContext';
import { logFileCredit, trashRemovedFile, useSettings } from '../lib/data';
import { driveFolderId, driveTokenNow, hasDriveToken, pickFilesFromDrive, UPLOAD_TOKEN_MS, uploadToJobFolder, warmUpDrive } from '../lib/drive';
import { extractLinks, jobFiles, toAttachment, type JobFile } from '../lib/links';
import { canPickFolder, filesFromDrop, filesFromFolderInput, folderOf, MAX_JOB_FILES, notUploaded, splitUpload } from '../lib/folders';
import { nameWithStatus, operatorsForSite, SITE_LABEL, URGENCY_LABEL, URGENCY_OPTIONS, type Attachment, type Item, type ItemColumn, type Profile, type Site, type Urgency, type WorkOrder } from '../lib/types';
import JobFiles from './JobFiles';
import ItemsEditor from './ItemsEditor';
import AutoGrowTextarea from './AutoGrowTextarea';
import { columnsOf, itemsOf, itemsTotal, moveDescriptionToItems } from '../lib/items';
import ItemsFromDescription from './ItemsFromDescription';
import { COPIED_IMAGE_HELP, readCopiedImages } from '../lib/clipboard';
import { deleteDraft, hasContent, newDraftId, saveDraft, type Draft, type DraftData } from '../lib/drafts';
import DriveConnect from './DriveConnect';

interface Props {
  artists: Profile[];
  /** Active printer operators — who can be picked to print the job. */
  operators: Profile[];
  /** Every WO number already in use, so a fresh random one avoids collisions. */
  taken: Set<string>;
  /** Prefill from an existing job — "Duplicate" for a reorder/repeat customer. */
  from?: WorkOrder | null;
  /** Re-open a saved draft (a form that was not finished). */
  draft?: Draft | null;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

// No 0/O/1/I/L — the code gets read aloud and copied by hand.
const WO_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A unique WO-XXXXX code: random letters and digits, checked against the ones
 *  already in use so it never clashes. */
function randomWoNumber(taken: Set<string>): string {
  for (let attempt = 0; attempt < 25; attempt++) {
    let code = 'WO-';
    for (let i = 0; i < 5; i++) code += WO_ALPHABET[Math.floor(Math.random() * WO_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  return 'WO-' + Date.now().toString(36).toUpperCase();
}

/** PRD section 6, step 1 — the receptionist opens the job. */
export default function NewOrder({ artists, operators, taken, from, draft, onClose }: Props) {
  const { profile } = useSession();
  const { settings, loading: settingsLoading } = useSettings();
  // An artist opens a task for themselves; reception/admin can assign to anyone.
  const isArtist = profile?.role === 'artist';
  const d0: DraftData = draft?.data ?? {};
  const [woNumber, setWoNumber] = useState(() => d0.wo_number || randomWoNumber(taken));
  // Duplicating copies the job's specs, but not its identity or progress: a
  // fresh WO number, today's date, and no finish/print.
  const [artistId, setArtistId] = useState(isArtist ? profile?.id ?? '' : d0.artist_id ?? from?.artist_id ?? '');
  const [clientName, setClientName] = useState(d0.client_name ?? from?.client_name ?? '');
  const [clientPhone, setClientPhone] = useState(d0.client_phone ?? from?.client_phone ?? '');
  // What the job is, line by line; the description is optional notes below it.
  const [items, setItems] = useState<Item[]>(() => d0.items ?? (from ? itemsOf(from) : []));
  // This task's own extra Items columns ("Branch", "Size"…).
  const [itemColumns, setItemColumns] = useState<ItemColumn[]>(() => columnsOf({ item_columns: d0.item_columns ?? from?.item_columns }));
  const [description, setDescription] = useState(d0.description ?? from?.description ?? '');
  // A typed list of items in the description can be moved into the table — and back.
  const [moveUndo, setMoveUndo] = useState<{ moved: number; description: string; items: Item[]; columns: ItemColumn[] } | null>(null);
  const moveToItems = () => {
    const next = moveDescriptionToItems(description, items, itemColumns);
    setMoveUndo({ moved: next.moved, description, items, columns: itemColumns });
    setItems(next.items); setItemColumns(next.columns); setDescription(next.description);
  };
  const undoMove = () => {
    if (!moveUndo) return;
    setItems(moveUndo.items); setItemColumns(moveUndo.columns); setDescription(moveUndo.description);
    setMoveUndo(null);
  };
  const [material, setMaterial] = useState(d0.material ?? from?.material ?? '');
  const [laminating, setLaminating] = useState(d0.laminating ?? from?.laminating ?? '');
  const [notes, setNotes] = useState(d0.notes ?? from?.notes ?? '');
  const [opNote, setOpNote] = useState(d0.operator_note ?? from?.operator_note ?? '');
  const [dateGiven, setDateGiven] = useState(d0.date_given || today());
  const [dateDue, setDateDue] = useState(d0.date_due ?? '');
  const [targetSite, setTargetSite] = useState<Site | ''>(d0.target_site ?? from?.target_site ?? '');
  // Who will print it, picked with the printing area (client request,
  // 2026-10-20). It becomes the queue's "Assigned to" on Send to print.
  const [plannedOp, setPlannedOp] = useState(() => {
    const id = d0.planned_operator_id ?? from?.planned_operator_id ?? '';
    return operators.some((op) => op.id === id) ? id : '';
  });
  const printers = operatorsForSite(operators, targetSite);
  const [urgency, setUrgency] = useState<Urgency | ''>(d0.urgency ?? from?.urgency ?? '');
  // The files can be attached right here — several at once: dropped/chosen
  // (uploaded to the job's Drive folder), picked from Drive, or pasted as links.
  // Duplicating never carries the source job's files over; each job gets its own.
  // With an artist assigned too, the job is created Finished (migration 045).
  const [files, setFiles] = useState<Attachment[]>(d0.files ?? []);
  const [pasteLink, setPasteLink] = useState('');
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveProg, setDriveProg] = useState(0);
  const [pickBusy, setPickBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  // Upload problems show next to the files (the form's top banner is out of sight).
  const [fileErr, setFileErr] = useState<string | null>(null);
  // Files waiting for a Google sign-in (see DriveConnect).
  const [pending, setPending] = useState<File[] | null>(null);
  const [pendingWarn, setPendingWarn] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // One upload at a time; a second batch meanwhile is refused, not run beside it.
  const uploading = useRef(false);
  // Leaving the page mid-upload loses the files not up yet: the browser asks first.
  useEffect(() => {
    if (!driveBusy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [driveBusy]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const driveReady = !!(settings.google_client_id?.trim() && driveFolderId(settings.drive_folder_url));
  const driveApiKey = !!settings.google_api_key?.trim();

  // Load Google sign-in ahead of the first upload so the token popup opens
  // inside the click instead of being blocked (which strands the upload at 0%).
  useEffect(() => { if (driveReady) warmUpDrive(); }, [driveReady]);

  // Keep the form as a draft while it is being filled in, so closing it, a
  // refresh or a lost connection never loses the work (migration 046).
  const [draftId] = useState(() => draft?.id ?? newDraftId());
  const [draftNote, setDraftNote] = useState<string | null>(draft ? 'Draft opened.' : null);
  const formData: DraftData = {
    wo_number: woNumber, artist_id: artistId, client_name: clientName, client_phone: clientPhone,
    items, item_columns: itemColumns, description, material, laminating, notes, operator_note: opNote, date_given: dateGiven, date_due: dateDue,
    target_site: targetSite, planned_operator_id: plannedOp, urgency, files,
  };
  const formKey = JSON.stringify(formData);
  const saved = useRef(false);
  // What still has to be written — kept so closing the form or the page within
  // the typing pause saves it at once instead of dropping it.
  const unsaved = useRef<DraftData | null>(null);
  const flushDraft = () => {
    const data = unsaved.current;
    unsaved.current = null;
    if (!profile || saved.current || !data) return;
    void saveDraft(profile.id, draftId, data).then((ok) =>
      setDraftNote(ok ? 'Draft saved.' : 'Saved as a draft on this device — it syncs when you are back online.'));
  };
  const flushRef = useRef(flushDraft);
  flushRef.current = flushDraft;
  useEffect(() => {
    if (!profile || saved.current || !hasContent(formData)) return;
    unsaved.current = formData;
    const t = window.setTimeout(() => flushRef.current(), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);
  useEffect(() => {
    const flush = () => flushRef.current();
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };   // closing the form
  }, []);

  // Paste a screenshot or snip (Ctrl+V) to upload it as a file.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;              // plain text pastes go to the field as usual
      e.preventDefault();
      if (!driveReady) { setFileErr('Uploading is not set up yet — paste a Drive link instead.'); return; }
      const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '');
      void uploadDrive(pasted.map((file, i) => new File([file], file.name && file.name !== 'image.png'
        ? file.name : `Pasted image ${stamp}${pasted.length > 1 ? `-${i + 1}` : ''}.png`, { type: file.type })));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveReady, woNumber, dateGiven]);

  async function discardDraft() {
    if (!confirm('Discard this draft? What you typed here will be lost.')) return;
    saved.current = true;
    if (profile) await deleteDraft(profile.id, draftId);
    onClose();
  }

  // A checkable preview of every file attached so far (uploaded, picked or pasted).
  const shown = jobFiles({ file_link: files[0]?.url ?? null, attachments: files });
  const addFiles = (added: Attachment[]) =>
    setFiles((cur) => {
      const next = [...cur];
      for (const a of added) if (!next.some((x) => x.url === a.url)) next.push(a);
      return next;
    });
  // Taking a file off the new job also moves it to the Drive trash (restorable
  // there for 30 days), unless a saved job already uses the same file.
  const removeFile = (f: JobFile) => {
    if (!confirm(`Remove ${f.name ?? 'this file'}?\n\nIt is also moved to the Google Drive trash (it can be restored from there for 30 days).`)) return;
    const clientId = settings.google_client_id?.trim();
    const tokenP: Promise<string | null> = clientId && f.link.id
      ? driveTokenNow(clientId).catch(() => null)
      : Promise.resolve(null);
    setFiles((cur) => cur.filter((x) => x.url !== f.url));
    void trashRemovedFile(tokenP, { url: f.url, driveId: f.link.id }).then(setLinkNote);
  };
  /** Pasted link(s) → the list (true once added). Several at once are fine. */
  const addLink = (raw: string): boolean => {
    if (!raw.trim()) return false;
    const links = extractLinks(raw);
    if (!links.length) { setError('A file link must start with https:// — or drop/choose files to upload.'); return false; }
    setError(null);
    addFiles(links.map((url) => ({ url, name: null })));
    if (links.length > 1) setLinkNote(`Added ${links.length} links.`);
    return true;
  };
  // Whether the person typed their own WO number. If they didn't (it's our
  // generated one), a rare clash on save is ours to resolve — regenerate and
  // retry — so two people creating at once never hit a dead-end error.
  const edited = useRef(false);

  /**
   * Drop/choose files → upload each into the job's own Drive folder
   * (Work Orders / <month> / <WO#>) and add them to the list. Above the browser
   * upload ceiling a file is skipped with a pointer to Drive-for-desktop + paste.
   */
  // "Paste Copied Image": the screenshot or snip on the clipboard goes up like a chosen file.
  const [pasteBusy, setPasteBusy] = useState(false);
  async function pasteCopiedImage() {
    setPasteBusy(true);
    const got = await readCopiedImages();
    setPasteBusy(false);
    if (!got.ok) { setFileErr(COPIED_IMAGE_HELP[got.why]); return; }
    await uploadDrive(got.files);
  }
  /**
   * Upload chosen or dropped files into the job's Drive folder, adding each to
   * the list the moment it is up. Files that cannot go (too big, unreadable)
   * and files an error stopped are named plainly (2026-10-27). `carried` is a
   * warning kept from before a Google sign-in.
   */
  async function uploadDrive(picked: File[], carried: string | null = null) {
    const clientId = settings.google_client_id?.trim();
    const folderId = driveFolderId(settings.drive_folder_url);
    if (!clientId || !folderId || !picked.length) return;
    if (uploading.current) { setFileErr('Files are still uploading. Wait for them to finish, then add these.'); return; }

    const { ok, warning: found } = splitUpload(picked);
    const warning = [carried, found].filter(Boolean).join(' ') || null;
    setFileErr(warning);
    setLinkNote(null);
    if (!ok.length) return;
    // A whole folder can be more than a task holds — say so before anything goes up.
    const waiting = pending?.length ?? 0;
    if (files.length + waiting + ok.length > MAX_JOB_FILES) {
      setFileErr(
        `A task holds up to ${MAX_JOB_FILES} files. ` +
        (files.length ? `This one has ${files.length}, and you chose ${ok.length} more.` : `You chose ${ok.length}.`) +
        ' Upload fewer files, or put the rest on another task.',
      );
      return;
    }
    // No Google pass (or one about to run out): hold the files and ask for one
    // click — the sign-in pop-up is blocked if it opens after the file window or
    // a drop. A second batch chosen meanwhile joins the first.
    if (!hasDriveToken(UPLOAD_TOKEN_MS)) {
      setPending((cur) => [...(cur ?? []), ...ok]);
      setPendingWarn((cur) => [cur, warning].filter(Boolean).join(' ') || null);
      return;
    }

    uploading.current = true;
    setDriveBusy(true);
    setDriveProg(0);
    const total = ok.reduce((t, f) => t + f.size, 0) || 1;
    let done = 0;
    let count = 0;
    try {
      for (const file of ok) {
        const up = await uploadToJobFolder(file, {
          clientId,
          rootFolderId: folderId,
          woNumber: woNumber.trim(),
          month: dateGiven.slice(0, 7),
          subfolder: folderOf(file),
          onProgress: (p) => setDriveProg((done + p * file.size) / total),
        });
        done += file.size;
        count++;
        addFiles([toAttachment({ url: up.webViewLink, name: file.name, folder: folderOf(file) })]);
        // The files now live under this WO number's folder, so stop auto-changing
        // the number on a save collision — surface the clash instead.
        edited.current = true;
      }
      setLinkNote(`${count === 1 ? 'Uploaded 1 file' : `Uploaded ${count} files`} to the job's Drive folder.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFileErr([
        msg,
        count ? `${count} of ${ok.length} files are uploaded and in the list.` : null,
        notUploaded(ok.slice(count)),
        warning,
      ].filter(Boolean).join(' '));
    } finally {
      uploading.current = false;
      setDriveBusy(false);
    }
  }

  // The one click that signs in to Google, then uploads the waiting files.
  function connectAndUpload() {
    const clientId = settings.google_client_id?.trim();
    const files = pending;
    const warn = pendingWarn;
    if (!clientId || !files) return;
    setFileErr(null);
    setConnecting(true);
    // Started inside this click, before any await, so the pop-up is allowed.
    driveTokenNow(clientId, UPLOAD_TOKEN_MS).then(
      () => { setConnecting(false); setPending(null); setPendingWarn(null); void uploadDrive(files, warn); },
      (err) => { setConnecting(false); setFileErr(err instanceof Error ? err.message : String(err)); },
    );
  }

  async function attachFromDrive() {
    const clientId = settings.google_client_id?.trim();
    const apiKey = settings.google_api_key?.trim();
    const rootFolderId = driveFolderId(settings.drive_folder_url);
    if (!clientId || !apiKey || !rootFolderId) return;
    setError(null);
    setLinkNote(null);
    setPickBusy(true);
    try {
      const picked = await pickFilesFromDrive({
        clientId,
        apiKey,
        rootFolderId,
        woNumber: woNumber.trim(),
        month: dateGiven.slice(0, 7),
      });
      if (picked.length) {
        addFiles(picked.map((p) => ({ url: p.url, name: p.name })));
        edited.current = true;
        setLinkNote(picked.length === 1 ? `Attached “${picked[0].name}” from Drive.` : `Attached ${picked.length} files from Drive.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setPickBusy(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();

    // Links typed in the box but not added yet still count.
    let list = files;
    if (pasteLink.trim()) {
      const typed = extractLinks(pasteLink);
      if (!typed.length) {
        setError('A file link must start with https:// — or drop/choose files to upload.');
        return;
      }
      list = [...files, ...typed.filter((u) => !files.some((x) => x.url === u)).map((url) => ({ url, name: null }))];
    }

    const lines = itemsOf({ items });
    if (!lines.length && !description.trim()) {
      setError('Add at least one item (or a job description).');
      return;
    }

    setBusy(true);
    setError(null);

    const base = {
      artist_id: artistId || null,
      description: description.trim(),
      material: material.trim() || null,
      laminating: laminating.trim() || null,
      client_name: clientName.trim() || null,
      client_phone: clientPhone.trim() || null,
      notes: notes.trim() || null,
      operator_note: opNote.trim() || null,
      items: lines,
      // Only sent when the task has its own columns (keeps older databases happy).
      ...(itemColumns.length ? { item_columns: columnsOf({ item_columns: itemColumns }) } : {}),
      qty: itemsTotal(lines),
      date_given: dateGiven,
      date_due: dateDue || null,
      target_site: targetSite || null,
      // Only sent when picked (keeps older databases happy).
      ...(plannedOp && !isArtist ? { planned_operator_id: plannedOp } : {}),
      urgency: urgency || null,
      // The first file is the main print file; every file is kept in attachments.
      file_link: list[0]?.url ?? null,
      attachments: list,
      created_by: profile?.id ?? null,
    };

    let code = woNumber.trim();
    const tried = new Set(taken);
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error } = await supabase.from('work_orders').insert({ wo_number: code, ...base });
      if (!error) {
        saved.current = true;
        if (profile) void deleteDraft(profile.id, draftId);
        // 1 Art done credit per file an artist attaches while creating the task
        // (a no-op server-side for any other role). Looked up by number after the
        // insert, so a refused read can never make the save itself retry.
        if (list.length) {
          void supabase.from('work_orders').select('id').eq('wo_number', code).maybeSingle().then(({ data }) => {
            if (data) for (const a of list) void logFileCredit(data.id, a.url);
          });
        }
        onClose();
        return;
      }

      // A unique-violation on OUR generated number (likely a simultaneous create)
      // — pick a fresh code and try again. A number the person typed is left to them.
      if (error.code === '23505' && !edited.current && attempt < 3) {
        tried.add(code);
        code = randomWoNumber(tried);
        setWoNumber(code);
        continue;
      }

      setError(error.code === '23505' ? `Work order ${code} already exists.` : error.message);
      setBusy(false);
      return;
    }
  }

  return (
    <>
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" style={{ maxWidth: 620 }} onSubmit={submit}>
        <div className="sheet-head">
          <h2>{from ? 'Duplicate work order' : 'New work order'}</h2>
          <div style={{ flex: 1 }} />
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          {error && <div className="error">{error}</div>}
          {from && (
            <div className="notice">
              Copied the specs from <strong>{from.wo_number}</strong>. This saves as a brand-new job
              with its own number — set the artist and dates, then add it.
            </div>
          )}

          <div className="grid2">
            <label className="field">
              <span>Work order number</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  type="text"
                  value={woNumber}
                  onChange={(e) => { setWoNumber(e.target.value); edited.current = true; }}
                  required
                />
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => { setWoNumber(randomWoNumber(taken)); edited.current = false; }}
                  title="Generate a new code"
                >
                  New code
                </button>
              </div>
              <span className="field-hint">Unique code, generated for each job — change it if you number jobs differently.</span>
            </label>

            <label className="field">
              <span>{isArtist ? 'Artist' : 'Assign to artist'}</span>
              <select value={artistId} onChange={(e) => setArtistId(e.target.value)} disabled={isArtist}>
                <option value="">
                  {artists.length ? 'Unassigned' : 'No artists yet — ask an admin to add them in Admin Tools'}
                </option>
                {artists.map((a) => (
                  <option key={a.id} value={a.id}>{nameWithStatus(a)}</option>
                ))}
              </select>
              {isArtist && <span className="field-hint">Tasks you open are assigned to you.</span>}
            </label>
          </div>

          <div className="grid2">
            <label className="field">
              <span>Customer</span>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client / company name"
              />
            </label>
            <label className="field">
              <span>Customer phone</span>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="For pickup — e.g. 0917…"
              />
            </label>
          </div>

          <div className="field">
            <span>Items</span>
            {/* Editing the table after a move ends its Undo — it would throw the edits away. */}
            <ItemsEditor items={items} onChange={(v) => { setItems(v); setMoveUndo(null); }}
              columns={itemColumns} onColumnsChange={(v) => { setItemColumns(v); setMoveUndo(null); }} />
          </div>

          <label className="field">
            <span>Job description (optional)</span>
            <AutoGrowTextarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); setMoveUndo(null); }}
              placeholder="Anything else about the job"
            />
          </label>
          <ItemsFromDescription description={description} onMove={moveToItems}
            undo={moveUndo ? { moved: moveUndo.moved, onUndo: undoMove } : null} />

          <div className="grid2">
            <label className="field">
              <span>Material</span>
              <input
                type="text"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="e.g. tarpaulin, sticker"
              />
            </label>

            <label className="field">
              <span>Laminating</span>
              <input
                type="text"
                value={laminating}
                onChange={(e) => setLaminating(e.target.value)}
                placeholder="e.g. matte, glossy, none"
              />
            </label>
          </div>

          <label className="field">
            <span>Priority</span>
            <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency | '')}>
              <option value="">None</option>
              {URGENCY_OPTIONS.map((u) => (
                <option key={u} value={u}>{URGENCY_LABEL[u]}</option>
              ))}
            </select>
          </label>

          <div className="grid2">
            <label className="field">
              <span>Date given</span>
              <input
                type="date"
                value={dateGiven}
                onChange={(e) => setDateGiven(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Date due</span>
              <input type="date" value={dateDue} onChange={(e) => setDateDue(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Which printing area</span>
            <select
              value={targetSite}
              onChange={(e) => {
                const site = e.target.value as Site | '';
                setTargetSite(site);
                // An operator from the other area no longer fits.
                if (plannedOp && !operatorsForSite(operators, site).some((op) => op.id === plannedOp)) setPlannedOp('');
              }}
            >
              <option value="">Either — shows on both queue screens</option>
              <option value="office">{SITE_LABEL.office}</option>
              <option value="production">{SITE_LABEL.production}</option>
            </select>
          </label>

          {!isArtist && (
            <label className="field">
              <span>Assigned to</span>
              <select value={plannedOp} onChange={(e) => setPlannedOp(e.target.value)}>
                <option value="">
                  {printers.length ? '— Not assigned —' : 'No operators for this area — ask an admin to add them in Admin Tools'}
                </option>
                {printers.map((op) => (
                  <option key={op.id} value={op.id}>{nameWithStatus(op)}</option>
                ))}
              </select>
              <span className="field-hint">The operator who will print it. The job is theirs in the Print Queue once it is sent to print.</span>
            </label>
          )}

          <label className="field">
            <span>Client notes / other requests</span>
            <AutoGrowTextarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {!isArtist && (
            <label className="field operator-note-field">
              <span>Note for the operator (optional)</span>
              <AutoGrowTextarea value={opNote} maxLength={1000} onChange={(e) => setOpNote(e.target.value)}
                placeholder="e.g. what to print when there is no file, special handling…" />
            </label>
          )}

          {/* Attach the files now — several at once: drag & drop / choose / pick /
              paste. Optional: the artist can still add them later on the ticket. */}
          <div className="field">
            <span>Files (optional)</span>
            {driveReady && (
              <div
                className={`drop-zone ${dragOver ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (!driveBusy) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (driveBusy) return;
                  void filesFromDrop(e.dataTransfer).then(uploadDrive);
                }}
              >
                {driveBusy ? (
                  <>
                    <span className="drop-hint">Uploading… {Math.round(driveProg * 100)}%</span>
                    <div className="upload-bar" role="progressbar" aria-valuenow={Math.round(driveProg * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="upload-bar-fill" style={{ width: `${Math.max(3, Math.round(driveProg * 100))}%` }} />
                    </div>
                  </>
                ) : (
                  <>
                    <span className="drop-hint">
                      Drag &amp; drop files or folders here — several at once. Images, PDF, Word, Excel, AI, PSD, CDR or any other type.
                    </span>
                    <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
                      <label className="btn sm" style={{ cursor: 'pointer' }}>
                        {files.length ? 'Add more files' : 'Choose files'}
                        <input
                          type="file"
                          multiple
                          hidden
                          onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; void uploadDrive(picked); }}
                        />
                      </label>
                      <button type="button" className="btn ghost sm" onClick={pasteCopiedImage} disabled={pasteBusy}
                        title="Attach the screenshot or snip you just copied">
                        {pasteBusy ? 'Pasting…' : 'Paste Copied Image'}
                      </button>
                      {canPickFolder() && (
                        <label className="btn ghost sm" style={{ cursor: 'pointer' }}
                          title="Upload a whole folder. Its files are kept together under the folder's name.">
                          Upload folder
                          <input
                            type="file"
                            multiple
                            hidden
                            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                            onChange={(e) => {
                              const picked = filesFromFolderInput(e.target.files);
                              const chose = (e.target.files?.length ?? 0) > 0;
                              e.target.value = '';
                              if (!picked.length) { if (chose) setFileErr('That folder has no files in it.'); return; }
                              void uploadDrive(picked);
                            }}
                          />
                        </label>
                      )}
                      {driveApiKey && (
                        <button type="button" className="btn ghost sm" onClick={attachFromDrive} disabled={pickBusy}>
                          {pickBusy ? 'Opening…' : 'Pick from Drive'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {files.length === 0 ? (
              <div className="files-link" style={{ marginTop: driveReady ? 8 : 0 }}>
                <input
                  type="url"
                  value={pasteLink}
                  placeholder={driveReady ? '…or paste one or more Drive links' : 'Paste one or more Drive links (https://drive.google.com/…)'}
                  aria-label="Paste one or more Drive links"
                  onChange={(e) => { setPasteLink(e.target.value); setLinkNote(null); }}
                  // A one-line box glues a pasted list of links together, so
                  // several links pasted at once are added straight away.
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    if (extractLinks(text).length < 2) return;
                    e.preventDefault();
                    if (addLink(text)) setPasteLink('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addLink(pasteLink)) setPasteLink(''); } }}
                />
                <button type="button" className="btn ghost sm" disabled={!pasteLink.trim()}
                  onClick={() => { if (addLink(pasteLink)) setPasteLink(''); }}>
                  Add
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <JobFiles
                  files={shown}
                  woNumber={woNumber.trim() || 'New work order'}
                  onRemove={removeFile}
                  onAddLink={async (urls) => addLink(urls.join(' '))}
                  onDropFiles={driveReady ? (dropped) => { void uploadDrive(dropped); } : undefined}
                />
              </div>
            )}
            {!driveReady && settingsLoading && <span className="field-hint">Getting the upload ready…</span>}
            {pending && (
              <DriveConnect count={pending.length} busy={connecting} onConnect={connectAndUpload}
                onCancel={() => { setPending(null); setPendingWarn(null); setFileErr(null); }} />
            )}
            {fileErr && <div className="error" style={{ margin: '8px 0 0' }}>{fileErr}</div>}
            <span className="field-hint">
              {linkNote ?? "Attach them now or leave it — the artist can add them later on the ticket. Uploads go to the job's Drive folder."}
            </span>
          </div>

          {/* What happens on save, so nobody is surprised by the status. */}
          <p className="new-order-outcome">
            {files.length
              ? <>Saves as <strong>File Attached for Review</strong> — it has {files.length === 1 ? 'a file' : `${files.length} files`}, so it goes straight to review{artistId ? '' : ' (you can still assign an artist later)'}.</>
              : artistId
                  ? <>Saves as <strong>In progress</strong> for the artist. Add the files to save it as <strong>File Attached for Review</strong>.</>
                  : <>Saves in <strong>To Do</strong>.</>}
          </p>

          <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            {draftNote && <span className="muted" style={{ fontSize: 12, marginRight: 'auto' }}>{draftNote} Find it under Drafts.</span>}
            {draftNote && (
              <button type="button" className="linkbtn" style={{ color: 'var(--vim-red)' }} onClick={discardDraft}>Discard draft</button>
            )}
            <button type="button" className="btn ghost" onClick={onClose}>{draftNote ? 'Close' : 'Cancel'}</button>
            <button className="btn" disabled={busy || driveBusy || !!pending}
              title={driveBusy ? 'Wait for the files to finish uploading' : pending ? 'Connect Google Drive to upload the waiting files first, or cancel them' : undefined}>
              {busy ? 'Adding…' : driveBusy ? 'Uploading… wait' : 'Add work order'}
            </button>
          </div>
        </div>
      </form>
    </div>

    </>
  );
}
