import { useEffect, useRef, useState } from 'react';
import { setPrinterStatus } from '../lib/data';
import { printerStateAt, SITE_LABEL, type PrinterState, type PrinterStatus, type Site } from '../lib/types';
import DurationInput from './DurationInput';
import { durationSecs, leftLabel, NO_DURATION, type Duration } from '../lib/duration';

const SITES: Site[] = ['office', 'production'];
const STATE_LABEL: Record<PrinterState, string> = { working: 'Working', cooldown: 'Cooling down', broken: 'Broken' };

/** A clock that ticks every second while some cool-down is running, else every 30s. */
function usePrinterClock(rows: PrinterStatus[]) {
  const [now, setNow] = useState(() => Date.now());
  const running = rows.some((r) => r.state === 'cooldown' && r.until && new Date(r.until).getTime() > now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), running ? 1000 : 30_000);
    return () => window.clearInterval(t);
  }, [running]);
  return now;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The printers at the upper right of the Print Queue (2026-10-27): one pill
 * per printing area — Working, Cooling down (with the time left) or Broken.
 * Tapping one shows who set it and when; operators, reception and admins can
 * change it there. Marking it Broken, and fixed again, notifies everyone.
 */
export default function PrinterPills({ rows, canChange, only, onChanged }: {
  rows: PrinterStatus[];
  canChange: boolean;
  /** Read the statuses again after a change (the live update can lag). */
  onChanged?: () => void;
  /** Show just this area (an operator's own), or both when null. */
  only?: Site | null;
}) {
  const now = usePrinterClock(rows);
  const [open, setOpen] = useState<Site | null>(null);
  const [mode, setMode] = useState<PrinterState | null>(null);
  const [dur, setDur] = useState<Duration>(NO_DURATION);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Tap outside or Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const sites = only ? [only] : SITES;
  const rowOf = (site: Site) => rows.find((r) => r.site === site) ?? null;
  const toggle = (site: Site) => {
    setErr(null); setMode(null); setDur(NO_DURATION); setNote('');
    setOpen((cur) => (cur === site ? null : site));
  };
  async function apply(site: Site, state: PrinterState) {
    const secs = state === 'cooldown' ? durationSecs(dur) : null;
    if (state === 'cooldown' && (!secs || secs > 86400)) { setErr('Type how long it cools down (up to 24 hours).'); return; }
    setBusy(true); setErr(null);
    const { error } = await setPrinterStatus(site, state, secs, state === 'broken' ? note.trim() || null : null);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpen(null);
    onChanged?.();
  }

  return (
    <div className="printer-pills" ref={box}>
      {sites.map((site) => {
        const r = rowOf(site);
        const state = printerStateAt(r, now);
        const label = state === 'cooldown' ? `${STATE_LABEL.cooldown} ${leftLabel(r?.until ?? null, now)}` : STATE_LABEL[state];
        return (
          <div className="printer-pill-wrap" key={site}>
            <button type="button" className={`printer-pill ${state}`} onClick={() => toggle(site)}
              aria-expanded={open === site} aria-haspopup="dialog"
              aria-label={`${SITE_LABEL[site]} printer: ${label}${r?.note && state === 'broken' ? ` — ${r.note}` : ''}`}>
              <span className="printer-dot" aria-hidden />
              <span className="printer-area">{SITE_LABEL[site]}</span>
              <span className="printer-state">{label}</span>
            </button>
            {open === site && (
              <div className="printer-menu" role="dialog" aria-label={`${SITE_LABEL[site]} printer`}>
                <div className="printer-menu-now">
                  <strong>{SITE_LABEL[site]} printer: {label}</strong>
                  {state === 'broken' && r?.note && <span className="printer-menu-note">{r.note}</span>}
                  {r?.changed_by_name && state !== 'working' && <span className="muted">Set by {r.changed_by_name} · {when(r.changed_at)}</span>}
                </div>
                {canChange ? (
                  <>
                    <div className="printer-menu-choices">
                      <button type="button" className={`pq-btn ${state === 'working' ? 'on' : ''}`} disabled={busy || state === 'working'}
                        onClick={() => apply(site, 'working')}>Working</button>
                      <button type="button" className={`pq-btn ${mode === 'cooldown' ? 'on' : ''}`} disabled={busy}
                        onClick={() => { setMode('cooldown'); setErr(null); }}>Cooling down…</button>
                      <button type="button" className={`pq-btn danger ${mode === 'broken' ? 'on' : ''}`} disabled={busy}
                        onClick={() => { setMode('broken'); setErr(null); }}>Broken…</button>
                    </div>
                    {mode === 'cooldown' && (
                      <div className="pq-controls printer-menu-form">
                        <DurationInput value={dur} onChange={setDur} onEnter={() => apply(site, 'cooldown')} idPrefix={`cool-${site}`} />
                        <button type="button" className="pq-btn" disabled={busy} onClick={() => apply(site, 'cooldown')}>Start</button>
                      </div>
                    )}
                    {mode === 'broken' && (
                      <div className="printer-menu-form">
                        <input type="text" className="pq-note-input" maxLength={500} value={note} placeholder="What is wrong? (optional)"
                          aria-label="What is wrong with the printer" onChange={(e) => setNote(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') apply(site, 'broken'); }} />
                        <button type="button" className="pq-btn danger" disabled={busy} onClick={() => apply(site, 'broken')}>Mark broken</button>
                        <p className="muted printer-menu-hint">Everyone is notified, and again when it is working.</p>
                      </div>
                    )}
                    {err && <div className="error" style={{ margin: '6px 0 0' }}>{err}</div>}
                  </>
                ) : (
                  <p className="muted printer-menu-hint">Printer operators, reception and admins change this.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * On a task going to print (2026-10-27): a banner when its printer is Broken or
 * cooling down. A job for either area only warns when both are down.
 */
export function PrinterBanner({ rows, site }: { rows: PrinterStatus[]; site: Site | null }) {
  const now = usePrinterClock(rows);
  const down = (site ? [site] : SITES)
    .map((s) => ({ s, r: rows.find((x) => x.site === s) ?? null }))
    .map(({ s, r }) => ({ s, r, state: printerStateAt(r, now) }))
    .filter((x) => x.state !== 'working');
  if (!down.length || (!site && down.length < SITES.length)) return null;
  return (
    <>
      {down.map(({ s, r, state }) => (
        <div className={`notice printer-banner ${state}`} role="status" key={s}>
          <strong>{SITE_LABEL[s]} printer {state === 'broken' ? 'is broken' : `is cooling down — ${leftLabel(r?.until ?? null, now)} left`}</strong>
          {state === 'broken' && r?.note ? ` — ${r.note}` : ''}
          {state === 'broken' ? '. This job may print late.' : '.'}
        </div>
      ))}
    </>
  );
}
