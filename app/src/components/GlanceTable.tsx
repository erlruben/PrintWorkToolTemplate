import { useEffect, useMemo, useRef, useState } from 'react';
import { archiveOrder, previewUrls, useProfiles, useWorkOrders } from '../lib/data';
import { canCreateOrders, canEditOrder, isReviewerRole, useSession } from '../lib/sessionContext';
import { supabase } from '../lib/supabase';
import { AFTER_PRINT_LABEL, afterPrint, isAdminRole, isArchived, PROBLEM_LABEL, SITE_LABEL, STATUS_LABEL, URGENCY_LABEL, URGENCY_OPTIONS, URGENCY_RANK, daysOpen, fmtDate, type Status, type Urgency, type WorkOrder, waitingForClient } from '../lib/types';
import TicketCard from './TicketCard';
import NewOrder from './NewOrder';
import { jobFiles, linkBadge } from '../lib/links';
import UrgencySelect from './UrgencySelect';
import StageSelect from './StageSelect';
import { IconChevron, IconPlus, IconSearch } from './Icons';
import { columnsOf, itemExtrasText, itemsOf, itemsSummary, jobTitle } from '../lib/items';
import ItemsPreview from './ItemsPreview';
import MissingTask from './MissingTask';
import { groupOf, moveTo, type GroupKey } from '../lib/boardMoves';
import { startPan } from '../lib/pan';
import { deleteDraft, useDrafts, usePendingEdits, type Draft } from '../lib/drafts';

// Board dates stay on one line: "Sep 28" this year, "Sep 28 '25" otherwise.
// The full date is in the cell's tooltip.
const THIS_YEAR = new Date().getFullYear();
function fmtDay(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
  const day = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  return dt.getFullYear() === THIS_YEAR ? day : `${day} '${String(dt.getFullYear()).slice(2)}`;
}
const savedAt = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function IconArchived() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
    </svg>
  );
}

type SortKey =
  | 'smart' | 'wo_number' | 'description' | 'artist' | 'date_given'
  | 'date_due' | 'date_finished' | 'days' | 'urgency' | 'status' | 'customer' | 'material' | 'site';

/**
 * The board's own order (049): urgent tasks first, then tasks with a deadline
 * (soonest first), then the rest, newest first. Clicking a column header sorts
 * by that column instead; "Default order" brings this back.
 */
function smartCompare(a: WorkOrder, b: WorkOrder) {
  const rank = (o: WorkOrder) => (o.urgency === 'urgent' || o.priority ? 0 : o.date_due ? 1 : 2);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra < 2) {
    const da = a.date_due ?? '9999-12-31', db = b.date_due ?? '9999-12-31';
    if (da !== db) return da.localeCompare(db);
  }
  return (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.wo_number.localeCompare(b.wo_number);
}

/** Sort statuses by where they sit in the workflow, not alphabetically. */
const STATUS_ORDER: Record<Status, number> = {
  todo: 0,
  in_progress: 1,
  finished: 2,
  awaiting_print: 3,
  printed: 4,
};

// Due-date buckets, shared by the "Due" filter and the row cues. A printed job
// is never "due" — it's done.
const DAY = 86400000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dueTime = (o: WorkOrder) => (o.date_due ? new Date(o.date_due + 'T00:00:00').getTime() : null);
// Past its due date — unless it is waiting for the client's approval (not the team's delay).
const isOverdue = (o: WorkOrder) =>
  o.status !== 'printed' && !!o.date_due && new Date(o.date_due + 'T23:59:59') < new Date() && !waitingForClient(o);
const isDueToday = (o: WorkOrder) => o.status !== 'printed' && dueTime(o) === startOfToday();
const isDueSoon = (o: WorkOrder) => {          // within 3 days ahead, not yet overdue
  const t = dueTime(o);
  return o.status !== 'printed' && t != null && t >= startOfToday() && t <= startOfToday() + 3 * DAY;
};
const isDueWithinWeek = (o: WorkOrder) => {
  const t = dueTime(o);
  return o.status !== 'printed' && t != null && t >= startOfToday() && t <= startOfToday() + 7 * DAY;
};

const ALL_STATUSES: Status[] = ['todo', 'in_progress', 'finished', 'awaiting_print', 'printed'];

/**
 * PRD section 5, feature 2 — every order in one scannable row, no clicking
 * into each one. Clicking opens the full ticket card.
 */
interface Props {
  /** A notification click routes here: open this ticket, or this chat. */
  pendingOpen?: { kind: 'ticket' | 'chat'; id: string } | null;
  onConsumed?: () => void;
}

export default function GlanceTable({ pendingOpen, onConsumed }: Props) {
  const { profile } = useSession();
  const { orders, trashed, loading, error } = useWorkOrders();
  const { profiles, loading: profilesLoading } = useProfiles();

  const [q, setQ] = useState('');
  // Artist filtering is still available via the "N unassigned" chip and search;
  // the standing filter defaults to everyone.
  const [artist, setArtist] = useState('all');
  const [status, setStatus] = useState<'all' | Status>('all');
  const [urg, setUrg] = useState<'all' | Urgency>('all');
  const [due, setDue] = useState<'all' | 'today' | 'week' | 'overdue'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dupFrom, setDupFrom] = useState<WorkOrder | null>(null);
  const [openDraft, setOpenDraft] = useState<Draft | null>(null);
  // Unsaved New work order forms, and task edits waiting on this device (046).
  const { drafts } = useDrafts(profile?.id);
  const pendingEdits = usePendingEdits(profile?.id);
  // Status / Priority / Due are folded into one "Filters" popover. The menu is
  // positioned fixed so the toolbar's horizontal-scroll overflow can't clip it.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPos, setFilterPos] = useState<{ top: number; right: number } | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    const onScroll = () => setFilterOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [filterOpen]);
  function toggleFilters() {
    if (filterOpen) { setFilterOpen(false); return; }
    const r = filterBtnRef.current?.getBoundingClientRect();
    if (r) setFilterPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setFilterOpen(true);
  }
  const activeFilters =
    (status !== 'all' ? 1 : 0) + (urg !== 'all' ? 1 : 0) + (due !== 'all' ? 1 : 0) + (artist === '__none__' ? 1 : 0);

  // Act on a notification click routed here from the app shell — once the list
  // has loaded; a task that is no longer there gets a short pop-up instead.
  const [missing, setMissing] = useState<{ inTrash: boolean } | null>(null);
  useEffect(() => {
    if (!pendingOpen || loading) return;
    if (pendingOpen.kind === 'ticket') {
      if (orders.some((o) => o.id === pendingOpen.id)) setOpenId(pendingOpen.id);
      else setMissing({ inTrash: trashed.some((o) => o.id === pendingOpen.id) });
    }
    onConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, loading]);

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'smart', dir: 'asc' });
  // Rows gather under their status. Awaiting print leads: it is the group
  // the printing area is watching for.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const toggleFold = (key: string) => setFolded((f) => ({ ...f, [key]: !f[key] }));

  // Excel-style column resizing. A dragged width overrides the CSS default for
  // that column (inline width on the header cell wins) and is remembered per
  // viewer. An empty map means "use the CSS defaults" until the person drags.
  const [colW, setColW] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('printflow-glance-col-w');
      if (s) return JSON.parse(s);
    } catch { /* private mode / blocked storage — just use defaults */ }
    return {};
  });
  const hasCustomWidths = Object.keys(colW).length > 0;
  useEffect(() => {
    try {
      if (Object.keys(colW).length) localStorage.setItem('printflow-glance-col-w', JSON.stringify(colW));
      else localStorage.removeItem('printflow-glance-col-w');
    } catch { /* ignore */ }
  }, [colW]);
  function resetCol(key: string) {
    setColW((m) => { const next = { ...m }; delete next[key]; return next; });
  }
  function startResize(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();                       // never trigger the column's sort
    const th = (e.currentTarget as HTMLElement).closest('th');
    if (!th) return;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    document.body.classList.add('col-resizing');
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(48, Math.round(startW + (ev.clientX - startX)));
      setColW((m) => ({ ...m, [key]: w }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('col-resizing');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  // Keyboard resizing on a focused handle: ←/→ by 10px (Shift: 40px), Delete
  // puts that column back to its default width.
  function keyResize(e: React.KeyboardEvent, key: string) {
    e.stopPropagation();                       // Enter/Space here must not sort
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); resetCol(key); return; }
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const measured = (e.currentTarget as HTMLElement).closest('th')?.getBoundingClientRect().width ?? 100;
    const step = e.shiftKey ? 40 : 10;
    setColW((m) => ({ ...m, [key]: Math.max(48, Math.round((m[key] ?? measured) + dir * step)) }));
  }
  const resizeHandle = (key: string, label: string) => (
    <span
      className="col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column (arrow keys; Delete resets)`}
      aria-valuenow={colW[key]}
      aria-valuemin={48}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onMouseDown={(e) => startResize(e, key)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); resetCol(key); }}
      onKeyDown={(e) => keyResize(e, key)}
    />
  );

  const nameOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.full_name]));
    return (id: string | null) => {
      if (!id) return 'Unassigned';
      // Until the names land, say nothing rather than accusing a real person
      // of being "Unknown" for the first second of every page load.
      return m.get(id) ?? (profilesLoading ? '…' : 'Unknown');
    };
  }, [profiles, profilesLoading]);

  // The filter keeps deactivated artists so their past jobs stay findable;
  // only current artists can be handed new work.
  const artists = useMemo(() => profiles.filter((p) => p.role === 'artist'), [profiles]);
  const assignable = useMemo(() => artists.filter((a) => a.active), [artists]);
  const printers = useMemo(() => profiles.filter((p) => p.role === 'operator' && p.active), [profiles]);

  // Keyed on the paths themselves, not the array: the orders list is rebuilt
  // on every realtime event, and re-signing every thumbnail each time would
  // hammer storage for no new pictures.
  const thumbKey = useMemo(
    () => orders.map((o) => o.preview_path).filter(Boolean).sort().join('|'),
    [orders],
  );

  useEffect(() => {
    previewUrls(thumbKey ? thumbKey.split('|') : []).then(setThumbs);
  }, [thumbKey]);

  // Released jobs file themselves away after 90 days (about a quarter), to keep the board tidy.
  // Best-effort and admin-only (archiving is an admin action), run once when an
  // admin has the board open.
  const autoArchivedRef = useRef(false);
  useEffect(() => {
    if (autoArchivedRef.current || loading || !isAdminRole(profile?.role)) return;
    const cutoff = Date.now() - 90 * 86400000;
    const stale = orders.filter(
      (o) => o.released_at && !isArchived(o) && new Date(o.released_at).getTime() < cutoff,
    );
    if (stale.length === 0) return;
    autoArchivedRef.current = true;
    (async () => { for (const o of stale) await archiveOrder(o.id); })();
  }, [orders, loading, profile]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((o) => {
      // Archived jobs are filed away — off the board unless asked for.
      if (isArchived(o) && !showArchived) return false;
      if (artist === '__none__' ? o.artist_id !== null : artist !== 'all' && o.artist_id !== artist) return false;
      if (status !== 'all' && o.status !== status) return false;
      if (urg !== 'all' && o.urgency !== urg) return false;
      if (due === 'overdue' && !isOverdue(o)) return false;
      if (due === 'today' && !isDueToday(o)) return false;
      if (due === 'week' && !isDueWithinWeek(o)) return false;
      if (!needle) return true;
      return (
        o.wo_number.toLowerCase().includes(needle) ||
        jobTitle(o).toLowerCase().includes(needle) ||
        o.description.toLowerCase().includes(needle) ||
        itemExtrasText(o).includes(needle) ||
        nameOf(o.artist_id).toLowerCase().includes(needle) ||
        (o.client_name ?? '').toLowerCase().includes(needle) ||
        (o.client_phone ?? '').toLowerCase().includes(needle) ||
        (o.material ?? '').toLowerCase().includes(needle) ||
        (o.notes ?? '').toLowerCase().includes(needle)
      );
    });
  }, [orders, q, artist, status, urg, due, showArchived, nameOf]);

  const archivedCount = useMemo(() => orders.filter(isArchived).length, [orders]);
  // Jobs still open with nobody on them — a nudge so none quietly slips through.
  const unassignedCount = useMemo(
    () => orders.filter((o) => !o.artist_id && o.status !== 'printed' && !isArchived(o)).length,
    [orders],
  );

  /**
   * Sorting. "Which job is most overdue?" and "who has the oldest unprinted
   * file?" are the questions this table exists to answer, and neither is
   * answerable by reading a date-ordered list.
   */
  const sortValue = (o: WorkOrder, key: SortKey): string | number => {
    switch (key) {
      case 'wo_number': return o.wo_number.toLowerCase();
      case 'description': return jobTitle(o).toLowerCase();
      case 'customer': return (o.client_name ?? '').toLowerCase() || '￿';
      case 'material': return (o.material ?? '').toLowerCase() || '￿';
      case 'site': return o.target_site ?? '￿';
      case 'smart': return 0;
      case 'artist': return nameOf(o.artist_id).toLowerCase();
      case 'date_given': return o.date_given;
      // Blank due dates sort last however you order the column, rather than
      // pretending to be the year 0 and crowding the top.
      case 'date_due': return o.date_due ?? '￿';
      case 'date_finished': return o.date_finished ?? '￿';
      case 'days': return daysOpen(o);
      case 'urgency': return o.urgency ? URGENCY_RANK[o.urgency] : -1;
      case 'status': return STATUS_ORDER[o.status];
    }
  };

  const shown = useMemo(() => {
    const rows = [...filtered];
    if (sort.key === 'smart') return rows.sort(smartCompare);
    rows.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      let cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp === 0) cmp = a.wo_number.localeCompare(b.wo_number); // stable tiebreak
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, nameOf]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'date_given' || key === 'days' ? 'desc' : 'asc' }));

  // A render helper, not a component: a component defined in here would remount
  // every render and drop keyboard focus off the header / resize handle.
  const sortTh = (label: string, k: SortKey, short?: string) => (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', width: colW[k] }}
      onClick={() => toggleSort(k)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(k); }
      }}
      tabIndex={0}
      aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {short ? <><span className="th-full">{label}</span><span className="th-short">{short}</span></> : label}
      <span className={`sort-caret ${sort.key === k ? 'on' : ''}`}>
        {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
      {resizeHandle(k, label)}
    </th>
  );

  // Picking a status hides the other status groups. When it's a priority, due,
  // unassigned or search filter doing the narrowing instead, drop the groups
  // that hold none of the filtered kind — so no empty headers linger. The printed
  // stage is split in three: Done Printing (the operator finished it), For Release
  // (reception checked it) and Released to Client.
  const narrowing = urg !== 'all' || due !== 'all' || artist === '__none__' || q.trim() !== '';
  const grouped = useMemo(() => {
    const sections: { key: string; label: string; cls: string; rows: WorkOrder[] }[] = [];
    const plain: Status[] = ['todo', 'in_progress', 'finished', 'awaiting_print'];
    for (const st of plain) {
      if (status === 'all' || status === st) {
        sections.push({ key: st, label: STATUS_LABEL[st], cls: st, rows: shown.filter((o) => o.status === st) });
      }
    }
    if (status === 'all' || status === 'printed') {
      sections.push({ key: 'to_review', label: AFTER_PRINT_LABEL.done, cls: 'printed', rows: shown.filter((o) => afterPrint(o) === 'done') });
      sections.push({ key: 'for_release', label: AFTER_PRINT_LABEL.ready, cls: 'ready', rows: shown.filter((o) => afterPrint(o) === 'ready') });
      sections.push({ key: 'released', label: AFTER_PRINT_LABEL.released, cls: 'released', rows: shown.filter((o) => afterPrint(o) === 'released') });
    }
    return sections.filter((g) => !narrowing || g.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, status, narrowing]);

  // How many jobs each filter option would land on, so options with nothing
  // behind them can be greyed out. Faceted: each dimension is counted with the
  // OTHER active filters (and the search / archive / artist base) applied, so
  // the choices always reflect what is actually reachable from here.
  const facet = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const passBase = (o: WorkOrder) => {
      if (isArchived(o) && !showArchived) return false;
      if (artist === '__none__' ? o.artist_id !== null : artist !== 'all' && o.artist_id !== artist) return false;
      if (!needle) return true;
      return (
        o.wo_number.toLowerCase().includes(needle) ||
        jobTitle(o).toLowerCase().includes(needle) ||
        o.description.toLowerCase().includes(needle) ||
        itemExtrasText(o).includes(needle) ||
        nameOf(o.artist_id).toLowerCase().includes(needle) ||
        (o.client_name ?? '').toLowerCase().includes(needle) ||
        (o.client_phone ?? '').toLowerCase().includes(needle) ||
        (o.material ?? '').toLowerCase().includes(needle) ||
        (o.notes ?? '').toLowerCase().includes(needle)
      );
    };
    const passStatus = (o: WorkOrder) => status === 'all' || o.status === status;
    const passUrg = (o: WorkOrder) => urg === 'all' || o.urgency === urg;
    const passDue = (o: WorkOrder) =>
      due === 'overdue' ? isOverdue(o)
        : due === 'today' ? isDueToday(o)
          : due === 'week' ? isDueWithinWeek(o)
            : true;

    const base = orders.filter(passBase);
    const statusPool = base.filter((o) => passUrg(o) && passDue(o));
    const urgPool = base.filter((o) => passStatus(o) && passDue(o));
    const duePool = base.filter((o) => passStatus(o) && passUrg(o));

    const statusCounts = Object.fromEntries(
      ALL_STATUSES.map((st) => [st, statusPool.filter((o) => o.status === st).length]),
    ) as Record<Status, number>;
    const urgCounts = Object.fromEntries(
      URGENCY_OPTIONS.map((u) => [u, urgPool.filter((o) => o.urgency === u).length]),
    ) as Record<Urgency, number>;
    const dueCounts = {
      today: duePool.filter(isDueToday).length,
      week: duePool.filter(isDueWithinWeek).length,
      overdue: duePool.filter(isOverdue).length,
    };
    return { statusCounts, urgCounts, dueCounts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, q, artist, status, urg, due, showArchived, nameOf]);

  // When a filter leaves nothing on the board, say what was filtered rather than
  // showing five empty status groups — "No Urgent tasks." etc.
  const emptyMessage = useMemo(() => {
    const bits: string[] = [];
    if (artist === '__none__') bits.push('unassigned');
    if (urg !== 'all') bits.push(URGENCY_LABEL[urg]);
    if (status !== 'all') bits.push(STATUS_LABEL[status]);
    const dueWord = due === 'today' ? ' due today' : due === 'week' ? ' due this week' : due === 'overdue' ? ' overdue' : '';
    const noun = bits.length ? `${bits.join(' ')} tasks` : 'tasks';
    const q0 = q.trim();
    if (q0) return `No ${noun}${dueWord} match “${q0}”.`;
    return `No ${noun}${dueWord}.`;
  }, [artist, urg, status, due, q]);

  // Turning "Unassigned only" on also drops any Status, Priority or Due filter
  // that has no unassigned jobs behind it, so you never sit on a stale tag whose
  // option has just greyed out.
  function setUnassignedOnly(on: boolean) {
    if (!on) { setArtist('all'); return; }
    setArtist('__none__');
    const needle = q.trim().toLowerCase();
    const pool = orders.filter((o) => {
      if (isArchived(o) && !showArchived) return false;
      if (o.artist_id !== null) return false; // unassigned only
      if (!needle) return true;
      return (
        o.wo_number.toLowerCase().includes(needle) ||
        jobTitle(o).toLowerCase().includes(needle) ||
        o.description.toLowerCase().includes(needle) ||
        itemExtrasText(o).includes(needle) ||
        (o.material ?? '').toLowerCase().includes(needle) ||
        (o.notes ?? '').toLowerCase().includes(needle)
      );
    });
    if (status !== 'all' && !pool.some((o) => o.status === status)) setStatus('all');
    if (urg !== 'all' && !pool.some((o) => o.urgency === urg)) setUrg('all');
    if (due !== 'all' && !pool.some((o) =>
      due === 'today' ? isDueToday(o) : due === 'week' ? isDueWithinWeek(o) : isOverdue(o),
    )) setDue('all');
  }

  // Every WO number in use, so a new job's random code never clashes.
  // Include trashed jobs: their rows still hold their wo_number (unique), so a new
  // order must not reuse one — otherwise the insert would clash, and it would block
  // that trashed job from being restored cleanly.
  const takenWoNumbers = useMemo(
    () => new Set([...orders, ...trashed].map((o) => o.wo_number)),
    [orders, trashed],
  );

  const open = orders.find((o) => o.id === openId) ?? null;

  // Drag a task onto another status group (049) — admin and reception. The task
  // floats under the pointer as a little card; groups it can go to light up.
  const canDrag = isReviewerRole(profile);
  const [dragTip, setDragTip] = useState(() => {
    try { return localStorage.getItem('printflow-drag-tip') !== 'off'; } catch { return true; }
  });
  const hideDragTip = () => { setDragTip(false); try { localStorage.setItem('printflow-drag-tip', 'off'); } catch { /* ignore */ } };
  const [dragId, setDragId] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const dragging = dragId ? orders.find((o) => o.id === dragId) ?? null : null;
  function startDrag(e: React.DragEvent<HTMLTableRowElement>, o: WorkOrder) {
    setDragId(o.id);
    setMoveErr(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', o.wo_number);
    // The floating card.
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const title = itemsSummary(itemsOf(o)) || o.description || '';
    ghost.innerHTML = '<strong></strong><span></span><em></em>';
    (ghost.children[0] as HTMLElement).textContent = o.wo_number;
    (ghost.children[1] as HTMLElement).textContent = o.client_name || '';
    (ghost.children[2] as HTMLElement).textContent = title;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 24, 20);
    window.setTimeout(() => ghost.remove(), 0);
  }
  const endDrag = () => { setDragId(null); setOverGroup(null); };
  async function dropOn(target: GroupKey) {
    const o = dragging;
    endDrag();
    if (!o) return;
    const mv = moveTo(o, target, profile);
    if (!mv) return;
    if (mv.confirm && !confirm(mv.confirm)) return;
    const { error: err } = await supabase.from('work_orders').update(mv.patch).eq('id', o.id);
    if (err) setMoveErr(`${o.wo_number}: ${err.message}`);
  }
  const groupDrop = (key: string) => {
    if (!dragging || key === 'drafts') return {};
    const ok = !!moveTo(dragging, key as GroupKey, profile);
    const isHome = groupOf(dragging) === key;
    return {
      className: `group-body${ok ? ' drop-ok' : isHome ? '' : ' drop-no'}${ok && overGroup === key ? ' drop-over' : ''}`,
      onDragOver: (e: React.DragEvent) => { if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overGroup !== key) setOverGroup(key); } },
      onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverGroup((g) => (g === key ? null : g)); },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); if (ok) void dropOn(key as GroupKey); },
    };
  };

  // One board row. `pending` = this device holds edits to it that are not saved
  // yet (shown in the Drafts group).
  const orderRow = (o: WorkOrder, pending = false) => (
    <tr
      key={pending ? `pending-${o.id}` : o.id}
      className={[isOverdue(o) && 'overdue', isArchived(o) && 'archived', pending && 'draft-row', dragId === o.id && 'dragging', canDrag && !pending && !isArchived(o) && 'draggable'].filter(Boolean).join(' ') || undefined}
      title={pending ? 'Changes kept on this device — open the task to save them.' : undefined}
      draggable={canDrag && !pending && !isArchived(o)}
      onDragStart={canDrag && !pending ? (e) => startDrag(e, o) : undefined}
      onDragEnd={canDrag ? endDrag : undefined}
      onClick={() => setOpenId(o.id)}
    >
      <td className="wo-num">
        <span className="wo-line">
          {pending ? <span className="row-dot pending" /> : <StageSelect order={o} editable={canEditOrder(profile, o)} />}
          <span className="wo-code">{o.wo_number}</span>
          {/* One mark at most, the most important first: problem, reprint, archived
              (the others are in the tooltip and on the ticket; an archived row is faded). */}
          {waitingForClient(o) && (
            <span className="client-chip" title={`Waiting for client approval since ${fmtDate(o.client_wait_since!)} — not counted as late`}>Client</span>
          )}
          {o.print_problem && (
            <span className="problem-chip" title={`Problem at the press: ${PROBLEM_LABEL[o.print_problem]}`} aria-label="Problem at the press">⚠</span>
          )}
          {o.reprint_count > 0 && (
            <span className="reprint-chip" title={`Returned for reprint ${o.reprint_count}×`} aria-label={`Returned for reprint ${o.reprint_count} times`}>
              ♻{o.reprint_count < 10 && <span className="reprint-n">{o.reprint_count}</span>}
            </span>
          )}
          {isArchived(o) && <span className="archived-chip" title="Archived" aria-label="Archived"><IconArchived /></span>}
        </span>
      </td>
      <td className="desc" title={o.client_name ?? ''}>{o.client_name || '—'}</td>
      <td className="desc items-td"><ItemsPreview items={o.items} description={o.description} columns={columnsOf(o)} /></td>
      <td className="desc site-cell">{o.target_site ? SITE_LABEL[o.target_site] : <span className="muted">Either</span>}</td>
      <td className="desc" title={o.material ?? ''}>{o.material || '—'}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <UrgencySelect orderId={o.id} level={o.urgency} editable={!pending && canEditOrder(profile, o)} />
      </td>
      <td className="desc" title={nameOf(o.artist_id)}>{nameOf(o.artist_id)}</td>
      <td className="date-cell" title={fmtDate(o.date_given)}>{fmtDay(o.date_given)}</td>
      <td className="date-cell" title={o.date_due ? fmtDate(o.date_due) : undefined} style={
        isOverdue(o) ? { color: 'var(--vim-red)', fontWeight: 600 }
          : isDueSoon(o) ? { color: 'var(--amber)', fontWeight: 600 }
            : undefined
      }>
        {fmtDay(o.date_due)}
      </td>
      <td className="date-cell" title={o.date_finished ? fmtDate(o.date_finished) : undefined}>{fmtDay(o.date_finished)}</td>
      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
        {o.date_finished ? o.days_to_finish ?? daysOpen(o) : daysOpen(o)}
      </td>
      <td>
        {pending ? (
          <span className="unsaved-badge">Unsaved</span>
        ) : o.preview_path && thumbs[o.preview_path] ? (
          <img className="thumb" src={thumbs[o.preview_path]} alt="Proof" />
        ) : o.file_link ? (
          <span className="drive-badge" title={jobFiles(o).length > 1 ? `${jobFiles(o).length} files` : undefined}>
            {linkBadge(o.file_link)}{jobFiles(o).length > 1 ? ` ${jobFiles(o).length}` : ''}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="wrap">
      <div className="page-head head-center">
        <h1>Work Orders</h1>
        <div className="head-actions">
        <div className="search-wrap">
          <IconSearch />
          <input
            type="text"
            placeholder="Search WO #, customer, items, artist, material…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="head-actions-end">
        <div className="filter-menu" ref={filterRef}>
          <button
            ref={filterBtnRef}
            type="button"
            className={`filter-btn ${activeFilters ? 'on' : ''}`}
            onClick={toggleFilters}
            aria-expanded={filterOpen}
          >
            Filters{activeFilters ? <span className="filter-count">{activeFilters}</span> : null}
            <span className="filter-caret" aria-hidden>▾</span>
          </button>
          {filterOpen && filterPos && (
            <div
              className="filter-pop"
              style={{ top: filterPos.top, right: filterPos.right }}
            >
              <label className="filter-field">
                <span>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="all">All statuses</option>
                  <option value="todo" disabled={facet.statusCounts.todo === 0 && status !== 'todo'}>To Do</option>
                  <option value="in_progress" disabled={facet.statusCounts.in_progress === 0 && status !== 'in_progress'}>In progress</option>
                  <option value="finished" disabled={facet.statusCounts.finished === 0 && status !== 'finished'}>{STATUS_LABEL.finished}</option>
                  <option value="awaiting_print" disabled={facet.statusCounts.awaiting_print === 0 && status !== 'awaiting_print'}>{STATUS_LABEL.awaiting_print}</option>
                  <option value="printed" disabled={facet.statusCounts.printed === 0 && status !== 'printed'}>{STATUS_LABEL.printed} / released</option>
                </select>
              </label>

              <label className="filter-field">
                <span>Priority</span>
                <select value={urg} onChange={(e) => setUrg(e.target.value as typeof urg)}>
                  <option value="all">All priorities</option>
                  {URGENCY_OPTIONS.map((u) => (
                    <option key={u} value={u} disabled={facet.urgCounts[u] === 0 && urg !== u}>{URGENCY_LABEL[u]}</option>
                  ))}
                </select>
              </label>

              <label className="filter-field">
                <span>Due date</span>
                <select value={due} onChange={(e) => setDue(e.target.value as typeof due)}>
                  <option value="all">Any due date</option>
                  <option value="today" disabled={facet.dueCounts.today === 0 && due !== 'today'}>Due today</option>
                  <option value="week" disabled={facet.dueCounts.week === 0 && due !== 'week'}>Due this week</option>
                  <option value="overdue" disabled={facet.dueCounts.overdue === 0 && due !== 'overdue'}>Overdue</option>
                </select>
              </label>

              {unassignedCount > 0 && canCreateOrders(profile) && (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={artist === '__none__'}
                    onChange={(e) => setUnassignedOnly(e.target.checked)}
                  />
                  <span>Unassigned only</span>
                </label>
              )}

              {activeFilters > 0 && (
                <button
                  type="button"
                  className="filter-clear"
                  onClick={() => { setStatus('all'); setUrg('all'); setDue('all'); setArtist('all'); }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {canCreateOrders(profile) && (
          <button className="btn" onClick={() => setCreating(true)}>
            <IconPlus /> New work order
          </button>
        )}
        </div>
        </div>
      </div>

      {(archivedCount > 0 || hasCustomWidths || sort.key !== 'smart') && (
        <div className="toolbar">
          {archivedCount > 0 && (
            <label className="archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived ({archivedCount})
            </label>
          )}
          {sort.key !== 'smart' && (
            <button type="button" className="linkbtn reset-cols" onClick={() => setSort({ key: 'smart', dir: 'asc' })}
              title="Urgent first, then soonest deadline, then newest">
              Default order
            </button>
          )}
          {hasCustomWidths && (
            <button type="button" className="linkbtn reset-cols" onClick={() => setColW({})}>
              Reset column widths
            </button>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {canDrag && dragTip && orders.length > 0 && (
        <div className="drag-tip">
          <span>Tip: drag a task onto another status to move it — e.g. from In progress to Waiting to Print.</span>
          <button className="linkbtn" onClick={hideDragTip}>Got it</button>
        </div>
      )}
      {moveErr && (
        <div className="error">Could not move {moveErr} <button className="linkbtn" onClick={() => setMoveErr(null)}>Dismiss</button></div>
      )}

      {/* A filter that matches nothing shows a single, named empty state rather
          than a stack of empty status groups. */}
      {!loading && orders.length > 0 && shown.length === 0 ? (
        <div className="card empty">{emptyMessage}</div>
      ) : (
      /* One table for every group, so the whole list scrolls sideways as a
         single region with the columns lined up — not one scrollbar per
         status. Each status is its own <tbody>. */
      <div
        className="table-scroll"
        onMouseDown={startPan}
        tabIndex={0}
        role="region"
        aria-label="Work orders (arrow keys scroll sideways)"
      >
        <table className="glance flat grouped">
          {/* Twelve column slots. The group rows span all twelve, so when narrow
              screens hide columns the spare slots end up last — the CSS sizes
              those to nothing and Items takes the room. */}
          <colgroup>{Array.from({ length: 12 }, (_, i) => <col key={i} />)}</colgroup>
          <thead>
            <tr>
              {sortTh('WO #', 'wo_number')}
              {sortTh('Customer', 'customer')}
              {sortTh('Items', 'description')}
              {sortTh('Print area', 'site', 'Area')}
              {sortTh('Material', 'material')}
              {sortTh('Priority', 'urgency')}
              {sortTh('Artist', 'artist')}
              {sortTh('Given', 'date_given')}
              {sortTh('Due', 'date_due')}
              {sortTh('Finished', 'date_finished')}
              {sortTh('Days', 'days')}
              <th style={{ width: colW['file'] }}>
                File
                {resizeHandle('file', 'File')}
              </th>
            </tr>
          </thead>

          {(drafts.length > 0 || Object.keys(pendingEdits).length > 0) && (
            <tbody className="group-body">
              <tr className="group-row">
                <td colSpan={12}>
                  <button className="group-head" onClick={() => toggleFold('drafts')} aria-expanded={!folded.drafts}>
                    <IconChevron open={!folded.drafts} />
                    <span className="status-pill draft">Drafts</span>
                    <span className="group-count">{drafts.length + Object.keys(pendingEdits).length}</span>
                    <span className="group-hint">Not added yet — only you see these. Open one to carry on.</span>
                  </button>
                </td>
              </tr>
              {!folded.drafts && drafts.map((d) => {
                const title = jobTitle({ description: d.data.description ?? '', items: d.data.items }) || 'Untitled work order';
                return (
                  <tr key={d.id} className="draft-row" title={`Draft — not added yet. Saved ${savedAt(d.updated_at)}. Click to carry on with it.`}
                    onClick={() => { setOpenDraft(d); setCreating(true); }}>
                    <td className="wo-num"><span className="wo-line"><span className="row-dot draft" /><span className="wo-code">{d.data.wo_number || 'New'}</span></span></td>
                    <td className="desc">{d.data.client_name || '—'}</td>
                    <td className="desc">{title}</td>
                    <td className="desc">{d.data.target_site ? SITE_LABEL[d.data.target_site] : <span className="muted">Either</span>}</td>
                    <td className="desc">{d.data.material || '—'}</td>
                    <td><UrgencySelect orderId={d.id} level={d.data.urgency || null} editable={false} /></td>
                    <td className="desc">{nameOf(d.data.artist_id || null)}</td>
                    <td className="date-cell">{fmtDay(d.data.date_given)}</td>
                    <td className="date-cell">{fmtDay(d.data.date_due)}</td>
                    <td className="date-cell muted">—</td>
                    <td className="muted">—</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="linkbtn discard-btn"
                        onClick={() => { if (profile && confirm('Discard this draft? What was typed in it will be lost.')) void deleteDraft(profile.id, d.id); }}>
                        Discard
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!folded.drafts && Object.entries(pendingEdits).map(([id, p]) => {
                const o = orders.find((x) => x.id === id);
                return o
                  ? orderRow(o, true)
                  : (
                    <tr key={id} className="draft-row" onClick={() => setOpenId(id)}>
                      <td className="wo-num"><span className="wo-line"><span className="row-dot pending" /><span className="wo-code">{p.wo}</span></span></td>
                      <td className="muted" colSpan={11}>Changes kept on this device — open the task to save them.</td>
                    </tr>
                  );
              })}
            </tbody>
          )}

          {grouped.map((g) => (
            <tbody className="group-body" key={g.key} {...groupDrop(g.key)}>
              <tr className="group-row">
                <td colSpan={12}>
                  <button className="group-head" onClick={() => toggleFold(g.key)} aria-expanded={!folded[g.key]}>
                    <IconChevron open={!folded[g.key]} />
                    <span className={`status-pill ${g.cls}`}>{g.label}</span>
                    <span className="group-count">{g.rows.length}</span>
                  </button>
                </td>
              </tr>

              {!folded[g.key] && g.rows.map((o) => orderRow(o))}

              {!folded[g.key] && g.rows.length === 0 && (
                <tr className="row-empty">
                  <td colSpan={12}>Nothing here.</td>
                </tr>
              )}

              {!folded[g.key] && canCreateOrders(profile) && g.key !== 'released' && g.key !== 'to_review' && g.key !== 'for_release' && (
                <tr className="group-add-row">
                  <td colSpan={12}>
                    <button className="group-add" onClick={() => setCreating(true)}>
                      <IconPlus /> Add work order
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="card empty">No work orders yet. The receptionist adds the first one.</div>
      )}
      {loading && <div className="card empty">Loading…</div>}

      {open && (
        <TicketCard
          key={open.id}
          order={open}
          profiles={profiles}
          onClose={() => setOpenId(null)}
          onDuplicate={(o) => { setOpenId(null); setDupFrom(o); setCreating(true); }}
        />
      )}

      {missing && <MissingTask inTrash={missing.inTrash} onClose={() => setMissing(null)} />}

      {creating && (
        <NewOrder
          artists={assignable}
          operators={printers}
          taken={takenWoNumbers}
          from={dupFrom}
          draft={openDraft}
          onClose={() => { setCreating(false); setDupFrom(null); setOpenDraft(null); }}
        />
      )}
    </div>
  );
}
