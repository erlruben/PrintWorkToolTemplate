import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent, type UIEvent } from 'react';
import {
  addToGroup,
  createGroup,
  markChatRead,
  removeFromGroup,
  archiveChat,
  chatImagesReady,
  deleteChatForMe,
  deleteGroup,
  deleteOrphanChat,
  renameGroup,
  sendChatMessage,
  startChat,
  setReaction,
  useChat,
  useOnlineUsers,
  type ChatConversation,
  type ChatMsg,
  type ChatReactionRow,
} from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { effectiveVolume } from '../lib/sound';
import { awayLabel, ROLE_LABEL, STAFF_STATUS_LABEL, staffStatusOf, statusUntilLabel, type Profile } from '../lib/types';
import { StatusIcon, StatusTag } from './StaffStatus';
import { expandMentions, plainBody } from '../lib/mentions';
import MentionInput from './MentionInput';
import MentionText from './MentionText';
import { isImageFile, PHOTO_TEXT, uploadChatImage, useChatImageUrls } from '../lib/chatImages';

// The reactions offered, in Messenger's order (plus 🙏, much used here). Older ones (😂) still show.
const REACTIONS = ['❤️', '😆', '😮', '😢', '😡', '👍', '🙏'];

// Messenger-style threading: a new time label after a 30-minute lull (or a new
// day), and back-to-back messages from one person within 5 minutes join into
// one stack of bubbles with a single avatar.
const SEP_GAP = 30 * 60_000;
const CLUSTER_GAP = 5 * 60_000;

/** A message sent from this device that the server hasn't echoed back yet. */
/** `local` + `file`: a picture still on its way — shown from this device, kept for a retry. */
interface PendingMsg extends ChatMsg { failed?: boolean; local?: string; file?: File; why?: string }

/**
 * "Chats" — a header control that opens a Messenger-style
 * panel: a conversation list with who's active now, one open conversation at a
 * time (with a back arrow), and a "New group" flow. Bubbles stack per sender,
 * time labels break up the thread, "Seen" shows under your last message, and a
 * long-press (or the ☺ button) reacts. One panel, not a row of docked windows —
 * tidier on a phone.
 */
export default function TeamChat({
  profiles,
  openConversation,
  onOpened,
  openRequest = 0,
}: {
  profiles: Profile[];
  openConversation?: string | null;
  onOpened?: () => void;
  openRequest?: number;
}) {
  const { session, profile } = useSession();
  const me = profile?.id;
  const { conversations, members, messages, reactions, reload } = useChat(me, !!session);
  const online = useOnlineUsers(me, !!session);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'conv' | 'group' | 'add' | 'people'>('list');
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingMsg[]>([]);
  const [q, setQ] = useState('');
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [addPick, setAddPick] = useState<string[]>([]);
  const [addingBusy, setAddingBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);     // the chat whose ⋮ menu is open
  const [showArchived, setShowArchived] = useState(false);
  const [rowMenuUp, setRowMenuUp] = useState(false);
  // The message whose "who reacted" list is open.
  const [reactedFor, setReactedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!reactedFor) return;
    const onDown = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.react-pill, .react-who')) setReactedFor(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setReactedFor(null); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [reactedFor]);
  // Pictures in chat (2026-10-12): on once the database has them; the one open full screen.
  const [imagesOn, setImagesOn] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => { if (session) void chatImagesReady().then(setImagesOn); }, [session]);
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setViewer(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewer]);
  // The ⋮ menu closes on a tap elsewhere or Escape. (Up here with the other hooks: before any early return.)
  useEffect(() => {
    if (!rowMenu) return;
    const onDown = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.chat-row-menu, .chat-row-more')) setRowMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setRowMenu(null); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [rowMenu]);
  const [manageErr, setManageErr] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  // The emoji bar opens above a message — below it when the message is at the very top of the chat.
  const [paletteBelow, setPaletteBelow] = useState(false);
  const placeBar = (el: Element) => {
    const row = el.closest('.msg'), log = el.closest('.teamchat-log');
    setPaletteBelow(!!row && !!log && row.getBoundingClientRect().top - log.getBoundingClientRect().top < 56);
  };
  const [timeFor, setTimeFor] = useState<string | null>(null);   // a tapped bubble shows its time
  const [nearBottom, setNearBottom] = useState(true);
  const [bottomCount, setBottomCount] = useState(0);              // thread length when last at the bottom
  const [, setTick] = useState(0);                                // re-render so "5m" ages while open
  const lastSeenId = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ t: number; x: number; y: number; fired: boolean } | null>(null);

  const profOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p]));
    return (id: string) => m.get(id);
  }, [profiles]);
  const nameOf = (id: string) => profOf(id)?.full_name ?? 'Unknown';
  const firstName = (id: string) => nameOf(id).split(' ')[0];

  const membersByConv = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const m of members) (map[m.conversation_id] ??= []).push(m.user_id);
    return map;
  }, [members]);
  const readAt = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const m of members) (map[m.conversation_id] ??= {})[m.user_id] = m.last_read_at;
    return map;
  }, [members]);
  // When each person was put into each chat — with last_read_at it tells a chat
  // you were added to but have never opened ("New", like Messenger).
  const addedAt = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const m of members) (map[m.conversation_id] ??= {})[m.user_id] = m.added_at;
    return map;
  }, [members]);
  const msgsByConv = useMemo(() => {
    const map: Record<string, ChatMsg[]> = {};
    for (const m of messages) (map[m.conversation_id] ??= []).push(m);
    return map;
  }, [messages]);
  const reactionsByMsg = useMemo(() => {
    const map: Record<string, ChatReactionRow[]> = {};
    for (const r of reactions) (map[r.message_id] ??= []).push(r);
    return map;
  }, [reactions]);

  const otherOf = (c: ChatConversation) => (membersByConv[c.id] ?? []).find((id) => id !== me);
  /**
   * A chat nobody else can use any more: everyone else in it has a deleted
   * account ('deleted' — the purge removes them from the chat) or a switched-off
   * one ('deactivated'); a group left with no one active is 'empty'. Such a chat
   * can be removed. Unknown until the staff list has loaded.
   */
  function goneOf(c: ChatConversation): null | 'deleted' | 'deactivated' | 'empty' {
    if (!profiles.length) return null;
    const rest = (membersByConv[c.id] ?? []).filter((id) => id !== me);
    if (rest.some((id) => profOf(id)?.active)) return null;
    if (c.is_group) return 'empty';
    return rest.length && profOf(rest[0]) ? 'deactivated' : 'deleted';
  }
  const GONE_LABEL = { deleted: 'Account deleted', deactivated: 'Account deactivated', empty: 'No one else here' } as const;
  function convName(c: ChatConversation): string {
    if (c.is_group) {
      if (c.title) return c.title;
      const others = (membersByConv[c.id] ?? []).filter((id) => id !== me).map(firstName);
      return others.join(', ') || 'Group chat';
    }
    const other = otherOf(c);
    return other && profOf(other) ? nameOf(other) : 'Deleted account';
  }
  function convSub(c: ChatConversation): string {
    const gone = goneOf(c);
    if (gone) return GONE_LABEL[gone];
    if (c.is_group) {
      const ids = membersByConv[c.id] ?? [];
      const on = ids.filter((id) => id !== me && online.has(id)).length;
      return `${ids.length} members${on ? ` · ${on} online` : ''}`;
    }
    const other = otherOf(c);
    const p = other ? profOf(other) : undefined;
    if (!p) return '';
    // Away (Out of office / Sick) always shows — it says why they may not answer.
    // "Working" only while they have the app open (Online); otherwise Offline.
    return awayLabel(p) ?? (other && online.has(other)
      ? `${STAFF_STATUS_LABEL.working} · Online`
      : `Offline · ${ROLE_LABEL[p.role]}`);
  }
  const unreadOf = (c: ChatConversation) => {
    const rd = me ? readAt[c.id]?.[me] : undefined;
    return (msgsByConv[c.id] ?? []).filter(
      (m) => m.sender_id !== me && (!rd || new Date(m.created_at) > new Date(rd)),
    ).length;
  };
  // Someone else started this chat or added you, and you have not opened it yet.
  const isNewFor = (c: ChatConversation) => {
    if (!me || c.created_by === me) return false;
    const added = addedAt[c.id]?.[me];
    return !!added && readAt[c.id]?.[me] === added;
  };
  // The red number: unread messages — or 1 for a chat you were just added to.
  const countOf = (c: ChatConversation) => unreadOf(c) || (isNewFor(c) ? 1 : 0);
  const lastMsg = (c: ChatConversation) => { const l = msgsByConv[c.id] ?? []; return l[l.length - 1]; };
  const lastAt = (c: ChatConversation) =>
    new Date(lastMsg(c)?.created_at ?? c.last_message_at ?? c.created_at).getTime();
  // This person's own marks on each chat (2026-10-11): put away, or deleted on their side.
  const myMark = useMemo(() => {
    const map: Record<string, { archived: number | null; cleared: boolean }> = {};
    for (const m of members) if (m.user_id === me) map[m.conversation_id] = { archived: m.archived_at ? new Date(m.archived_at).getTime() : null, cleared: !!m.cleared_at };
    return map;
  }, [members, me]);
  // Deleted on my side and nothing new since: gone from my list. A new message brings the chat back, empty of the old ones.
  const isDeletedForMe = (c: ChatConversation) => !!myMark[c.id]?.cleared && !(msgsByConv[c.id]?.length);
  // Put away, and nothing new since.
  const isArchived = (c: ChatConversation) => {
    const at = myMark[c.id]?.archived;
    if (at == null) return false;
    const lm = lastMsg(c);
    return !lm || new Date(lm.created_at).getTime() <= at;
  };
  const unreadTotal = conversations.reduce((s, c) => s + (isDeletedForMe(c) ? 0 : countOf(c)), 0);
  // Most recent conversation first, like any messenger.
  const allSorted = [...conversations].filter((c) => !isDeletedForMe(c)).sort((a, b) => lastAt(b) - lastAt(a));
  const sortedConvs = allSorted.filter((c) => !isArchived(c));
  const archivedConvs = allSorted.filter(isArchived);

  function openConv(id: string) {
    setActiveConv(id);
    setView('conv');
    setOpen(true);
    setPaletteFor(null);
    setTimeFor(null);
    setNearBottom(true);
  }
  function backToList() { setView('list'); setActiveConv(null); setPaletteFor(null); }

  // A message-notification click opens that conversation.
  useEffect(() => {
    if (openConversation) { openConv(openConversation); onOpened?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConversation]);
  useEffect(() => {
    if (openRequest > 0) openChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  // Ping when a new message arrives from someone else.
  useEffect(() => {
    if (!me || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (lastSeenId.current === null) { lastSeenId.current = newest.id; return; }
    const vol = effectiveVolume();
    if (newest.id !== lastSeenId.current && newest.sender_id !== me && vol > 0) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.08 * vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.5);
      } catch { /* audio blocked until first click; the badge carries it */ }
    }
    lastSeenId.current = newest.id;
  }, [messages, me]);

  // Is this browser tab in front? A message is only "seen" when it is.
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Keep the open conversation marked read — but only write when something new
  // from someone else has actually arrived. Writing on every reload looped:
  // the write itself is a realtime change that triggers the next reload.
  // Only while the panel is really OPEN on it and the tab is in front: a chat
  // left behind a closed panel must keep its red number (it used to be marked
  // read unseen).
  useEffect(() => {
    if (!open || !tabVisible || view !== 'conv' || !activeConv || !me) return;
    const theirs = (msgsByConv[activeConv] ?? []).filter((m) => m.sender_id !== me);
    const newest = theirs[theirs.length - 1];
    if (!newest) {
      // Nothing from them yet, but opening a chat you were added to clears "New".
      const conv = conversations.find((c) => c.id === activeConv);
      if (conv && isNewFor(conv)) markChatRead(activeConv, me);
      return;
    }
    const rd = readAt[activeConv]?.[me];
    if (rd && new Date(rd) >= new Date(newest.created_at)) return;
    markChatRead(activeConv, me, newest.created_at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgsByConv, readAt, addedAt, conversations, view, activeConv, me, open, tabVisible]);

  // Relative times in the list ("5m", "2h") keep ageing while the panel is open.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [open]);

  function openChats() { setOpen(true); setView('list'); }

  // The open thread: the server's messages plus any still sending from here.
  const active = activeConv ? conversations.find((c) => c.id === activeConv) ?? null : null;
  const thread = useMemo(() => {
    if (!activeConv) return [] as PendingMsg[];
    const own = pending.filter((p) => p.conversation_id === activeConv);
    return [...(msgsByConv[activeConv] ?? []), ...own] as PendingMsg[];
  }, [activeConv, msgsByConv, pending]);

  const imageUrls = useChatImageUrls(thread.map((m) => m.image_path).filter((x): x is string => !!x));

  // Stay pinned to the newest message — unless the person has scrolled up to
  // read, in which case a "New messages" pill appears instead of yanking them.
  const lastInThread = thread[thread.length - 1];
  const lastId = lastInThread?.id;
  const lastMine = !!lastInThread && lastInThread.sender_id === me;
  const prevLastId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (view !== 'conv') return;
    const el = logRef.current;
    if (!el) return;
    // Your own new message always brings you down; anything else only if you
    // were already at the bottom.
    const arrived = lastId !== prevLastId.current;
    prevLastId.current = lastId;
    if (nearBottom || (arrived && lastMine)) el.scrollTo({ top: el.scrollHeight });
  }, [lastId, lastMine, activeConv, view, nearBottom]);

  function onLogScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setNearBottom(near);
    if (near) setBottomCount(thread.length);
  }
  function jumpToNewest() {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }

  if (!profile) return null;

  // People you can start/expand a chat with: everyone active but you.
  // (Deactivated staff stay resolvable by name in existing threads, just not
  // offered here.)
  const others = profiles.filter((p) => p.id !== me && p.active);
  const needle = q.trim().toLowerCase();
  const searchHits = needle ? others.filter((p) => p.full_name.toLowerCase().includes(needle)) : [];
  const groupHits = needle
    ? sortedConvs.filter((c) => c.is_group && convName(c).toLowerCase().includes(needle))
    : [];
  const activeNow = others
    .filter((p) => online.has(p.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // The conversation log: time labels, "X was added" notices, and messages
  // marked as the first / last of a same-sender stack. Groups only get the
  // added notices — in a 1:1 there is nobody to "add", and backfilled 1:1s
  // (migration-027) carry an old conversation created_at but migration-time
  // member added_at, which would read as an add. Initial group members share
  // the group's exact creation time (one transaction), so anyone with a later
  // added_at was added afterwards.
  type LogItem =
    | { kind: 'sep'; key: string; label: string }
    | { kind: 'add'; at: number; key: string; userId: string }
    | { kind: 'msg'; at: number; key: string; msg: PendingMsg; first: boolean; last: boolean };
  const convCreated = active?.created_at ? new Date(active.created_at).getTime() : Infinity;
  const raw: ({ kind: 'add'; at: number; key: string; userId: string } | { kind: 'msg'; at: number; key: string; msg: PendingMsg })[] = active
    ? [
        ...thread.map((m) => ({ kind: 'msg' as const, at: new Date(m.created_at).getTime(), key: m.id, msg: m })),
        ...(active.is_group
          ? members
              .filter((m) => m.conversation_id === active.id && new Date(m.added_at).getTime() > convCreated + 2000)
              .map((m) => ({ kind: 'add' as const, at: new Date(m.added_at).getTime(), key: `add-${m.user_id}`, userId: m.user_id }))
          : []),
      ].sort((a, b) => a.at - b.at)
    : [];
  const log: LogItem[] = [];
  let prevAt: number | null = null;
  for (const it of raw) {
    const newDay = prevAt != null && new Date(prevAt).toDateString() !== new Date(it.at).toDateString();
    if (prevAt == null || newDay || it.at - prevAt > SEP_GAP) {
      log.push({ kind: 'sep', key: `sep-${it.key}`, label: timeLabel(it.at) });
    }
    if (it.kind === 'msg') {
      const prev = log[log.length - 1];
      const joins = prev?.kind === 'msg' && prev.msg.sender_id === it.msg.sender_id && it.at - prev.at < CLUSTER_GAP;
      if (joins) prev.last = false;
      log.push({ ...it, first: !joins, last: true });
    } else {
      log.push(it);
    }
    prevAt = it.at;
  }

  // Who has seen what (2026-10-12). A person has seen everything up to the last
  // time they had the chat open — or up to their own newest message, whichever
  // is later (you have read what you answered). Their small picture sits under
  // the LAST message they have seen, like Messenger; tapping a message lists
  // everyone who has seen it.
  const realThread = thread.filter((m) => !m.id.startsWith('tmp-'));
  const seenUpTo: Record<string, number> = {};          // user id → time
  const seenUnder: Record<string, string[]> = {};       // message id → the people whose picture sits under it
  if (active) {
    for (const id of membersByConv[active.id] ?? []) {
      if (id === me) continue;
      const read = readAt[active.id]?.[id];
      const own = [...realThread].reverse().find((m) => m.sender_id === id);
      seenUpTo[id] = Math.max(read ? new Date(read).getTime() : 0, own ? new Date(own.created_at).getTime() : 0);
      // The newest message from someone else that they have seen.
      const at = [...realThread].reverse().find((m) => m.sender_id !== id && new Date(m.created_at).getTime() <= seenUpTo[id]);
      if (at) (seenUnder[at.id] ??= []).push(id);
    }
  }
  /** Everyone (but you and its sender) who has seen this message. */
  const seenBy = (m: ChatMsg) => Object.keys(seenUpTo).filter((id) => id !== m.sender_id && seenUpTo[id] >= new Date(m.created_at).getTime());
  // "Sent" under your newest message until someone has seen it.
  const lastReal = realThread[realThread.length - 1];
  const seenLine = active && lastInThread && lastInThread.sender_id === me && lastReal && lastReal.id === lastInThread.id && seenBy(lastReal).length === 0
    ? 'Sent' : null;

  async function startWith(otherId: string) {
    const id = await startChat(otherId);
    setQ('');
    if (id) openConv(id);
  }
  async function makeGroup() {
    if (groupPick.length === 0) return;
    const id = await createGroup(groupName.trim(), groupPick);
    if (id) { setGroupPick([]); setGroupName(''); openConv(id); }
  }
  // Group-settings screen: who's in the group, and who can still be added.
  const currentMembers = active
    ? ((membersByConv[active.id] ?? []).map(profOf).filter(Boolean) as Profile[])
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
    : [];
  const addCandidates = active
    ? others.filter((p) => !(membersByConv[active.id] ?? []).includes(p.id))
    : [];
  async function addMembers() {
    if (!activeConv || addPick.length === 0) return;
    setAddingBusy(true);
    setManageErr(null);
    const { error } = await addToGroup(activeConv, addPick);
    if (error) { setManageErr(error.message); setAddingBusy(false); return; }
    await reload();                    // realtime also refreshes, but don't wait on it
    setAddPick([]);
    setAddingBusy(false);
  }
  async function removeMember(userId: string) {
    if (!activeConv) return;
    const who = nameOf(userId);
    if (!confirm(`Remove ${who} from this chat? They lose access to it.`)) return;
    setRemovingId(userId);
    setManageErr(null);
    const { error } = await removeFromGroup(activeConv, userId);
    if (error) setManageErr(error.message);
    else await reload();
    setRemovingId(null);
  }
  // ---- the ⋮ menu on a chat in the list: archive it, or delete it on my side ----
  async function doArchive(c: ChatConversation, on: boolean) {
    setRowMenu(null);
    if (!me) return;
    const { error } = await archiveChat(c.id, me, on);
    if (error) { alert(error.message); return; }
    await reload();
  }
  async function doDeleteForMe(c: ChatConversation) {
    setRowMenu(null);
    if (!me) return;
    const who = c.is_group ? 'The others in the group keep theirs.' : `${convName(c)} keeps their copy.`;
    if (!confirm(`Delete this chat?\n\nEvery message in it is removed from YOUR side for good — this cannot be undone. ${who}`)) return;
    const { error } = await deleteChatForMe(c.id, me, lastMsg(c)?.created_at);
    if (error) { alert(error.message); return; }
    await reload();
  }
  function chatRow(c: ChatConversation) {
    const n = unreadOf(c);
    const isNew = n === 0 && isNewFor(c);
    const lm = lastMsg(c);
    const other = otherOf(c);
    const archived = isArchived(c);
    const preview = lm
      ? `${lm.sender_id === me ? 'You: ' : c.is_group ? `${firstName(lm.sender_id)}: ` : ''}${plainBody(lm.body)}`
      : isNew ? (c.is_group ? 'You were added to this group' : 'New chat — say hi 👋') : 'No messages yet — say hi 👋';
    return (
      <div key={c.id} className={`chat-row-wrap${rowMenu === c.id ? ' menu-open' : ''}`}>
        <button className={`teamchat-row${n > 0 || isNew ? ' unread' : ''}`} onClick={() => openConv(c.id)}>
          {c.is_group
            ? <GroupAvatar />
            : <Avatar id={other ?? c.id} name={convName(c)} online={!!other && online.has(other)} />}
          <span className="teamchat-row-main">
            <span className="teamchat-row-name">
              {convName(c)}
              {!c.is_group && other && <StatusTag profile={profOf(other)} showWorking={online.has(other)} />}
              {goneOf(c) && <span className="teamchat-gone-tag">{GONE_LABEL[goneOf(c)!]}</span>}
            </span>
            <span className="teamchat-row-sub">
              <span className="teamchat-row-preview">{preview}</span>
              {lm && <span className="teamchat-row-time"> · {shortAgo(lm.created_at)}</span>}
            </span>
          </span>
          {n > 0 && <span className="teamchat-badge" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>}
          {isNew && <span className="teamchat-badge" aria-label="New chat">New</span>}
        </button>
        <button
          className="chat-row-more"
          aria-label={`More for ${convName(c)}`}
          title="More"
          aria-haspopup="menu"
          aria-expanded={rowMenu === c.id}
          onClick={(e) => {
            // Near the bottom of the list the menu opens upward, so it is never cut off.
            const list = e.currentTarget.closest('.chat-list')?.getBoundingClientRect();
            setRowMenuUp(!!list && e.currentTarget.getBoundingClientRect().bottom + 110 > list.bottom);
            setRowMenu((v) => (v === c.id ? null : c.id));
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
        </button>
        {rowMenu === c.id && (
          <div className={`chat-row-menu${rowMenuUp ? ' up' : ''}`} role="menu">
            <button role="menuitem" onClick={() => doArchive(c, !archived)}>{archived ? 'Unarchive chat' : 'Archive chat'}</button>
            <button role="menuitem" className="danger" onClick={() => doDeleteForMe(c)}>Delete chat</button>
          </div>
        )}
      </div>
    );
  }

  // A chat whose other people all have deleted or deactivated accounts.
  async function doRemoveChat() {
    if (!activeConv) return;
    if (!confirm('Remove this chat?\n\nIts messages are deleted for good. This cannot be undone.')) return;
    setDeleteBusy(true);
    const { error } = await deleteOrphanChat(activeConv);
    setDeleteBusy(false);
    if (error) { alert(error.message); return; }
    backToList();
    await reload();
  }
  // The group's owner can delete it once they are the only one left in it.
  async function doDeleteGroup() {
    if (!activeConv) return;
    if (!confirm('Delete this group chat for good?\n\nIts messages are removed and this cannot be undone.')) return;
    setDeleteBusy(true);
    setManageErr(null);
    const { error } = await deleteGroup(activeConv);
    setDeleteBusy(false);
    if (error) { setManageErr(error.message); return; }
    backToList();
    await reload();
  }
  async function doRename() {
    if (!activeConv) return;
    setRenameBusy(true);
    setManageErr(null);
    const { error } = await renameGroup(activeConv, renameVal.trim() || null);
    if (error) setManageErr(error.message);
    else await reload();
    setRenameBusy(false);
  }

  // Sending shows the message at once (greyed until the server has it). If it
  // fails it stays in the thread marked "Not sent — tap to retry".
  async function deliver(tempId: string, convId: string, text: string) {
    if (!me) return;
    const { error } = await sendChatMessage(convId, me, text);
    if (error) {
      setPending((p) => p.map((x) => (x.id === tempId ? { ...x, failed: true } : x)));
      return;
    }
    await reload();
    setPending((p) => p.filter((x) => x.id !== tempId));
  }
  function sendText(rawText: string) {
    const id = activeConv;
    const body = rawText.trim();
    if (!id || !me || !body) return;
    // In a group, @everyone tags each member (stored as one mention per person).
    const text = expandMentions(body, mentionable, active?.is_group ? mentionable : undefined, !!active?.is_group);
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPending((p) => [...p, { id: tempId, conversation_id: id, sender_id: me, body: text, created_at: new Date().toISOString() }]);
    setNearBottom(true);
    deliver(tempId, id, text);
  }
  function retry(m: PendingMsg) {
    setPending((p) => p.map((x) => (x.id === m.id ? { ...x, failed: false, why: undefined } : x)));
    if (m.file) void deliverImage(m.id, m.conversation_id, m.file);
    else deliver(m.id, m.conversation_id, m.body);
  }
  // A picture: shown at once from this device, then stored and sent as its own message.
  async function deliverImage(tempId: string, convId: string, file: File) {
    if (!me) return;
    try {
      const path = await uploadChatImage(convId, file);
      const { error } = await sendChatMessage(convId, me, PHOTO_TEXT, path);
      if (error) throw new Error(error.message);
    } catch (e) {
      setPending((p) => p.map((x) => (x.id === tempId ? { ...x, failed: true, why: e instanceof Error ? e.message : undefined } : x)));
      return;
    }
    await reload();
    setPending((p) => { const gone = p.find((x) => x.id === tempId); if (gone?.local) URL.revokeObjectURL(gone.local); return p.filter((x) => x.id !== tempId); });
  }
  function sendImages(files: File[]) {
    const id = activeConv;
    const pics = files.filter(isImageFile).slice(0, 10);
    if (!id || !me || !pics.length) return;
    const now = Date.now();
    const rows = pics.map((file, k) => ({ id: `tmp-${now}-${k}-${Math.random().toString(36).slice(2, 8)}`, conversation_id: id, sender_id: me, body: PHOTO_TEXT,
      created_at: new Date(now + k).toISOString(), local: URL.createObjectURL(file), file }));
    setPending((p) => [...p, ...rows]);
    setNearBottom(true);
    // One after the other, so they arrive in the order they were picked.
    void (async () => { for (const r of rows) await deliverImage(r.id, id, r.file); })();
  }
  function send() {
    const id = activeConv;
    if (!id) return;
    const text = drafts[id] ?? '';
    if (!text.trim()) return;
    setDrafts((d) => ({ ...d, [id]: '' }));
    sendText(text);
  }
  // One reaction per person, like Messenger: the same one again takes it off, another replaces it.
  function react(msgId: string, emoji: string) {
    if (!me) return;
    const mine = (reactionsByMsg[msgId] ?? []).some((r) => r.user_id === me && r.emoji === emoji);
    void setReaction(msgId, me, mine ? null : emoji).then(() => reload());
  }
  function submit(e: FormEvent) { e.preventDefault(); send(); }
  async function copyText(body: string) {
    try { await navigator.clipboard.writeText(plainBody(body)); } catch { /* clipboard blocked */ }
  }

  // Long-press a bubble on a phone to react, like Messenger. A mouse uses the
  // ☺ button instead; a plain tap shows the message's time.
  function pressStart(e: PointerEvent<HTMLDivElement>, id: string) {
    if (e.pointerType === 'mouse') return;
    const el = e.currentTarget;
    const t = window.setTimeout(() => {
      if (pressRef.current) pressRef.current.fired = true;
      placeBar(el);
      setPaletteFor(id);
      navigator.vibrate?.(10);
    }, 450);
    pressRef.current = { t, x: e.clientX, y: e.clientY, fired: false };
  }
  function pressMove(e: PointerEvent<HTMLDivElement>) {
    const p = pressRef.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      window.clearTimeout(p.t);
      pressRef.current = null;
    }
  }
  function pressEnd() {
    const p = pressRef.current;
    if (p && !p.fired) { window.clearTimeout(p.t); pressRef.current = null; }
  }
  function bubbleTap(e: React.MouseEvent, id: string) {
    const p = pressRef.current;
    pressRef.current = null;
    if (p?.fired) { e.stopPropagation(); return; }   // the long-press already opened the palette
    setTimeFor((t) => (t === id ? null : id));
  }

  // In a group you can @mention the other members; in a 1:1 the other person.
  const mentionable = active
    ? ((membersByConv[active.id] ?? []).filter((id) => id !== me).map(profOf).filter(Boolean) as Profile[])
    : [];
  const draft = active ? drafts[active.id] ?? '' : '';
  const showNewPill = view === 'conv' && !nearBottom && thread.length > bottomCount;

  const personRow = (p: Profile, sub: string, onClick: () => void) => (
    <button key={p.id} className="teamchat-row" onClick={onClick}>
      <Avatar id={p.id} name={p.full_name} online={online.has(p.id)} />
      <span className="teamchat-row-main">
        <span className="teamchat-row-name">{p.full_name}<StatusTag profile={p} showWorking={online.has(p.id)} /></span>
        {/* The tag already says Sick / Out of office; the line adds until when and the note. */}
        <span className="teamchat-row-sub">
          {staffStatusOf(p) === 'working'
            ? sub
            : [statusUntilLabel(p.status_until), p.status_note?.trim()].filter(Boolean).join(' · ') || sub}
        </span>
      </span>
    </button>
  );

  return (
    <>
      {!open && (
        <button
          className="chat-toggle"
          onClick={openChats}
          aria-label={unreadTotal > 0 ? `Open chats, ${unreadTotal} unread` : 'Open chats'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {unreadTotal > 0 && <span className="chat-toggle-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}
        </button>
      )}

      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chats">
          <div className="chat-panel-head">
            {view !== 'list' && (
              <button
                className="chat-panel-back"
                onClick={view === 'conv' ? backToList : view === 'add' ? () => setView('conv') : () => setView('list')}
                aria-label="Back"
              >←</button>
            )}
            {view === 'conv' && active && (
              active.is_group
                ? <GroupAvatar size={32} />
                : <Avatar id={otherOf(active) ?? active.id} name={convName(active)} size={32} online={!!otherOf(active) && online.has(otherOf(active)!)} />
            )}
            <span className="chat-panel-title">
              <strong>
                {view === 'conv' && active ? convName(active)
                  : view === 'group' ? 'New group'
                  : view === 'add' ? 'Group settings'
                  : view === 'people' ? 'New message'
                  : 'Chats'}
              </strong>
              {view === 'conv' && active && (
                <span className="chat-head-status">
                  {/* "icon - Status" for the other person: away always, Working only while active. */}
                  {(() => {
                    const other = active.is_group ? null : otherOf(active);
                    const p = other ? profOf(other) : undefined;
                    if (!p) return null;
                    const st = staffStatusOf(p);
                    return st !== 'working' || online.has(p.id) ? <><StatusIcon status={st} size={12} /> - </> : null;
                  })()}
                  {convSub(active)}
                </span>
              )}
            </span>
            <span className="spacer" style={{ flex: 1 }} />
            {view === 'list' && (
              <>
                <button className="chat-panel-icon" onClick={() => setView('people')} aria-label="New message" title="New message">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button className="chat-panel-icon" onClick={() => setView('group')} aria-label="New group" title="New group">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M19 8v6" /><path d="M22 11h-6" />
                  </svg>
                </button>
              </>
            )}
            {view === 'conv' && active?.is_group && (
              <button
                className="chat-panel-settings"
                onClick={() => { setAddPick([]); setManageErr(null); setRenameVal(active?.title ?? ''); setView('add'); }}
                aria-label="Group settings"
                title="Group settings"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}
            <button className="chat-panel-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>

          <div className="chat-panel-body">
            {view === 'list' && (
              <div className="chat-list">
                <div className="teamchat-search">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or groups" aria-label="Search chats" />
                </div>

                {!needle && activeNow.length > 0 && (
                  <div className="chat-active">
                    <div className="chat-active-label">
                      <i className="presence-dot on" aria-hidden /> Online · {activeNow.length}
                    </div>
                    <div className="chat-active-strip" aria-label="Online now">
                      {activeNow.map((p) => (
                        <button key={p.id} className="chat-active-person" onClick={() => startWith(p.id)} title={`Message ${p.full_name}`}>
                          <Avatar id={p.id} name={p.full_name} size={46} online />
                          <span className="chat-active-name">{p.full_name.split(' ')[0]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {needle ? (
                  groupHits.length || searchHits.length ? (
                    <>
                      {groupHits.map((c) => (
                        <button key={c.id} className="teamchat-row" onClick={() => openConv(c.id)}>
                          <GroupAvatar />
                          <span className="teamchat-row-main">
                            <span className="teamchat-row-name">{convName(c)}</span>
                            <span className="teamchat-row-sub">{convSub(c)}</span>
                          </span>
                        </button>
                      ))}
                      {searchHits.map((p) => personRow(p, online.has(p.id) ? 'Online' : `Offline · ${ROLE_LABEL[p.role]}`, () => startWith(p.id)))}
                    </>
                  ) : (
                    <p className="chat-empty">No one by that name.</p>
                  )
                ) : sortedConvs.length || archivedConvs.length ? (
                  <>
                    {sortedConvs.map(chatRow)}
                    {archivedConvs.length > 0 && (
                      <>
                        <button className="chat-archived-toggle" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
                          Archived chats · {archivedConvs.length}
                          <span aria-hidden>{showArchived ? ' ▴' : ' ▾'}</span>
                        </button>
                        {showArchived && archivedConvs.map(chatRow)}
                      </>
                    )}
                  </>
                ) : (
                  <div className="chat-empty">
                    <p><strong>No chats yet.</strong></p>
                    <p>Tap <strong>✎</strong> above to message someone, or search a name.</p>
                  </div>
                )}
              </div>
            )}

            {view === 'group' && (
              <div className="teamchat-group">
                <input className="teamchat-group-name" placeholder="Group name (optional)"
                  value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                <p className="chat-hint">Tick the people to add, then tap <strong>Create group</strong>.</p>
                <div className="teamchat-group-people">
                  {others.map((p) => {
                    const on = groupPick.includes(p.id);
                    return (
                      <label key={p.id} className="teamchat-pick">
                        <input type="checkbox" checked={on}
                          onChange={() => setGroupPick((g) => (on ? g.filter((x) => x !== p.id) : [...g, p.id]))} />
                        <Avatar id={p.id} name={p.full_name} online={online.has(p.id)} />
                        <span className="teamchat-row-main">
                          <span className="teamchat-row-name">{p.full_name}<StatusTag profile={p} showWorking={online.has(p.id)} /></span>
                          <span className="teamchat-row-sub">{ROLE_LABEL[p.role]}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <button className="btn sm" disabled={groupPick.length === 0} onClick={makeGroup}>
                  Create group ({groupPick.length})
                </button>
              </div>
            )}

            {view === 'add' && active && (
              <div className="teamchat-group teamchat-settings">
                {manageErr && <div className="error" style={{ margin: '0 0 6px' }}>{manageErr}</div>}

                <label className="field" style={{ marginBottom: 6 }}>
                  <span>Group name</span>
                  <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'stretch', gap: 8 }}>
                    <input
                      type="text"
                      style={{ flex: 1, minWidth: 0 }}
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      placeholder="e.g. Production floor, Rush jobs…"
                    />
                    <button
                      className="btn ghost sm"
                      disabled={renameBusy || renameVal.trim() === (active.title ?? '')}
                      onClick={doRename}
                    >
                      {renameBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </label>

                <div className="teamchat-section-label">In this chat · {currentMembers.length}</div>
                <div className="teamchat-group-people">
                  {currentMembers.map((p) => (
                    <div key={p.id} className="teamchat-member">
                      <Avatar id={p.id} name={p.full_name} online={online.has(p.id)} />
                      <span className="teamchat-row-main">
                        <span className="teamchat-row-name">{p.full_name}{p.id === me ? ' (you)' : ''}<StatusTag profile={p} showWorking={online.has(p.id)} /></span>
                        <span className="teamchat-row-sub">
                          {ROLE_LABEL[p.role]}{p.id === active.created_by ? ' · Group owner' : ''}
                        </span>
                      </span>
                      {p.id !== me && (
                        <button className="teamchat-remove" disabled={removingId === p.id}
                          onClick={() => removeMember(p.id)}>
                          {removingId === p.id ? '…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="teamchat-section-label">Add people</div>
                <div className="teamchat-group-people">
                  {addCandidates.length === 0 ? (
                    <p className="chat-empty">Everyone is already in this chat.</p>
                  ) : (
                    addCandidates.map((p) => {
                      const on = addPick.includes(p.id);
                      return (
                        <label key={p.id} className="teamchat-pick">
                          <input type="checkbox" checked={on}
                            onChange={() => setAddPick((g) => (on ? g.filter((x) => x !== p.id) : [...g, p.id]))} />
                          <Avatar id={p.id} name={p.full_name} online={online.has(p.id)} />
                          <span className="teamchat-row-main">
                            <span className="teamchat-row-name">{p.full_name}<StatusTag profile={p} showWorking={online.has(p.id)} /></span>
                            <span className="teamchat-row-sub">{ROLE_LABEL[p.role]}</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                {addCandidates.length > 0 && (
                  <button className="btn sm" disabled={addPick.length === 0 || addingBusy} onClick={addMembers}>
                    {addingBusy ? 'Adding…' : `Add to group (${addPick.length})`}
                  </button>
                )}

                {active.created_by === me && (() => {
                  const othersLeft = currentMembers.filter((p) => p.id !== me).length;
                  return (
                    <div className="teamchat-delete">
                      <div className="teamchat-section-label">Delete group</div>
                      <p className="teamchat-delete-note">
                        {othersLeft > 0
                          ? `Remove everyone else first (${othersLeft} left), then you can delete this group.`
                          : 'Everyone else has been removed. Deleting removes the group and its messages for good.'}
                      </p>
                      <button className="btn danger sm" disabled={othersLeft > 0 || deleteBusy} onClick={doDeleteGroup}>
                        {deleteBusy ? 'Deleting…' : 'Delete group'}
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {view === 'people' && (
              <div className="chat-list">
                <div className="teamchat-people-hint">
                  Tap someone to message them.
                  <span style={{ flex: 1 }} />
                  <i className="presence-dot on" /> Online
                </div>
                {others.length === 0 ? (
                  <p className="chat-empty">No one else yet.</p>
                ) : (
                  [...others]
                    .sort((a, b) =>
                      Number(online.has(b.id)) - Number(online.has(a.id)) || a.full_name.localeCompare(b.full_name))
                    .map((p) => personRow(
                      p,
                      `${ROLE_LABEL[p.role]}${online.has(p.id) ? ' · Online' : ''}`,
                      () => startWith(p.id),
                    ))
                )}
              </div>
            )}

            {view === 'conv' && active && (
              <>
                <div className="teamchat-log" ref={logRef} onScroll={onLogScroll} onClick={() => setPaletteFor(null)}>
                  {log.length === 0 && (
                    <div className="chat-empty chat-hello">
                      {active.is_group
                        ? <GroupAvatar size={64} />
                        : <Avatar id={otherOf(active) ?? active.id} name={convName(active)} size={64} />}
                      <p><strong>{convName(active)}</strong></p>
                      <p>Say hi 👋 — or tap the 👍 to send a quick thumbs up.</p>
                    </div>
                  )}
                  {log.map((it) => {
                    if (it.kind === 'sep') {
                      return <div key={it.key} className="chat-timesep">{it.label}</div>;
                    }
                    if (it.kind === 'add') {
                      return (
                        <div key={it.key} className="chat-sysline">
                          <span>{it.userId === me ? 'You were' : `${nameOf(it.userId)} was`} added to the chat</span>
                        </div>
                      );
                    }
                    const m = it.msg;
                    const mine = m.sender_id === me;
                    const isPending = m.id.startsWith('tmp-');
                    const grouped = groupReactions(reactionsByMsg[m.id] ?? [], me as string);
                    const total = (reactionsByMsg[m.id] ?? []).length;
                    const myReaction = (reactionsByMsg[m.id] ?? []).find((r) => r.user_id === me)?.emoji ?? null;
                    const big = isEmojiOnly(m.body);
                    const cls = [
                      'msg', mine ? 'mine' : 'theirs', grouped.length ? 'reacted' : '',
                      it.first ? 'first' : 'cont', it.last ? 'last' : '',
                      isPending ? 'pending' : '', m.failed ? 'failed' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <Fragment key={m.id}>
                      <div className={cls}>
                        {!mine && active.is_group && it.first && (
                          <div className="msg-name">{firstName(m.sender_id)}</div>
                        )}
                        <div className="msg-line">
                          {!mine && (
                            <span className="msg-avatar-slot">
                              {it.last && <Avatar id={m.sender_id} name={nameOf(m.sender_id)} size={28} />}
                            </span>
                          )}
                          <div className="bubble-row">
                            <div className="bubble-wrap">
                            <div
                              className={`bubble${big ? ' big-emoji' : ''}${m.image_path || m.local ? ' has-img' : ''}`}
                              title={new Date(m.created_at).toLocaleString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                              onPointerDown={isPending ? undefined : (e) => pressStart(e, m.id)}
                              onPointerMove={pressMove}
                              onPointerUp={pressEnd}
                              onPointerCancel={pressEnd}
                              onContextMenu={(e) => { if (pressRef.current) e.preventDefault(); }}
                              onClick={(e) => (m.failed ? retry(m) : bubbleTap(e, m.id))}
                            >
                              {m.image_path || m.local ? (
                                (m.local ?? imageUrls[m.image_path!]) ? (
                                  <img className="chat-img" src={m.local ?? imageUrls[m.image_path!]} alt="Photo"
                                    onClick={(e) => { if (!m.failed && !isPending) { e.stopPropagation(); setViewer(m.local ?? imageUrls[m.image_path!]); } }} />
                                ) : <span className="chat-img-wait">Photo…</span>
                              ) : null}
                              {(!(m.image_path || m.local) || m.body !== PHOTO_TEXT) && <MentionText body={m.body} meId={me} />}
                            </div>
                            {/* Reactions: one small pill on the bubble's corner; tap it to see who. */}
                            {grouped.length > 0 && (
                              <button className={`react-pill${grouped.some((g) => g.mine) ? ' mine' : ''}`} aria-expanded={reactedFor === m.id}
                                aria-label={`${total} ${total === 1 ? 'reaction' : 'reactions'}: ${grouped.map((g) => g.emoji).join(' ')}. See who reacted`}
                                onClick={(e) => { e.stopPropagation(); setReactedFor(reactedFor === m.id ? null : m.id); }}>
                                <span className="react-pill-emo">{grouped.slice(0, 3).map((g) => g.emoji).join('')}</span>
                                {total > 1 && <span className="react-pill-n">{total}</span>}
                              </button>
                            )}
                            {reactedFor === m.id && grouped.length > 0 && (
                              <div className="react-who" role="dialog" aria-label="Who reacted" onClick={(e) => e.stopPropagation()}>
                                {(reactionsByMsg[m.id] ?? []).map((r) => (
                                  r.user_id === me ? (
                                    <button key={r.user_id + r.emoji} className="react-who-row mine" onClick={() => { react(m.id, r.emoji); setReactedFor(null); }}>
                                      <span>You <span className="muted">· tap to remove</span></span><span>{r.emoji}</span>
                                    </button>
                                  ) : (
                                    <div key={r.user_id + r.emoji} className="react-who-row"><span>{nameOf(r.user_id)}</span><span>{r.emoji}</span></div>
                                  )
                                ))}
                              </div>
                            )}
                            </div>
                            {!isPending && (
                              <button className="react-add" aria-label="React"
                                onClick={(e) => { e.stopPropagation(); placeBar(e.currentTarget); setPaletteFor(paletteFor === m.id ? null : m.id); }}>☺</button>
                            )}
                            {paletteFor === m.id && (
                              <div className={`react-palette${paletteBelow ? ' below' : ''}`} onClick={(e) => e.stopPropagation()}>
                                {REACTIONS.map((emo) => (
                                  <button key={emo} aria-label={`React ${emo}`} aria-pressed={myReaction === emo} className={myReaction === emo ? 'on' : ''}
                                    onClick={() => { react(m.id, emo); setPaletteFor(null); }}>{emo}</button>
                                ))}
                                <button className="react-copy" onClick={() => { copyText(m.body); setPaletteFor(null); }}>Copy</button>
                              </div>
                            )}
                          </div>
                        </div>
                        {m.failed ? (
                          <div className="msg-status failed">{m.why ? `${m.why} ` : 'Not sent · '}tap to retry</div>
                        ) : isPending ? (
                          it.last && <div className="msg-status">Sending…</div>
                        ) : timeFor === m.id ? (
                          <div className="msg-status">
                            {new Date(m.created_at).toLocaleString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                            {/* Tapped: who has seen this message. */}
                            {(() => {
                              const who = seenBy(m);
                              const everyone = active.is_group && who.length > 0 && who.length === Object.keys(seenUpTo).filter((id) => id !== m.sender_id).length;
                              return who.length
                                ? <span className="msg-seen-names"> · Seen by {everyone ? 'everyone' : who.map(firstName).join(', ')}</span>
                                : mine ? <span className="msg-seen-names"> · Not seen yet</span> : null;
                            })()}
                          </div>
                        ) : null}
                      </div>
                      {/* The small pictures of the people whose latest seen message this is — at the right edge, like Messenger. */}
                      {!isPending && seenUnder[m.id] && (
                        <div className="msg-seenby" aria-label={`Seen by ${seenUnder[m.id].map(nameOf).join(', ')}`}>
                          {seenUnder[m.id].slice(0, 6).map((id) => (
                            <span key={id} className="msg-seenby-face" title={`Seen by ${nameOf(id)}`}><Avatar id={id} name={nameOf(id)} size={16} /></span>
                          ))}
                          {seenUnder[m.id].length > 6 && <span className="msg-seenby-more">+{seenUnder[m.id].length - 6}</span>}
                        </div>
                      )}
                      </Fragment>
                    );
                  })}
                  {seenLine && <div className="msg-seen">{seenLine}</div>}
                </div>
                {showNewPill && (
                  <button className="chat-new-pill" onClick={jumpToNewest}>↓ New messages</button>
                )}
                {goneOf(active) && (
                  <div className="teamchat-gone">
                    <span>
                      {goneOf(active) === 'deleted'
                        ? 'This account has been deleted.'
                        : goneOf(active) === 'deactivated'
                          ? `${convName(active)}'s account is deactivated.`
                          : 'No one else in this group has an active account.'}
                    </span>
                    <button className="btn danger sm" onClick={doRemoveChat} disabled={deleteBusy}>
                      {deleteBusy ? 'Removing…' : 'Remove chat'}
                    </button>
                  </div>
                )}
                {(!goneOf(active) || active.is_group) && (
                <form className="teamchat-compose" onSubmit={submit}
                  onPaste={imagesOn ? (e) => { const pics = Array.from(e.clipboardData.files).filter(isImageFile); if (pics.length) { e.preventDefault(); sendImages(pics); } } : undefined}
                  onDragOver={imagesOn ? (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); } : undefined}
                  onDrop={imagesOn ? (e) => { const pics = Array.from(e.dataTransfer.files).filter(isImageFile); if (pics.length) { e.preventDefault(); sendImages(pics); } } : undefined}>
                  {imagesOn && (
                    <label className="compose-attach" title="Send a picture" aria-label="Send a picture">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="M21 15.5l-4.8-4.8a1.2 1.2 0 0 0-1.7 0L7 18.2" />
                      </svg>
                      <input type="file" accept="image/*" multiple hidden
                        onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; sendImages(picked); }} />
                    </label>
                  )}
                  <MentionInput
                    value={draft}
                    onChange={(v) => setDrafts((d) => ({ ...d, [active.id]: v }))}
                    onEnter={send}
                    candidates={mentionable}
                    everyone={active.is_group}
                    roles={active.is_group}
                    placeholder="Type a message…"
                  />
                  {draft.trim() ? (
                    <button className="compose-send" aria-label="Send" title="Send (Enter)">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.1 15 12 3.4 13.9z" />
                      </svg>
                    </button>
                  ) : (
                    <button type="button" className="compose-like" aria-label="Send a thumbs up" title="Send 👍"
                      onClick={() => sendText('👍')}>👍</button>
                  )}
                </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {/* A picture opened full screen: tap anywhere, × or Escape to close. */}
      {viewer && (
        <div className="chat-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setViewer(null)}>
          <button className="chat-viewer-x" aria-label="Close photo" onClick={() => setViewer(null)}>×</button>
          <img src={viewer} alt="Photo" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/** Initials on a colour picked from the person's id — the same colour everywhere. */
const AVATAR_COLORS = ['#e11d48', '#c026d3', '#7c3aed', '#4f46e5', '#0369a1', '#0e7490', '#0f766e', '#15803d', '#c2410c'];
function Avatar({ id, name, size = 36, online }: { id: string; name: string; size?: number; online?: boolean }) {
  let h = 2166136261;                          // FNV-1a: spreads similar ids across colours
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return (
    <span
      className="teamchat-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: AVATAR_COLORS[h % AVATAR_COLORS.length] }}
      aria-hidden
    >
      {initials(name)}
      {/* Green = online (the app is open), red = offline. The dot grows with the avatar, so
          its colour — not its white ring — is what you see. */}
      {online !== undefined && (
        <i
          className={`presence-dot ${online ? 'on' : 'off'}`}
          title={online ? 'Online' : 'Offline'}
          style={{ width: dotSize(size), height: dotSize(size), right: 0, bottom: 0 }}
        />
      )}
    </span>
  );
}
const dotSize = (avatar: number) => Math.min(16, Math.max(10, Math.round(avatar * 0.3)));
function GroupAvatar({ size = 36 }: { size?: number }) {
  return (
    <span className="teamchat-avatar group" style={{ width: size, height: size }} aria-hidden>
      <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    </span>
  );
}

function groupReactions(rs: ChatReactionRow[], me: string) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of rs) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.user_id === me) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/** "now", "5m", "3h", "Mon", "Sep 20" — the conversation-list clock. */
function shortAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return new Date(t).toLocaleDateString('en-PH', { weekday: 'short' });
  return new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/** The centred label between message runs: "Today 3:45 PM", "Yesterday 9:10 AM", "Monday 2:00 PM". */
function timeLabel(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  if (diff < 7) return `${d.toLocaleDateString('en-PH', { weekday: 'long' })} ${time}`;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString('en-PH', opts)}, ${time}`;
}

/** A short message of only emoji shows large with no bubble, like Messenger. */
function isEmojiOnly(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 16 || /^[\d#*\s]+$/.test(t)) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(t);
}
