import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import PrinterPills from './PrinterStatus';
import DurationInput from './DurationInput';
import { durationSecs, NO_DURATION, type Duration } from '../lib/duration';
import { printerOf } from '../lib/credits';
import { supabase } from '../lib/supabase';
import { useFileMarks, useProfiles, useWorkOrders, usePrinterStatus } from '../lib/data';
import { isAlarmBeepOn, playPrintAlarm, playPrintAlert } from '../lib/sound';
import { canEditOrder, canMarkPrinted, useSession } from '../lib/sessionContext';
import { isAdminRole, isReceptionRole, nameWithStatus, PRINT_STATE_LABEL, PROBLEM_LABEL, SITE_LABEL, URGENCY_LABEL, fmtDate, type PrintProblem, type PrintState, type Site, type WorkOrder, canSetPrinter } from '../lib/types';
import { jobFiles } from '../lib/links';
import { jobTitle } from '../lib/items';
import { summarizePrintDashboard } from '../lib/printDashboard';
import TicketCard from './TicketCard';
import QueueFiles from './QueueFiles';
import MissingTask from './MissingTask';
import { cleanPerSheet, columnsOf, INSTALL_LABEL, itemExtras, itemsOf, sheetsLabel, sheetsOf, sheetsTotal } from '../lib/items';

// A length of time to the second: "42s", "4m 07s", "1h 05m 12s".
function fmtSecs(secs: number): string {
  const t = Math.max(0, Math.round(secs));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}h ${p2(m)}m ${p2(s)}s` : m ? `${m}m ${p2(s)}s` : `${s}s`;
}

// A live countdown to the printer's expected finish time, to the second.
function etaLabel(eta: string, now: number): { text: string; over: boolean } {
  const secs = Math.round((new Date(eta).getTime() - now) / 1000);
  if (secs > 0) return { text: `ends in ${fmtSecs(secs)}`, over: false };
  if (secs === 0) return { text: 'ending now', over: false };
  return { text: `over by ${fmtSecs(-secs)}`, over: true };
}

// The status buttons the operator taps, in order. Waiting = not started (no state).
const STATES: { key: PrintState | null; label: string }[] = [
  { key: null, label: 'Waiting' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'printing', label: 'Printing' },
  { key: 'paused', label: 'On pause' },
];

type PrintTab = 'dashboard' | 'all';

/**
 * The print queue (PRD section 4). A screen at the printing area that updates
 * over realtime and chimes when a job lands. Each job is a folded card; unfold
 * it to drive the print — status, pages printed, the printer timer — and to
 * Return it (out of the queue) or Release the claim, each behind a confirm.
 */
export default function QueueScreen({ pendingOpen, onConsumed }: {
  /** A notification click routes here: open this task's ticket (049). */
  pendingOpen?: { kind: 'ticket' | 'chat'; id: string } | null;
  onConsumed?: () => void;
} = {}) {
  const { orders, trashed, loading, reload } = useWorkOrders();
  const { profiles } = useProfiles();
  const { profile } = useSession();
  const printers = usePrinterStatus();
  const mayOperate = canMarkPrinted(profile);
  const me = profile?.id;
  const isAdmin = isAdminRole(profile?.role);
  // Reception sees the print controls, sets priority and assigns the operator,
  // but only operators run the print (046).
  const isReception = isReceptionRole(profile?.role);

  const [activeTab, setActiveTab] = useState<PrintTab>('dashboard');
  const [flash, setFlash] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);            // full ticket modal
  const [missing, setMissing] = useState<{ inTrash: boolean } | null>(null);
  // A notification opens its task here; a task that is gone gets a pop-up.
  useEffect(() => {
    if (!pendingOpen || loading) return;
    setActiveTab('all');
    if (pendingOpen.kind === 'ticket') {
      if (orders.some((o) => o.id === pendingOpen.id)) setOpenId(pendingOpen.id);
      else setMissing({ inTrash: trashed.some((o) => o.id === pendingOpen.id) });
    }
    onConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, loading]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // unfolded cards
  // Every printer sees every task (049): the queue opens on All Tasks; the
  // Office / Production tabs narrow it.
  const [site, setSite] = useState<Site | 'all'>('all');
  const [groupBy, setGroupBy] = useState<'none' | 'priority' | 'material' | 'deadline'>('none');
  // The printing time being typed, per job: hours, minutes and seconds.
  const [dur, setDur] = useState<Record<string, Duration>>({});
  const [pcs, setPcs] = useState<Record<string, string>>({});
  const [totals, setTotals] = useState<Record<string, string>>({});     // total pages typed (qty)
  const [itemPcs, setItemPcs] = useState<Record<string, string>>({});   // `${id}:${index}` → pages typed
  // Pages per item just saved, shown until the live update brings them back —
  // so a quick second "Set pages" never resends an old count. Only used while
  // the job still holds what it had at the time of saving (`base`).
  const [justSaved, setJustSaved] = useState<Record<string, { base: string; val: number[] }>>({});
  const [probFor, setProbFor] = useState<string | null>(null);           // the job whose problem form is open
  const [probKind, setProbKind] = useState<PrintProblem | null>(null);
  const [probNote, setProbNote] = useState('');

  // The queue is left open at the printing area: keep the screen awake so it
  // never sleeps through an alarm (browsers that support it; released on leaving).
  useEffect(() => {
    if (activeTab !== 'all') return;
    let lock: { release: () => Promise<void> } | null = null;
    let gone = false;
    const get = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === 'visible' && !gone) lock = await wl.request('screen');
      } catch { /* not allowed here (battery saver, unsupported) — the queue still works */ }
    };
    void get();
    const onVis = () => { if (document.visibilityState === 'visible') void get(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { gone = true; document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, [activeTab]);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick so every open queue keeps the countdowns current — every second while
  // a printer timer is running, so the seconds count down live.
  const timerRunning = activeTab === 'all' && orders.some((o) => o.status === 'awaiting_print' && o.print_eta && o.print_state !== 'paused');
  useEffect(() => {
    if (activeTab !== 'all') return;
    const t = setInterval(() => setNow(Date.now()), timerRunning ? 1000 : 15000);
    return () => clearInterval(t);
  }, [activeTab, timerRunning]);

  const nameOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.full_name]));
    return (id: string | null) => (id ? m.get(id) ?? '…' : 'Unassigned');
  }, [profiles]);

  // Operators an admin can reassign a print to.
  const operators = useMemo(() => profiles.filter((p) => p.role === 'operator' && p.active), [profiles]);

  // Jobs still to print: anything bumped to priority first, then soonest due.
  const dashboardSummary = useMemo(() => summarizePrintDashboard(orders), [orders]);
  const allActive = dashboardSummary.waiting;
  const active = useMemo(
    () => allActive.filter((o) => site === 'all' || o.target_site === null || o.target_site === site),
    [allActive, site],
  );

  // Opened / printed marks on the files of the jobs waiting to print.
  const marks = useFileMarks(useMemo(() => active.map((o) => o.id), [active]));

  // Finished off the press today — kept on the board with a Printed tag.
  const allPrintedToday = dashboardSummary.printedToday;
  const printedToday = useMemo(
    () => allPrintedToday.filter((o) => {
      const printedSite = o.printed_site ?? o.target_site;
      return site === 'all' || printedSite === null || printedSite === site;
    }),
    [allPrintedToday, site],
  );

  // Alarm + flash when a job joins the queue — but not on first load. The alarm
  // is a distinct three-beep buzzer (see playPrintAlarm) so operators recognise
  // "a file is here to print" without looking.
  const seen = useRef<Set<string> | null>(null);
  const seenSite = useRef(site);
  useEffect(() => {
    if (loading) return;
    const ids = new Set(active.map((o) => o.id));
    if (activeTab !== 'all') {
      seen.current = ids;
      seenSite.current = site;
      return;
    }

    // Switching the site filter (All / Office / Production) changes the visible
    // list but isn't a new arrival — resync quietly, no alarm.
    if (seenSite.current !== site) {
      seenSite.current = site;
      seen.current = ids;
      return;
    }

    const isNew = !!seen.current && [...ids].some((id) => !seen.current!.has(id));
    seen.current = ids;
    if (isNew) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 2500);
      // Operators get the app-wide alarm (twice + voice, repeating) from
      // PrintAlarm; anyone else watching the queue hears it once.
      if (profile?.role !== 'operator') {
        if (isAlarmBeepOn()) playPrintAlarm();
        else playPrintAlert();                     // voice-only device: say it instead
      }
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeTab, loading, site]);

  // Every queue write goes through here so a rejected action says so instead of
  // looking like a dead button.
  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    setErr(null);
    const { error } = await p;
    if (error) setErr(error.message);
    // Show the change at once — don't wait on the live feed, which can lag on
    // a weak connection (a reassigned operator would look unchanged meanwhile).
    else void reload();
  }
  const setState = (id: string, state: PrintState | null) =>
    run(supabase.from('work_orders').update({ print_state: state }).eq('id', id));
  const markPrinted = (id: string) =>
    run(supabase.from('work_orders').update({ printed_at: new Date().toISOString(), print_state: null, print_eta: null }).eq('id', id));
  const undoPrinted = (id: string) =>
    run(supabase.from('work_orders').update({ printed_at: null }).eq('id', id));
  const assignMe = (id: string) => run(supabase.from('work_orders').update({ operator_id: me }).eq('id', id));
  const reassign = (id: string, opId: string | null) =>
    run(supabase.from('work_orders').update({ operator_id: opId }).eq('id', id));
  const togglePriority = (id: string, on: boolean) =>
    run(supabase.from('work_orders').update({ priority: on }).eq('id', id));
  async function logPieces(id: string, cap: number | null) {
    const raw = pcs[id];
    if (raw == null || raw === '') return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return;
    const capped = cap != null ? Math.min(n, cap) : n;
    setPcs((m) => { const c = { ...m }; delete c[id]; return c; });
    await run(supabase.from('work_orders').update({ printed_qty: capped }).eq('id', id));
  }
  // Total pages (qty) from the queue, the same field as the ticket's Quantity:
  // empty clears it, else a whole number of 0 or more.
  async function saveTotal(id: string) {
    const raw = totals[id];
    if (raw == null) return;
    const qty = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)));
    if (qty != null && !Number.isFinite(qty)) return;
    setTotals((m) => { const c = { ...m }; delete c[id]; return c; });
    await run(supabase.from('work_orders').update({ qty }).eq('id', id));
  }
  // Sheets to print (2026-10-27): an item laid out several to a sheet ("12 icons
  // per sheet") counts its sheets, not its pieces — 120 icons = 10 sheets. A job
  // with no items keeps its own page total.
  const pagesOf = (o: WorkOrder): number | null => ((o.items?.length ?? 0) > 0 ? sheetsTotal(o.items ?? []) : o.qty);
  // Pages per item (048): what is typed for each item, else what is saved.
  const itemDone = (o: WorkOrder, i: number) => {
    const js = justSaved[o.id];
    const fromServer = JSON.stringify(o.printed_items ?? []);
    return Number((js && js.base === fromServer ? js.val : o.printed_items ?? [])[i] ?? 0);
  };
  const itemShown = (o: WorkOrder, i: number) => {
    const raw = itemPcs[`${o.id}:${i}`];
    const n = raw != null && raw !== '' ? parseInt(raw, 10) : itemDone(o, i);
    return Number.isFinite(n) ? n : 0;
  };
  function bumpItem(o: WorkOrder, i: number, delta: number) {
    const it = o.items?.[i];
    const max = it ? sheetsOf(it) : null;
    let next = itemShown(o, i) + delta;
    if (next < 0) next = 0;
    if (max != null && next > max) next = max;
    setItemPcs((m) => ({ ...m, [`${o.id}:${i}`]: String(next) }));
  }
  async function saveItemPages(o: WorkOrder) {
    const items = o.items ?? [];
    const next = items.map((it, i) => {
      const n = Math.max(0, itemShown(o, i));
      const max = sheetsOf(it);
      return max != null ? Math.min(n, max) : n;
    });
    const base = JSON.stringify(o.printed_items ?? []);
    setErr(null);
    const { error } = await supabase.from('work_orders').update({ printed_items: next }).eq('id', o.id);
    if (error) { setErr(error.message); return; }
    setJustSaved((m) => ({ ...m, [o.id]: { base, val: next } }));
    setItemPcs((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${o.id}:`))));
  }
  const openProblem = (id: string) => { setProbFor(id); setProbKind(null); setProbNote(''); };
  async function reportProblem(o: WorkOrder) {
    if (!probKind) return;
    await run(supabase.from('work_orders').update({ print_problem: probKind, print_problem_note: probNote.trim() || null }).eq('id', o.id));
    setProbFor(null);
  }
  const clearProblem = (o: WorkOrder) => run(supabase.from('work_orders').update({ print_problem: null }).eq('id', o.id));

  // The ◄ / ► steppers nudge the page field (native number arrows are too small).
  function bumpPcs(id: string, delta: number, current: number, max: number | null) {
    setPcs((m) => {
      const raw = m[id];
      const base = raw != null && raw !== '' ? parseInt(raw, 10) : current;
      let next = (Number.isFinite(base) ? base : 0) + delta;
      if (next < 0) next = 0;
      if (max != null && next > max) next = max;
      return { ...m, [id]: String(next) };
    });
  }
  async function setTimer(id: string) {
    const secs = durationSecs(dur[id]);
    if (secs <= 0) return;
    setDur((x) => ({ ...x, [id]: NO_DURATION }));
    await run(supabase.from('work_orders').update({ print_eta: new Date(Date.now() + secs * 1000).toISOString() }).eq('id', id));
  }
  const clearTimer = (id: string) => run(supabase.from('work_orders').update({ print_eta: null, print_pause_left: null }).eq('id', id));

  const toggle = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }));

  // Grouping clusters the queue — same media, or same deadline window — so the
  // operator can batch. Within a group the usual priority-then-due order holds;
  // nothing about the jobs changes, only how the list reads.
  const DAY = 86400000;
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const matOf = (o: { material: string | null }) => o.material?.trim() || 'Unspecified';
  const groupOf = (o: WorkOrder): { key: string; rank: number } => {
    if (groupBy === 'material') return { key: matOf(o), rank: 0 };
    if (groupBy === 'priority') {
      const urgentFirst: Record<string, number> = { urgent: 0, high: 1, mid: 2, low: 3 };
      return o.urgency
        ? { key: URGENCY_LABEL[o.urgency], rank: urgentFirst[o.urgency] }
        : { key: 'No priority', rank: 4 };
    }
    const t = o.date_due ? new Date(o.date_due + 'T00:00:00').getTime() : null;
    if (t == null) return { key: 'No deadline', rank: 5 };
    const s = startOfToday();
    if (t < s) return { key: 'Overdue', rank: 0 };
    if (t < s + DAY) return { key: 'Due today', rank: 1 };
    if (t < s + 2 * DAY) return { key: 'Due tomorrow', rank: 2 };
    if (t < s + 7 * DAY) return { key: 'This week', rank: 3 };
    return { key: 'Later', rank: 4 };
  };
  // Red once overdue, amber within three days — the deadline cue on each card.
  const dueStyle = (o: WorkOrder) => {
    const t = o.date_due ? new Date(o.date_due + 'T00:00:00').getTime() : null;
    if (t == null) return undefined;
    const s = startOfToday();
    if (t < s) return { color: 'var(--vim-red)', fontWeight: 700 };
    if (t <= s + 3 * DAY) return { color: 'var(--amber)', fontWeight: 700 };
    return undefined;
  };
  const queueList = groupBy === 'none'
    ? active
    : [...active].sort((a, b) => {
        const ga = groupOf(a), gb = groupOf(b);
        return (ga.rank - gb.rank)
          || ga.key.localeCompare(gb.key)
          || Number(b.priority) - Number(a.priority)
          || (a.date_due ?? '9999').localeCompare(b.date_due ?? '9999')
          || (a.queued_at ?? '').localeCompare(b.queued_at ?? '');
      });

  const printingNow = dashboardSummary.printingNow;
  const dashboardPreview = allActive.slice(0, 5);

  const siteSwitch = (
    <div className="queue-site">
      {(['all', 'office', 'production'] as const).map((s) => (
        <button key={s} aria-current={site === s} onClick={() => setSite(s)}>
          {s === 'all' ? 'All Tasks' : SITE_LABEL[s]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="wrap print-page">
      <div className="page-head">
        <div>
          <h1>Print Queue</h1>
          <p className="sub">Live print work across the Office and Production areas.</p>
        </div>
      </div>

      <div className="inventory-tabs print-tabs" role="tablist" aria-label="Print Queue sections">
        <button
          type="button"
          role="tab"
          id="print-dashboard-tab"
          aria-selected={activeTab === 'dashboard'}
          aria-controls="print-dashboard-panel"
          className={activeTab === 'dashboard' ? 'inventory-tab active' : 'inventory-tab'}
          onClick={() => setActiveTab('dashboard')}
        >
          Print Dashboard
        </button>
        <button
          type="button"
          role="tab"
          id="print-all-tab"
          aria-selected={activeTab === 'all'}
          aria-controls="print-all-panel"
          className={activeTab === 'all' ? 'inventory-tab active' : 'inventory-tab'}
          onClick={() => setActiveTab('all')}
        >
          All Print
        </button>
      </div>

      {activeTab === 'dashboard' ? (
        <section className="inventory-tab-panel print-dashboard" role="tabpanel" id="print-dashboard-panel" aria-labelledby="print-dashboard-tab" tabIndex={0}>
          <section className="card print-dashboard-printers">
            <div className="inventory-section-heading">
              <div>
                <h2>Printer status</h2>
                <p className="muted">Current status for both printing areas.</p>
              </div>
            </div>
            {printers.loading ? (
              <p className="muted">Loading printer status…</p>
            ) : !printers.available ? (
              <p className="muted" role="status">Printer status is not configured in this database yet.</p>
            ) : printers.error ? (
              <div className="error" role="alert">
                Couldn&rsquo;t load printer status. {printers.error}{' '}
                <button type="button" className="linkbtn" onClick={() => void printers.reload()}>Retry</button>
              </div>
            ) : (
              <PrinterPills
                rows={printers.rows}
                canChange={canSetPrinter(profile?.role)}
                onChanged={() => { void printers.reload(); }}
              />
            )}
          </section>

          <div className="print-dashboard-summary">
            <div className="card inventory-stat">
              <span>Waiting to print</span>
              <strong>{loading ? '—' : allActive.length}</strong>
            </div>
            <div className="card inventory-stat">
              <span>Printing now</span>
              <strong>{loading ? '—' : printingNow}</strong>
            </div>
            <div className="card inventory-stat">
              <span>Printed today</span>
              <strong>{loading ? '—' : allPrintedToday.length}</strong>
            </div>
          </div>

          <section className="card print-dashboard-queue">
            <div className="inventory-section-heading">
              <div>
                <h2>Next to print</h2>
                <p className="muted">{loading ? 'Loading queue…' : `${allActive.length} ${allActive.length === 1 ? 'job' : 'jobs'} waiting across both areas.`}</p>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setActiveTab('all')}>View all print</button>
            </div>
            {err && <div className="error" role="alert">{err}</div>}
            {loading ? (
              <p className="muted">Loading print jobs…</p>
            ) : dashboardPreview.length === 0 ? (
              <div className="inventory-empty">Nothing is waiting to print.</div>
            ) : (
              <div className="print-dashboard-list">
                {dashboardPreview.map((order) => (
                  <div className="print-dashboard-row" key={order.id}>
                    <div className="print-dashboard-job">
                      <strong>{order.wo_number}</strong>
                      <span>{order.client_name || order.description}</span>
                    </div>
                    <span className="print-dashboard-site">{SITE_LABEL[order.target_site ?? 'office']}</span>
                    <span className="print-dashboard-state">
                      <i className={`pq-dot ${order.print_state ?? 'waiting'}`} />
                      {order.print_state ? PRINT_STATE_LABEL[order.print_state] : 'Waiting'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : (
        <section className="inventory-tab-panel" role="tabpanel" id="print-all-panel" aria-labelledby="print-all-tab" tabIndex={0}>
      <div className="toolbar queue-toolbar">
        {siteSwitch}
        <div className="queue-filters">
          <select
            className="queue-groupsel"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'none' | 'priority' | 'material' | 'deadline')}
          >
            <option value="none">No grouping</option>
            <option value="priority">Group by priority</option>
            <option value="material">Group by material</option>
            <option value="deadline">Group by deadline</option>
          </select>
        </div>
      </div>

      {err && (
        <div className="error" style={{ marginBottom: 12 }}>
          {err} <button className="linkbtn" onClick={() => setErr(null)}>Dismiss</button>
        </div>
      )}

      <div className={`queue-panel ${flash ? 'flash' : ''}`}>
        {active.length === 0 ? (
          <div className="queue-empty">
            <p className="queue-empty-title">Nothing waiting.</p>
            <p>New jobs appear here when an admin or reception sends a finished job to print.</p>
          </div>
        ) : (
          <div className="pq-cards">
            {queueList.map((o, idx) => {
              const open = !!expanded[o.id];
              const state = o.print_state;
              const claimer = o.operator_id;
              // Reception and admins run any job; an operator runs the one they are on.
              const canDrive = mayOperate && (claimer === me || isAdmin || isReception);
              // The operator's controls: status, pages and timer.
              const tools = (
                <>
                          <div className="pq-section-label">Current status</div>
                          <div className="pq-controls">
                            {STATES.map((s) => (
                              <button
                                key={s.label}
                                className={`pq-btn ${s.key ?? 'waiting'} ${state === s.key ? 'on' : ''}`}
                                onClick={() => setState(o.id, s.key)}
                              >
                                {s.label}
                              </button>
                            ))}
                            <button className="pq-done" onClick={() => markPrinted(o.id)}>✓ Finish</button>
                          </div>

                          <div className="pq-section-label">Page printed</div>
                          {(o.items?.length ?? 0) > 0 ? (
                            <div className="pq-items">
                              {(o.items ?? []).map((it, i) => {
                                const done = itemDone(o, i);
                                const target = sheetsOf(it);
                                const per = cleanPerSheet(it.per_sheet);
                                const full = target != null && done >= target;
                                return (
                                  <div className={`pq-item ${full ? 'done' : ''}`} key={i}>
                                    <span className="pq-item-name" title={it.name}>
                                      {it.name}
                                      {it.install && <span className="pq-install">{INSTALL_LABEL.yes}</span>}
                                      {itemExtras(it, columnsOf(o)).map(([label, value]) => (
                                        <span className="item-extras" key={label}>{label}: {value}</span>
                                      ))}
                                      {per && it.qty != null && (
                                        <span className="pq-per-sheet" title={`${it.qty} pieces, ${per} on each sheet`}>{sheetsLabel(target)} · {it.qty} pcs, {per}/sheet</span>
                                      )}
                                    </span>
                                    <span className="pq-item-ctl">
                                      <button className="pq-step" onClick={() => bumpItem(o, i, -1)} aria-label={`One less ${it.name}`}>◄</button>
                                      <input
                                        className="pq-mins"
                                        type="number"
                                        min="0"
                                        max={target ?? undefined}
                                        aria-label={`Pages printed of ${it.name}`}
                                        value={itemPcs[`${o.id}:${i}`] ?? String(done)}
                                        onChange={(e) => setItemPcs((m) => ({ ...m, [`${o.id}:${i}`]: e.target.value }))}
                                        onKeyDown={(e) => { if (e.key === 'Enter') saveItemPages(o); }}
                                      />
                                      <button className="pq-step" onClick={() => bumpItem(o, i, 1)} aria-label={`One more ${it.name}`}>►</button>
                                      <span className="pq-mins-label">{done}/{target ?? '—'}{full ? ' ✓' : ''}</span>
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="pq-controls">
                                <button className="pq-btn" onClick={() => saveItemPages(o)}>Set pages</button>
                                {pagesOf(o) != null && (
                                  <span className="pq-mins-label">Total {o.printed_qty}/{pagesOf(o)} · {Math.max(0, (pagesOf(o) ?? 0) - o.printed_qty)} left</span>
                                )}
                              </div>
                            </div>
                          ) : o.qty != null ? (
                            <div className="pq-controls">
                              <button className="pq-step" onClick={() => bumpPcs(o.id, -1, o.printed_qty, o.qty)} aria-label="One less">◄</button>
                              <input
                                className="pq-mins"
                                type="number"
                                min="0"
                                max={o.qty}
                                value={pcs[o.id] ?? String(o.printed_qty)}
                                onChange={(e) => setPcs((m) => ({ ...m, [o.id]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') logPieces(o.id, o.qty); }}
                              />
                              <button className="pq-step" onClick={() => bumpPcs(o.id, 1, o.printed_qty, o.qty)} aria-label="One more">►</button>
                              <button className="pq-btn" onClick={() => logPieces(o.id, o.qty)}>Set page</button>
                              <span className="pq-mins-label">{o.printed_qty}/{o.qty} · {o.qty - o.printed_qty} left</span>
                            </div>
                          ) : (
                            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                              Set the quantity on the ticket to track pages.
                            </p>
                          )}

                          <div className="pq-section-label">Printing time</div>
                          <div className="pq-controls">
                            <DurationInput value={dur[o.id]} onChange={(d) => setDur((x) => ({ ...x, [o.id]: d }))}
                              onEnter={() => setTimer(o.id)} />
                            <button className="pq-btn" onClick={() => setTimer(o.id)}>Set timer</button>
                            {o.print_eta && <button className="pq-release" onClick={() => clearTimer(o.id)}>clear</button>}
                          </div>
                </>
              );
              const eta = o.print_eta ? etaLabel(o.print_eta, now) : null;
              const grp = groupOf(o).key;
              const showHead = groupBy !== 'none' && (idx === 0 || groupOf(queueList[idx - 1]).key !== grp);
              return (
                <Fragment key={o.id}>
                  {showHead && <div className="pq-mat-head">{grp}</div>}
                  <div className={`pq-card ${open ? 'open' : ''} ${o.priority ? 'is-priority' : ''}`}>
                  {/* Folded header — labelled fields, click to unfold. */}
                  <div
                    className="pq-card-head"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(o.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') toggle(o.id); }}
                  >
                    <div className="pq-fields">
                      <div className="pq-field">
                        <div className="pq-field-l">Status</div>
                        <div className="pq-field-v"><i className={`pq-dot ${state ?? 'waiting'}`} />{state ? PRINT_STATE_LABEL[state] : 'Waiting'}</div>
                      </div>
                      <div className="pq-field wo">
                        <div className="pq-field-l">WO number</div>
                        <div className="pq-field-v strong">{o.wo_number}</div>
                      </div>
                      {open && (
                        <div className="pq-field grow">
                          <div className="pq-field-l">Task title</div>
                          <div className="pq-field-v">{jobTitle(o) || o.description}</div>
                        </div>
                      )}
                      {o.client_name && (
                        <div className="pq-field">
                          <div className="pq-field-l">Customer</div>
                          <div className="pq-field-v">{o.client_name}</div>
                        </div>
                      )}
                      {o.material && (
                        <div className="pq-field">
                          <div className="pq-field-l">Material</div>
                          <div className="pq-field-v">{o.material}</div>
                        </div>
                      )}
                      {o.laminating && (
                        <div className="pq-field">
                          <div className="pq-field-l">Laminating</div>
                          <div className="pq-field-v">{o.laminating}</div>
                        </div>
                      )}
                      <div className="pq-field">
                        <div className="pq-field-l">Who is assigned</div>
                        <div className="pq-field-v">{claimer ? nameOf(claimer) : 'Unassigned'}</div>
                      </div>
                      <div className="pq-field">
                        <div className="pq-field-l">Total printing time</div>
                        <div className={`pq-field-v ${o.print_state !== 'paused' && eta?.over ? 'over' : ''}`}>
                          {o.print_state === 'paused'
                            ? (o.print_pause_left != null ? `⏸ ${fmtSecs(o.print_pause_left)} left` : '⏸ paused')
                            : eta ? eta.text : '—'}
                        </div>
                      </div>
                      <div className="pq-field">
                        <div className="pq-field-l">Pages</div>
                        <div className="pq-field-v">{pagesOf(o) != null ? `${o.printed_qty}/${pagesOf(o)}` : '—'}</div>
                      </div>
                      <div className="pq-field">
                        <div className="pq-field-l">Deadline</div>
                        <div className="pq-field-v" style={dueStyle(o)}>{fmtDate(o.date_due)}</div>
                      </div>
                    </div>
                    <div className="pq-head-right">
                      {mayOperate || isReception ? (
                        <button
                          className={`pq-star ${o.priority ? 'on' : ''}`}
                          title={o.priority ? 'Remove priority' : 'Bump to the top'}
                          onClick={(e) => { e.stopPropagation(); togglePriority(o.id, !o.priority); }}
                        >
                          {o.priority ? '★' : '☆'}
                        </button>
                      ) : (
                        o.priority && <span className="pq-star on" aria-hidden>★</span>
                      )}
                      {open && <span className="pq-chev">▲</span>}
                    </div>
                  </div>

                  {(o.print_problem || o.return_note || o.operator_note?.trim() || !o.file_link) && (
                    <div className="pq-alerts" onClick={(e) => e.stopPropagation()}>
                      {o.operator_note?.trim() && (
                        <div className="pq-alert opnote">
                          <span><strong>Note for the operator:</strong> {o.operator_note}</span>
                        </div>
                      )}
                      {!o.file_link && !o.operator_note?.trim() && (
                        <div className="pq-alert opnote">
                          <span><strong>No file on this task.</strong> Ask reception what to print.</span>
                        </div>
                      )}
                      {o.print_problem && (
                        <div className="pq-alert problem" role="status">
                          <span>
                            <strong>⚠ {PROBLEM_LABEL[o.print_problem]}</strong>
                            {o.print_problem_note ? ` — ${o.print_problem_note}` : ''}
                            <span className="pq-alert-meta">
                              {' · '}{nameOf(o.print_problem_by ?? null)}
                              {o.print_problem_at ? `, ${new Date(o.print_problem_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : ''}
                            </span>
                          </span>
                          {(mayOperate || isReception) && (
                            <button className="pq-btn" onClick={() => clearProblem(o)}>Problem solved</button>
                          )}
                        </div>
                      )}
                      {o.return_note && (
                        <div className="pq-alert returned">
                          <span><strong>↩ Returned by reception:</strong> {o.return_note}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Unfolded panel. */}
                  {open && (
                    <div className="pq-card-body" onClick={(e) => e.stopPropagation()}>
                      {/* The items, with installation, for anyone not running the print
                          (the one running it sees them in Page printed). */}
                      {(o.items?.length ?? 0) > 0 && !canDrive && (
                        <div className="pq-itemlist">
                          <div className="pq-section-label">Items</div>
                          <ul>
                            {(o.items ?? []).map((it, i) => (
                              <li key={i}>
                                <span className="pq-item-name">{it.name}</span>
                                {it.qty != null && <span className="pq-mins-label"> ×{it.qty}{cleanPerSheet(it.per_sheet) ? ` (${sheetsLabel(sheetsOf(it))})` : ''}</span>}
                                {it.install && <span className="pq-install">{INSTALL_LABEL.yes}</span>}
                                {itemExtras(it, columnsOf(o)).map(([label, value]) => (
                                  <span className="item-extras" key={label}>{label}: {value}</span>
                                ))}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(o.notes?.trim() || ((o.items?.length ?? 0) > 0 && o.description?.trim())) && (
                        <div className="pq-notes">
                          {o.notes?.trim() && (
                            <div><div className="pq-section-label">Client notes</div><p>{o.notes}</p></div>
                          )}
                          {(o.items?.length ?? 0) > 0 && o.description?.trim() && (
                            <div><div className="pq-section-label">Job description</div><p>{o.description}</p></div>
                          )}
                        </div>
                      )}
                      {/* Total pages: whoever may edit the ticket may edit it here too.
                          With items it is their sum, changed on the ticket (as there). */}
                      {canEditOrder(profile, o) && (
                        itemsOf(o).length > 0 ? (
                          <div className="pq-controls">
                            <span className="pq-section-label" style={{ margin: 0 }}>Total pages (from items)</span>
                            <span className="pq-mins-label">{sheetsTotal(itemsOf(o)) ?? '—'} · change the items on the ticket</span>
                          </div>
                        ) : (
                          <div className="pq-controls">
                            <span className="pq-section-label" style={{ margin: 0 }}>Total pages</span>
                            <input
                              className="pq-mins"
                              type="number"
                              min="0"
                              step="1"
                              aria-label="Total pages"
                              value={totals[o.id] ?? (o.qty != null ? String(o.qty) : '')}
                              onChange={(e) => setTotals((m) => ({ ...m, [o.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveTotal(o.id); }}
                            />
                            <button className="pq-btn" onClick={() => saveTotal(o.id)}>Edit total pages</button>
                          </div>
                        )
                      )}
                      {isReception || isAdmin ? (
                        <>
                          <div className="pq-controls">
                            <span className="pq-section-label" style={{ margin: 0 }}>Assigned to</span>
                            <select
                              className="pq-select"
                              value={claimer ?? ''}
                              onChange={(e) => reassign(o.id, e.target.value || null)}
                            >
                              <option value="">— Not assigned —</option>
                              {claimer && !operators.some((op) => op.id === claimer) && (
                                <option value={claimer}>{nameOf(claimer)}</option>
                              )}
                              {operators.map((op) => (
                                <option key={op.id} value={op.id}>{nameWithStatus(op)}</option>
                              ))}
                            </select>
                          </div>
                          {tools}
                        </>
                      ) : !mayOperate ? (
                        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                          Only operators and reception run a job through the print queue.
                        </p>
                      ) : !claimer ? (
                        <div className="pq-controls">
                          <button className="pq-assign" onClick={() => assignMe(o.id)}>Assign to me</button>
                        </div>
                      ) : !canDrive ? (
                        <div className="pq-controls">
                          <span className="pq-who">{nameOf(claimer)} is printing this.</span>
                          <button className="pq-btn" onClick={() => assignMe(o.id)}>Take over</button>
                        </div>
                      ) : (
                        <>
                          {tools}
                        </>
                      )}

                      {/* Something wrong at the press — an operator, reception or an admin can say so. */}
                      {mayOperate && !o.print_problem && (probFor === o.id ? (
                        <div className="pq-problem-form">
                          <div className="pq-section-label">What's wrong?</div>
                          <div className="pq-controls">
                            {(Object.keys(PROBLEM_LABEL) as PrintProblem[]).map((k) => (
                              <button key={k} className={`pq-btn ${probKind === k ? 'on' : ''}`} onClick={() => setProbKind(k)}>
                                {PROBLEM_LABEL[k]}
                              </button>
                            ))}
                          </div>
                          <input
                            className="pq-note-input"
                            maxLength={500}
                            placeholder="Add a note (optional) — e.g. which item, what is broken"
                            value={probNote}
                            onChange={(e) => setProbNote(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') reportProblem(o); }}
                          />
                          <div className="pq-controls">
                            <button className="pq-btn danger" disabled={!probKind} onClick={() => reportProblem(o)}>Report problem</button>
                            <button className="pq-release" onClick={() => setProbFor(null)}>Cancel</button>
                            <span className="pq-mins-label">It shows on the board, the ticket and here for everyone; a running timer pauses.</span>
                          </div>
                        </div>
                      ) : (
                        <div className="pq-controls">
                          <button className="pq-btn problem" onClick={() => openProblem(o.id)}>⚠ Report a problem</button>
                        </div>
                      ))}

                      <QueueFiles files={jobFiles(o)} wo={o.wo_number} orderId={o.id} marks={marks.byOrder[o.id]}
                        canMark={mayOperate && marks.available} nameOf={nameOf} onMarked={marks.reload} />
                      <div className="pq-card-foot">
                        <button className="linkbtn" onClick={() => setOpenId(o.id)}>Ticket details</button>
                      </div>

                    </div>
                  )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {printedToday.length > 0 && (
        <div className="pq-printed">
          <div className="pq-printed-head">Done printing today · {printedToday.length}</div>
          {printedToday.map((o) => (
            <div key={o.id} className="queue-row printed clickable" onClick={() => setOpenId(o.id)}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(o.id); }}>
              <span className="pq-tag printed">Done Printing</span>
              <div className="queue-row-main">
                <div className="queue-row-title">
                  <span className="n">{o.wo_number}</span>
                  <span className="d">{o.description}</span>
                </div>
                <div className="a">
                  {nameOf(printerOf(o))}
                  {o.printed_at ? ` · ${new Date(o.printed_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : ''}
                  {pagesOf(o) != null ? ` · ${pagesOf(o)} pages` : ''}
                </div>
              </div>
              {mayOperate && (
                <button className="linkbtn" onClick={(e) => { e.stopPropagation(); undoPrinted(o.id); }}>Undo</button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        Leave this open at the printing area. Unfold a job to drive it — new files arrive on their
        own with a chime. Bookmark <code>#queue</code> to reopen straight into it.
      </p>
        </section>
      )}
      {missing && <MissingTask inTrash={missing.inTrash} onClose={() => setMissing(null)} />}
      {openId && (() => {
        const o = orders.find((x) => x.id === openId) ?? null;
        return o && <TicketCard key={o.id} order={o} profiles={profiles} onClose={() => setOpenId(null)} />;
      })()}
    </div>
  );
}
