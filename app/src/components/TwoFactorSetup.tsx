import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../lib/sessionContext';
import {
  enrollTotp, listTotpFactors, trustThisDevice, unenrollTotp, untrustThisDevice, verifyTotp,
} from '../lib/twofactor';

/**
 * Supabase hands back the QR as a data URI (`data:image/svg+xml;utf-8,<svg…>`),
 * not raw markup. Dropping the whole string into innerHTML prints the
 * `data:image/svg+xml;…,` prefix as stray text next to the code, so pull out
 * just the SVG. We inject the SVG rather than use <img src>, because the SVG's
 * `fill="#000000"` colours contain `#`, which truncates an unencoded data URI.
 */
function svgFromQr(qr: string): string {
  if (!qr.startsWith('data:')) return qr; // already raw SVG
  const comma = qr.indexOf(',');
  if (comma === -1) return qr;
  const meta = qr.slice(0, comma);
  const payload = qr.slice(comma + 1);
  if (meta.includes('base64')) {
    try { return atob(payload); } catch { return qr; }
  }
  if (payload.includes('<svg')) return payload; // literal SVG — just strip the prefix
  try { return decodeURIComponent(payload); } catch { return payload; }
}

/**
 * Turn two-factor on (or off) for your own account — opened from the profile
 * menu. Enrolling shows a QR to scan in an authenticator app; entering the code
 * it gives confirms and switches 2FA on, and trusts this device for 30 days.
 */
export default function TwoFactorSetup({ onClose }: { onClose: () => void }) {
  const { profile } = useSession();
  const [mode, setMode] = useState<'loading' | 'on' | 'enroll'>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;   // guard StrictMode's double-invoke
    started.current = true;
    (async () => {
      const factors = await listTotpFactors();
      const verified = factors.find((f) => f.status === 'verified');
      if (verified) { setFactorId(verified.id); setMode('on'); return; }
      // Clear any half-finished (unverified) factors, then start a fresh enrol.
      for (const f of factors) await unenrollTotp(f.id);
      const { data, error } = await enrollTotp();
      if (error || !data) { setError(error?.message ?? 'Could not start setup.'); setMode('enroll'); return; }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setMode('enroll');
    })();
  }, []);

  async function activate(e: FormEvent) {
    e.preventDefault();
    if (!factorId || !profile) return;
    setBusy(true);
    setError(null);
    const { error } = await verifyTotp(factorId, code);
    if (error) { setError('That code did not match — enter the current one.'); setBusy(false); return; }
    await trustThisDevice(profile.id);
    setDone(true);
    setBusy(false);
  }

  async function turnOff() {
    if (!factorId || !profile) return;
    if (!confirm('Turn off two-factor for your account? You will only need your password to sign in.')) return;
    setBusy(true);
    setError(null);
    const { error } = await unenrollTotp(factorId);
    if (error) { setError(error.message); setBusy(false); return; }
    await untrustThisDevice(profile.id);
    setBusy(false);
    onClose();
  }

  return createPortal(
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ maxWidth: 460 }}>
        <div className="sheet-head">
          <h2>Two-factor authentication</h2>
          <div style={{ flex: 1 }} />
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          {error && <div className="error">{error}</div>}

          {mode === 'loading' && <p className="muted">Loading…</p>}

          {mode === 'on' && (
            <>
              <div className="notice">
                <strong>Two-factor is on.</strong> You'll enter a code from your authenticator app
                when signing in on a new device.
              </div>
              <button className="btn danger" onClick={turnOff} disabled={busy}>
                {busy ? 'Working…' : 'Turn off two-factor'}
              </button>
            </>
          )}

          {mode === 'enroll' && !done && (
            <>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Scan this with an authenticator app (Google Authenticator, Authy…), then enter the
                6-digit code it shows to switch two-factor on.
              </p>
              {qr && <div className="totp-qr" dangerouslySetInnerHTML={{ __html: svgFromQr(qr) }} />}
              {secret && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Can't scan? Enter this key by hand: <code>{secret}</code>
                </p>
              )}
              <form onSubmit={activate}>
                <label className="field">
                  <span>Code from the app</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    autoFocus
                  />
                </label>
                <div className="totp-actions">
                  <button className="btn" disabled={busy || code.length < 6}>
                    {busy ? 'Verifying…' : 'Turn on two-factor'}
                  </button>
                </div>
              </form>
            </>
          )}

          {done && (
            <div className="notice">
              <strong>Two-factor is on. ✓</strong> You'll be asked for a code on new devices. This
              device is trusted for 30 days.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
