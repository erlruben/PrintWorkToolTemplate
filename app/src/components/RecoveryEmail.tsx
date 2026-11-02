import { useEffect, useState, type FormEvent } from 'react';
import { emailDomainProblem } from '../lib/emailCheck';
import { isEmail, removeRecoveryEmail, saveRecoveryEmail, setMyRecoveryEmail, useRecoveryEmail } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { isInternalEmail } from '../lib/identity';
import type { Profile } from '../lib/types';

/**
 * Settings card: your password-recovery email — where a "Forgot your
 * password?" link is sent. You add or change it here with your current
 * password (2026-10-11). Support and the Tech Developer can also set or
 * remove it for you (Accounts). Private: other staff never see it.
 */
export function RecoveryEmailCard() {
  const { session, profile } = useSession();
  const rec = useRecoveryEmail(profile?.id);
  // Adding or changing your own: the email and your current password (2026-10-11).
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!profile || !rec.available || rec.loading) return null;
  const usesUsername = isInternalEmail(session?.user.email ?? '');
  const startEdit = () => { setValue(''); setPassword(''); setError(null); setSaved(false); setEditing(true); };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(value)) { setError('Type an email you can open, like name@gmail.com.'); return; }
    if (rec.email && value.trim().toLowerCase() === rec.email.toLowerCase()) { setError('That is already your recovery email.'); return; }
    if (!password) { setError('Type your current password.'); return; }
    setBusy(true);
    setError(null);
    // A misspelled or mail-less domain is caught before it is saved (2026-10-27).
    const bad = await emailDomainProblem(value);
    if (bad) { setBusy(false); setError(bad); return; }
    const problem = await setMyRecoveryEmail(value, password);
    setBusy(false);
    setPassword('');
    if (problem) { setError(problem); return; }
    await rec.reload();
    setEditing(false);
    setSaved(true);
  }

  return (
    <div className="card" style={{ padding: 18, marginTop: 16, maxWidth: 720 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Password recovery email</h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
        If you forget your password, tap &ldquo;Forgot your password?&rdquo; on the sign-in screen and a
        reset link is sent here. It is private to you. You can add or change it with your current password.
      </p>
      {editing ? (
        <form onSubmit={save} className="recovery-change">
          {rec.email && <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Now: <strong style={{ overflowWrap: 'anywhere' }}>{rec.email}</strong></p>}
          <label className="field">
            <span>{rec.email ? 'New recovery email' : 'Recovery email'}</span>
            <input type="email" value={value} autoFocus autoComplete="email" inputMode="email" maxLength={254}
              placeholder="name@gmail.com" onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="field">
            <span>Your current password</span>
            <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error" role="alert" style={{ margin: '0 0 10px' }}>{error}</p>}
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : rec.email ? 'Save new email' : 'Save email'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : rec.email ? (
        <>
          <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>{rec.email}</p>
            <button type="button" className="btn ghost sm" onClick={startEdit}>Change</button>
          </div>
          {saved && <p className="muted" role="status" style={{ margin: '8px 0 0', fontSize: 13 }}>Saved. Reset links now go to this email.</p>}
        </>
      ) : (
        <>
          {usesUsername
            ? <p className="notice" style={{ margin: '0 0 10px' }}>Not set yet. Without it, only an admin can reset your password.</p>
            : <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Not set — reset links go to the email you sign in with.</p>}
          <button type="button" className="btn sm" onClick={startEdit}>Add recovery email</button>
        </>
      )}
    </div>
  );
}

/** Support and the Tech Developer: add, change or remove someone's recovery email (Accounts). */
export function RecoveryEmailDialog({ person, current, onClose, onSaved }: {
  person: Profile;
  current: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(value)) { setError('Type an email they can open, like name@gmail.com.'); return; }
    setBusy(true);
    setError(null);
    const bad = await emailDomainProblem(value);
    if (bad) { setBusy(false); setError(bad); return; }
    const { error: err } = await saveRecoveryEmail(person.id, value);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  }
  async function remove() {
    if (!confirm(`Remove ${person.full_name}'s recovery email?

They can't reset their password by email until a new one is added.`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await removeRecoveryEmail(person.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="overlay status-over" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet status-picker" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onSubmit={save}>
        <div className="status-body">
          <h2 id="recovery-title">Recovery email for {person.full_name}</h2>
          <label className="field">
            <span>Email</span>
            <input type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@gmail.com"
              autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus />
          </label>
          <p className="field-hint" style={{ margin: '0 0 12px' }}>
            Where their &ldquo;Forgot your password?&rdquo; link goes. Only they and the admins can see it.
          </p>
          {error && <div className="error" style={{ margin: '0 0 12px' }}>{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {current && (
              <button type="button" className="linkbtn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>
                Remove
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
