import { useMemo, useState } from 'react';
import { startPan } from '../lib/pan';
import { useCreditEvents, useFileCreditEventsSince } from '../lib/data';
import { credits } from '../lib/credits';
import type { Profile, WorkOrder } from '../lib/types';

interface Props {
  orders: WorkOrder[];
  profiles: Profile[];
}

/**
 * The lifetime view: every client's stats across all of history, no period
 * to pick, no auto-save, no archive — just a "Download PDF" of everything.
 */
export default function AllTimeReport({ orders, profiles }: Props) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.full_name]));
    return (id: string | null) => (id ? m.get(id) ?? 'Unknown' : 'Unassigned');
  }, [profiles]);

  const stamp = useMemo(() => `${orders.length}:${orders.reduce((m, o) => (o.updated_at > m ? o.updated_at : m), '')}`, [orders]);
  const events = useCreditEvents(stamp);
  const { rows: fileCreditRows } = useFileCreditEventsSince('1970-01-01T00:00:00+08:00');

  const data = useMemo(() => {
    const always = () => true;
    const credit = credits(orders, always, nameOf, events);

    const fcByArtist = new Map<string, { name: string; count: number }>();
    for (const r of fileCreditRows) {
      if (!r.artist_id) continue;
      const cur = fcByArtist.get(r.artist_id) ?? { name: r.artist_name ?? nameOf(r.artist_id), count: 0 };
      cur.count += 1;
      fcByArtist.set(r.artist_id, cur);
    }
    const byId = new Map<string, { id: string; name: string; given: number; count: number }>();
    for (const a of credit.artists) byId.set(a.id, { id: a.id, name: a.name, given: a.given, count: fcByArtist.get(a.id)?.count ?? 0 });
    for (const [id, v] of fcByArtist) if (!byId.has(id)) byId.set(id, { id, name: v.name, given: 0, count: v.count });
    const artistRows = [...byId.values()].sort((a, b) => b.count - a.count || b.given - a.given || a.name.localeCompare(b.name));

    return {
      opened: credit.totals.made,
      finished: fileCreditRows.length,
      printed: credit.totals.printed,
      makerRows: credit.makers,
      artistRows,
      opRows: credit.printers,
      clients: new Set(orders.map((o) => o.client_name).filter(Boolean)).size,
    };
  }, [orders, nameOf, events, fileCreditRows]);

  const summary: { key: string; title: string; head: string[]; rows: (string | number)[][] }[] = [
    { key: 'makers', title: 'Made the task', head: ['Made by', 'Tasks made'], rows: data.makerRows.map((r) => [r.name, r.count]) },
    { key: 'artists', title: 'Did the art', head: ['Artist', 'Given', 'Art done'], rows: data.artistRows.map((r) => [r.name, r.given, r.count]) },
    { key: 'printers', title: 'Printed', head: ['Printed by', 'Jobs printed'], rows: data.opRows.map((r) => [r.name, r.count]) },
  ];

  async function pdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const M = 40;
      doc.setFontSize(18);
      doc.setTextColor(20, 22, 26);
      doc.text('Report — All time', M, 48);
      doc.setFontSize(11);
      doc.setTextColor(107, 114, 128);
      doc.text('Your organization', M, 66);
      doc.setFontSize(11);
      doc.setTextColor(20, 22, 26);
      doc.text(`Opened ${data.opened}      Art done ${data.finished}      Printed ${data.printed}      Clients ${data.clients}`, M, 90);
      const last = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
      let startY = 108;
      for (const t of summary) {
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
      doc.save('report-all-time.pdf');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the PDF.');
    }
    setPdfBusy(false);
  }

  return (
    <div className="card report-card">
      <div className="report-head">
        <div>
          <div className="chart-title" style={{ marginBottom: 2 }}>All time</div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Every client and job in the shop's history. No period to pick, and nothing is auto-saved — download it when you need it.
          </p>
        </div>
      </div>

      <div className="report-stats">
        <div><strong>{data.opened}</strong><span>Opened</span></div>
        <div><strong>{data.finished}</strong><span>Art done</span></div>
        <div><strong>{data.printed}</strong><span>Printed</span></div>
        <div><strong>{data.clients}</strong><span>Clients</span></div>
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
        <button className="btn" onClick={pdf} disabled={pdfBusy || !orders.length}>
          {pdfBusy ? 'Preparing…' : 'Download PDF'}
        </button>
        {!orders.length && <span className="muted" style={{ fontSize: 13 }}>No activity yet.</span>}
      </div>
    </div>
  );
}
