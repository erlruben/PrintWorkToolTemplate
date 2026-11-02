import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { PrinterBanner } from './PrinterStatus';
import { supabase, userBearer } from '../lib/supabase';
import { logFileCredit, markFileApproved, markNotificationsSeen, revokeFileCredit, softDeleteOrder, trashRemovedFile, useFileMarks, useSettings, usePrinterStatus } from '../lib/data';
import { canCreateOrders, canEditOrder, useSession } from '../lib/sessionContext';
import { mentionToken, plainBody } from '../lib/mentions';
import { AFTER_PRINT_LABEL, afterPrint, isAdminRole, isReceptionRole, nameWithStatus, isArchived, operatorsForSite, PROBLEM_LABEL, SITE_LABEL, URGENCY_LABEL, URGENCY_OPTIONS, fmtDate, type Attachment, type Item, type ItemColumn, type Profile, type Site, type Urgency, type WorkOrder, waitingForClient } from '../lib/types';
import Chat from './Chat';
import StageSelect from './StageSelect';
import JobFiles from './JobFiles';
import { extractLinks, jobFiles, toAttachment, type JobFile } from '../lib/links';
import TaskHistory from './TaskHistory';
import { printerOf } from '../lib/credits';
import { canPickFolder, filesFromDrop, filesFromFolderInput, folderOf, MAX_JOB_FILES, notUploaded, splitUpload } from '../lib/folders';
import { driveFolderId, driveTokenNow, ensureJobFolder, hasDriveToken, pickFilesFromDrive, saveReceiptToJobFolder, UPLOAD_TOKEN_MS, uploadToJobFolder, warmUpDrive } from '../lib/drive';
import DriveConnect from './DriveConnect';
import ItemsEditor from './ItemsEditor';
import { COPIED_IMAGE_HELP, readCopiedImages } from '../lib/clipboard';
import AutoGrowTextarea from './AutoGrowTextarea';
import { columnsOf, hasPerSheet, itemsOf, itemsTotal, moveDescriptionToItems, sheetsTotal } from '../lib/items';
import ItemsFromDescription from './ItemsFromDescription';
import { clearPendingEdits, keepPendingEdits, pendingEditsFor } from '../lib/drafts';
import { buildReceipt } from '../lib/receipt';

// Quick-pick reasons when reception returns a print to the operator.
const RETURN_REASONS = ['Wrong colour', 'Wrong size', 'Damaged media', 'Wrong file', 'Alignment off'];

/**
 * The fields a person edits on the ticket, and how each is saved. They save on
 * their own (auto-save). The print file's link is not among them: it saves
 * through its own box, the uploader or the Drive picker, because adding a file
 * finishes the job — a half-typed link must never do that.
 */
const SAVE_AS = {
  wo_number: (d: WorkOrder) => d.wo_number.trim(),
  artist_id: (d: WorkOrder) => d.artist_id,
  description: (d: WorkOrder) => d.description,
  items: (d: WorkOrder) => itemsOf(d),
  item_columns: (d: WorkOrder) => columnsOf(d),
  material: (d: WorkOrder) => d.material,
  laminating: (d: WorkOrder) => d.laminating,
  client_name: (d: WorkOrder) => d.client_name ?? null,
  client_phone: (d: WorkOrder) => d.client_phone ?? null,
  notes: (d: WorkOrder) => d.notes,
  date_given: (d: WorkOrder) => d.date_given,
  date_due: (d: WorkOrder) => d.date_due || null,
  date_finished: (d: WorkOrder) => d.date_finished || null,
  target_site: (d: WorkOrder) => d.target_site || null,
  planned_operator_id: (d: WorkOrder) => d.planned_operator_id || null,
  urgency: (d: WorkOrder) => d.urgency || null,
  operator_note: (d: WorkOrder) => d.operator_note?.trim() ? d.operator_note : null,
  // With item lines, the total quantity is their sum.
  qty: (d: WorkOrder) => { const it = itemsOf(d); return it.length ? itemsTotal(it) : d.qty ?? null; },
} as const;
type EditKey = keyof typeof SAVE_AS;
const EDIT_KEYS = Object.keys(SAVE_AS) as EditKey[];

/** The edited fields that differ from `base`, as they would be saved. */
function changes(d: WorkOrder, base: WorkOrder): Partial<Record<EditKey, unknown>> {
  const out: Partial<Record<EditKey, unknown>> = {};
  for (const k of EDIT_KEYS) {
    const v = SAVE_AS[k](d);
    if (JSON.stringify(v ?? '') !== JSON.stringify(SAVE_AS[k](base) ?? '')) out[k] = v;
  }
  return out;
}

/** A newer saved version of the job, with the person's own unsaved edits kept on top. */
function rebase(d: WorkOrder, base: WorkOrder, next: WorkOrder): WorkOrder {
  const out: Record<string, unknown> = { ...next };
  for (const k of [...EDIT_KEYS, 'file_link'] as const) {
    if (JSON.stringify(d[k] ?? '') !== JSON.stringify(base[k] ?? '')) out[k] = d[k];
  }
  return out as unknown as WorkOrder;
}

// updated_at to milliseconds (Postgres sends microseconds, which not every
// browser parses).
const msOf = (t: string) => Date.parse(t.replace(/(\.\d{3})\d+/, '$1'));

interface Props {
  order: WorkOrder;
  profiles: Profile[];
  onClose: () => void;
  /** Open a new order prefilled from this one (repeat/reorder). */
  onDuplicate?: (o: WorkOrder) => void;
}

/** PRD section 5, feature 3 — the detailed ticket card. */
export default function TicketCard({ order, profiles, onClose, onDuplicate }: Props) {
  const { profile } = useSession();
  const printerStatus = usePrinterStatus();
  const { settings } = useSettings();
  const editable = canEditOrder(profile, order);
  // Reception and admins review the work: a finished job is sent to print or sent
  // back to the artist; a printed one is Released, or Returned to the operator.
  const isReviewer = isReceptionRole(profile?.role) || isAdminRole(profile?.role);
  // The artist can send their own finished job straight to print (046).
  const isOwnArtist = profile?.role === 'artist' && order.artist_id === profile.id;
  // Everyone may move a job to the Trash (an artist only their own) — 046.
  const canTrash = !!profile && (profile.role !== 'artist' || isOwnArtist);
  const after = afterPrint(order);
  // "Waiting for client approval": for a job an artist has, before it goes to print — set by
  // reception, an admin or its own artist. Offered only once the database has the column.
  const clientWaitOn = waitingForClient(order);
  const canClientWait = (isReviewer || isOwnArtist) && 'client_wait_since' in order && !!order.artist_id
    && (order.status === 'in_progress' || order.status === 'finished') && !order.deleted_at;
  // Adding a file to an open job marks it Finished (the database does it).
  const attachFinishes = !order.date_finished && !order.printed_at;
  // The files stay open until the job is sent to print: on a Finished job the
  // artist (their own) and reception can still add or remove files, and it
  // stays Finished (migration 044). Everything else stays locked for them.
  const canEditFiles = editable || (order.status === 'finished' && (
    isReceptionRole(profile?.role) || (profile?.role === 'artist' && order.artist_id === profile.id)));
  // Reception can also assign the artist then — a job with its file is Finished
  // even before it has one (migration 047).
  const canSetArtist = editable || (order.status === 'finished' && isReceptionRole(profile?.role));
  // Approved-to-print (2026-10-21): an artist, reception or admin tells
  // operators a file is cleared — a notice only, never a gate on Send to
  // print. Offered until the job is actually printed.
  const canApprove = !!profile && !order.printed_at &&
    (profile.role === 'artist' || isReceptionRole(profile.role) || isAdminRole(profile.role));
  const { byOrder: fileMarksByOrder } = useFileMarks([order.id]);
  const fileMarks = fileMarksByOrder[order.id] ?? {};
  const approvedByUrl = Object.fromEntries(
    Object.entries(fileMarks).map(([url, mark]) => [url, !!mark.approved_at]),
  );
  // Who will print it, picked with the printing area: reception and admins,
  // until it is sent to print — from then on the Print Queue's "Assigned to"
  // is the one that counts (2026-10-20). Offered once the database has it.
  const canPlanOperator = isReviewer && 'planned_operator_id' in order
    && !order.queued_at && !order.printed_at && !order.deleted_at;
  // The note for the operator: reception and admins, at any stage (049).
  const canNote = editable || isReviewer;
  // What this person may save on this job. Without full edit rights only the
  // fields they are allowed to touch are sent.
  const canSave = editable || canSetArtist || canNote || canPlanOperator;
  const allowRef = useRef<{ all: boolean; keys: EditKey[] }>({ all: editable, keys: [] });
  allowRef.current = {
    all: editable,
    keys: [
      ...(canSetArtist ? ['artist_id' as const] : []),
      ...(canNote ? ['operator_note' as const] : []),
      ...(canPlanOperator ? ['planned_operator_id' as const] : []),
    ],
  };


  const [draft, setDraft] = useState<WorkOrder>(() => {
    const kept = profile ? pendingEditsFor(profile.id, order.id) : null;
    return kept ? ({ ...order, ...kept } as WorkOrder) : order;
  });
  const meRef = useRef(profile?.id);
  useEffect(() => { meRef.current = profile?.id; });
  // Opening the task is seeing it: its "gave you …" notification needn't stay unread.
  useEffect(() => {
    if (profile?.id) void markNotificationsSeen(profile.id, order.id, ['assign']);
  }, [profile?.id, order.id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  // Files waiting for a Google sign-in (see DriveConnect), and upload problems
  // shown next to the files rather than in the banner at the top.
  const [pending, setPending] = useState<File[] | null>(null);
  // What could not go up with the files waiting there (too big, unreadable) —
  // said again once the upload starts, so the sign-in never hides it.
  const [pendingWarn, setPendingWarn] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // One upload at a time: a second batch dropped meanwhile is refused, not run beside it.
  const uploading = useRef(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [driveProg, setDriveProg] = useState(0);
  const [folderBusy, setFolderBusy] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');

  // Current artists, plus whoever is already on this job even if they have
  // since been deactivated — otherwise the dropdown would silently blank out
  // an old job's artist the first time someone saved it.
  const artists = useMemo(
    () =>
      profiles.filter(
        (p) => p.role === 'artist' && (p.active || p.id === order.artist_id),
      ),
    [profiles, order.artist_id],
  );
  const nameOf = (id: string | null) =>
    id ? profiles.find((p) => p.id === id)?.full_name ?? 'Unknown' : 'Unassigned';
  // Active printer operators — who can be picked to print it.
  const printers = useMemo(() => profiles.filter((p) => p.role === 'operator' && p.active), [profiles]);

  // Auto-save. `server` is the latest saved version this card knows of; edits
  // that differ from it are saved about a second after the typing stops. Saves
  // run one at a time, in order.
  const [server, setServer] = useState(order);
  // Every file on the job, the main print file first — from the latest saved
  // version, so a second upload right after the first never works from a list
  // that is out of date.
  const files = useMemo(() => jobFiles(server), [server]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const draftRef = useRef(draft);
  const serverRef = useRef(server);
  useEffect(() => { draftRef.current = draft; serverRef.current = server; });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const savedAny = useRef(false);
  const saveFailed = useRef(false); // the error banner is showing a failed save

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(fn, fn);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  // Adopt a newer saved version, keeping whatever the person is still typing.
  const adopt = useCallback((base: WorkOrder, next: WorkOrder) => {
    serverRef.current = next;
    setServer(next);
    setDraft((d) => rebase(d, base, next));
  }, []);

  /** Save the edits now (after any save already running). True once nothing is left unsaved. */
  const saveNow = useCallback((): Promise<boolean> => enqueue(async () => {
    const base = serverRef.current;
    const d = draftRef.current;
    const allow = allowRef.current;
    const patch = changes(d, base);
    if (!allow.all) for (const k of Object.keys(patch) as EditKey[]) if (!allow.keys.includes(k)) delete patch[k];
    if (!Object.keys(patch).length) return true;
    const fail = (msg: string) => { saveFailed.current = true; setSaveState('error'); setError(msg); return false; };
    if (patch.wo_number === '') return fail('Add the work order number — changes are not saved yet.');
    if ('date_given' in patch && !patch.date_given) return fail('Add the date given — changes are not saved yet.');
    setSaveState('saving');
    const { data, error: err } = await supabase.from('work_orders').update(patch).eq('id', base.id).select().single();
    if (err || !data) {
      const msg = err?.message ?? '';
      if (meRef.current && (!navigator.onLine || /fetch|network|load failed/i.test(msg))) {
        keepPendingEdits(meRef.current, base.id, base.wo_number, patch as Record<string, unknown>);
        return fail('No connection — your changes are kept on this device (see Drafts) and will save when you are back online.');
      }
      return fail(msg || 'Could not save the changes.');
    }
    if (meRef.current) clearPendingEdits(meRef.current, base.id);
    adopt(base, data as WorkOrder);
    savedAny.current = true;
    if (saveFailed.current) { saveFailed.current = false; setError(null); }
    setSaveState('saved');
    return true;
  }), [enqueue, adopt]);

  // Keep the open card in step with realtime updates from other devices — only
  // when THIS row has a newer version (the orders list is rebuilt on every
  // event), and without wiping what the person is halfway through typing.
  useEffect(() => {
    const base = serverRef.current;
    if (order.updated_at !== base.updated_at && msOf(order.updated_at) >= msOf(base.updated_at)) {
      adopt(base, order);
    }
  }, [order, adopt]);

  // Close the Task settings dropdown on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const set = <K extends keyof WorkOrder>(k: K, v: WorkOrder[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // A typed list of items in the description can be moved into the table — and back.
  const [moveUndo, setMoveUndo] = useState<{ moved: number; description: string; items: Item[]; columns: ItemColumn[] } | null>(null);
  const moveToItems = () => {
    const next = moveDescriptionToItems(draft.description ?? '', draft.items ?? [], columnsOf(draft));
    setMoveUndo({ moved: next.moved, description: draft.description ?? '', items: draft.items ?? [], columns: columnsOf(draft) });
    setDraft((d) => ({ ...d, items: next.items, item_columns: next.columns, description: next.description }));
  };
  const undoMove = () => {
    if (!moveUndo) return;
    setDraft((d) => ({ ...d, items: moveUndo.items, item_columns: moveUndo.columns, description: moveUndo.description }));
    setMoveUndo(null);
  };

  // Edits not saved yet. They save about a second after the typing stops.
  const dirty = useMemo(() => Object.keys(changes(draft, server)).length > 0, [draft, server]);
  useEffect(() => {
    if (!canSave || !dirty) return;
    const t = window.setTimeout(() => { void saveNow(); }, 900);
    return () => window.clearTimeout(t);
  }, [draft, canSave, dirty, saveNow]);
  // If the card goes away with edits still waiting, save them anyway.
  useEffect(() => () => { void saveNow(); }, [saveNow]);
  // A refresh or a closed tab mid-typing: keep what wasn't saved on this
  // device; it comes back when the task is opened again. Back online: save.
  useEffect(() => {
    const keep = () => {
      const patch = changes(draftRef.current, serverRef.current);
      if (meRef.current && Object.keys(patch).length) {
        keepPendingEdits(meRef.current, serverRef.current.id, serverRef.current.wo_number, patch as Record<string, unknown>);
      }
    };
    const online = () => { void saveNow(); };
    window.addEventListener('pagehide', keep);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('pagehide', keep); window.removeEventListener('online', online); };
  }, [saveNow]);

  /**
   * Drop a fresh receipt into the job's Drive folder — a frozen copy of the
   * ticket AND its chat history, kept in step with the latest save. Best-effort:
   * it never blocks the save, and does nothing if Drive isn't set up.
   */
  async function refreshDriveReceipt(o: WorkOrder) {
    const clientId = settings.google_client_id?.trim();
    const rootFolderId = driveFolderId(settings.drive_folder_url);
    if (!clientId || !rootFolderId) return;
    try {
      // Never rebuild the receipt from a chat that failed to load (or came
      // back empty for lack of a session) — that would overwrite it in Drive.
      const bearer = await userBearer();
      if (!bearer) return;
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('body, created_at, author_id')
        .eq('work_order_id', o.id)
        .order('created_at', { ascending: true })
        .setHeader('Authorization', bearer);
      if (msgErr) return;
      const chat = (msgs ?? []).map((m) => ({
        at: m.created_at as string,
        author: nameOf(m.author_id as string | null),
        body: plainBody((m.body as string) ?? ''),
      }));
      const r = await buildReceipt(
        o,
        { artist: nameOf(o.artist_id), printedBy: nameOf(printerOf(o)) },
        chat,
      );
      await saveReceiptToJobFolder(
        { blob: r.blob, name: r.filename },
        { clientId, rootFolderId, woNumber: o.wo_number, month: o.date_given.slice(0, 7) },
      );
    } catch { /* receipt is best-effort — never fails the save */ }
  }

  // Writes the job's files. A job finishes (and locks for the artist) the moment a
  // file is added, so any edits not saved yet go in with it rather than being lost.
  // `make` builds the new file list from the latest saved version, inside the
  // save queue, so uploads one after another all add up.
  const writeFiles = (make: (cur: WorkOrder) => { file_link: string | null; attachments?: Attachment[] }) =>
    enqueue(async () => {
      const base = serverRef.current;
      // Unsaved edits ride along, but only the ones this person may make and
      // never an emptied required field — so a stray edit can't sink the files.
      const edits = changes(draftRef.current, base);
      const allow = allowRef.current;
      if (!allow.all) for (const k of Object.keys(edits) as EditKey[]) if (!allow.keys.includes(k)) delete edits[k];
      if (edits.wo_number === '') delete edits.wo_number;
      if ('date_given' in edits && !edits.date_given) delete edits.date_given;
      const res = await supabase
        .from('work_orders')
        .update({ ...edits, ...make(base) })
        .eq('id', base.id)
        .select()
        .single();
      if (!res.error && res.data) adopt(base, res.data as WorkOrder);
      return res;
    });

  /**
   * Adds files to the job, keeping the ones already there. The first file ever
   * attached becomes the main print file (file_link), the one the operator opens.
   */
  async function addFiles(added: Attachment[], { receipt = true }: { receipt?: boolean } = {}) {
    let saved: { file_link: string | null; attachments?: Attachment[] } | null = null;
    let newlyAdded: Attachment[] = [];
    const { data, error } = await writeFiles((cur) => {
      const all: Attachment[] = jobFiles(cur).map(toAttachment);
      newlyAdded = added.filter((a) => !all.some((x) => x.url === a.url));
      for (const a of newlyAdded) all.push(a);
      saved = { file_link: cur.file_link ?? all[0]?.url ?? null, attachments: all };
      return saved;
    });
    if (error) throw new Error(error.message);
    if (receipt) {
      try {
        await refreshDriveReceipt({ ...((data as WorkOrder | null) ?? order), ...(saved ?? {}) });
      } catch { /* receipt is best-effort */ }
    }
    // 1 artist file-credit per genuinely new file (a no-op server-side unless
    // the signed-in person is an artist).
    for (const a of newlyAdded) void logFileCredit(order.id, a.url);
  }

  /**
   * Takes a file off the job AND moves it to the Drive trash (restorable there
   * for about 30 days) — unless another job uses the same file. The only file of
   * a Finished job can go too; the job then goes back to In progress (045).
   */
  async function removeFile(f: JobFile) {
    const last = files.length === 1 && !!order.date_finished;
    if (!confirm(
      `Remove ${f.name ?? 'this file'} from ${order.wo_number}?\n\n` +
      'It is also moved to the Google Drive trash (it can be restored from there for 30 days).' +
      (last ? '\n\nIt is the only file, so the task goes back to In progress.' : ''),
    )) return;
    // Start the Google sign-in now, inside the click, so its pop-up isn't blocked.
    const clientId = settings.google_client_id?.trim();
    const tokenP: Promise<string | null> = clientId && f.link.id
      ? driveTokenNow(clientId).catch(() => null)
      : Promise.resolve(null);
    setBusy(true);
    setError(null);
    setLinkNote(null);
    const { error } = await writeFiles((cur) => {
      const rest: Attachment[] = jobFiles(cur).filter((x) => x.url !== f.url).map(toAttachment);
      return { file_link: cur.file_link === f.url ? rest[0]?.url ?? null : cur.file_link, attachments: rest };
    });
    if (error) { setError(error.message); setBusy(false); return; }
    // Takes back whatever art-done credit this file earned (a no-op if it never earned one).
    void revokeFileCredit(order.id, f.url);
    setLinkNote(await trashRemovedFile(tokenP, { url: f.url, driveId: f.link.id }, order.id));
    setBusy(false);
  }

  /** Paste one more link onto a job that already has files. True once saved. */
  /** Pasted link(s) → the job's files, all in one save. */
  async function addPastedLink(urls: string[]): Promise<boolean> {
    if (!urls.length || urls.some((u) => !/^https?:\/\//i.test(u))) { setError('Paste a full link, starting with https://'); return false; }
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      await addFiles(urls.map((url) => ({ url, name: null })));
      const what = urls.length > 1 ? `${urls.length} links added` : 'Link added';
      setLinkNote(attachFinishes ? `${what} — marked Finished for review.` : `${what}.`);
      ok = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
    return ok;
  }

  // Closing saves anything still waiting first. Only if that save fails does it
  // ask, so half-typed work is never lost to a stray click on the backdrop.
  const [confirmExit, setConfirmExit] = useState(false);
  // Leaving the page mid-upload loses the files not up yet: the browser asks first.
  useEffect(() => {
    if (!driveBusy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [driveBusy]);
  function finishClose() {
    // Keep the Drive receipt in step with what was saved — only when this browser
    // already holds a Google token, so closing never pops up a Google sign-in.
    if (savedAny.current && hasDriveToken()) refreshDriveReceipt(draftRef.current).catch(() => {});
    onClose();
  }
  async function requestClose() {
    if (uploading.current && !confirm('Files are still uploading. Close anyway? The files not uploaded yet will not be added to the task.')) return;
    if (canSave && (dirty || saveState === 'saving') && !(await saveNow())) {
      setConfirmExit(true);
      return;
    }
    finishClose();
  }
  async function saveAndClose() {
    if (await saveNow()) { setConfirmExit(false); finishClose(); }
  }


  /**
   * Admin-only. A mistyped work order number is unique, so the number cannot
   * be reused until the bad row is gone — without this it would block that
   * number forever. Deliberately not offered to reception: deleting a job
   * erases its chat and its printing record along with it.
   */
  async function destroy() {
    const ok = confirm(
      `Move work order ${order.wo_number} to the Trash?\n\n` +
      'It leaves the boards but keeps its files, chat and printing record. From the Trash Bin ' +
      '(your profile menu) you can restore it or delete it for good. Anything left in the Trash ' +
      'is removed automatically after 30 days, including its Drive folder.',
    );
    if (!ok) return;

    setBusy(true);
    setError(null);

    const { error } = await softDeleteOrder(order.id);

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    onClose();
  }

  /**
   * The Drive link is the one action that moves a job to the print queue, so
   * it should not wait for a save. Leaving
   * the field with a changed, valid link saves just the link.
   */
  async function saveLinkOnBlur() {
    // Several links typed or pasted in → all become the job's files.
    const several = extractLinks(draft.file_link);
    if (several.length > 1) {
      set('file_link', several[0]);   // what the save makes the main print file
      await addPastedLink(several);
      return;
    }
    // One link with words around it ("front: https://…") saves just the link.
    const next = (several.length === 1 ? several[0] : draft.file_link?.trim()) || null;
    if (next === (order.file_link ?? null)) return;
    if (next && !/^https?:\/\//i.test(next)) return;   // let Save report it

    setBusy(true);
    setError(null);
    const isNew = !!next && !files.some((x) => x.url === next);
    const { error } = await writeFiles(() => ({ file_link: next }));
    if (error) setError(error.message);
    // A link typed into the field is a file added too: 1 credit if an artist did it.
    else if (next && isNew) void logFileCredit(order.id, next);
    else setLinkNote(next ? (attachFinishes ? 'Link saved — marked Finished for review.' : 'Link saved.') : 'Link removed — job reopened.');
    setBusy(false);
  }

  /**
   * Straight-to-Drive upload of one or more files, when a Google client id +
   * folder are set in Settings. Each file is linked to the job the moment it is
   * in Drive, so if the connection drops half-way the ones already up stay on
   * the task, and the message names the ones that did not go (2026-10-27).
   * `carried` is a warning kept from before a Google sign-in.
   */
  async function uploadDrive(picked: File[], carried: string | null = null) {
    const clientId = settings.google_client_id?.trim();
    const folderId = driveFolderId(settings.drive_folder_url);
    if (!clientId || !folderId || !picked.length) return;
    if (uploading.current) { setFileErr('Files are still uploading. Wait for them to finish, then add these.'); return; }

    // Too big for a browser upload, or unreadable: said plainly, by name.
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
    const linked: Attachment[] = [];
    try {
      for (const file of ok) {
        const up = await uploadToJobFolder(file, {
          clientId,
          rootFolderId: folderId,
          woNumber: order.wo_number,
          month: order.date_given.slice(0, 7),
          subfolder: folderOf(file),
          onProgress: (p) => setDriveProg((done + p * file.size) / total),
        });
        done += file.size;
        const a = toAttachment({ url: up.webViewLink, name: file.name, folder: folderOf(file) });
        await addFiles([a], { receipt: false });
        linked.push(a);
      }
      const inFolders = new Set(linked.map((a) => a.folder).filter(Boolean)).size;
      const what = (linked.length === 1 ? 'Uploaded to' : `${linked.length} files uploaded to`) +
        (inFolders ? ` ${inFolders === 1 ? 'a folder' : `${inFolders} folders`} in` : '');
      setLinkNote(`${what} this job's Drive folder and linked${attachFinishes ? ' — marked Finished for review' : ''}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const left = ok.slice(linked.length);
      setFileErr([
        msg,
        linked.length ? `${linked.length} of ${ok.length} files are uploaded and on the task.` : null,
        notUploaded(left),
        warning,
      ].filter(Boolean).join(' '));
    } finally {
      uploading.current = false;
      setDriveBusy(false);
    }
    // One fresh receipt for the whole batch (best-effort).
    if (linked.length) refreshDriveReceipt(serverRef.current).catch(() => {});
  }

  // The one click that signs in to Google, then uploads the waiting files.
  function connectAndUpload() {
    const clientId = settings.google_client_id?.trim();
    const waiting = pending;
    const warn = pendingWarn;
    if (!clientId || !waiting) return;
    setFileErr(null);
    setConnecting(true);
    // Started inside this click, before any await, so the pop-up is allowed.
    driveTokenNow(clientId, UPLOAD_TOKEN_MS).then(
      () => { setConnecting(false); setPending(null); setPendingWarn(null); void uploadDrive(waiting, warn); },
      (err) => { setConnecting(false); setFileErr(err instanceof Error ? err.message : String(err)); },
    );
  }

  /**
   * Open (creating if needed) this job's own Drive folder —
   * Work Orders / <month> / <WO#> — so a big print file can be dropped straight
   * in with Google Drive, then its link pasted below. The blank tab is opened
   * inside the click so the pop-up blocker lets it through.
   */
  async function openJobFolder() {
    const clientId = settings.google_client_id?.trim();
    const rootFolderId = driveFolderId(settings.drive_folder_url);
    if (!clientId || !rootFolderId) return;
    const win = window.open('', '_blank');
    setFolderBusy(true);
    setError(null);
    try {
      const f = await ensureJobFolder({
        clientId,
        rootFolderId,
        woNumber: order.wo_number,
        month: order.date_given.slice(0, 7),
      });
      if (win) win.location.href = f.webViewLink;
      else window.open(f.webViewLink, '_blank');
      // The folder is open — reset the button now. The receipt refresh runs in the
      // background (best-effort), so it never keeps the button stuck on "Opening…".
      setFolderBusy(false);
      refreshDriveReceipt(order).catch(() => {});
      return;
    } catch (err) {
      win?.close();
      setError(err instanceof Error ? err.message : String(err));
    }
    setFolderBusy(false);
  }

  /**
   * Open the Google Picker on this job's folder so the artist can pick the print
   * files (or upload new ones through the Picker — no browser size limit). The
   * choices are linked to the ticket automatically, and a receipt is left beside
   * them. Needs the Google API key set in Settings.
   */
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
        woNumber: order.wo_number,
        month: order.date_given.slice(0, 7),
      });
      const receipt = `${order.wo_number} receipt.pdf`.toLowerCase();
      const usable = picked.filter((p) => p.name.toLowerCase() !== receipt);
      const skipped = usable.length < picked.length ? ' The job receipt was skipped — it is not a print file.' : '';
      if (usable.length) {
        await addFiles(usable.map((p) => ({ url: p.url, name: p.name })));
        const what = usable.length === 1 ? `“${usable[0].name}”` : `${usable.length} files`;
        setLinkNote(`Attached ${what} from Drive${attachFinishes ? ' — marked Finished for review' : ''}.${skipped}`);
      } else if (skipped) {
        setLinkNote(skipped.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setPickBusy(false);
  }

  /**
   * Admin-only. Filing away a printed job hides it from the default board but
   * keeps the record — it still counts in the monthly report. The database
   * enforces admin-only and printed-only regardless of this button.
   */
  async function toggleArchive(next: boolean) {
    setBusy(true);
    setError(null);

    const { error } = await supabase
      .from('work_orders')
      .update({ archived_at: next ? new Date().toISOString() : null })
      .eq('id', order.id);

    if (error) {
      setError(
        /archived_at/.test(error.message)
          ? 'Archiving needs a database update — apply the pending database migrations.'
          : error.message,
      );
    }
    setBusy(false);
  }

  // Review gate: a finished job reaches the operator's queue only when an admin
  // or reception sends it; they can also pull it back before it is printed.
  async function setQueued(next: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('work_orders')
      .update({ queued_at: next ? new Date().toISOString() : null })
      .eq('id', order.id);
    if (error) setError(error.message);
    setBusy(false);
  }

  /**
   * An admin or reception sends a job back to the artist with a reason:
   * un-finishing it returns it to In progress (and out of the queue), and the
   * reason lands in the comments @mentioning the artist, which notifies them.
   */
  async function sendBackForChanges() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('work_orders')
      .update({ stage: 'in_progress', date_finished: null })
      .eq('id', order.id);
    if (error) { setError(error.message); setBusy(false); return; }
    const artist = order.artist_id ? profiles.find((p) => p.id === order.artist_id) : null;
    const reason = sendBackReason.trim();
    const body = `🔁 Sent back for changes${artist ? ` — ${mentionToken(artist)}` : ''}${reason ? `: ${reason}` : ''}`;
    await supabase.from('messages').insert({ work_order_id: order.id, author_id: profile.id, body });
    setSendBackReason('');
    setSendBackOpen(false);
    setBusy(false);
    onClose();
  }

  /**
   * Reception checks a printed job and RELEASES it — the item is good and handed
   * over. `released_at` marks it done. Undo clears it.
   */
  /**
   * "Waiting for client approval" (2026-10-13): the artist's part is done and the
   * client has the layout. Reception, an admin or the task's own artist sets it;
   * while it is on the job is not counted as late. It clears itself when the job
   * is sent to print.
   */
  async function setClientWait(next: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('work_orders')
      .update({ client_wait_since: next ? new Date().toISOString() : null })
      .eq('id', order.id);
    if (error) setError(error.message);
    setBusy(false);
  }

  /** Reception checked the print: it's good and waiting for the customer (For Release). */
  async function setForRelease(next: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('work_orders')
      .update({ ready_for_pickup_at: next ? new Date().toISOString() : null })
      .eq('id', order.id);
    if (error) setError(error.message);
    setBusy(false);
  }

  async function setReleased(next: boolean) {
    if (!profile) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('work_orders')
      .update({
        released_at: next ? new Date().toISOString() : null,
        released_by: next ? profile.id : null,
      })
      .eq('id', order.id);
    if (error) setError(error.message);
    setBusy(false);
  }

  /**
   * Reception RETURNS a printed job to the operator for a reprint (a defect): it
   * re-enters the print queue with progress reset, the reprint tally bumps, and
   * the operator is @-mentioned in the comments with the reason so they're told.
   * (If the fault is the artist's, the admin then sends it operator → artist.)
   */
  async function clearProblem() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('work_orders').update({ print_problem: null }).eq('id', order.id);
    if (error) setError(error.message);
    setBusy(false);
  }

  async function returnForReprint() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('work_orders').update({
      printed_at: null,
      printed_qty: 0,
      print_state: null,
      print_eta: null,
      ready_for_pickup_at: null,
      released_at: null,
      reprint_count: (order.reprint_count ?? 0) + 1,
      return_note: returnReason.trim() || null,
    }).eq('id', order.id);
    if (error) { setError(error.message); setBusy(false); return; }
    const operator = profiles.find((p) => p.id === (order.operator_id ?? order.printed_by)) ?? null;
    const reason = returnReason.trim();
    await supabase.from('messages').insert({
      work_order_id: order.id,
      author_id: profile.id,
      body: `↩ Returned to the operator${operator ? ` — ${mentionToken(operator)}` : ''}${reason ? `: ${reason}` : ''}`,
    });
    setReturnReason('');
    setReturnOpen(false);
    setBusy(false);
  }

  const canDrive = !!(settings.google_client_id && driveFolderId(settings.drive_folder_url));
  // What the print queue counts: sheets when items fit several to a sheet
  // (2026-10-27), otherwise pieces — the same as the queue's counters.
  const printItems = itemsOf(order);
  const printTarget = printItems.length ? sheetsTotal(printItems) : order.qty;
  const printUnit = hasPerSheet(printItems) ? 'sheets' : 'pcs';
  // Paste a screenshot or snip (Ctrl+V) on the task to upload it as a file.
  useEffect(() => {
    if (!canEditFiles || !canDrive) return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;              // text pastes go to the field as usual
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '');
      void uploadDrive(pasted.map((file, i) => new File([file], file.name && file.name !== 'image.png'
        ? file.name : `Pasted image ${stamp}${pasted.length > 1 ? `-${i + 1}` : ''}.png`, { type: file.type })));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditFiles, canDrive, order.id]);
  // Load Google sign-in early so an upload's or removal's pop-up opens inside the click.
  useEffect(() => { if (canDrive) warmUpDrive(); }, [canDrive]);
  const [dropOver, setDropOver] = useState(false);
  const showDuplicate = !!onDuplicate && canCreateOrders(profile) && (!order.released_at || isAdminRole(profile?.role));
  // "Paste Copied Image": the screenshot or snip on the clipboard goes up like a chosen file.
  const [pasteBusy, setPasteBusy] = useState(false);
  async function pasteCopiedImage() {
    setPasteBusy(true);
    const got = await readCopiedImages();
    setPasteBusy(false);
    if (!got.ok) { setLinkNote(null); setFileErr(COPIED_IMAGE_HELP[got.why]); return; }
    await uploadDrive(got.files);
  }
  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    uploadDrive(picked);
  };
  // "Upload folder": every file inside goes up, and keeps the folder's name.
  const onPickFolder = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = filesFromFolderInput(e.target.files);
    const chose = (e.target.files?.length ?? 0) > 0;
    e.target.value = '';
    if (!picked.length) { if (chose) setFileErr('That folder has no files in it.'); return; }
    uploadDrive(picked);
  };
  const folderInput = { webkitdirectory: '', directory: '' } as Record<string, string>;
  // Waiting for a Google sign-in, or what went wrong — right by the files.
  const uploadStatus = (
    <>
      {pending && (
        <DriveConnect count={pending.length} busy={connecting} onConnect={connectAndUpload}
          onCancel={() => { setPending(null); setPendingWarn(null); setFileErr(null); }} />
      )}
      {fileErr && <div className="error" style={{ margin: '8px 0 0' }}>{fileErr}</div>}
    </>
  );
  const uploadBar = driveBusy && (
    <div className="upload-bar" role="progressbar" aria-valuenow={Math.round(driveProg * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="upload-bar-fill" style={{ width: `${Math.max(3, Math.round(driveProg * 100))}%` }} />
    </div>
  );

  return (
    <>
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="sheet">
        <div className="sheet-head ticket-head">
          <h2>{order.wo_number}</h2>
          <StageSelect order={order} editable={editable} full />
          {order.released_at && (
            <span className="released-meta">
              · {fmtDate(order.released_at)}{order.released_by ? ` by ${nameOf(order.released_by)}` : ''}
              {isReviewer && (
                <button className="linkbtn" style={{ marginLeft: 6 }} onClick={() => setReleased(false)} disabled={busy}>
                  Undo
                </button>
              )}
            </span>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          {/* The actions sit in one group so a phone can drop them to their own
              row under the title, keeping the close button visible. */}
          <div className="ticket-actions">
          {canSave && (dirty || saveState !== 'idle') && (
            <span className={`save-state ${saveState === 'error' ? 'bad' : ''}`} aria-live="polite">
              {saveState === 'error' ? 'Not saved' : dirty || saveState === 'saving' ? 'Saving…' : 'Saved'}
            </span>
          )}
          {editable && settings.google_client_id && driveFolderId(settings.drive_folder_url) && (
            <button type="button" className="ticket-menu-btn" onClick={openJobFolder} disabled={folderBusy}>
              {folderBusy ? 'Opening…' : 'Open Drive folder'}
            </button>
          )}
          {(showDuplicate || (isReviewer && order.status === 'awaiting_print') || canTrash) && (
          <div className="ticket-menu" ref={menuRef}>
            <button
              className="ticket-menu-btn"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {busy ? 'Working…' : 'Task settings'} ▾
            </button>
            {menuOpen && (
              <div className="ticket-menu-pop" role="menu">
                {showDuplicate && (
                  <button role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate?.(order); }}>
                    Duplicate
                  </button>
                )}
                {isReviewer && order.status === 'awaiting_print' && (
                  <button role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); setSendBackOpen(true); }}>
                    Send back…
                  </button>
                )}
                {isReviewer && order.status === 'awaiting_print' && (
                  <button role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); setQueued(false); }}>
                    Pull from queue
                  </button>
                )}
                {canTrash && (
                  <button role="menuitem" className="danger" disabled={busy} onClick={() => { setMenuOpen(false); destroy(); }}>
                    Move to Trash
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          {isReviewer && order.status === 'finished' && (
            // The finished-job review, out in the open rather than in the menu.
            <span className="ticket-review-actions">
              <button className="btn ghost sm" onClick={() => setSendBackOpen(true)} disabled={busy}>
                Send back
              </button>
              <button className="btn sm" onClick={() => setQueued(true)} disabled={busy}>
                Send to print →
              </button>
            </span>
          )}
          {isOwnArtist && !isReviewer && order.status === 'finished' && (
            <span className="ticket-review-actions">
              <button className="btn sm" onClick={() => setQueued(true)} disabled={busy}>
                Send to print →
              </button>
            </span>
          )}
          {isReviewer && (after === 'done' || after === 'ready') && (
            // Kept as a pair so a narrow screen wraps them together.
            <span className="ticket-review-actions">
              <button className="btn danger sm" onClick={() => setReturnOpen(true)} disabled={busy}>
                Return
              </button>
              {after === 'done' ? (
                <button className="btn sm" onClick={() => setForRelease(true)} disabled={busy}>
                  For Release →
                </button>
              ) : (
                <button className="btn sm" onClick={() => setReleased(true)} disabled={busy}>
                  Released to Client
                </button>
              )}
            </span>
          )}
          </div>
          <button className="x" onClick={requestClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          {error && <div className="error">{error}</div>}

          {/* To-be-reviewed prompt (released status shows beside the WO number in the header). */}
          {after === 'done' && (
            <div className="notice review-top">
              {isReviewer ? (
                <span><strong>{AFTER_PRINT_LABEL.done}</strong> — check the printed item, then <strong>Return</strong> it or mark it <strong>For Release</strong> at the top-right.</span>
              ) : (
                <span><strong>{AFTER_PRINT_LABEL.done}</strong> — waiting for reception to check it.</span>
              )}
            </div>
          )}
          {after === 'ready' && (
            <div className="notice review-top">
              <span>
                <strong>{AFTER_PRINT_LABEL.ready}</strong> — checked and waiting for the customer.
                {isReviewer && <> Press <strong>Released to Client</strong> when it is handed over.{' '}
                  <button className="linkbtn" onClick={() => setForRelease(false)} disabled={busy}>Undo For Release</button></>}
              </span>
            </div>
          )}

          {/* Reception's "Return to operator" reason box — triggered from the header. */}
          {isReviewer && returnOpen && order.printed_at && !order.released_at && (
            <div className="notice">
              <label className="field" style={{ marginBottom: 8 }}>
                <span>Return to the operator — what's the reason?</span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {RETURN_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`chip-pick ${returnReason === r ? 'on' : ''}`}
                      onClick={() => setReturnReason(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="Pick a reason above or type one…"
                  autoFocus
                />
              </label>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => { setReturnOpen(false); setReturnReason(''); }}>Cancel</button>
                <button className="btn danger sm" onClick={returnForReprint} disabled={busy}>
                  Return{order.operator_id || order.printed_by ? ` to ${nameOf(order.operator_id ?? order.printed_by)}` : ''}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                Sends it back to the operator's print queue and notifies them. (If the artwork is the
                problem, the admin can then send it from the operator to the artist.)
              </p>
            </div>
          )}
          {isReviewer && sendBackOpen && (order.status === 'finished' || order.status === 'awaiting_print') && (
            <div className="notice">
              <label className="field" style={{ marginBottom: 8 }}>
                <span>Send back to the artist — what needs changing?</span>
                <textarea
                  value={sendBackReason}
                  onChange={(e) => setSendBackReason(e.target.value)}
                  placeholder="e.g. wrong size, client changed the text…"
                  autoFocus
                />
              </label>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => { setSendBackOpen(false); setSendBackReason(''); }}>Cancel</button>
                <button className="btn sm" onClick={sendBackForChanges} disabled={busy}>
                  Send back{order.artist_id ? ` to ${nameOf(order.artist_id)}` : ''}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                Moves it back to In progress and notifies the artist — the note is saved in the comments.
              </p>
            </div>
          )}
          {/* Its printer is Broken or cooling down (2026-10-27). */}
          {printerStatus.available && order.status === 'awaiting_print' && (
            <PrinterBanner rows={printerStatus.rows} site={order.target_site ?? null} />
          )}
          {/* Waiting for the client: say so loudly, and say it is not counted as late. */}
          {clientWaitOn && (
            <div className="notice client-wait" role="status">
              <span>
                <strong>Waiting for client approval</strong> since {fmtDate(order.client_wait_since!)}.
                {' '}The layout is with the client, so this task is <strong>not counted as late</strong>.
              </span>
              {canClientWait && (
                <button className="btn ghost sm" onClick={() => setClientWait(false)} disabled={busy}>Client approved</button>
              )}
            </div>
          )}
          {!clientWaitOn && canClientWait && (
            <div className="client-wait-offer">
              <button className="linkbtn" onClick={() => setClientWait(true)} disabled={busy}
                title="The layout is done and with the client. The task stops counting as late until they approve.">
                Mark as waiting for client approval
              </button>
            </div>
          )}
          {order.status === 'finished' && !sendBackOpen && (
            <div className="notice review-top">
              {isReviewer ? (
                <span><strong>File attached for review</strong> — check it, then <strong>Send back</strong> or <strong>Send to print</strong> at the top-right.</span>
              ) : (
                <span>
                  <strong>File attached for review</strong>
                  {isOwnArtist
                    ? <> — check it, then press <strong>Send to print</strong> at the top-right (or leave it for reception).</>
                    : ' — waiting for reception or the admin to send it to print.'}
                  {canEditFiles && ' You can still add or change its files until then.'}
                </span>
              )}
            </div>
          )}
          {order.print_problem && (
            <div className="notice problem-notice" role="status">
              <strong>⚠ Problem at the press: {PROBLEM_LABEL[order.print_problem]}</strong>
              {order.print_problem_note ? ` — ${order.print_problem_note}` : ''}
              {' '}<span className="muted">({nameOf(order.print_problem_by ?? null)})</span>
              {(isReviewer || profile?.role === 'operator') && (
                <>{' '}<button className="linkbtn" onClick={clearProblem} disabled={busy}>Problem solved</button></>
              )}
            </div>
          )}
          {!editable && ((order.status !== 'finished' && order.status !== 'awaiting_print') || isOwnArtist) && (
            <div className="notice">
              {order.printed_at && (isOwnArtist || isReceptionRole(profile?.role))
                ? 'This job is printed, so its details are locked — only an admin can change them now.'
                : isOwnArtist
                  ? 'Printing has started, so the details are locked — only an admin can change them now.'
                  : <>Read-only — only {order.artist_id ? nameOf(order.artist_id) : 'the artist'}, reception or the admin can edit the job details.</>}
            </div>
          )}

          <div className="ticket-cols">
            <div>
              {/* Printed status — kept above the work order number for quick reference. */}
              <div className="file-status-top">
                {order.printed_at ? (
                  <>
                    <div className="printed-strip on">
                      <span>
                        <strong>Printed</strong> {fmtDate(order.printed_at)} by {nameOf(printerOf(order))}
                        {order.printed_file_link && order.printed_file_link !== order.file_link && (
                          <span className="link-changed">
                            The Drive link has been changed since this was printed. It was printed from{' '}
                            <a href={order.printed_file_link} target="_blank" rel="noreferrer">this file</a>.
                          </span>
                        )}
                      </span>
                    </div>
                    {order.reprint_count > 0 && (
                      <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
                        ↩ Returned {order.reprint_count} time{order.reprint_count === 1 ? '' : 's'}.
                        {order.return_note ? ` Last reason: ${order.return_note}` : ''}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    Not printed yet — it is marked from the print queue.
                  </p>
                )}
                {printTarget != null && (order.queued_at || order.printed_at) && (
                  <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
                    {order.printed_qty >= printTarget
                      ? `All ${printTarget} ${printUnit} printed.`
                      : `${order.printed_qty} of ${printTarget} ${printUnit} printed — ${printTarget - order.printed_qty} left. Operators log this from the print queue.`}
                  </p>
                )}
              </div>

              <div className="grid2">
                <label className="field">
                  <span>Work order number</span>
                  <input
                    type="text"
                    value={draft.wo_number}
                    disabled={!editable}
                    onChange={(e) => set('wo_number', e.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Artist</span>
                  <select
                    value={draft.artist_id ?? ''}
                    disabled={!canSetArtist}
                    onChange={(e) => set('artist_id', e.target.value || null)}
                  >
                    <option value="">
                      {artists.length ? 'Unassigned' : 'No artists yet — ask an admin to add them in Admin Tools'}
                    </option>
                    {/* Someone no longer an artist (e.g. their role changed) stays
                        visible so a reviewer can see who it is and reassign. */}
                    {order.artist_id && !artists.some((a) => a.id === order.artist_id) && (
                      <option value={order.artist_id} disabled>
                        {nameOf(order.artist_id)} (not an artist, reassign)
                      </option>
                    )}
                    {artists.map((a) => (
                      <option key={a.id} value={a.id}>{nameWithStatus(a)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid2">
                <label className="field">
                  <span>Customer</span>
                  <input
                    type="text"
                    value={draft.client_name ?? ''}
                    disabled={!editable}
                    placeholder="Client / company name"
                    onChange={(e) => set('client_name', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Customer phone</span>
                  <input
                    type="tel"
                    value={draft.client_phone ?? ''}
                    disabled={!editable}
                    placeholder="For pickup — e.g. 0917…"
                    onChange={(e) => set('client_phone', e.target.value)}
                  />
                </label>
              </div>

              <div className="field">
                <span>Items</span>
                {/* Editing the table after a move ends its Undo — it would throw the edits away. */}
                <ItemsEditor items={draft.items ?? []} disabled={!editable} onChange={(v) => { set('items', v); setMoveUndo(null); }}
                  columns={columnsOf(draft)} onColumnsChange={(v) => { set('item_columns', v); setMoveUndo(null); }} />
              </div>

              <label className="field">
                <span>Job description (optional)</span>
                <AutoGrowTextarea
                  value={draft.description}
                  disabled={!editable}
                  onChange={(e) => { set('description', e.target.value); setMoveUndo(null); }}
                />
              </label>
              {editable && (
                <ItemsFromDescription description={draft.description ?? ''} onMove={moveToItems}
                  undo={moveUndo ? { moved: moveUndo.moved, onUndo: undoMove } : null} />
              )}

              {(canNote || draft.operator_note) && (
                <label className="field operator-note-field">
                  <span>Note for the operator</span>
                  <AutoGrowTextarea
                    value={draft.operator_note ?? ''}
                    disabled={!canNote}
                    maxLength={1000}
                    placeholder="e.g. what to print when there is no file, special handling…"
                    onChange={(e) => set('operator_note', e.target.value)}
                  />
                </label>
              )}

              <div className="grid2">
                <label className="field">
                  <span>Material</span>
                  <input
                    type="text"
                    value={draft.material ?? ''}
                    disabled={!editable}
                    placeholder="e.g. tarpaulin, sticker"
                    onChange={(e) => set('material', e.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Laminating</span>
                  <input
                    type="text"
                    value={draft.laminating ?? ''}
                    disabled={!editable}
                    placeholder="e.g. matte, glossy, none"
                    onChange={(e) => set('laminating', e.target.value)}
                  />
                </label>
              </div>

              <div className="grid2">
                <label className="field">
                  <span>Priority</span>
                  <select
                    value={draft.urgency ?? ''}
                    disabled={!editable}
                    onChange={(e) => set('urgency', (e.target.value || null) as Urgency | null)}
                  >
                    <option value="">None</option>
                    {URGENCY_OPTIONS.map((u) => (
                      <option key={u} value={u}>{URGENCY_LABEL[u]}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>{itemsOf(draft).length ? 'Total quantity (from items)' : 'Quantity (pcs)'}</span>
                  <input
                    type="number"
                    min="0"
                    value={itemsOf(draft).length ? itemsTotal(itemsOf(draft)) ?? '' : draft.qty ?? ''}
                    disabled={!editable || itemsOf(draft).length > 0}
                    placeholder="e.g. 100"
                    onChange={(e) =>
                      set('qty', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))
                    }
                  />
                </label>
              </div>

              <div className="grid2">
                <label className="field">
                  <span>Date given</span>
                  <input
                    type="date"
                    value={draft.date_given}
                    disabled={!editable}
                    onChange={(e) => set('date_given', e.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Date due</span>
                  <input
                    type="date"
                    value={draft.date_due ?? ''}
                    disabled={!editable}
                    onChange={(e) => set('date_due', e.target.value || null)}
                  />
                </label>
              </div>

              <label className="field">
                <span>Which printing area</span>
                <select
                  value={draft.target_site ?? ''}
                  disabled={!editable}
                  onChange={(e) => {
                    const site = (e.target.value || null) as Site | null;
                    set('target_site', site);
                    // An operator from the other area no longer fits.
                    const planned = draft.planned_operator_id;
                    if (planned && !operatorsForSite(printers, site).some((op) => op.id === planned)) set('planned_operator_id', null);
                  }}
                >
                  <option value="">Either — shows on both queue screens</option>
                  <option value="office">{SITE_LABEL.office}</option>
                  <option value="production">{SITE_LABEL.production}</option>
                </select>
              </label>

              {'planned_operator_id' in order && (isReviewer || order.planned_operator_id || order.operator_id) && (() => {
                // In the queue (or printed) it shows who has the job there.
                const who = order.queued_at || order.printed_at
                  ? order.operator_id ?? null
                  : draft.planned_operator_id ?? null;
                const choices = operatorsForSite(printers, draft.target_site);
                return (
                  <label className="field">
                    <span>Assigned to</span>
                    <select
                      value={who ?? ''}
                      disabled={!canPlanOperator}
                      onChange={(e) => set('planned_operator_id', e.target.value || null)}
                    >
                      <option value="">— Not assigned —</option>
                      {who && !choices.some((op) => op.id === who) && (
                        <option value={who}>{nameOf(who)}</option>
                      )}
                      {choices.map((op) => (
                        <option key={op.id} value={op.id}>{nameWithStatus(op)}</option>
                      ))}
                    </select>
                    {canPlanOperator && (
                      <span className="field-hint">The operator who will print it. The job is theirs in the Print Queue once it is sent to print.</span>
                    )}
                    {order.queued_at && !order.printed_at && (
                      <span className="field-hint">Change it in the Print Queue.</span>
                    )}
                  </label>
                );
              })()}

              <label className="field">
                <span>Date finished</span>
                <input
                  type="date"
                  value={draft.date_finished ?? ''}
                  disabled={!editable}
                  onChange={(e) => set('date_finished', e.target.value || null)}
                />
              </label>

              <label className="field">
                <span>Client notes / other requests</span>
                <AutoGrowTextarea
                  value={draft.notes ?? ''}
                  disabled={!editable}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </label>

              {/* Every file on the job — the Drive images are the artwork proof. */}
              {files.length === 0 ? (
                <>
                  <div className="notice" style={{ marginTop: 0 }}>
                    No print-ready file yet. A job needs its Drive file before it can be marked
                    <strong> Finished</strong> — attach one or more below, set to <strong>Anyone with the link can view</strong>.
                    {attachFinishes && <> Attaching marks it <strong>File Attached for Review</strong>.</>}
                  </div>
                  {editable && canDrive && (
                    <div
                      className={`drop-zone ${dropOver ? 'over' : ''}`}
                      style={{ marginTop: 10 }}
                      onDragOver={(e) => { e.preventDefault(); if (!driveBusy) setDropOver(true); }}
                      onDragLeave={() => setDropOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropOver(false);
                        if (!driveBusy) void filesFromDrop(e.dataTransfer).then(uploadDrive);
                      }}
                    >
                      <span className="drop-hint">
                        Drag &amp; drop files or folders here — images, PDF, Word, Excel, AI, PSD, CDR or any other type
                      </span>
                      <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <label className="btn sm" style={{ cursor: driveBusy ? 'wait' : 'pointer' }}>
                          {driveBusy ? `Uploading… ${Math.round(driveProg * 100)}%` : 'Upload files'}
                          <input type="file" multiple hidden disabled={driveBusy} onChange={onPickFiles} />
                        </label>
                        <button type="button" className="btn ghost sm" onClick={pasteCopiedImage} disabled={driveBusy || pasteBusy}
                          title="Attach the screenshot or snip you just copied">
                          {pasteBusy ? 'Pasting…' : 'Paste Copied Image'}
                        </button>
                        {canPickFolder() && !driveBusy && (
                          <label className="btn ghost sm" style={{ cursor: 'pointer' }}
                            title="Upload a whole folder. Its files are kept together under the folder's name.">
                            Upload folder
                            <input type="file" multiple hidden onChange={onPickFolder} {...folderInput} />
                          </label>
                        )}
                        {settings.google_api_key && (
                          <button type="button" className="btn ghost sm" onClick={attachFromDrive} disabled={pickBusy}>
                            {pickBusy ? 'Opening…' : 'Pick from Drive'}
                          </button>
                        )}
                      </div>
                      {uploadBar}
                    </div>
                  )}
                  {editable && (
                    <label className="field" style={{ marginTop: 10 }}>
                      <span>Or paste Drive links (one or more)</span>
                      <input type="url" value={draft.file_link ?? ''}
                        placeholder="https://drive.google.com/file/d/…"
                        onChange={(e) => { set('file_link', e.target.value); setLinkNote(null); }}
                        // A one-line box glues a pasted list of links together, so
                        // several links pasted at once are added straight away.
                        onPaste={(e) => {
                          const links = extractLinks(e.clipboardData.getData('text'));
                          if (links.length < 2) return;
                          e.preventDefault();
                          void addPastedLink(links);
                        }}
                        onBlur={saveLinkOnBlur} />
                    </label>
                  )}
                  {uploadStatus}
                  {linkNote && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>{linkNote}</p>}
                </>
              ) : (
                <>
                  <JobFiles
                    files={files}
                    woNumber={order.wo_number}
                    busy={busy || driveBusy || pickBusy}
                    // A printed job keeps at least one file (its printing record).
                    onRemove={canEditFiles && (files.length > 1 || !order.printed_at) ? removeFile : undefined}
                    onAddLink={canEditFiles ? addPastedLink : undefined}
                    onDropFiles={canEditFiles && canDrive ? (dropped) => { void uploadDrive(dropped); } : undefined}
                    approved={approvedByUrl}
                    onApprove={canApprove ? (f, on) => { void markFileApproved(order.id, f.url, on); } : undefined}
                    // Upload picks from this computer or phone; From Drive opens the
                    // job's Drive folder (for files already put there).
                    actions={canEditFiles && canDrive ? (
                      <>
                        <label className="linkbtn" style={{ cursor: driveBusy ? 'wait' : 'pointer' }}>
                          {driveBusy ? `Uploading… ${Math.round(driveProg * 100)}%` : '+ Upload files'}
                          <input type="file" multiple hidden disabled={driveBusy} onChange={onPickFiles} />
                        </label>
                        <button type="button" className="linkbtn" onClick={pasteCopiedImage} disabled={driveBusy || pasteBusy}
                          title="Attach the screenshot or snip you just copied">
                          {pasteBusy ? 'Pasting…' : 'Paste Copied Image'}
                        </button>
                        {canPickFolder() && !driveBusy && (
                          <label className="linkbtn" style={{ cursor: 'pointer' }}
                            title="Upload a whole folder. Its files are kept together under the folder's name.">
                            + Upload folder
                            <input type="file" multiple hidden onChange={onPickFolder} {...folderInput} />
                          </label>
                        )}
                        {settings.google_api_key && (
                          <button type="button" className="linkbtn" onClick={attachFromDrive} disabled={pickBusy}>
                            {pickBusy ? 'Opening…' : 'From Drive'}
                          </button>
                        )}
                      </>
                    ) : undefined}
                  />
                  {uploadBar}
                  {uploadStatus}
                  {linkNote && <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>{linkNote}</p>}
                </>
              )}

              {isAdminRole(profile?.role) && order.printed_at && (
                <div className="archive-row">
                  {isArchived(order) ? (
                    <>
                      <span className="muted" style={{ fontSize: 13 }}>
                        Archived {fmtDate(order.archived_at)} — hidden from the board.
                      </span>
                      <button className="btn ghost sm" onClick={() => toggleArchive(false)} disabled={busy}>
                        Unarchive
                      </button>
                    </>
                  ) : order.released_at ? (
                    <>
                      <span className="muted" style={{ fontSize: 13 }}>
                        File this released job away to keep the board tidy. It stays in the records.
                        (Released jobs also archive themselves after 90 days.)
                      </span>
                      <button className="btn ghost sm" onClick={() => toggleArchive(true)} disabled={busy}>
                        Archive
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="muted" style={{ fontSize: 13 }}>
                        You can archive this once it has been released.
                      </span>
                      <button className="btn ghost sm" disabled>
                        Archive
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="section-title" style={{ marginTop: 0 }}>
                Comments
              </div>
              <Chat workOrderId={order.id} profiles={profiles} />
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Kept with the work order. For anything not about this job, use Chats in the corner.
              </p>
              <TaskHistory orderId={order.id} stamp={server.updated_at} />
            </div>
          </div>
        </div>
      </div>
    </div>

    {confirmExit && (
      <div
        className="overlay exit-confirm-over"
        onClick={(e) => e.target === e.currentTarget && setConfirmExit(false)}
      >
        <div className="exit-confirm" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
          <h3 id="exit-confirm-title">Changes not saved</h3>
          <p>Your last changes could not be saved.</p>
          {error && <div className="error" style={{ margin: '0 0 12px' }}>{error}</div>}
          <div className="exit-confirm-actions">
            <button className="btn ghost sm" onClick={() => setConfirmExit(false)}>
              Keep editing
            </button>
            <button className="btn danger sm" onClick={() => { setConfirmExit(false); onClose(); }}>
              Exit without saving
            </button>
            <button className="btn sm" onClick={saveAndClose} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : 'Try again'}
            </button>
          </div>
        </div>
      </div>
    )}

    </>
  );
}
