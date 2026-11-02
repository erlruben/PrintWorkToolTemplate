import { useEffect, useState } from 'react';

export interface UpdateEntry {
  id: string;
  released: string;
  title: string;
  items: string[];
}

export const UPDATES: UpdateEntry[] = [
  {
    id: '2026-10-29-template',
    released: '2026-10-29',
    title: 'PrintFlow template is ready',
    items: [
      'The work-order workflow is ready to configure for your shop.',
      'Connect a new Supabase project and review roles, policy pages, and print areas before inviting your team.',
    ],
  },
];

export const KEEP_DAYS = 30;
const DAY = 86400000;
export const releasedAt = (u: Pick<UpdateEntry, 'released'>) => new Date(`${u.released}T00:00:00+08:00`);
export const dateLabel = (u: Pick<UpdateEntry, 'released'>) =>
  releasedAt(u).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });

export function activeUpdates(now = Date.now()): UpdateEntry[] {
  return UPDATES.filter((u) => now - releasedAt(u).getTime() < KEEP_DAYS * DAY);
}

export function updatesByDate(now = Date.now()): { released: string; label: string; entries: UpdateEntry[] }[] {
  const out: { released: string; label: string; entries: UpdateEntry[] }[] = [];
  for (const u of activeUpdates(now)) {
    const group = out.find((x) => x.released === u.released);
    if (group) group.entries.push(u);
    else out.push({ released: u.released, label: dateLabel(u), entries: [u] });
  }
  return out;
}

export const LATEST_UPDATE = UPDATES[0];
const seenKey = (userId: string) => `printflow-updates-seen-${userId}`;
const clearedKey = (userId: string) => `printflow-updates-cleared-${userId}`;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* not remembered; it shows again next time */ } };

const newerThan = (id: string | null, list: UpdateEntry[]) => {
  if (!id) return list;
  const at = UPDATES.findIndex((u) => u.id === id);
  return at < 0 ? list.slice(0, 1) : list.filter((u) => UPDATES.indexOf(u) < at);
};

export function unseenUpdates(userId: string, now = Date.now()): UpdateEntry[] {
  const seen = read(seenKey(userId));
  const active = activeUpdates(now);
  return seen ? newerThan(seen, active) : active.slice(0, 1);
}

export function markUpdatesSeen(userId: string) {
  write(seenKey(userId), LATEST_UPDATE.id);
  window.dispatchEvent(new Event('printflow-updates'));
}

export interface ReleaseNotice {
  id: string;
  title: string;
  body: string;
  at: string;
  label: string;
  unread: boolean;
}

export function releaseNotices(userId: string, now = Date.now()): ReleaseNotice[] {
  const cleared = read(clearedKey(userId));
  const unseen = new Set(unseenUpdates(userId, now).map((u) => u.id));
  const listed = cleared ? newerThan(cleared, activeUpdates(now)) : activeUpdates(now);
  return listed.map((u) => ({
    id: u.id,
    title: `Update · ${u.title}`,
    body: u.items[0].replace(/\*\*/g, ''),
    at: releasedAt(u).toISOString(),
    label: dateLabel(u),
    unread: unseen.has(u.id),
  }));
}

export function clearReleaseNotices(userId: string) {
  write(clearedKey(userId), LATEST_UPDATE.id);
  window.dispatchEvent(new Event('printflow-updates'));
}

export function useUpdates(userId: string | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener('printflow-updates', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('printflow-updates', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  if (!userId) return { unseen: [] as UpdateEntry[], notices: [] as ReleaseNotice[] };
  return { unseen: unseenUpdates(userId), notices: releaseNotices(userId) };
}
