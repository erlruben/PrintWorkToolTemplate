/**
 * Drafts (migration 046).
 *
 * 1. New work order forms that were not saved yet. Kept in the account
 *    (work_order_drafts — private to the author, on any device) AND mirrored in
 *    this browser, so a lost connection or a refresh never loses them; the
 *    mirror is pushed up again when the connection comes back.
 * 2. Edits to an existing task that could not be saved (no connection, or the
 *    page closed mid-typing). Kept in this browser and re-sent when the task is
 *    opened again or the connection returns.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Attachment, Item, ItemColumn, Site, Urgency } from './types';

export interface DraftData {
  wo_number?: string;
  artist_id?: string;
  client_name?: string;
  client_phone?: string;
  items?: Item[];
  item_columns?: ItemColumn[];
  description?: string;
  material?: string;
  laminating?: string;
  notes?: string;
  operator_note?: string;
  date_given?: string;
  date_due?: string;
  target_site?: Site | '';
  planned_operator_id?: string;
  urgency?: Urgency | '';
  files?: Attachment[];
}
export interface Draft { id: string; data: DraftData; updated_at: string }

const CHANGED = 'printflow-drafts-changed';
const draftsKey = (userId: string) => `printflow-drafts:${userId}`;
const pendingKey = (userId: string) => `printflow-pending-edits:${userId}`;
// Drafts this person discarded. They stay hidden even while the account copy is
// still being deleted (or the delete failed offline and is retried later), and
// a save still in flight cannot bring one back. `done` = gone from the account.
const discardedKey = (userId: string) => `printflow-drafts-discarded:${userId}`;
type Discarded = Record<string, { done: boolean; at: string }>;

type LocalDrafts = Record<string, { data: DraftData; updated_at: string; synced: boolean }>;
function readJson<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
function writeJson(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked — the account copy still works */ }
}
const announce = () => window.dispatchEvent(new Event(CHANGED));
const discarded = (userId: string) => readJson<Discarded>(discardedKey(userId), {});
function markDiscarded(userId: string, id: string, done: boolean) {
  const all = discarded(userId);
  all[id] = { done, at: all[id]?.at ?? new Date().toISOString() };
  // Keep the newest 100 — plenty to cover anything still syncing.
  const keep = Object.entries(all).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 100);
  writeJson(discardedKey(userId), Object.fromEntries(keep));
}
async function deleteRemote(userId: string, id: string) {
  const { error } = await supabase.from('work_order_drafts').delete().eq('id', id);
  if (!error) markDiscarded(userId, id, true);
}

export const newDraftId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/** True when the form has anything worth keeping. */
export function hasContent(d: DraftData): boolean {
  return !!(d.client_name?.trim() || d.description?.trim() || d.notes?.trim() || d.material?.trim()
    || d.items?.some((i) => i.name.trim()) || d.files?.length);
}

/** Save (or update) a draft: in this browser at once, then in the account. */
export async function saveDraft(userId: string, id: string, data: DraftData): Promise<boolean> {
  if (discarded(userId)[id]) return true;   // discarded meanwhile — never bring it back
  const updated_at = new Date().toISOString();
  const local = readJson<LocalDrafts>(draftsKey(userId), {});
  local[id] = { data, updated_at, synced: false };
  writeJson(draftsKey(userId), local);
  announce();
  const { error } = await supabase.from('work_order_drafts').upsert({ id, user_id: userId, data, updated_at });
  if (error) return false;
  // Discarded while this save was on its way: remove the copy it just made.
  if (discarded(userId)[id]) { await deleteRemote(userId, id); return true; }
  const after = readJson<LocalDrafts>(draftsKey(userId), {});
  if (after[id]?.updated_at === updated_at) { after[id].synced = true; writeJson(draftsKey(userId), after); }
  return true;
}

export async function deleteDraft(userId: string, id: string) {
  markDiscarded(userId, id, false);
  const local = readJson<LocalDrafts>(draftsKey(userId), {});
  delete local[id];
  writeJson(draftsKey(userId), local);
  announce();
  await deleteRemote(userId, id);
}

/** The list straight from this browser's copy plus the last account fetch — no waiting. */
function quickList(userId: string, server: Draft[]): Draft[] {
  const local = readJson<LocalDrafts>(draftsKey(userId), {});
  const gone = discarded(userId);
  const merged = new Map<string, Draft>();
  for (const r of server) if (!gone[r.id]) merged.set(r.id, r);
  for (const [id, l] of Object.entries(local)) {
    const remote = merged.get(id);
    if (!gone[id] && (!remote || l.updated_at > remote.updated_at)) merged.set(id, { id, data: l.data, updated_at: l.updated_at });
  }
  return [...merged.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** This person's drafts, newest first — the account's merged with this browser's. */
export function useDrafts(userId: string | undefined) {
  // The account's copies as last fetched, so the list can redraw from this
  // browser's copy at once and not wait on the network.
  const server = useRef<Draft[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>(() => (userId ? quickList(userId, []) : []));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++seq.current;
    setDrafts(quickList(userId, server.current));
    const { data, error } = await supabase.from('work_order_drafts').select('id, data, updated_at').eq('user_id', userId);
    if (mine !== seq.current) return;   // a newer reload is on its way — let it win
    if (!error) server.current = (data ?? []) as Draft[];
    const local = readJson<LocalDrafts>(draftsKey(userId), {});
    const gone = discarded(userId);
    const merged = new Map<string, Draft>();
    if (!error) for (const r of data ?? []) {
      const id = r.id as string;
      if (!gone[id]) merged.set(id, r as Draft);
      else void deleteRemote(userId, id);   // discarded, but the account copy is still there — retry
    }
    for (const [id, l] of Object.entries(local)) {
      if (gone[id]) continue;
      const remote = merged.get(id);
      if (!remote || l.updated_at > remote.updated_at) {
        // A copy made offline (or newer than the account's): show it, and push it up.
        if (!error && !l.synced) void saveDraft(userId, id, l.data);
        merged.set(id, { id, data: l.data, updated_at: l.updated_at });
      }
    }
    // A draft deleted on another device: drop this browser's synced copy too.
    if (!error) {
      const ids = new Set((data ?? []).map((r) => r.id as string));
      let changed = false;
      for (const [id, l] of Object.entries(local)) if (l.synced && !ids.has(id)) { delete local[id]; merged.delete(id); changed = true; }
      if (changed) writeJson(draftsKey(userId), local);
    }
    setDrafts([...merged.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }, [userId]);

  useEffect(() => {
    void load();
    const again = () => { void load(); };
    // Coming back to the tab picks up drafts made on another device.
    const onShow = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener(CHANGED, again);
    window.addEventListener('online', again);
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.removeEventListener(CHANGED, again); window.removeEventListener('online', again);
      window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', onShow);
    };
  }, [load]);
  return { drafts, reload: load };
}

// ---- Task edits that couldn't be saved ----

type Pending = Record<string, { fields: Record<string, unknown>; at: string; wo: string }>;

/** Keep a task's unsaved edits in this browser (raw form values). */
export function keepPendingEdits(userId: string, orderId: string, wo: string, fields: Record<string, unknown>) {
  const all = readJson<Pending>(pendingKey(userId), {});
  if (Object.keys(fields).length) all[orderId] = { fields, at: new Date().toISOString(), wo };
  else delete all[orderId];
  writeJson(pendingKey(userId), all);
  announce();
}
export function pendingEditsFor(userId: string, orderId: string): Record<string, unknown> | null {
  return readJson<Pending>(pendingKey(userId), {})[orderId]?.fields ?? null;
}
export function clearPendingEdits(userId: string, orderId: string) {
  const all = readJson<Pending>(pendingKey(userId), {});
  if (!all[orderId]) return;
  delete all[orderId];
  writeJson(pendingKey(userId), all);
  announce();
}
/** Tasks with edits waiting in this browser. */
export function usePendingEdits(userId: string | undefined) {
  const [ids, setIds] = useState<Pending>(() => (userId ? readJson<Pending>(pendingKey(userId), {}) : {}));
  useEffect(() => {
    if (!userId) return;
    const load = () => setIds(readJson<Pending>(pendingKey(userId), {}));
    window.addEventListener(CHANGED, load);
    window.addEventListener('storage', load);
    return () => { window.removeEventListener(CHANGED, load); window.removeEventListener('storage', load); };
  }, [userId]);
  return ids;
}
