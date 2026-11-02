import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useSettings } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import BrandMark from './BrandMark';

/**
 * Choose a password — shown once, right after a person signs in with the
 * temporary password the admin handed them (clearing must_change_password lets
 * them through), and after opening a "forgot password" email link.
 * (Recovery emails are added by admins in Accounts, not here.)
 */
export default function ChangePassword() {
  const { profile, refreshProfile, signOut, recovering, endRecovery } = useSession();
  const { settings } = useSettings();
  const driveAccount = settings.drive_account_email;
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = !!recovering && !profile?.must_change_password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== confirm) return setError('The two passwords do not match.');

    setBusy(true);

    const { error: pwErr } = await supabase.auth.updateUser({ password: pw });
    if (pwErr) {
      setError(pwErr.message);
      setBusy(false);
      return;
    }

    if (profile?.must_change_password) {
      const { error: flagErr } = await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', profile.id);

      if (flagErr) {
        setError(flagErr.message);
        setBusy(false);
        return;
      }
    }

    endRecovery?.();
    await refreshProfile();
  }

  return (
    <div className="signin-page">
      <div className="signin-stack">
        <form className="signin-card signin-card--compact" onSubmit={submit}>
          <div className="signin-panel">
            <BrandMark size={72} />
            <div className="signin-panel-text">
              <div className="signin-panel-name">PrintFlow</div>
              <div className="signin-panel-org">PRINT SHOP OPERATIONS</div>
            </div>
            <p className="signin-panel-line">
              Every job, from the day it is given out to the day it is printed.
            </p>
          </div>

          <div className="signin-form">
            <h1 className="signin-title">{reset ? 'Choose a new password' : 'Choose your password'}</h1>
            <p className="signin-lede">
              {reset
                ? <>Hi {profile?.full_name}. You opened a password reset link — choose a new password to carry on.</>
                : <>Hi {profile?.full_name}. You are signed in with a temporary password — pick your own before you carry on.</>}
            </p>

            {error && <div className="signin-error">{error}</div>}

            <label className="signin-field">
              <span>New password</span>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                required
                autoFocus
              />
            </label>

            <label className="signin-field">
              <span>Type it again</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            <button className="signin-btn" disabled={busy}>
              {busy ? 'Saving…' : 'Save and continue'}
            </button>

            <button type="button" className="signin-link" onClick={signOut}>
              Sign out instead
            </button>

            {/* A setup tip for the office PCs — hidden on phones, where it doesn't apply
                and would push this screen past the fold. */}
            {driveAccount && (
              <p className="signin-note" style={{ marginTop: 18, fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)' }}>
                <strong>For uploading print files:</strong> this computer should be signed into the
                company Google account <strong>{driveAccount}</strong> in the browser (gmail.com) — a
                one-time setup per machine. Attaching files to Drive needs it.
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
