import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, userBearer } from './supabase';
import { trashDriveFile } from './drive';
import { setDriveAccountHint } from './drive';
import type { Message, Notification, PrinterState, PrinterStatus, Profile, Site, StaffStatus, WorkOrder } from './types';
import { CREDIT_KINDS, type OrderEvent } from './credits';

// A realtime channel name must be unique per subscription — a fixed name
// collides the moment two components use the same hook. This makes one.
const uniqueChannel = (base: string) => `${base}_${Math.random().toString(36).slice(2)}`;

/**
 * Every signed-in device holds the same live list (PRD section 5:
 * "everyone using the tracker sees the same live data"). Realtime pushes
 * changes; we refetch on any event rather than patching rows by hand, because
 * status and days_to_finish are computed in the database.
 */
export function useWorkOrders() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [trashed, setTrashed] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('work_orders')
      .select('*')
      .order('date_given', { ascending: false })
      .order('wo_number', { ascending: false });

    if (error) setError(error.message);
    else {
      const all = (data as WorkOrder[]) ?? [];
      // `deleted_at` may not exist before migration 035 — then it reads as undefined
      // and every row counts as live, so the split is a no-op until the column lands.
      setOrders(all.filter((o) => !o.deleted_at));
      setTrashed(all.filter((o) => !!o.deleted_at));
      setError(null);
    }
    setLoading(false);
  }, []);

  const channelName = useRef(uniqueChannel('work_orders_live'));

  useEffect(() => {
    load();
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return { orders, trashed, loading, error, reload: load };
}

/** Move a work order to the Trash Bin (soft delete) — keeps the row and its files. */
export async function softDeleteOrder(id: string) {
  return supabase.from('work_orders').update({ deleted_at: new Date().toISOString() }).eq('id', id);
}

/** Take a work order back out of the Trash Bin. */
export async function restoreOrder(id: string) {
  return supabase.from('work_orders').update({ deleted_at: null }).eq('id', id);
}

/** Permanently delete a work order row. The Drive folder is cleared separately (browser-side). */
export async function purgeOrder(id: string) {
  return supabase.from('work_orders').delete().eq('id', id);
}

/** File a released job away — kept in the records, off the board. */
export async function archiveOrder(id: string) {
  return supabase.from('work_orders').update({ archived_at: new Date().toISOString() }).eq('id', id);
}

/**
 * Everyone's profile, kept live. `enabled` false (no one signed in yet) asks
 * nothing: a signed-out visitor may not read profiles at all, and asking only
 * left a refused request on the sign-in page (2026-10-27).
 */
export function useProfiles(enabled = true) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');
    setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  }, [enabled]);

  // Live: a status change (or a new account) shows everywhere at once.
  useEffect(() => {
    if (!enabled) return;
    load();
    const channel = supabase
      .channel(uniqueChannel('profiles_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, enabled]);

  return { profiles, loading, reload: load };
}

/** A usable email address (the database checks the same shape). */
export const isEmail = (v: string) => {
  const t = v.trim();
  return t.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
};
// The table is missing until migration 20261008190000 runs.
const tableMissing = (err: { code?: string } | null) => !!err && ['42P01', 'PGRST205'].includes(err.code ?? '');

/**
 * Your private password-recovery email (account_recovery). `available` is
 * false while the database does not have the table yet.
 */
export function useRecoveryEmail(userId: string | undefined) {
  const [email, setEmail] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from('account_recovery').select('email').eq('user_id', userId).maybeSingle();
    if (error) setAvailable(!tableMissing(error));
    else { setAvailable(true); setEmail((data as { email: string } | null)?.email ?? null); }
    setLoading(false);
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  return { email, available, loading, reload: load };
}

/** Everyone's recovery emails, by person — admins only (RLS hides the rest). */
export function useRecoveryEmails(enabled: boolean) {
  const [byId, setById] = useState<Record<string, string>>({});
  const [available, setAvailable] = useState(true);
  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase.from('account_recovery').select('user_id, email');
    if (error) { setAvailable(!tableMissing(error)); return; }
    setAvailable(true);
    setById(Object.fromEntries(((data as { user_id: string; email: string }[]) ?? []).map((r) => [r.user_id, r.email])));
  }, [enabled]);
  useEffect(() => { void load(); }, [load]);
  return { byId, available, reload: load };
}

/** Save (add or change) someone's recovery email — admins only (Accounts, Settings). */
export async function saveRecoveryEmail(userId: string, email: string) {
  return supabase.from('account_recovery').upsert({ user_id: userId, email: email.trim().toLowerCase() }, { onConflict: 'user_id' });
}

/**
 * Add or change your OWN recovery email (Settings) — it asks for your current
 * password, checked on the server. (Admins can also set anyone's.)
 * Returns a sentence to show when it did not go through, or null when saved.
 */
export async function setMyRecoveryEmail(email: string, password: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_my_recovery_email', { p_email: email.trim().toLowerCase(), p_password: password });
  if (error) return /set_my_recovery_email|PGRST202|42883/.test(`${error.code} ${error.message}`)
    ? 'Setting it here is not switched on yet — ask an admin to do it for you.'
    : error.message;
  switch (data as string) {
    case 'ok': return null;
    case 'wrong_password': return 'That is not your current password.';
    case 'locked': return 'Too many wrong passwords. Try again in 15 minutes, or ask an admin.';
    case 'bad_email': return 'Type an email you can open, like name@gmail.com.';
    default: return 'Could not save it. Sign in again and retry.';
  }
}

/** Remove someone's recovery email — admins only. */
export async function removeRecoveryEmail(userId: string) {
  return supabase.from('account_recovery').delete().eq('user_id', userId);
}

/** Is "forgot password by email" switched on (function deployed + Gmail set up)? */
export async function passwordResetReady(): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('password-reset', { body: { ping: true } });
    return !error && (data as { ready?: boolean } | null)?.ready === true;
  } catch {
    return false;
  }
}

/**
 * "Forgot password": ask the password-reset Edge Function to email a reset
 * link. It answers the same whether or not the account exists; only a setup
 * problem (no sending Gmail yet) comes back as an error message.
 */
export async function requestPasswordReset(login: string): Promise<string | null> {
  const { error } = await supabase.functions.invoke('password-reset', {
    body: { login: login.trim(), redirectTo: `${window.location.origin}/` },
  });
  if (!error) return null;
  const ctx = (error as { context?: Response }).context;
  try {
    const body = ctx ? await ctx.json() : null;
    if (body?.error) return String(body.error);
  } catch { /* not JSON */ }
  return 'Could not send the reset email right now. Try again, or ask an admin to reset your password.';
}

/** A file of a print job: when it was first opened, ticked printed, and approved for printing (and by whom). */
export interface FileMark {
  work_order_id: string;
  file_url: string;
  opened_at: string | null;
  opened_by: string | null;
  printed_at: string | null;
  printed_by: string | null;
  /** A notice only — never required to send to print or mark a file printed/Done. */
  approved_at: string | null;
  approved_by: string | null;
}

/**
 * Opened / printed marks for the files of the given jobs (print_file_marks),
 * live for everyone at the queue. byOrder[jobId][fileUrl] → the mark.
 */
export function useFileMarks(orderIds: string[]) {
  const [byOrder, setByOrder] = useState<Record<string, Record<string, FileMark>>>({});
  const [available, setAvailable] = useState(true);
  const key = [...orderIds].sort().join(',');
  const load = useCallback(async () => {
    const ids = key ? key.split(',') : [];
    if (!ids.length) { setByOrder({}); return; }
    const { data, error } = await supabase.from('print_file_marks').select('*').in('work_order_id', ids);
    if (error) { setAvailable(!tableMissing(error)); return; }
    const m: Record<string, Record<string, FileMark>> = {};
    for (const r of (data as FileMark[]) ?? []) (m[r.work_order_id] ??= {})[r.file_url] = r;
    setAvailable(true);
    setByOrder(m);
  }, [key]);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(uniqueChannel('file_marks_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'print_file_marks' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);
  return { byOrder, available, reload: load };
}

/**
 * The credit lines of every task's history (who made it, who did the art, who
 * printed it). null while loading, and when the history is not in the database
 * yet — the counts then come from the tasks themselves. `stamp` changes when
 * any task changes, so the counts follow.
 */
export function useCreditEvents(stamp: string): OrderEvent[] | null {
  const [events, setEvents] = useState<OrderEvent[] | null>(null);
  useEffect(() => {
    let off = false;
    void (async () => {
      const all: OrderEvent[] = [];
      // The API hands over 1000 rows at a time.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('work_order_events').select('*')
          .in('kind', CREDIT_KINDS).order('id').range(from, from + 999);
        if (error) { if (!off) setEvents(null); return; }
        all.push(...((data as OrderEvent[]) ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      if (!off) setEvents(all);
    })();
    return () => { off = true; };
  }, [stamp]);
  return events;
}

/** One task's history, oldest first. `available` is false until the history is in the database. */
export function useOrderHistory(orderId: string, stamp: string) {
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let off = false;
    void (async () => {
      const { data, error } = await supabase.from('work_order_events').select('*')
        .eq('work_order_id', orderId).order('at').order('id');
      if (off) return;
      if (error) { setAvailable(!tableMissing(error)); return; }
      setAvailable(true);
      setEvents((data as OrderEvent[]) ?? []);
    })();
    return () => { off = true; };
  }, [orderId, stamp]);
  return { events, available };
}

/**
 * Each printing area's printer status (2026-10-27), kept live. `available` is
 * false until the database has it (then nothing printer-related shows).
 */
export function usePrinterStatus() {
  const [rows, setRows] = useState<PrinterStatus[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('printer_status').select('*');
    if (error) {
      setAvailable(!tableMissing(error));
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }
    setAvailable(true);
    setErrorMessage(null);
    setRows((data as PrinterStatus[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(uniqueChannel('printer_status_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'printer_status' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);
  return { rows, available, loading, error: errorMessage, reload: load };
}

/** Mark a printing area's printer Working, Cooling down (for `seconds`) or Broken (with a note). */
export async function setPrinterStatus(site: Site, state: PrinterState, seconds: number | null, note: string | null) {
  return supabase.rpc('set_printer_status', { p_site: site, p_state: state, p_seconds: seconds, p_note: note });
}

/** A file was opened or downloaded from the queue (the first open is kept). */
export async function markFileOpened(orderId: string, fileUrl: string) {
  return supabase.from('print_file_marks')
    .upsert({ work_order_id: orderId, file_url: fileUrl, opened_at: new Date().toISOString() }, { onConflict: 'work_order_id,file_url' });
}

/** Tick (or untick) one file of a job as printed. */
export async function markFilePrinted(orderId: string, fileUrl: string, printed: boolean) {
  return supabase.from('print_file_marks')
    .upsert({ work_order_id: orderId, file_url: fileUrl, printed_at: printed ? new Date().toISOString() : null }, { onConflict: 'work_order_id,file_url' });
}

/** Tick (or untick) one file of a job as approved to print — a notice only, never a gate. */
export async function markFileApproved(orderId: string, fileUrl: string, approved: boolean) {
  return supabase.from('print_file_marks')
    .upsert({ work_order_id: orderId, file_url: fileUrl, approved_at: approved ? new Date().toISOString() : null }, { onConflict: 'work_order_id,file_url' });
}

/**
 * Logs 1 artist file-credit for a just-added file. A silent no-op unless the
 * signed-in person is an artist (enforced server-side, not just here) — safe
 * to call for every file add regardless of who's adding it.
 */
export async function logFileCredit(orderId: string, fileUrl: string) {
  return supabase.rpc('log_file_credit', { p_work_order: orderId, p_file_url: fileUrl });
}

/**
 * Takes back the credit a file earned, because it's just been removed from
 * the task. A silent no-op if the file never earned one (added by a
 * non-artist, or already removed).
 */
export async function revokeFileCredit(orderId: string, fileUrl: string) {
  return supabase.rpc('revoke_file_credit', { p_work_order: orderId, p_file_url: fileUrl });
}

type CreditRow = { artist_id: string | null; artist_name: string | null };
/**
 * File credits in [since, until) of tasks still on the board (not in the
 * Trash, not removed for good). If that join is ever refused, it falls back
 * to every credit in the window rather than showing nothing.
 */
async function liveFileCredits(sinceIso: string, untilIso?: string) {
  const window = <Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(q: Q) =>
    (untilIso ? q.gte('at', sinceIso).lt('at', untilIso) : q.gte('at', sinceIso));
  const live = await window(supabase.from('file_credit_events')
    .select('artist_id, artist_name, work_orders!inner(deleted_at)')
    .is('work_orders.deleted_at', null));
  if (!live.error) return { data: (live.data ?? []) as unknown as CreditRow[], error: null };
  return window(supabase.from('file_credit_events').select('artist_id, artist_name'));
}

/**
 * File-credit events in a window — the one source for "Art done" everywhere
 * (Workload table, every report tab). Open-ended (`untilIso` omitted) for
 * "this period so far", which naturally reads as zero right after the period
 * closes, since it's just a date filter; bounded for a specific past period.
 * Reacts to both new credits and removals (a file taken off a task). Only
 * tasks that are still on the board count: a task moved to the Trash stops
 * counting (and counts again if it is restored), one removed for good never does.
 */
export function useFileCreditEventsSince(sinceIso: string, untilIso?: string) {
  const [rows, setRows] = useState<{ artist_id: string | null; artist_name: string | null }[]>([]);
  const [available, setAvailable] = useState(true);
  const load = useCallback(async () => {
    const { data, error } = await liveFileCredits(sinceIso, untilIso);
    if (error) { setAvailable(!tableMissing(error)); return; }
    setAvailable(true);
    setRows((data as { artist_id: string | null; artist_name: string | null }[]) ?? []);
  }, [sinceIso, untilIso]);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(uniqueChannel('file_credit_events_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'file_credit_events' }, load)
      // A task moved to (or back from) the Trash changes who has credits.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_orders' }, (p) => {
        const was = (p.old as { deleted_at?: string | null }).deleted_at;
        const now = (p.new as { deleted_at?: string | null }).deleted_at;
        if (was === undefined || (was ?? null) !== (now ?? null)) void load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);
  return { rows, available };
}

/** One archived month/quarter/year's frozen report snapshot. */
export interface ReportPeriod {
  id: string;
  period_type: 'month' | 'quarter' | 'year';
  period_label: string;
  period_start: string;
  period_end: string;
  status: 'pending' | 'finalized';
  pending_since: string;
  finalized_at: string | null;
  finalized_by: string | null;
  snapshot: {
    opened: number;
    artDone: number;
    printed: number;
    makers: { id: string; name: string; count: number }[];
    artists: { id: string; name: string; given: number; count: number }[];
    printers: { id: string; name: string; count: number }[];
  };
  drive_link: string | null;
  drive_saved_at: string | null;
  created_at: string;
}

/** Every archived period of one type, newest first, live for the Report screen. */
export function useReportPeriods(periodType: ReportPeriod['period_type']) {
  const [rows, setRows] = useState<ReportPeriod[]>([]);
  const [available, setAvailable] = useState(true);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('report_periods')
      .select('*').eq('period_type', periodType).order('period_label', { ascending: false });
    if (error) { setAvailable(!tableMissing(error)); return; }
    setAvailable(true);
    setRows((data as ReportPeriod[]) ?? []);
  }, [periodType]);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(uniqueChannel('report_periods_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_periods' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);
  return { rows, available, reload: load };
}

/** One-off file-credit rows for an arbitrary past window (for auto-archiving a just-ended period — not a hook, since the window isn't known ahead of render). */
export async function fileCreditRowsInRange(sinceIso: string, untilIso: string) {
  const { data, error } = await liveFileCredits(sinceIso, untilIso);
  if (error) return [];
  return (data as { artist_id: string | null; artist_name: string | null }[]) ?? [];
}

/** Opens (archives) a just-ended period with its computed snapshot. A harmless no-op if it's already open (admin only). */
export async function openReportPeriod(
  periodType: ReportPeriod['period_type'],
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  snapshot: ReportPeriod['snapshot'],
) {
  return supabase.rpc('open_report_period', {
    p_period_type: periodType, p_period_label: periodLabel,
    p_period_start: periodStart, p_period_end: periodEnd, p_snapshot: snapshot,
  });
}

/** Closes a still-pending period early (admin only). */
export async function finalizeReportPeriod(periodType: ReportPeriod['period_type'], periodLabel: string) {
  return supabase.rpc('finalize_report_period', { p_period_type: periodType, p_period_label: periodLabel });
}

/** Records where a period's auto-saved PDF landed, once uploaded (admin only). */
export async function setReportPeriodDriveLink(periodType: ReportPeriod['period_type'], periodLabel: string, driveLink: string) {
  return supabase.rpc('set_report_period_drive_link', { p_period_type: periodType, p_period_label: periodLabel, p_drive_link: driveLink });
}

/** Set someone's staff status (their own, or anyone's for an admin). */
export async function saveStaffStatus(
  userId: string,
  next: { status: StaffStatus; status_note: string | null; status_until: string | null },
) {
  const clean = next.status === 'working'
    ? { status: 'working' as const, status_note: null, status_until: null }
    : { ...next, status_note: next.status_note?.trim().slice(0, 80) || null };
  return supabase.from('profiles').update(clean).eq('id', userId);
}

/**
 * Who's currently using the app, via Supabase Realtime presence — no database
 * writes, no table. Each signed-in device joins a shared channel keyed by its
 * user id and announces itself; every device then sees the set of ids present.
 * Someone closing the tab drops off automatically after a short timeout.
 */
export function useOnlineUsers(me: string | undefined, enabled: boolean) {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !me) return;
    const channel = supabase.channel('presence:online', { config: { presence: { key: me } } });
    const sync = () => setOnline(new Set(Object.keys(channel.presenceState())));
    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ at: Date.now() });
      });
    return () => { supabase.removeChannel(channel); };
  }, [enabled, me]);

  return online;
}

/** Chat for one work order, live for everyone with the ticket open. */
export function useMessages(workOrderId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workOrderId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('work_order_id', workOrderId)
      .order('created_at');
    setMessages((data as Message[]) ?? []);
    setLoading(false);
  }, [workOrderId]);

  useEffect(() => {
    setLoading(true);
    load();
    if (!workOrderId) return;

    const channel = supabase
      .channel(`messages_${workOrderId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `work_order_id=eq.${workOrderId}`,
        },
        (payload) => setMessages((prev) => {
          const row = payload.new as Message;
          return prev.some((m) => m.id === row.id) ? prev : [...prev, row];
        }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workOrderId, load]);

  return { messages, loading };
}

/**
 * Notifications about something you have now SEEN — a chat you opened, a task's
 * comments you read — are marked read too, so the bell doesn't keep showing
 * them. `refId` is the conversation or the work order the notifications point at.
 */
export async function markNotificationsSeen(userId: string, refId: string, kinds: Notification['kind'][]) {
  return supabase.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('user_id', userId).eq('ref_id', refId).in('kind', kinds).is('read_at', null);
}

export async function markThreadRead(userId: string, workOrderId: string) {
  await supabase
    .from('message_reads')
    .upsert(
      { user_id: userId, work_order_id: workOrderId, last_read_at: new Date().toISOString() },
      { onConflict: 'user_id,work_order_id' },
    );
  // The comments are read: so are the notifications for tags in them.
  await markNotificationsSeen(userId, workOrderId, ['comment']);
}

/** Signed URL for a stored screenshot; the bucket is private. */
export async function previewUrl(path: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from('previews').createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Batch signed URLs, so a 60-row table is one request not sixty. */
export async function previewUrls(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data } = await supabase.storage.from('previews').createSignedUrls(unique, 60 * 60);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
  }
  return map;
}

/**
 * Shop-wide settings. Currently just the shared Google Drive folder, kept in
 * the database rather than the build so switching from a personal Google
 * account to the company one is an edit, not a redeploy.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const retries = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async function loadSettings(): Promise<void> {
    const bearer = await userBearer();
    const res = bearer
      ? await supabase.from('app_settings').select('key, value').setHeader('Authorization', bearer)
      : null;
    // A dropped connection (or no session to send) must not leave the app
    // thinking Drive isn't set up (no upload box at all) — keep what we had
    // and try again shortly.
    if (!res || res.error) {
      if (retries.current < 6) {
        retries.current++;
        window.setTimeout(() => { void loadSettings(); }, 1500 * retries.current);
      }
      return;
    }
    retries.current = 0;
    loaded.current = true;
    const map: Record<string, string | null> = {};
    for (const row of res.data ?? []) map[row.key as string] = row.value as string | null;
    setSettings(map);
    // Point every Drive sign-in at the account the admin connected.
    setDriveAccountHint(map.drive_account_email);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(uniqueChannel('app_settings_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, load)
      .subscribe();
    // Settings are only readable signed in, and this hook mounts before the
    // sign-in screen — load once someone signs in. Only if not loaded yet:
    // SIGNED_IN also fires when a tab regains focus, and a fresh settings
    // object re-runs every screen that depends on it (a live feed dropped an
    // update in the gap). (Deferred: a Supabase call inside the auth callback
    // can wait on its own lock.)
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && !loaded.current) {
        retries.current = 0;
        window.setTimeout(() => { void load(); }, 0);
      }
    });
    return () => {
      supabase.removeChannel(channel);
      auth.subscription.unsubscribe();
    };
  }, [load]);

  return { settings, loading, reload: load };
}

export async function saveSetting(key: string, value: string | null) {
  return supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
}

/**
 * Is the database behind the app? Each migration adds something the app then
 * relies on; if the newest of those is missing, writes fail with a column
 * error nobody at the shop can act on. Probe once after sign-in and say so
 * plainly instead.
 */
export function useSchemaCheck(enabled: boolean) {
  const [missing, setMissing] = useState<SchemaGap[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    // Only a "column/table genuinely absent" answer counts as a missing
    // migration. A network hiccup or auth race also produces an error, and
    // treating that as a gap would flash a false "creating orders will fail"
    // alarm. PostgREST codes: 42703 undefined_column, 42P01 undefined_table,
    // PGRST205 table not in the schema cache.
    const isAbsent = (err: { code?: string } | null) =>
      !!err && ['42703', '42P01', 'PGRST205'].includes(err.code ?? '');

    (async () => {
      const gaps: SchemaGap[] = [];
      const [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z, aa, ab, ac, ad, ae, af, ag] = await Promise.all([
        supabase.from('work_orders').select('ready_at').limit(1),          // 002
        supabase.from('app_settings').select('key').limit(1),              // 003
        supabase.from('work_orders').select('target_site').limit(1),       // 004
        supabase.from('work_orders').select('printed_file_link').limit(1), // 005
        supabase.from('work_orders').select('urgency').limit(1),           // 006
        supabase.from('direct_messages').select('id').limit(1),            // 007
        supabase.from('work_orders').select('archived_at').limit(1),       // 009
        supabase.from('work_orders').select('stage').limit(1),             // 010
        supabase.from('notifications').select('id').limit(1),              // 011
        supabase.from('profiles').select('deactivated_at').limit(1),       // 012
        supabase.from('profiles').select('username').limit(1),             // 013
        supabase.from('work_orders').select('print_state').limit(1),       // 016
        supabase.from('work_orders').select('queued_at').limit(1),         // 017
        supabase.from('work_orders').select('operator_id').limit(1),       // 018
        supabase.from('work_orders').select('print_eta').limit(1),         // 019
        supabase.from('work_orders').select('job_order_number').limit(1),  // 020
        supabase.from('work_orders').select('qty').limit(1),               // 021
        supabase.from('work_orders').select('priority').limit(1),          // 022
        supabase.from('work_orders').select('print_pause_left').limit(1),  // 025
        supabase.from('work_orders').select('deleted_at').limit(1),        // 035
        supabase.from('work_orders').select('released_at').limit(1),       // 036
        supabase.from('work_orders').select('client_name').limit(1),       // 038
        supabase.from('work_orders').select('attachments').limit(1),       // 042
        supabase.from('work_orders').select('operator_note').limit(1),     // 049
        supabase.from('profiles').select('status').limit(1),               // staff status
        supabase.from('account_recovery').select('user_id').limit(1),      // recovery email
        supabase.from('work_orders').select('item_columns').limit(1),      // a task's own Items columns
        supabase.from('chat_members').select('cleared_at').limit(1),       // archive / delete a chat
        supabase.from('support_tickets').select('id').limit(1),            // Chat Support tickets
        supabase.from('work_orders').select('first_finished_on').limit(1), // credit survives Send back
        supabase.from('work_orders').select('client_wait_since').limit(1), // waiting for client approval
        supabase.from('work_order_events').select('id').limit(1),          // history on every task
        supabase.from('printer_status').select('site').limit(1),           // printer status per area
      ]);
      // `blocking` marks a migration the app writes against — without it,
      // creating or saving work orders fails. Additive migrations only add
      // record-keeping, so the app runs fine until they are applied.
      if (isAbsent(a.error)) gaps.push({ label: '002 — the print queue rule', blocking: true });
      if (isAbsent(b.error)) gaps.push({ label: '003 — settings', blocking: true });
      if (isAbsent(c.error)) gaps.push({ label: '004 — printing areas and operator stats', blocking: true });
      if (isAbsent(d.error)) gaps.push({ label: '005 — record of which file was printed', blocking: false });
      if (isAbsent(e.error)) gaps.push({ label: '006 — job priority', blocking: false });
      if (isAbsent(f.error)) gaps.push({ label: '007 — direct messages', blocking: false });
      if (isAbsent(g.error)) gaps.push({ label: '009 — archiving printed jobs', blocking: false });
      if (isAbsent(h.error)) gaps.push({ label: '010 — the To Do stage and task flow', blocking: false });
      if (isAbsent(i.error)) gaps.push({ label: '011 — the notifications inbox', blocking: false });
      if (isAbsent(j.error)) gaps.push({ label: '012 — deactivation countdown', blocking: false });
      if (isAbsent(k.error)) gaps.push({ label: '013 — username sign-in', blocking: false });
      if (isAbsent(l.error)) gaps.push({ label: '016 — operator print progress', blocking: false });
      if (isAbsent(m.error)) gaps.push({ label: '017 — admin send-to-print gate', blocking: false });
      if (isAbsent(n.error)) gaps.push({ label: '018 — operator claim', blocking: false });
      if (isAbsent(o.error)) gaps.push({ label: '019 — printing timer', blocking: false });
      if (isAbsent(p.error)) gaps.push({ label: '020 — job order number', blocking: false });
      if (isAbsent(q.error)) gaps.push({ label: '021 — pieces printed count', blocking: false });
      if (isAbsent(r.error)) gaps.push({ label: '022 — queue priority & controls', blocking: false });
      if (isAbsent(s.error)) gaps.push({ label: '025 — pausable printer timer', blocking: false });
      if (isAbsent(t.error)) gaps.push({ label: '035 — Trash Bin (soft delete)', blocking: false });
      if (isAbsent(u.error)) gaps.push({ label: '036 — post-print release check', blocking: false });
      if (isAbsent(v.error)) gaps.push({ label: '038 — customer/client contact', blocking: false });
      if (isAbsent(w.error)) gaps.push({ label: '042 — review flow and multiple files per task', blocking: false });
      // 049 is blocking: saving a task sends the operator note.
      if (isAbsent(x.error)) gaps.push({ label: '049 — operator notes, new roles, assigning rules', blocking: true });
      if (isAbsent(y.error)) gaps.push({ label: 'Staff status (Working / Out of office / Sick)', blocking: false });
      if (isAbsent(z.error)) gaps.push({ label: 'Password recovery email', blocking: false });
      if (isAbsent(aa.error)) gaps.push({ label: "A task's own Items columns", blocking: false });
      if (isAbsent(ab.error)) gaps.push({ label: 'Archive / delete a chat', blocking: false });
      if (isAbsent(ac.error)) gaps.push({ label: 'Chat Support tickets', blocking: false });
      if (isAbsent(ad.error)) gaps.push({ label: "An artist's finished credit surviving Send back", blocking: false });
      if (isAbsent(ae.error)) gaps.push({ label: 'Waiting for client approval', blocking: false });
      if (isAbsent(af.error)) gaps.push({ label: 'History on every task', blocking: false });
      if (isAbsent(ag.error)) gaps.push({ label: 'Printer status (Working / Cooling down / Broken)', blocking: false });
      if (!cancelled) {
        setMissing(gaps);
        setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    behind: missing.length > 0,
    blocking: missing.some((g) => g.blocking),
    missing: missing.map((g) => g.label),
    checked,
  };
}

interface SchemaGap {
  label: string;
  blocking: boolean;
}

/**
 * How many jobs are waiting to print — for the badge on the sidebar.
 * Gated on `enabled` (the session): this hook lives in App, above the sign-in
 * gate, so without the gate its first load runs as anonymous, RLS returns
 * nothing, and the count sticks at zero.
 */
/** A job waiting at the printers — enough to badge the tab and ring the alarm. */
export interface AwaitingJob {
  id: string; wo_number: string; target_site: Site | null;
  // For the "printing time is up" alarm.
  print_eta: string | null; print_state: string | null; operator_id: string | null;
}

/**
 * Jobs waiting to print, live, from any screen. Drives the Print Queue badge and
 * the operators' alarm. null until the first load, so "nothing yet" is never
 * mistaken for "nothing waiting".
 */
export function useAwaitingJobs(enabled: boolean) {
  const [jobs, setJobs] = useState<AwaitingJob[] | null>(null);

  const load = useCallback(async () => {
    // Filter client-side from an unfiltered select: filtering on the generated
    // status column in the request came back empty in the browser even when the
    // REST API returned rows for the same query.
    const { data, error } = await supabase.from('work_orders').select('id, wo_number, status, target_site, deleted_at, print_eta, print_state, operator_id');
    if (error) return;
    setJobs(
      (data ?? [])
        .filter((o) => o.status === 'awaiting_print' && !o.deleted_at)
        .map((o) => ({ id: o.id, wo_number: o.wo_number, target_site: o.target_site,
          print_eta: o.print_eta, print_state: o.print_state, operator_id: o.operator_id })),
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    // Coalesce bursts of changes into one reload.
    let timer: number | undefined;
    const kick = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 250); };
    const channel = supabase
      .channel(uniqueChannel('awaiting_jobs'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, kick)
      .subscribe();
    // A phone or PC waking from sleep may have missed realtime events — catch up.
    const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', kick);
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', kick);
    };
  }, [enabled, load]);

  return jobs;
}

// The old 1:1 `direct_messages` helpers lived here — superseded by the chat_*
// conversation model below and removed. The `direct_messages` table itself is
// kept in the database as a backfilled backup (see migration-027).

// ---------------------------------------------------------------
// Chat — conversations (1:1 + groups), messages, reactions
// ---------------------------------------------------------------
export interface ChatConversation {
  id: string;
  title: string | null;
  is_group: boolean;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
}
export interface ChatMemberRow {
  conversation_id: string; user_id: string; last_read_at: string; added_at: string;
  /** This person put the chat away (2026-10-11); a newer message brings it back. */
  archived_at?: string | null;
  /** This person deleted the chat on their side: nothing up to here is shown to them. */
  cleared_at?: string | null;
}
export interface ChatMsg {
  id: string; conversation_id: string; sender_id: string; body: string; created_at: string;
  /** A picture sent in chat (2026-10-12): its path in the chat-images bucket. */
  image_path?: string | null;
}
export interface ChatReactionRow { message_id: string; user_id: string; emoji: string; }

/**
 * Everything the chat UI needs, kept live: the conversations the signed-in
 * person belongs to (RLS scopes each table to their memberships), their
 * members, all messages, and all reactions. A small shop means loading them and
 * grouping client-side is simpler than a query per conversation.
 */
export function useChat(me: string | undefined, enabled: boolean) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [members, setMembers] = useState<ChatMemberRow[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [reactions, setReactions] = useState<ChatReactionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!me) return;
    const [c, m0, msg, r] = await Promise.all([
      supabase.from('chat_conversations').select('*').order('last_message_at', { ascending: false }),
      supabase.from('chat_members').select('conversation_id, user_id, last_read_at, added_at, archived_at, cleared_at'),
      supabase.from('chat_messages').select('*').order('created_at'),
      supabase.from('chat_reactions').select('message_id, user_id, emoji'),
    ]);
    // A database without the archive / delete columns yet: chat still works, without them.
    const m = m0.error?.code === '42703'
      ? await supabase.from('chat_members').select('conversation_id, user_id, last_read_at, added_at')
      : m0;
    const rows = (m.data as ChatMemberRow[]) ?? [];
    // A chat this person deleted on their side: its messages up to that moment
    // are not theirs to see any more (everyone else keeps their own copy).
    const cleared = new Map<string, number>();
    for (const row of rows) if (row.user_id === me && row.cleared_at) cleared.set(row.conversation_id, new Date(row.cleared_at).getTime());
    const all = (msg.data as ChatMsg[]) ?? [];
    const mine = cleared.size
      ? all.filter((x) => { const t = cleared.get(x.conversation_id); return t == null || new Date(x.created_at).getTime() > t; })
      : all;
    setConversations((c.data as ChatConversation[]) ?? []);
    setMembers(rows);
    setMessages(mine);
    setReactions((r.data as ChatReactionRow[]) ?? []);
    setLoading(false);
  }, [me]);

  useEffect(() => {
    if (!enabled || !me) return;
    load();
    // One send fires several changes at once (the message, the conversation's
    // last_message_at, read receipts). Coalesce a burst into a single reload so
    // every device doesn't re-read all four tables once per change.
    let timer: number | undefined;
    const kick = () => { window.clearTimeout(timer); timer = window.setTimeout(load, 250); };
    const ch = supabase
      .channel(uniqueChannel('chat_live'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, kick)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, kick)
      .subscribe();
    return () => { window.clearTimeout(timer); supabase.removeChannel(ch); };
  }, [enabled, me, load]);

  return { conversations, members, messages, reactions, loading, reload: load };
}

export async function sendChatMessage(conversationId: string, senderId: string, body: string, imagePath?: string | null) {
  return supabase.from('chat_messages').insert({ conversation_id: conversationId, sender_id: senderId, body, ...(imagePath ? { image_path: imagePath } : {}) });
}
/** Can pictures be sent in chat yet? (The database change that adds them has been applied.) */
export async function chatImagesReady(): Promise<boolean> {
  const { error } = await supabase.from('chat_messages').select('image_path').limit(1);
  return !error;
}
/** Find or create the 1:1 conversation with `otherId`; returns its id. */
export async function startChat(otherId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('chat_start', { other: otherId });
  if (error) { console.error(error); return null; }
  return data as string;
}
export async function createGroup(title: string, memberIds: string[]): Promise<string | null> {
  const { data, error } = await supabase.rpc('chat_create_group', { p_title: title, member_ids: memberIds });
  if (error) { console.error(error); return null; }
  return data as string;
}
export async function addToGroup(conversationId: string, memberIds: string[]) {
  return supabase.rpc('chat_add_members', { conv: conversationId, member_ids: memberIds });
}
/** Remove someone from a group. Any member can; the RPC enforces membership. */
export async function removeFromGroup(conversationId: string, userId: string) {
  return supabase.rpc('chat_remove_member', { conv: conversationId, target: userId });
}
/**
 * Delete a group chat for good (messages included). Only the person who made
 * it, and only once everyone else has been removed — chat_delete_group checks.
 */
export async function deleteGroup(conversationId: string) {
  return supabase.rpc('chat_delete_group', { conv: conversationId });
}
/**
 * After a file has been taken off a job: move it to the Drive trash — unless
 * another job still uses the same file, which keeps it. `tokenP` is a Google
 * token started inside the click (driveTokenNow). Returns a short note for the
 * person. Never throws.
 */
export async function trashRemovedFile(
  tokenP: Promise<string | null>,
  file: { url: string; driveId: string | null },
  exceptOrderId?: string,
): Promise<string> {
  if (!file.driveId) return 'Removed from the task.';
  let byMain = supabase.from('work_orders').select('id', { count: 'exact', head: true }).eq('file_link', file.url);
  // A JSON string, not an array: supabase-js turns an array into a Postgres
  // array literal ({…}), which a jsonb column rejects (HTTP 400).
  let byList = supabase.from('work_orders').select('id', { count: 'exact', head: true })
    .filter('attachments', 'cs', JSON.stringify([{ url: file.url }]));
  if (exceptOrderId) { byMain = byMain.neq('id', exceptOrderId); byList = byList.neq('id', exceptOrderId); }
  const [a, b] = await Promise.all([byMain, byList]);
  if (a.error || b.error) return 'Removed from the task. It was left in Drive (could not check other tasks).';
  if ((a.count ?? 0) + (b.count ?? 0) > 0) return 'Removed from the task. It stays in Drive — another task uses the same file.';
  const token = await tokenP;
  if (!token) return 'Removed from the task. It was left in Drive (Google sign-in did not finish).';
  return (await trashDriveFile(token, file.driveId))
    ? 'Removed from the task and moved to the Drive trash.'
    : 'Removed from the task. It could not be removed from Drive (only files added through the app can be) — delete it in Drive if needed.';
}

/**
 * Remove a chat nobody else can use any more — everyone else in it has a
 * deleted or deactivated account. Any member may; chat_delete_orphan checks.
 */
export async function deleteOrphanChat(conversationId: string) {
  return supabase.rpc('chat_delete_orphan', { conv: conversationId });
}
/** Rename a group (its purpose). A member may; the chat_conv_update policy allows it. */
export async function renameGroup(conversationId: string, title: string | null) {
  return supabase.from('chat_conversations').update({ title }).eq('id', conversationId);
}
/**
 * Set your reaction to a message, Messenger-style (2026-10-12): one per person.
 * Whatever you had on it is taken off first; `emoji` null just removes it.
 */
export async function setReaction(messageId: string, userId: string, emoji: string | null) {
  const cleared = await supabase.from('chat_reactions').delete().eq('message_id', messageId).eq('user_id', userId);
  if (cleared.error || !emoji) return cleared;
  return supabase.from('chat_reactions').insert({ message_id: messageId, user_id: userId, emoji });
}
/** Toggle a reaction: remove it if `on` (already mine), otherwise add it. */
export async function toggleReaction(messageId: string, userId: string, emoji: string, on: boolean) {
  if (on) {
    return supabase.from('chat_reactions').delete()
      .eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji);
  }
  return supabase.from('chat_reactions').insert({ message_id: messageId, user_id: userId, emoji });
}
/**
 * Mark a conversation read up to `upTo` (a message's server timestamp) or now,
 * whichever is later — so a device whose clock runs behind still lands past
 * the newest message and doesn't look "unread" again.
 */
export async function markChatRead(conversationId: string, userId: string, upTo?: string) {
  const now = new Date();
  const at = upTo && new Date(upTo) > now ? new Date(upTo) : now;
  const res = await supabase.from('chat_members').update({ last_read_at: at.toISOString() })
    .eq('conversation_id', conversationId).eq('user_id', userId);
  // The chat is read: so are its "sent a message" / "mentioned you" notifications.
  await markNotificationsSeen(userId, conversationId, ['message', 'mention']);
  return res;
}

/** Put a chat away (or bring it back). Only on this person's side; a newer message brings it back by itself. */
export async function archiveChat(conversationId: string, userId: string, on: boolean) {
  return supabase.from('chat_members').update({ archived_at: on ? new Date().toISOString() : null })
    .eq('conversation_id', conversationId).eq('user_id', userId);
}
/**
 * Delete a chat on this person's side only: everything in it up to now stops
 * showing for them, for good. The other people keep their copy. `upTo` is the
 * newest message's server time, so a device whose clock runs behind still
 * covers it.
 */
export async function deleteChatForMe(conversationId: string, userId: string, upTo?: string) {
  const now = new Date();
  const at = (upTo && new Date(upTo) > now ? new Date(upTo) : now).toISOString();
  const res = await supabase.from('chat_members').update({ cleared_at: at, archived_at: null, last_read_at: at })
    .eq('conversation_id', conversationId).eq('user_id', userId);
  if (!res.error) await markNotificationsSeen(userId, conversationId, ['message', 'mention']);
  return res;
}

// ---------------------------------------------------------------
// Chat Support tickets (Help → Chat Support) — filed when a ticket is closed
// or handed to Support; readable for 30 days.
// ---------------------------------------------------------------
export interface SupportTicket {
  id: string;
  user_id: string;
  status: 'closed' | 'handed_over';
  transcript: { from: 'bot' | 'me'; text: string; at: string; steps?: string[]; topic?: string }[];
  conversation_id: string | null;
  started_at: string;
  closed_at: string;
}
/** File a ticket (your own). Returns an error message, or null when it was saved. */
export async function saveSupportTicket(t: Pick<SupportTicket, 'status' | 'transcript' | 'conversation_id' | 'started_at'>): Promise<string | null> {
  try {
    const { error } = await supabase.from('support_tickets').insert({ ...t, closed_at: new Date().toISOString() });
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : 'No connection';
  }
}
/** The tickets this person may read: their own — or everyone's, for Support and the Tech Developer. */
export function useSupportTickets(enabled: boolean) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase.from('support_tickets').select('*').order('closed_at', { ascending: false }).limit(200);
    if (error) setAvailable(!tableMissing(error));
    else { setAvailable(true); setTickets((data as SupportTicket[]) ?? []); }
    setLoading(false);
  }, [enabled]);
  useEffect(() => { void load(); }, [load]);
  return { tickets, loading, available, reload: load };
}

/**
 * The notifications inbox — assignments and messages, live. `onNew` fires for
 * each freshly-arrived notification (used to raise a toast).
 */
export function useNotifications(userId: string | undefined, onNew?: (n: Notification) => void) {
  const [items, setItems] = useState<Notification[]>([]);
  const channelName = useRef(uniqueChannel('notifications_live'));
  const onNewRef = useRef(onNew);
  useEffect(() => { onNewRef.current = onNew; }, [onNew]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    setItems((data as Notification[]) ?? []);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    const channel = supabase
      .channel(channelName.current)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          setItems((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list].slice(0, 50)));
          onNewRef.current?.(n);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          setItems((list) => list.map((x) => (x.id === n.id ? n : x)));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setItems((list) => list.map((x) => (x.id === id && !x.read_at ? { ...x, read_at: now } : x)));
    await supabase.from('notifications').update({ read_at: now }).eq('id', id).is('read_at', null);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((list) => list.map((x) => (x.read_at ? x : { ...x, read_at: now })));
    await supabase.from('notifications').update({ read_at: now }).eq('user_id', userId).is('read_at', null);
  }, [userId]);

  // Delete every notification of this person (their own only — the
  // notifications_delete policy allows nothing else). Put back on failure.
  const clearAll = useCallback(async () => {
    if (!userId) return;
    setItems([]);
    const { error } = await supabase.from('notifications').delete().eq('user_id', userId);
    if (error) await load();
  }, [userId, load]);

  const unread = items.reduce((n, x) => n + (x.read_at ? 0 : 1), 0);
  return { items, unread, markRead, markAllRead, clearAll, reload: load };
}
