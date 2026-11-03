import { useMemo, useState } from 'react';
import { useCreditEvents, useFileCreditEventsSince, useProfiles, useWorkOrders } from '../lib/data';
import { credits, phDay } from '../lib/credits';
import { useSession } from '../lib/sessionContext';
import { isAdminRole, SITE_LABEL, STATUS_LABEL } from '../lib/types';
import { finishedTrend, isOverdue, windowFirstDay, windowStartIso } from '../lib/dashboardStats';
import { ProductionFlow, ShareBar, TrendBars } from './WorkloadCharts';
import Report from './Report';
import '../workload.css';
import ArtistDashboard from './ArtistDashboard';
import OperatorDashboard from './OperatorDashboard';
import ReceptionDashboard from './ReceptionDashboard';
import SupplyDashboard from './SupplyDashboard';

type Window = '30' | '90' | 'all';

const RANGES: { id: Window; label: string }[] = [
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All time' },
];

const TODAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });

/**
 * PRD section 4 — who is carrying more work than the others, and how long
 * jobs actually take. Everything here is counted from the work orders
 * themselves, so there is nothing to keep up to date by hand.
 */
function TeamDashboard({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { orders } = useWorkOrders();
  const { profiles } = useProfiles();
  const { profile } = useSession();
  const [window, setWindow] = useState<Window>('30');

  // One window for every number on this screen: the last 30 or 90 shop days
  // (Philippine time), today included — the same days the credits, the file
  // credits and the chart count.
  const [today] = useState(() => phDay(new Date().toISOString()) ?? '');
  const firstDay = windowFirstDay(window, today);
  const inWindow = useMemo(
    () => (firstDay ? orders.filter((o) => o.date_given >= firstDay) : orders),
    [orders, firstDay],
  );

  // Deactivated artists still appear while they have work in the window —
  // dropping them would quietly rewrite the period's history.
  const artists = useMemo(
    () =>
      profiles.filter(
        (p) =>
          p.role === 'artist' &&
          (p.active || inWindow.some((o) => o.artist_id === p.id)),
      ),
    [profiles, inWindow],
  );

  // Who gets the credit, counted the same way as the Monthly Report: the artist
  // from the first time the art was done (a later Send back does not take it
  // away), the print to the operator who took the job, each on the day it happened.
  const stamp = useMemo(() => `${orders.length}:${orders.reduce((m, o) => (o.updated_at > m ? o.updated_at : m), '')}`, [orders]);
  const events = useCreditEvents(stamp);
  const credit = useMemo(() => {
    const names = new Map(profiles.map((p) => [p.id, p.full_name]));
    return credits(orders, (day) => !!day && (!firstDay || day >= firstDay), (id) => (id ? names.get(id) ?? 'Unknown' : 'Unknown'), events);
  }, [orders, profiles, firstDay, events]);

  // 1 credit per file an artist adds to any task — the same selected window as
  // everything else here (Last 30/90 days, or all time).
  const fileCreditsSince = windowStartIso(window, today);
  const { rows: fileCreditRows } = useFileCreditEventsSince(fileCreditsSince);
  const fileCreditsByArtist = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of fileCreditRows) {
      if (!r.artist_id) continue;
      by.set(r.artist_id, (by.get(r.artist_id) ?? 0) + 1);
    }
    return by;
  }, [fileCreditRows]);

  const perArtist = useMemo(() => {
    const rows = artists.map((a) => {
      const mine = inWindow.filter((o) => o.artist_id === a.id);
      return {
        id: a.id,
        name: a.full_name,
        total: mine.length,
        open: mine.filter((o) => o.status === 'in_progress').length,
        finished: fileCreditsByArtist.get(a.id) ?? 0,
      };
    });
    // Someone who has left the shop keeps the art they did in the period.
    for (const c of credit.artists) {
      const finished = fileCreditsByArtist.get(c.id) ?? 0;
      if ((c.given || finished) && !rows.some((r) => r.id === c.id)) {
        rows.push({ id: c.id, name: c.name, total: c.given, open: 0, finished });
      }
    }

    return rows.sort((a, b) => b.total - a.total || b.finished - a.finished);
  }, [artists, inWindow, credit, fileCreditsByArtist]);

  const totalOrders = perArtist.reduce((s, a) => s + a.total, 0);

  /**
   * PRD section 7 asks the tracker to measure "an artist's OR OPERATOR'S
   * performance ... to work on the design OR TO PRINT A FILE". The operator's
   * clock starts when the job entered the queue (ready_at), not when the
   * artist was given it — they cannot be held to time they were not waiting.
   */
  const operators = useMemo(
    () =>
      profiles.filter(
        (p) =>
          p.role === 'operator' &&
          (p.active || credit.printers.some((c) => c.id === p.id)),
      ),
    [profiles, credit],
  );

  const perOperator = useMemo(() => {
    const rows = operators.map((op) => {
      const printed = credit.printers.find((c) => c.id === op.id)?.count ?? 0;
      // Live queue state for this operator, regardless of the window.
      const claimed = orders.filter((o) => o.operator_id === op.id && o.status === 'awaiting_print');
      const printing = claimed.filter((o) => o.print_state === 'printing').length;

      return {
        id: op.id,
        name: op.full_name,
        site: op.site,
        waiting: claimed.length - printing,
        printing,
        printed,
      };
    });
    // A print nobody took is credited to whoever ticked it off — reception or
    // an admin — and a person who has left keeps theirs: they are listed too.
    for (const c of credit.printers) {
      if (!rows.some((r) => r.id === c.id)) rows.push({ id: c.id, name: c.name, site: profiles.find((p) => p.id === c.id)?.site ?? null, waiting: 0, printing: 0, printed: c.count });
    }
    return rows.sort((a, b) => b.printed - a.printed);
  }, [operators, credit, orders, profiles]);

  const totalPrinted = perOperator.reduce((s, o) => s + o.printed, 0);

  const waiting = orders.filter((o) => o.status === 'awaiting_print');
  // Live counts, like Waiting to print: a job given before the window that is
  // still open (or late) must not drop off the screen. Late counts To Do jobs
  // too and skips jobs waiting for the client's approval — the same rule as
  // every other dashboard (isOverdue).
  const openJobs = orders.filter((o) => o.status === 'in_progress');
  const overdue = orders.filter((o) => isOverdue(o, today));


  // The status split of the jobs given in the window — the same mix the top
  // cards report, drawn as one donut so the pipeline reads at a glance.
  const statusMix = useMemo(
    () => ({
      todo: inWindow.filter((o) => o.status === 'todo').length,
      in_progress: inWindow.filter((o) => o.status === 'in_progress').length,
      finished: inWindow.filter((o) => o.status === 'finished').length,
      awaiting_print: inWindow.filter((o) => o.status === 'awaiting_print').length,
      printed: inWindow.filter((o) => o.status === 'printed').length,
    }),
    [inWindow],
  );

  // Art is done once a file is attached, whether it is still in review, waiting
  // for the printer, or already printed.
  const artDonePct = inWindow.length
    ? Math.round(((statusMix.finished + statusMix.awaiting_print + statusMix.printed) / inWindow.length) * 100)
    : 0;

  // Jobs whose art was first finished, per equal time bucket ending today:
  // 3-day buckets for 30 days, 10-day for 90, calendar months for all time.
  // No partial bucket, so no bar under-reads.
  const trend = useMemo(() => finishedTrend(orders, window, today), [orders, window, today]);


  return (
    <div className="wrap wl">
      <header className="wl-head">
        <div>
          <p className="wl-eyebrow">Production floor · {TODAY.format(new Date())}</p>
          <h1 className="wl-date">Production overview</h1>
        </div>
        <div className="wl-head-actions">
          <div className="wl-range" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r.id} type="button" className={window === r.id ? 'on' : ''} aria-pressed={window === r.id} onClick={() => setWindow(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className="wl-queue-action" onClick={onOpenQueue} aria-label={`Open print queue, ${waiting.length} ${waiting.length === 1 ? 'job' : 'jobs'} waiting to print`}>
            <span>Open print queue</span>
            <strong>{waiting.length}</strong>
          </button>
        </div>
      </header>

      <section className="wl-kpis">
        <div className="wl-card wl-kpi">
          <span className="wl-kpi-k">In progress</span>
          <span className="wl-kpi-n">{openJobs.length}<small>{openJobs.length === 1 ? 'job' : 'jobs'} now</small></span>
        </div>
        <div className="wl-card wl-kpi hero">
          <span className="wl-kpi-k">Art done</span>
          <span className="wl-kpi-n">{artDonePct}%<small>of {inWindow.length} {inWindow.length === 1 ? 'job' : 'jobs'}</small></span>
        </div>
        <div className={`wl-card wl-kpi${waiting.length ? ' warn' : ''}`}>
          <span className="wl-kpi-k">Waiting to print</span>
          <span className="wl-kpi-n">{waiting.length}<small>now</small></span>
        </div>
        <div className={`wl-card wl-kpi${overdue.length ? ' alert' : ''}`}>
          <span className="wl-kpi-k">Past due date</span>
          <span className="wl-kpi-n">{overdue.length}<small>{overdue.length === 1 ? 'job' : 'jobs'} now</small></span>
        </div>
      </section>

      <section className="wl-grid">
        <div className="wl-card wl-timeline">
          <div className="wl-card-head">
            <h2>Art finished over time</h2>
            <span className="wl-card-note">{trend.reduce((s, b) => s + b.value, 0)} finished</span>
          </div>
          <TrendBars data={trend} empty="No finished jobs in this period yet." />
        </div>
        <div className="wl-card wl-summary">
          <div className="wl-card-head">
            <h2>Jobs by production stage</h2>
            <span className="wl-card-note">{inWindow.length} {inWindow.length === 1 ? 'job' : 'jobs'} · selected period</span>
          </div>
          <ProductionFlow
            total={inWindow.length}
            stages={[
              { label: STATUS_LABEL.todo, value: statusMix.todo },
              { label: STATUS_LABEL.in_progress, value: statusMix.in_progress },
              { label: STATUS_LABEL.finished, value: statusMix.finished },
              { label: STATUS_LABEL.awaiting_print, value: statusMix.awaiting_print, focus: true },
              { label: STATUS_LABEL.printed, value: statusMix.printed },
            ]}
          />
        </div>
      </section>

      <section className="wl-lists">
        <div className="wl-card">
          <div className="wl-card-head">
            <h2>Artists</h2>
            <span className="wl-card-note">Share of work orders</span>
          </div>
          <ul className="wl-rows">
            {perArtist.map((a) => {
              const share = totalOrders ? Math.round((a.total / totalOrders) * 100) : 0;
              return (
                <li key={a.id} className="wl-row">
                  <span className="wl-row-pct">{totalOrders ? `${share}%` : '—'}</span>
                  <ShareBar pct={share} />
                  <span className="wl-row-name">{a.name}</span>
                  <span className="wl-row-meta">
                    <span><b>{a.total}</b> total</span>
                    <span><b>{a.open}</b> in progress</span>
                    <span title="Files this artist has added to tasks in the period — 1 credit each, taken back if the file is later removed."><b>{a.finished}</b> {a.finished === 1 ? 'file' : 'files'} added</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {perArtist.length === 0 && <p className="wl-empty">No artists set up yet. Ask an admin to add them in Admin Tools.</p>}
        </div>

        <div className="wl-card">
          <div className="wl-card-head">
            <h2>Printing</h2>
            <span className="wl-card-note">Share of jobs printed</span>
          </div>
          <ul className="wl-rows">
            {perOperator.map((o) => {
              const share = totalPrinted ? Math.round((o.printed / totalPrinted) * 100) : 0;
              return (
                <li key={o.id} className="wl-row">
                  <span className="wl-row-pct">{totalPrinted ? `${share}%` : '—'}</span>
                  <span className="wl-row-name">
                    {o.name}
                    <small>{o.site ? SITE_LABEL[o.site] : 'No site'}</small>
                  </span>
                  <ShareBar pct={share} />
                  <span className="wl-row-meta">
                    <span><b>{o.waiting}</b> waiting</span>
                    <span><b>{o.printing}</b> printing</span>
                    <span><b>{o.printed}</b> done</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {perOperator.length === 0 && <p className="wl-empty">No printer operators set up yet. Ask an admin to add them in Admin Tools.</p>}
        </div>
      </section>

      <p className="muted" style={{ fontSize: 12 }}>
        Waiting and Printing are the operator's live queue right now; Done printing counts the jobs printed in the selected period.
        A print is credited to the operator who took the job, even when reception or an admin marked it done.
      </p>

      {isAdminRole(profile?.role) && (
        <>
          <h2 className="wl-report-heading">Production report</h2>
          <Report orders={orders} profiles={profiles} />
        </>
      )}
    </div>
  );
}

/** Each role lands on its own dashboard; admins, moderators, Tech Developers and Support see the whole shop. */
export default function Dashboard({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { profile } = useSession();
  switch (profile?.role) {
    case 'artist': return <ArtistDashboard />;
    case 'operator': return <OperatorDashboard />;
    case 'receptionist': return <ReceptionDashboard />;
    case 'supply_clerk': return <SupplyDashboard />;
    default: return <TeamDashboard onOpenQueue={onOpenQueue} />;
  }
}
