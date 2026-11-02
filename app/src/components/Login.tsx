import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { toLoginEmail } from '../lib/identity';
import { passwordResetReady, requestPasswordReset } from '../lib/data';
import BrandMark from './BrandMark';

/**
 * Sign-in uses a compact, single-column card on a soft workspace surface.
 */
// A reset link that expired or was already used comes back with the reason in
// the address (#error=access_denied&error_code=otp_expired…).
const linkFailed = () => /(?:^|[#&?])error(?:_code)?=/.test(window.location.hash);

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => linkFailed()
    ? 'That reset link has expired or was already used. Ask for a new one below.'
    : null);
  const [busy, setBusy] = useState(false);
  // Forgot password: ask for the sign-in name, then say a link is on its way.
  const [mode, setMode] = useState<'signin' | 'forgot' | 'sent'>(() => (linkFailed() ? 'forgot' : 'signin'));
  // "Forgot your password?" only once reset emails can actually be sent.
  const [resetReady, setResetReady] = useState(false);
  useEffect(() => {
    let live = true;
    void passwordResetReady().then((r) => { if (live) setResetReady(r); });
    return () => { live = false; };
  }, []);
  // Tidy the address once the message is showing.
  useEffect(() => {
    if (linkFailed()) history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  async function sendReset(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    setError(null);
    const problem = await requestPasswordReset(identifier);
    setBusy(false);
    if (problem) setError(problem);
    else setMode('sent');
  }
  const goSignIn = () => { setMode('signin'); setError(null); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Staff type a username, owners type an email — both resolve to an email.
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(identifier),
      password,
    });

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'That username or email and password do not match an account.'
          : error.message,
      );
      setBusy(false);
    }
    // On success the session listener swaps the screen out.
  }

  return (
    <div className="signin-page">
      <div className="signin-stack">
        <form className="signin-card" onSubmit={mode === 'signin' ? submit : sendReset}>
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

          {mode === 'sent' ? (
            <div className="signin-form">
              <h1 className="signin-title">Check your email</h1>
              <p className="signin-sent">
                If <strong>{identifier.trim()}</strong> has a recovery email, a link to choose a new
                password is on its way. It can take a minute — look in Spam too. The link works once,
                within about an hour.
              </p>
              <p className="signin-sent">No email? Ask an admin to reset your password.</p>
              <button type="button" className="signin-btn" onClick={goSignIn}>Back to sign in</button>
            </div>
          ) : mode === 'forgot' ? (
            <div className="signin-form">
              <h1 className="signin-title">Forgot your password?</h1>
              <p className="signin-sent">
                Type the username or email you sign in with. We&apos;ll email a link to choose a new
                password to the recovery email on your account.
              </p>

              {error && <div className="signin-error">{error}</div>}

              <label className="signin-field">
                <span>Username or email</span>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  autoFocus
                />
              </label>

              <button className="signin-btn" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <button type="button" className="signin-link" onClick={goSignIn}>Back to sign in</button>
            </div>
          ) : (
          <div className="signin-form">
            <h1 className="signin-title">Sign in</h1>
            <p className="signin-lede">Use the account the office set up for you.</p>

            {error && <div className="signin-error">{error}</div>}

            <label className="signin-field">
              <span>Username or email</span>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
              />
            </label>

            <label className="signin-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            <button className="signin-btn" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {resetReady ? (
              <button type="button" className="signin-link" onClick={() => { setMode('forgot'); setError(null); }}>
                Forgot your password?
              </button>
            ) : (
              <p className="signin-help">Forgot your password? Ask the admin to reset it for you.</p>
            )}
          </div>
          )}
        </form>

        <div className="signin-foot">
          <div className="signin-credit">
            <span className="signin-credit-label">A PRINTFLOW PRODUCT BY</span>
            <span className="signin-credit-brand">
              <img src="/brand/recon-mark.png" alt="" />
              <span className="signin-credit-name">RECONTECH</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
