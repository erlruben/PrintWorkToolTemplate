import { useEffect, useMemo, useRef, useState } from 'react';
import { startPan } from '../lib/pan';
import {
  fileCreditRowsInRange, finalizeReportPeriod, openReportPeriod, setReportPeriodDriveLink,
  useCreditEvents, useFileCreditEventsSince, useReportPeriods, useSettings, type ReportPeriod,
} from '../lib/data';
import { credits, phDay } from '../lib/credits';
import { downloadCsv, toCsv } from '../lib/csv';
import { itemsOf, sheetsTotal } from '../lib/items';
import { driveFolderId, hasDriveToken, uploadReportToDrive } from '../lib/drive';
import {
  periodBounds, periodHasEnded, periodLabelOf, periodRangeText, periodTitle,
  previousPeriodLabel, recentLabels, type PeriodType,
} from '../lib/periods';
import { SITE_LABEL, STATUS_LABEL, URGENCY_LABEL, type Profile, type WorkOrder } from '../lib/types';

interface Props {
  orders: WorkOrder[];
  profiles: Profile[];
  periodType: PeriodType;
}

type SnapshotArtist = { id: string; name: string; given: number; count: number };
type Snapshot = ReportPeriod['snapshot'];

const PICKER_COUNT: Record<PeriodType, number> = { month: 24, quarter: 12, year: 8 };

/** The summary-only PDF for an archived period (no per-job list — see the Archive note in the UI). */
async function buildSnapshotDoc(periodType: PeriodType, label: string, snapshot: Snapshot) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  doc.setFontSize(18);
  doc.setTextColor(20, 22, 26);
  doc.text(`Report — ${periodTitle(periodType, label)}`, M, 48);
  doc.setFontSize(11);
  doc.setTextColor(107, 114, 128);
  doc.text('Your organization', M, 66);
  doc.text(periodRangeText(periodType, label), M, 82);
  doc.setFontSize(11);
  doc.setTextColor(20, 22, 26);
  doc.text(`Opened ${snapshot.opened}      Art done ${snapshot.artDone}      Printed ${snapshot.printed}`, M, 100);

  const last = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
  const tables: { rows: (string | number)[][]; head: string[] }[] = [
    { head: ['Made by', 'Tasks made'], rows: snapshot.makers.map((r) => [r.name, r.count]) },
    { head: ['Artist', 'Given', 'Art done'], rows: snapshot.artists.map((r) => [r.name, r.given, r.count]) },
    { head: ['Printed by', 'Jobs printed'], rows: snapshot.printers.map((r) => [r.name, r.count]) },
  ];
  let startY = 118;
  for (const t of tables) {
    if (!t.rows.length) continue;
    autoTable(doc, {
      startY,
      head: [t.head],
      body: t.rows.map((r) => r.map(String)),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [63, 59, 82], textColor: 255, fontSize: 9 },
      tableWidth: 320,
      margin: { left: M, right: M },
      pageBreak: 'avoid',
    });
    startY = last() + 22;
  }
  doc.setFontSize(9);
  doc.setTextColor(154, 161, 172);
  doc.text(`Generated ${new Date().toLocaleString('en-PH')}`, M, startY + 4);
  return doc;
}

/**
 * One period's report — Monthly, Quarterly or Yearly, same shape, picked by
 * `periodType`. Only years are archived: months and quarters are for viewing
 * (and their PDF/CSV), a closed year keeps its snapshot in the Archive. "Art done" is a straight file-credit count for the period
 * (see lib/periods + useFileCreditEventsSince) — the same number the Workload
 * table shows for the same window. On mount, it also checks whether the
 * year right before this one has ended without being archived yet, and if
 * so computes and archives its snapshot (and, if this browser already holds
 * a Google token, auto-saves its PDF to Drive) — see the plan's note on why
 * this runs client-side rather than being recomputed in SQL.
 */
export default function PeriodReport({ orders, profiles, periodType }: Props) {
  const { settings } = useSettings();
  const [period, setPeriod] = useState(() => periodLabelOf(periodType));
  const [pdfBusy, setPdfBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveNote, setDriveNote] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState<string | null>(null);
  const [archPdfBusy, setArchPdfBusy] = useState<string | null>(null);

  const driveReady = !!settings.google_client_id && !!driveFolderId(settings.drive_folder_url);

  const nameOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.full_name]));
    return (id: string | null) => (id ? m.get(id) ?? 'Unknown' : 'Unassigned');
  }, [profiles]);

  const bounds = useMemo(() => periodBounds(periodType, period), [periodType, period]);

  const stamp = useMemo(() => `${orders.length}:${orders.reduce((m, o) => (o.updated_at > m ? o.updated_at : m), '')}`, [orders]);
  const events = useCreditEvents(stamp);
  const { rows: fileCreditRows } = useFileCreditEventsSince(bounds.startIso, bounds.endIsoExclusive);

  const data = useMemo(() => {
    const inPeriod = (d: string | null | undefined) => !!d && d >= bounds.startDate && d <= bounds.endDate;
    const credit = credits(orders, inPeriod, nameOf, events);
    const who = (o: WorkOrder) => credit.byTask.get(o.id);

    const fcByArtist = new Map<string, { name: string; count: number }>();
    for (const r of fileCreditRows) {
      if (!r.artist_id) continue;
      const cur = fcByArtist.get(r.artist_id) ?? { name: r.artist_name ?? nameOf(r.artist_id), count: 0 };
      cur.count += 1;
      fcByArtist.set(r.artist_id, cur);
    }
    const byId = new Map<string, SnapshotArtist>();
    for (const a of credit.artists) byId.set(a.id, { id: a.id, name: a.name, given: a.given, count: fcByArtist.get(a.id)?.count ?? 0 });
    for (const [id, v] of fcByArtist) if (!byId.has(id)) byId.set(id, { id, name: v.name, given: 0, count: v.count });
    const artistRows = [...byId.values()].sort((a, b) => b.count - a.count || b.given - a.given || a.name.localeCompare(b.name));

    const touched = orders
      .filter((o) => inPeriod(o.date_given) || inPeriod(o.date_finished) || inPeriod(o.first_finished_on)
        || inPeriod(o.client_wait_first_on) || inPeriod(phDay(o.printed_at)))
      .sort((a, b) => a.date_given.localeCompare(b.date_given))
      .map((o) => ({
        o,
        maker: who(o)?.maker ?? '—',
        artist: who(o)?.artist ?? (o.artist_id ? nameOf(o.artist_id) : 'Unassigned'),
        printer: who(o)?.printers.join(', ') || (o.operator_id ? nameOf(o.operator_id) : '—'),
        printedDay: phDay(o.printed_at),
      }));

    return {
      opened: credit.totals.made,
      finished: fileCreditRows.length,
      printed: credit.totals.printed,
      makerRows: credit.makers,
      artistRows,
      opRows: credit.printers,
      touched,
    };
  }, [orders, bounds, nameOf, events, fileCreditRows]);

  const summary: { key: string; title: string; head: string[]; rows: (string | number)[][] }[] = [
    { key: 'makers', title: 'Made the task', head: ['Made by', 'Tasks made'], rows: data.makerRows.map((r) => [r.name, r.count]) },
    { key: 'artists', title: 'Did the art', head: ['Artist', 'Given', 'Art done'], rows: data.artistRows.map((r) => [r.name, r.given, r.count]) },
    { key: 'printers', title: 'Printed', head: ['Printed by', 'Jobs printed'], rows: data.opRows.map((r) => [r.name, r.count]) },
  ];

  const archives = periodType === 'year';
  // One try per visit: if the archive call doesn't land, don't keep resending it.
  const triedArchive = useRef<string | null>(null);
  const { rows: archive, available: archiveAvailable, reload: reloadArchive } = useReportPeriods(periodType);

  // Auto-archive the period right before this one, once it has ended and
  // nobody has opened its report yet — see the component doc comment.
  useEffect(() => {
    if (!archives || !archiveAvailable) return;
    const prevLabel = previousPeriodLabel(periodType, periodLabelOf(periodType));
    if (!periodHasEnded(periodType, prevLabel)) return;
    if (archive.some((r) => r.period_label === prevLabel)) return;
    if (triedArchive.current === prevLabel) return;
    let cancelled = false;
    void (async () => {
      const b = periodBounds(periodType, prevLabel);
      const inPrev = (d: string | null | undefined) => !!d && d >= b.startDate && d <= b.endDate;
      const prevCredit = credits(orders, inPrev, nameOf, events);
      const fcRows = await fileCreditRowsInRange(b.startIso, b.endIsoExclusive);
      const fcByArtist = new Map<string, { name: string; count: number }>();
      for (const r of fcRows) {
        if (!r.artist_id) continue;
        const cur = fcByArtist.get(r.artist_id) ?? { name: r.artist_name ?? nameOf(r.artist_id), count: 0 };
        cur.count += 1;
        fcByArtist.set(r.artist_id, cur);
      }
      const byId = new Map<string, SnapshotArtist>();
      for (const a of prevCredit.artists) byId.set(a.id, { id: a.id, name: a.name, given: a.given, count: fcByArtist.get(a.id)?.count ?? 0 });
      for (const [id, v] of fcByArtist) if (!byId.has(id)) byId.set(id, { id, name: v.name, given: 0, count: v.count });
      const snapshot: Snapshot = {
        opened: prevCredit.totals.made,
        artDone: fcRows.length,
        printed: prevCredit.totals.printed,
        makers: prevCredit.makers,
        artists: [...byId.values()],
        printers: prevCredit.printers,
      };
      if (cancelled || triedArchive.current === prevLabel) return;
      triedArchive.current = prevLabel;
      // A year with nothing in it (before the shop used the app) isn't archived.
      if (!snapshot.opened && !snapshot.artDone && !snapshot.printed) return;
      const { error: openErr } = await openReportPeriod(periodType, prevLabel, b.startDate, b.endDate, snapshot);
      if (openErr || cancelled) return;
      reloadArchive();
      // Only if this browser already holds a Google token (from an earlier,
      // user-initiated Drive action this session) — a fresh sign-in popup
      // can't open from a background effect with no click behind it.
      const clientId = settings.google_client_id?.trim();
      const rootFolderId = driveFolderId(settings.drive_folder_url);
      if (clientId && rootFolderId && hasDriveToken()) {
        try {
          const doc = await buildSnapshotDoc(periodType, prevLabel, snapshot);
          const blob = doc.output('blob');
          const up = await uploadReportToDrive(blob, `PrintFlow report — ${periodTitle(periodType, prevLabel)}.pdf`, { clientId, rootFolderId, month: prevLabel });
          if (!cancelled) { await setReportPeriodDriveLink(periodType, prevLabel, up.webViewLink); reloadArchive(); }
        } catch { /* best-effort — stays downloadable by hand from the Archive */ }
      }
    })();
    return () => { cancelled = true; };
  }, [periodType, archives, archiveAvailable, archive, orders, events, nameOf, settings, reloadArchive]);

  async function closeNow(label: string) {
    if (!confirm(`Close ${periodTitle(periodType, label)} now? Its report will be archived and everyone will be notified.`)) return;
    setCloseBusy(label);
    setError(null);
    const { error: err } = await finalizeReportPeriod(periodType, label);
    if (err) setError(err.message);
    setCloseBusy(null);
  }

  async function archivePdf(r: ReportPeriod) {
    setArchPdfBusy(r.period_label);
    setError(null);
    try {
      const doc = await buildSnapshotDoc(periodType, r.period_label, r.snapshot);
      doc.save(`report-${r.period_label}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    }
    setArchPdfBusy(null);
  }

  // jsPDF is heavy, so it is only fetched the moment it is actually needed —
  // the main bundle never carries it. Shared by "Download PDF" and "Save to
  // Drive" so the two documents are always identical.
  async function buildDoc() {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const M = 40;

    doc.setFontSize(18);
    doc.setTextColor(20, 22, 26);
    doc.text(`Report — ${periodTitle(periodType, period)}`, M, 48);

    doc.setFontSize(11);
    doc.setTextColor(107, 114, 128);
    doc.text('Your organization', M, 66);

    doc.setFontSize(11);
    doc.setTextColor(20, 22, 26);
    doc.text(
      `Opened ${data.opened}      Art done ${data.finished}      Printed ${data.printed}`,
      M,
      90,
    );

    autoTable(doc, {
      startY: 108,
      head: [['WO #', 'Customer', 'Job', 'Made by', 'Artist', 'Printed by', 'Material', 'Laminating', 'Qty', 'Priority', 'Print area', 'Given', 'Finished', 'Printed', 'Status']],
      body: data.touched.map(({ o, maker, artist, printer, printedDay }) => [
        o.wo_number,
        o.client_name ?? '—',
        o.description,
        maker,
        artist,
        printer,
        o.material ?? '',
        o.laminating || '—',
        o.qty != null ? String(o.qty) : '—',
        o.urgency ? URGENCY_LABEL[o.urgency] : '—',
        o.target_site ? SITE_LABEL[o.target_site] : 'Either',
        o.date_given,
        o.first_finished_on ?? o.date_finished ?? '—',
        printedDay ?? '—',
        STATUS_LABEL[o.status],
      ]),
      styles: { fontSize: 7.5, cellPadding: 3.5, overflow: 'linebreak' },
      headStyles: { fillColor: [20, 22, 26], textColor: 255, fontSize: 7.5 },
      columnStyles: { 1: { cellWidth: 100 } },
      margin: { left: M, right: M },
    });

    const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    for (const t of summary) {
      if (!t.rows.length) continue;
      autoTable(doc, {
        startY: last() + 22,
        head: [t.head],
        body: t.rows.map((r) => r.map(String)),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [63, 59, 82], textColor: 255, fontSize: 9 },
        tableWidth: 320,
        margin: { left: M, right: M },
        pageBreak: 'avoid',
      });
    }

    const finalY = last();
    doc.setFontSize(9);
    doc.setTextColor(154, 161, 172);
    doc.text(`Generated ${new Date().toLocaleString('en-PH')}`, M, finalY + 22);

    return doc;
  }

  async function pdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const doc = await buildDoc();
      doc.save(`report-${period}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    }
    setPdfBusy(false);
  }

  /** Save (or replace) this period's report in Monthly Report / <period> in Drive. */
  async function saveToDrive() {
    const clientId = settings.google_client_id?.trim();
    const rootFolderId = driveFolderId(settings.drive_folder_url);
    if (!clientId || !rootFolderId) return;

    setDriveBusy(true);
    setError(null);
    setDriveNote(null);
    setDriveLink(null);
    try {
      const doc = await buildDoc();
      const blob = doc.output('blob');
      const up = await uploadReportToDrive(blob, `PrintFlow report — ${periodTitle(periodType, period)}.pdf`, { clientId, rootFolderId, month: period });
      setDriveNote(`Saved to Drive — Monthly Report / ${period}.`);
      setDriveLink(up.webViewLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the report to Drive.');
    }
    setDriveBusy(false);
  }

  /** Every job of the period as a spreadsheet, one row each — for checking against invoices. */
  function csv() {
    const head = ['WO #', 'Job order #', 'Customer', 'Job', 'Items', 'Qty', 'Sheets', 'Material', 'Laminating', 'Priority', 'Print area',
      'Made by', 'Artist', 'Printed by', 'Given', 'Due', 'Art done', 'Printed', 'Released', 'Status'];
    const rows = data.touched.map(({ o, maker, artist, printer, printedDay }) => [
      o.wo_number,
      o.job_order_number ?? '',
      o.client_name ?? '',
      o.description,
      itemsOf(o).map((i) => (i.qty != null ? `${i.name} x${i.qty}${i.per_sheet ? ` (${i.per_sheet}/sheet)` : ''}` : i.name)).join('; '),
      o.qty ?? '',
      // What was printed: sheets when items fit several to a sheet (2026-10-27).
      (itemsOf(o).length ? sheetsTotal(itemsOf(o)) : o.qty) ?? '',
      o.material ?? '',
      o.laminating ?? '',
      o.urgency ? URGENCY_LABEL[o.urgency] : '',
      o.target_site ? SITE_LABEL[o.target_site] : 'Either',
      maker,
      artist,
      printer === '—' ? '' : printer,
      o.date_given,
      o.date_due ?? '',
      o.first_finished_on ?? o.date_finished ?? '',
      printedDay ?? '',
      phDay(o.released_at) ?? '',
      STATUS_LABEL[o.status],
    ]);
    downloadCsv(`PrintFlow jobs ${period}.csv`, toCsv(head, rows));
  }

  function print() {
    const rowsHtml = data.touched
      .map(
        ({ o, maker, artist, printer, printedDay }) => `<tr>
          <td>${escapeHtml(o.wo_number)}</td>
          <td>${escapeHtml(o.client_name || '—')}</td>
          <td>${escapeHtml(o.description)}</td>
          <td>${escapeHtml(maker)}</td>
          <td>${escapeHtml(artist)}</td>
          <td>${escapeHtml(printer)}</td>
          <td>${escapeHtml(o.material ?? '')}</td>
          <td>${escapeHtml(o.laminating || '—')}</td>
          <td>${o.qty != null ? o.qty : '—'}</td>
          <td>${o.urgency ? escapeHtml(URGENCY_LABEL[o.urgency]) : '—'}</td>
          <td>${o.target_site ? escapeHtml(SITE_LABEL[o.target_site]) : 'Either'}</td>
          <td>${o.date_given}</td>
          <td>${o.first_finished_on ?? o.date_finished ?? '—'}</td>
          <td>${printedDay ?? '—'}</td>
          <td>${escapeHtml(STATUS_LABEL[o.status])}</td>
        </tr>`,
      )
      .join('');

    const html = `<h1>Report — ${periodTitle(periodType, period)}</h1>
      <p class="org">Your organization</p>
      <div class="stats">
        <div><b>${data.opened}</b><span>Opened</span></div>
        <div><b>${data.finished}</b><span>Art done</span></div>
        <div><b>${data.printed}</b><span>Printed</span></div>
      </div>
      <h2>Work orders this period</h2>
      <table>
        <thead><tr><th>WO #</th><th>Customer</th><th>Job</th><th>Made by</th><th>Artist</th><th>Printed by</th><th>Material</th><th>Laminating</th><th>Qty</th><th>Priority</th><th>Print area</th><th>Given</th><th>Finished</th><th>Printed</th><th>Status</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="15">No activity this period.</td></tr>'}</tbody>
      </table>
      ${summary.filter((t) => t.rows.length).map((t) => `<h2>${t.title}</h2>
        <table class="who"><thead><tr>${t.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}
      <p class="foot">Generated ${new Date().toLocaleString('en-PH')}</p>`;

    const w = window.open('', '_blank', 'width=940,height=760');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Report — ${periodTitle(periodType, period)}</title>
      <style>
        body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #14161a; padding: 28px; }
        h1 { font-size: 20px; margin: 0 0 2px; }
        .org { color: #6b7280; margin: 0 0 18px; }
        .stats { display: flex; gap: 26px; margin-bottom: 20px; }
        .stats div { display: flex; flex-direction: column; }
        .stats b { font-size: 24px; } .stats span { font-size: 12px; color: #6b7280; }
        h2 { font-size: 14px; margin: 22px 0 8px; }
        table { width: 100%; border-collapse: collapse; }
        table.who { width: auto; min-width: 320px; }
        th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e2e5ea; font-size: 12px; }
        th { text-transform: uppercase; font-size: 10px; letter-spacing: .5px; color: #6b7280; }
        .foot { margin-top: 20px; color: #9aa1ac; font-size: 11px; }
        @media print { body { padding: 0; } }
      </style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  return (
    <div>
      <div className="card report-card">
        <div className="report-head">
          <div>
            <div className="chart-title" style={{ marginBottom: 2 }}>{periodTitle(periodType, period)}</div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {periodRangeText(periodType, period)} — admin only. Counts who made each task, which artist's files are on it and who printed it.
            </p>
          </div>
          {periodType === 'month' ? (
            <input
              type="month"
              value={period}
              max={periodLabelOf('month')}
              onChange={(e) => { setPeriod(e.target.value); setDriveNote(null); setDriveLink(null); }}
              style={{ width: 'auto' }}
            />
          ) : (
            <select
              value={period}
              onChange={(e) => { setPeriod(e.target.value); setDriveNote(null); setDriveLink(null); }}
              style={{ width: 'auto' }}
            >
              {recentLabels(periodType, PICKER_COUNT[periodType]).map((l) => (
                <option key={l} value={l}>{periodTitle(periodType, l)}</option>
              ))}
            </select>
          )}
        </div>

        <div className="report-stats">
          <div><strong>{data.opened}</strong><span>Opened</span></div>
          <div><strong>{data.finished}</strong><span>Art done</span></div>
          <div><strong>{data.printed}</strong><span>Printed</span></div>
        </div>

        <div className="credit-tables">
          {summary.filter((t) => t.rows.length > 0).map((t) => (
            <div className="credit-table" data-credit={t.key} key={t.key}>
              <div className="credit-title">{t.title}</div>
              <div className="table-scroll" onMouseDown={startPan}>
                <table className="glance">
                  <thead>
                    <tr>{t.head.map((h) => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r, k) => (
                      <tr key={`${r[0]}-${k}`} style={{ cursor: 'default' }}>
                        {r.map((c, n) => (n === 0
                          ? <td key={n}><strong>{c}</strong></td>
                          : <td key={n} style={{ fontVariantNumeric: 'tabular-nums' }}>{c}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="report-actions">
          <button className="btn" onClick={pdf} disabled={pdfBusy || !data.touched.length}>
            {pdfBusy ? 'Preparing…' : 'Download PDF'}
          </button>
          <button className="btn ghost" onClick={csv} disabled={!data.touched.length}
            title="Every job of the period as a spreadsheet (opens in Excel)">Download CSV</button>
          <button className="btn ghost" onClick={print} disabled={!data.touched.length}>Print</button>
          {driveReady && (
            <button className="btn ghost" onClick={saveToDrive} disabled={driveBusy || !data.touched.length}>
              {driveBusy ? 'Saving…' : 'Save to Drive'}
            </button>
          )}
          {!data.touched.length && (
            <span className="muted" style={{ fontSize: 13 }}>No activity in {periodTitle(periodType, period)}.</span>
          )}
          {driveNote && <span className="muted" style={{ fontSize: 13 }}>{driveNote}</span>}
          {driveLink && (
            <a className="btn ghost sm" href={driveLink} target="_blank" rel="noreferrer">
              Open in Drive →
            </a>
          )}
        </div>
      </div>

      {!archives && (
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Closed years are kept in the <strong>Yearly</strong> tab's Archive.
        </p>
      )}
      {archives && <>
      <div className="chart-title" style={{ margin: '18px 0 4px' }}>Archive</div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        A closed year's own PDF has the summary tables above only, not the per-job list —
        download this year's CSV while it's still live if you need every job line.
      </p>
      {!archiveAvailable && <p className="muted">The report archive isn't in the database yet.</p>}
      {archiveAvailable && !archive.length && <p className="muted">No year has closed yet.</p>}
      {archive.map((r) => (
        <details className="links-list task-history" key={r.id} style={{ marginBottom: 8 }}>
          <summary>
            {periodTitle(periodType, r.period_label)} — {r.status === 'pending' ? 'ready to close' : 'closed'}
            {' — '}Opened {r.snapshot.opened}, Art done {r.snapshot.artDone}, Printed {r.snapshot.printed}
          </summary>
          <p className="muted" style={{ fontSize: 12 }}>{periodRangeText(periodType, r.period_label)}</p>
          <div className="report-actions" style={{ marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => archivePdf(r)} disabled={archPdfBusy === r.period_label}>
              {archPdfBusy === r.period_label ? 'Preparing…' : 'Download PDF'}
            </button>
            {r.status === 'pending' && (
              <button className="btn sm" onClick={() => closeNow(r.period_label)} disabled={closeBusy === r.period_label}>
                {closeBusy === r.period_label ? 'Closing…' : 'Close now'}
              </button>
            )}
            {r.drive_link && (
              <a className="btn ghost sm" href={r.drive_link} target="_blank" rel="noreferrer">Open in Drive →</a>
            )}
          </div>
        </details>
      ))}
      </>}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
