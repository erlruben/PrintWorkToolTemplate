import { useEffect, useState } from 'react';
import { saveStaffStatus } from '../lib/data';
import {
  awayLabel, STAFF_STATUS_LABEL, STAFF_STATUSES, staffStatusOf,
  type Profile, type StaffStatus,
} from '../lib/types';

/**
 * The three status icons, drawn like the app's own icons (Icons.tsx: a 24 grid,
 * one stroke weight, the text colour) — not the device's emoji, which look
 * different on every phone and computer. Working: a briefcase. Out of office:
 * a door with an arrow leaving. Sick: a thermometer.
 */
export function StatusIcon({ status, size = 14 }: { status: StaffStatus; size?: number }) {
  return (
    <svg className={`status-icon ${status}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {status === 'working' && (
        <>
          <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
          <path d="M9 7.5V5.5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13.5h18" />
        </>
      )}
      {status === 'out_of_office' && (
        <>
          <path d="M12 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H12" />
          <path d="M16 8l4 4-4 4M20 12H10" />
        </>
      )}
      {status === 'sick' && (
        <>
          <path d="M14.5 14.3V5a2.5 2.5 0 0 0-5 0v9.3a4.5 4.5 0 1 0 5 0z" />
          <path d="M12 9.5v6" />
        </>
      )}
    </svg>
  );
}

/**
 * Someone's status next to their name, as "icon - Status" in plain text (no
 * coloured pill): "Sick" / "Out of office" always, and "Working" only with
 * `showWorking` — which chat passes while the person is active now (Working is
 * the default, so it means nothing for someone away from the app).
 */
export function StatusTag({ profile, showWorking = false }: { profile: Profile | null | undefined; showWorking?: boolean }) {
  const s = staffStatusOf(profile);
  if (s === 'working' && (!showWorking || !profile)) return null;
  return (
    <span className={`status-tag ${s}`} title={awayLabel(profile) ?? undefined}>
      <StatusIcon status={s} /> - {STAFF_STATUS_LABEL[s]}
    </span>
  );
}

type Clear = 'never' | 'today' | 'tomorrow' | 'date';

/** The end of a local calendar day, as the time the status clears itself. */
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Set a status, Slack-style: Working, Out of office or Sick, a short note and
 * when it clears itself. For your own status, or (admins) for someone else's.
 */
export function StatusPicker({ person, self, onClose, onSaved }: {
  person: Profile;
  self: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const current = staffStatusOf(person);
  const [status, setStatus] = useState<StaffStatus>(current);
  const [note, setNote] = useState(current === 'working' ? '' : person.status_note ?? '');
  // An existing end date opens as "Choose a date" on that day.
  const [clear, setClear] = useState<Clear>(current !== 'working' && person.status_until ? 'date' : 'never');
  const [date, setDate] = useState(() => {
    const d = current !== 'working' && person.status_until ? new Date(person.status_until) : new Date();
    return ymd(d);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes it wherever focus is (the menu item that opened it is gone).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const today = new Date();
  const untilOf = (): string | null => {
    if (clear === 'today') return endOfDay(today);
    if (clear === 'tomorrow') { const t = new Date(today); t.setDate(t.getDate() + 1); return endOfDay(t); }
    if (clear === 'date') {
      const [y, m, d] = date.split('-').map(Number);
      return y && m && d ? endOfDay(new Date(y, m - 1, d)) : null;
    }
    return null;
  };

  async function save() {
    if (status !== 'working' && clear === 'date' && date < ymd(today)) {
      setError('Pick today or a later date.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await saveStaffStatus(person.id, {
      status, status_note: note, status_until: status === 'working' ? null : untilOf(),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved?.();
    onClose();
  }

  return (
    <div className="overlay status-over" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet status-picker" role="dialog" aria-modal="true" aria-labelledby="status-title">
        <div className="status-body">
          <h2 id="status-title">{self ? 'Set your status' : `Set status for ${person.full_name}`}</h2>
          <div className="status-opts" role="radiogroup" aria-label="Status">
            {STAFF_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={status === s} autoFocus={s === current}
                className={`status-opt ${s}${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
                <StatusIcon status={s} size={16} />{STAFF_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {status !== 'working' && (
            <>
              <label className="field">
                <span>Note (optional)</span>
                <input value={note} maxLength={80} placeholder="e.g. Back on Monday"
                  onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="field">
                <span>Clear after</span>
                <select value={clear} onChange={(e) => setClear(e.target.value as Clear)}>
                  <option value="never">Don&apos;t clear (set back to Working by hand)</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="date">Choose a date…</option>
                </select>
              </label>
              {clear === 'date' && (
                <label className="field">
                  <span>Until the end of</span>
                  <input type="date" value={date} min={ymd(today)} onChange={(e) => setDate(e.target.value)} />
                </label>
              )}
              <p className="field-hint" style={{ margin: '0 0 12px' }}>
                {self ? 'Everyone' : 'The team'} sees this next to {self ? 'your' : 'their'} name, in chat, and when
                someone picks who to give a task to.
              </p>
            </>
          )}

          {error && <div className="error" style={{ margin: '0 0 12px' }}>{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
