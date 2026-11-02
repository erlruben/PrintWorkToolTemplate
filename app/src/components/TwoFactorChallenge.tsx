import { useEffect, useState, type FormEvent } from 'react';
import { listTotpFactors, trustThisDevice, verifyTotp } from '../lib/twofactor';
import BrandMark from './BrandMark';

/**
 * Shown after a correct password when the person has two-factor on and this
 * device isn't trusted. They enter the code from their authenticator app; a
 * ticked "trust this device" skips it for 30 days on this device.
 */
export default function TwoFactorChallenge({
  userId, onVerified, onSignOut,
}: {
  userId: string;
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTotpFactors().then((f) =>
      setFactorId(f.find((x) => x.status === 'verified')?.id ?? f[0]?.id ?? null),
    );
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await verifyTotp(factorId, code);
    if (error) {
      setError('That code is not right — check the current one in your authenticator app.');
      setBusy(false);
      return;
    }
    if (trust) await trustThisDevice(userId);
    setBusy(false);
    onVerified();
  }

  return (
    <div className="signin-page">
      <div className="signin-stack">
        <form className="signin-card" onSubmit={submit}>
          <div className="signin-panel">
            <BrandMark size={72} />
            <div className="signin-panel-text">
              <div className="signin-panel-name">PrintFlow</div>
              <div className="signin-panel-org">PRINT SHOP OPERATIONS</div>
            </div>
            <p className="signin-panel-line">A quick security check to keep the account safe.</p>
          </div>

          <div className="signin-form">
            <h1 className="signin-title">Enter your code</h1>
            <p className="signin-lede">
              Open your authenticator app and type the 6-digit code for this account.
            </p>

            {error && <div className="signin-error">{error}</div>}

            <label className="signin-field">
              <span>Authenticator code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                autoFocus
                required
              />
            </label>

            <label className="check-row" style={{ margin: '2px 0 12px' }}>
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
              <span>Trust this device for 30 days</span>
            </label>

            <button className="signin-btn" disabled={busy || code.length < 6}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <button type="button" className="signin-link" onClick={onSignOut}>
              Sign out instead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
